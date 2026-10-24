import { getTriggers } from './getTriggers.js';
import { ALLOW_MAIN_WORLD_FUNCTIONS_KEY } from './constants.js';
import { evaluateAccessPolicy, evaluateUrlAccessPolicy, accessDenialReasons } from '../shared/accessPolicy.js';
import { log } from './activityLog.js';
import { lambdafy } from './lambdafy.js';
import { findLambdas, isLambdaPending } from './getLambdas.js';
import { generateSessionKey } from './generateSessionKey.js';
import { getProjectSettings, getProjectCategorySettings, evaluateProjectAccess } from '../shared/projectPolicy.js';
import { registerInvocation, finishInvocation } from './invocations.js';
import {
    MAIN_WORLD,
    USER_SCRIPT_WORLD,
    parseExecutionInvocation
} from './parseExecutionInvocation.js';

export const MAX_NESTED_LAMBDA_DEPTH = 5;

const prepareLambda = async (lambda, userInput, requestId, executionWorld, nestedDepth, tabId, callers) => {
    const context = {
        qToken: crypto.randomUUID(),
        aToken: crypto.randomUUID(),
        handshakeId: crypto.randomUUID(),
        sessionKey: await generateSessionKey(),
        requestId,
        nestedDepth,
        executionWorld
    };
    const code = lambdafy(lambda.func, userInput, context);
    // This capability only travels through extension messaging, never the injected code.
    const { token, completion } = registerInvocation({ lambda, tabId, executionWorld, requestId, callers });
    context.invocationToken = token;
    return { code, context, completion };
};

const initializeLambdaRuntime = (tabId, context) => chrome.tabs.sendMessage(tabId, {
    type: 'BACKGROUND_INIT_HANDSHAKE',
    ...context
});

const executeLambdaInMainWorld = async ({ lambda, tabId, userInput, requestId, nestedDepth, callers }) => {
    const { code, context, completion } = await prepareLambda(lambda, userInput, requestId, MAIN_WORLD, nestedDepth, tabId, callers);
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (src) => new Function(src)(),
            args: [code]
        });
        await initializeLambdaRuntime(tabId, context);
        return { started: true, completion };
    } catch (error) {
        finishInvocation(context.invocationToken, tabId, requestId, { error: error.message });
        throw error;
    }
};

const executeLambdaInUserWorld = async ({ lambda, tabId, userInput, requestId, nestedDepth, callers }) => {
    if (!chrome.userScripts?.execute)
        throw new Error('User-script execution is not enabled in Chrome.');
    const { code, context, completion } = await prepareLambda(lambda, userInput, requestId, USER_SCRIPT_WORLD, nestedDepth, tabId, callers);
    try {
        const results = await chrome.userScripts.execute({
            target: { tabId },
            world: 'USER_SCRIPT',
            js: [{ code }]
        });
        if (results.length === 0)
            throw new Error('The user script did not run in the selected tab.');
        await initializeLambdaRuntime(tabId, context);
        return { started: true, completion };
    } catch (error) {
        finishInvocation(context.invocationToken, tabId, requestId, { error: error.message });
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
