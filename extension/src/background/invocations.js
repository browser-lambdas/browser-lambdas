import { getLambdas } from './getLambdas.js';
import { ALLOW_MAIN_WORLD_FUNCTIONS_KEY } from './constants.js';
import { evaluateAccessPolicy } from '../shared/accessPolicy.js';
import { getProjectSettings, evaluateProjectAccess } from '../shared/projectPolicy.js';

const invocations = new Map();
const connectionGrants = new Map();

export function registerInvocation({ lambda, tabId, documentId, frameId = 0, worldId, executionWorld, requestId, callers = [] }) {
    const token = crypto.randomUUID();
    let complete;
    const completion = new Promise((resolve) => { complete = resolve; });
    let start;
    const ready = new Promise((resolve) => { start = resolve; });
    const invocation = {
        tabId, documentId, frameId, worldId, executionWorld, requestId, complete, start, cleanup: new Set(),
        callers: [...callers, { id: lambda.id, name: lambda.name, project: lambda.project || 'default', tabId, documentId, frameId, worldId, executionWorld }]
    };
    invocations.set(token, invocation);
    return { token, completion, ready };
}

export const invocationActive = (token, invocation) => invocations.get(token) === invocation;

export function watchInvocation(token, cleanup) {
    const invocation = invocations.get(token);
    if (!invocation) return false;
    invocation.cleanup.add(cleanup);
    return true;
}

export function markInvocationReady(token, tabId, documentId) {
    const invocation = invocations.get(token);
    if (!invocation || (tabId != null && (invocation.tabId !== tabId || invocation.documentId !== documentId))) return false;
    invocation.start({ started: true });
    return true;
}

export function issueConnectionGrant(token) {
    const invocation = invocations.get(token);
    if (!invocation) throw new Error('The function invocation is no longer active.');
    const grant = crypto.randomUUID();
    invocation.grant = grant;
    connectionGrants.set(grant, token);
    return grant;
}

export function consumeConnectionGrant(grant, sender) {
    const token = connectionGrants.get(grant);
    const invocation = invocations.get(token);
    if (!invocation || invocation.executionWorld !== 'USER_SCRIPT_WORLD'
        || sender?.tab?.id !== invocation.tabId || sender.frameId !== invocation.frameId
        || sender.documentId !== invocation.documentId) return null;
    connectionGrants.delete(grant);
    delete invocation.grant;
    return { token, invocation };
}

export function finishInvocation(token, tabId, requestId, result = {}) {
    const invocation = invocations.get(token);
    if (!invocation || invocation.tabId !== tabId || invocation.requestId !== requestId) return false;
    invocations.delete(token);
    if (invocation.grant) connectionGrants.delete(invocation.grant);
    invocation.start({ started: false, error: result.error || 'The function stopped before startup completed.' });
    for (const cleanup of invocation.cleanup) {
        try { cleanup(result); } catch { /* A disconnected transport must not prevent completion. */ }
    }
    invocation.complete(result);
    return true;
}

export function clearTabInvocations(tabId) {
    for (const [token, invocation] of invocations) {
        if (invocation.tabId === tabId) finishInvocation(token, tabId, invocation.requestId, { error: 'The tab disconnected before the function finished.' });
    }
}

export function clearDocumentInvocations(tabId, documentId) {
    for (const [token, invocation] of invocations) {
        if (invocation.tabId === tabId && invocation.documentId !== documentId) {
            finishInvocation(token, tabId, invocation.requestId, { error: 'The target page changed before the function finished.' });
        }
    }
}

export async function revokeInvalidInvocations() {
    await Promise.all([...invocations].map(async ([token, invocation]) => {
        if (!(await verifiedInvocation(token, invocation.tabId))) {
            finishInvocation(token, invocation.tabId, invocation.requestId, { error: 'Function access was revoked. Run the function again after checking its permissions.' });
        }
    }));
}

export async function verifiedInvocation(token, tabId) {
    const invocation = invocations.get(token);
    if (!invocation || invocation.tabId !== tabId) return null;
    if (invocation.worldId) {
        try {
            const worlds = await chrome.userScripts.getWorldConfigurations();
            if (!worlds.some((world) => world.worldId === invocation.worldId && world.messaging === true)) return null;
        } catch { return null; }
    }
    const [lambdas, settings, stored] = await Promise.all([
        getLambdas(), getProjectSettings(),
        chrome.storage.local.get(ALLOW_MAIN_WORLD_FUNCTIONS_KEY)
    ]);
    const globals = {
        allowMainWorldFunctions: stored[ALLOW_MAIN_WORLD_FUNCTIONS_KEY] === true
    };
    for (const caller of invocation.callers) {
        const matches = lambdas.filter((lambda) => (caller.id == null || lambda.id === caller.id)
            && lambda.name === caller.name && (lambda.project || 'default') === caller.project);
        if (matches.length !== 1) return null;
        const frame = caller.documentId
            ? await chrome.webNavigation.getFrame({ tabId: caller.tabId, frameId: caller.frameId ?? 0 }).catch(() => null)
            : null;
        if (caller.documentId && frame?.documentId !== caller.documentId) return null;
        const url = frame?.url || (await chrome.tabs.get(caller.tabId).catch(() => null))?.url || '';
        const itemPolicy = evaluateAccessPolicy({ policy: matches[0], executionWorld: caller.executionWorld, url, allowMainWorld: globals.allowMainWorldFunctions });
        const projectPolicy = evaluateProjectAccess({ settings, project: caller.project, category: 'functions', executionWorld: caller.executionWorld, url, globals });
        if (!itemPolicy.allowed || !projectPolicy.allowed) return null;
    }
    return invocationActive(token, invocation) ? invocation : null;
}

export function callerAccessReasons(item, invocation) {
    if (item.projectsEnabled !== true && item.functionsEnabled !== true) return [];
    if (!invocation?.callers?.length) return ['the calling function could not be verified'];
    const reasons = [];
    if (item.projectsEnabled === true && (!Array.isArray(item.allowedProjects)
        || !invocation.callers.every((caller) => item.allowedProjects.includes(caller.project)))) {
        reasons.push('a calling project is not in the allowed projects');
    }
    if (item.functionsEnabled === true && (!Array.isArray(item.allowedFunctions)
        || !invocation.callers.every((caller) => item.allowedFunctions.includes(`${caller.project}/${caller.name.split(/\s+/)[0]}`)))) {
        reasons.push('a calling function is not in the allowed functions');
    }
    return reasons;
}
