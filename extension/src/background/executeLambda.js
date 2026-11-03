import { getTriggers } from './getTriggers.js';
import { ALLOW_MAIN_WORLD_FUNCTIONS_KEY } from './constants.js';
import { evaluateAccessPolicy, evaluateUrlAccessPolicy, accessDenialReasons } from '../shared/accessPolicy.js';
import { log } from './activityLog.js';
import { lambdafy } from './lambdafy.js';
import { findLambdas, isLambdaPending } from './getLambdas.js';
import { generateSessionKey } from './generateSessionKey.js';
import { getProjectSettings, getProjectCategorySettings, evaluateProjectAccess } from '../shared/projectPolicy.js';
import { registerInvocation, finishInvocation, issueConnectionGrant, watchInvocation, verifiedInvocation } from './invocations.js';
import { postToContent, contentPort } from './contentPorts.js';
import { configureUserWorld, releaseUserWorld, checkUserWorld } from './userWorlds.js';
import {
    MAIN_WORLD,
    USER_SCRIPT_WORLD,
    parseExecutionInvocation
} from './parseExecutionInvocation.js';

export const MAX_NESTED_LAMBDA_DEPTH = 5;

const prepareLambda = async (lambda, userInput, requestId, executionWorld, nestedDepth, tabId, callers, worldId) => {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!frame?.documentId) throw new Error('The target page is unavailable. Reload it and try again.');
    const { token, completion, ready } = registerInvocation({ lambda, tabId, documentId: frame.documentId, frameId: 0, worldId, executionWorld, requestId, callers });
    try {
        const native = executionWorld === USER_SCRIPT_WORLD;
        const context = { requestId, nestedDepth, executionWorld, documentId: frame.documentId };
        if (native) context.connectionGrant = issueConnectionGrant(token);
        else Object.assign(context, {
            qToken: crypto.randomUUID(), aToken: crypto.randomUUID(), handshakeId: crypto.randomUUID(),
            sessionKey: await generateSessionKey()
        });
        const code = lambdafy(lambda.func, userInput, context);
        // The canonical capability remains worker-owned; only a one-use grant is injected.
        context.invocationToken = token;
        const timeout = setTimeout(() => finishInvocation(token, tabId, requestId, { error: 'The function runtime connection timed out. Reload the page and try again.' }), 5000);
        ready.then(() => clearTimeout(timeout));
        watchInvocation(token, () => clearTimeout(timeout));
        if (!native) watchInvocation(token, (result) => {
            try { postToContent(tabId, frame.documentId, { type: 'RUNTIME_FINISHED', requestId, error: result.error }); } catch {}
        });
        return { code, context, completion, ready };
    } catch (error) {
        finishInvocation(token, tabId, requestId, { error: error.message });
        throw error;
    }
};

const executeLambdaInMainWorld = async ({ lambda, tabId, userInput, requestId, nestedDepth, callers }) => {
    const { code, context, completion, ready } = await prepareLambda(lambda, userInput, requestId, MAIN_WORLD, nestedDepth, tabId, callers);
    try {
        contentPort(tabId, context.documentId);
        if (!(await verifiedInvocation(context.invocationToken, tabId))) throw new Error('Function access was revoked or its target page changed.');
        await chrome.scripting.executeScript({
            target: { tabId, documentIds: [context.documentId] }, world: 'MAIN',
            func: (src) => { new Function(src)(); }, args: [code]
        });
        postToContent(tabId, context.documentId, { type: 'BACKGROUND_INIT_HANDSHAKE', ...context });
        const startup = await ready;
        return { ...startup, completion };
    } catch (error) {
        finishInvocation(context.invocationToken, tabId, requestId, { error: error.message });
        throw error;
    }
};

const executeLambdaInUserWorld = async ({ lambda, tabId, userInput, requestId, nestedDepth, callers }) => {
    const worldId = await configureUserWorld(lambda, callers);
    let prepared;
    try {
        prepared = await prepareLambda(lambda, userInput, requestId, USER_SCRIPT_WORLD, nestedDepth, tabId, callers, worldId);
        const { code, context, completion, ready } = prepared;
        completion.then(() => releaseUserWorld(worldId));
        await checkUserWorld(tabId, context.documentId, worldId);
        if (!(await verifiedInvocation(context.invocationToken, tabId))) throw new Error('Function access was revoked or its target page changed.');
        const results = await chrome.userScripts.execute({
            target: { tabId, documentIds: [context.documentId] }, world: 'USER_SCRIPT',
            worldId, js: [{ code }]
        });
        if (results.length !== 1 || results[0].error) throw new Error(results[0]?.error || 'The user script did not run in the selected document.');
        const startup = await ready;
        return { ...startup, completion };
    } catch (error) {
        if (prepared) finishInvocation(prepared.context.invocationToken, tabId, requestId, { error: error.message });
        else await releaseUserWorld(worldId);
        throw error;
    }
};

export async function executeLambda(tabId, rawInput, requestId, nestedDepth = 0, triggerReference = null, callers = []) {
    const invocation = parseExecutionInvocation(rawInput);
    if (invocation.invalidPrefix) {
        return { started: false, error: `Invalid prefix ${invocation.invalidPrefix}` };
    }
    const [cmd] = invocation.userInput.split(/\s+/);
    if (!cmd)
        return { started: false, error: 'Missing lambda name after execution prefix.' };
    if (await isLambdaPending(cmd)) {
        const error = `Lambda "${cmd}" is locked until its pending change is approved.`;
        log.dbg(`Function execution skipped: ${error} (tabId=${tabId}, requestId=${requestId}).`);
        return { started: false, error };
    }
    if (nestedDepth > MAX_NESTED_LAMBDA_DEPTH) {
        const error = `Maximum nested lambda depth (${MAX_NESTED_LAMBDA_DEPTH}) reached.`;
        log.dbg(`Function execution skipped: ${error} (tabId=${tabId}, requestId=${requestId}).`);
        return { started: false, error };
    }
    log.dbg(`Function execution requested: command="${cmd}", tabId=${tabId}, requestId=${requestId}.`);
    const matches = await findLambdas(cmd);
    if (matches.length === 0) {
        log.err(`Function execution skipped: no function named "${cmd}" was found (tabId=${tabId}, requestId=${requestId}).`);
        return { started: false, error: `No lambda named "${cmd}" was found.` };
    }
    if (matches.length > 1) {
        const error = `Function name conflict for "${cmd}" across projects: ${matches.map((match) => match.project || 'default').join(', ')}. Rename one function or remove the duplicate before invoking.`;
        log.err(error);
        return { started: false, error };
    }
    const lambda = matches[0];
    const execution = {
        lambda,
        tabId,
        userInput: invocation.userInput,
        requestId,
        nestedDepth,
        callers
    };
    const settings = await chrome.storage.local.get(ALLOW_MAIN_WORLD_FUNCTIONS_KEY);
    const projectSettings = await getProjectSettings();
    const globals = {
        allowMainWorldFunctions: settings[ALLOW_MAIN_WORLD_FUNCTIONS_KEY] === true
    };
    const project = getProjectCategorySettings(projectSettings, lambda.project || 'default', 'functions', globals);
    const defaultWorld = lambda.world || project.mode || 'USER_SCRIPT';
    const selectedWorld = invocation.hasExecutionPrefix
        ? invocation.execution
        : defaultWorld === 'MAIN' ? MAIN_WORLD : USER_SCRIPT_WORLD;
    const currentTab = tabId == null ? null : await chrome.tabs.get(tabId).catch(() => null);
    // Only the background trigger dispatcher supplies this reference. Reload the
    // definition for each command so revoked permissions/deletions take effect.
    if (triggerReference) {
        const triggers = await getTriggers();
        const matches = triggers.filter((trigger) => triggerReference.id != null
            ? trigger.id === triggerReference.id
            : trigger.name === triggerReference.name && (trigger.project || 'default') === (triggerReference.project || 'default'));
        const trigger = matches.length === 1 ? matches[0] : null;
        if (!trigger || !Array.isArray(trigger.commands) || !trigger.commands.includes(rawInput)) {
            const error = 'Trigger execution blocked: the trigger or command changed or was removed.';
            log.err(error);
            return { started: false, error };
        }
        const policy = evaluateUrlAccessPolicy({
            policy: { ...trigger, urlPatterns: trigger.patterns, urlAllowlistEnabled: true },
            url: currentTab?.url || ''
        });
        const projectPolicy = evaluateProjectAccess({ settings: projectSettings, project: trigger.project || 'default', category: 'triggers', url: currentTab?.url || '' });
        if (trigger.enabled === false || !policy.allowed || !projectPolicy.allowed) {
            const reasons = [...accessDenialReasons(policy.reasons, selectedWorld, 'trigger'), ...projectPolicy.reasons];
            if (trigger.enabled === false) reasons.push('automatic execution is disabled for this trigger');
            const error = `Trigger execution blocked for ${JSON.stringify(trigger.name || 'unnamed')}: ${reasons.join('; ')}.`;
            log.err(error);
            return { started: false, error };
        }
    }
    const policy = evaluateAccessPolicy({
        policy: lambda, executionWorld: selectedWorld, url: currentTab?.url || '',
        allowMainWorld: globals.allowMainWorldFunctions
    });
    const projectPolicy = evaluateProjectAccess({ settings: projectSettings, project: lambda.project || 'default', category: 'functions', executionWorld: selectedWorld, url: currentTab?.url || '', globals });
    if (!policy.allowed || !projectPolicy.allowed) {
        const error = `Function execution blocked for ${JSON.stringify(cmd)}: ${[...accessDenialReasons(policy.reasons, selectedWorld, 'function'), ...projectPolicy.reasons].join('; ')}.`;
        log.err(error);
        return { started: false, error };
    }
    if (selectedWorld === USER_SCRIPT_WORLD)
        return executeLambdaInUserWorld(execution);
    if (selectedWorld === MAIN_WORLD)
        return executeLambdaInMainWorld(execution);
    throw new Error(`Unsupported lambda execution world: ${selectedWorld}.`);
}
