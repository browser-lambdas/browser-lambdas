import { getLambdas } from './getLambdas.js';
import { ALLOW_MAIN_WORLD_FUNCTIONS_KEY } from './constants.js';
import { evaluateAccessPolicy } from '../shared/accessPolicy.js';
import { getProjectSettings, evaluateProjectAccess } from '../shared/projectPolicy.js';

const invocations = new Map();

export function registerInvocation({ lambda, tabId, executionWorld, requestId, callers = [] }) {
    const token = crypto.randomUUID();
    let complete;
    const completion = new Promise((resolve) => { complete = resolve; });
    invocations.set(token, {
        tabId, executionWorld, requestId, complete,
        callers: [...callers, { id: lambda.id, name: lambda.name, project: lambda.project || 'default', tabId, executionWorld }]
    });
    return { token, completion };
}

export function finishInvocation(token, tabId, requestId, result = {}) {
    const invocation = invocations.get(token);
    if (!invocation || invocation.tabId !== tabId || invocation.requestId !== requestId) return false;
    invocations.delete(token);
    invocation.complete(result);
    return true;
}

export function clearTabInvocations(tabId) {
    for (const [token, invocation] of invocations) {
        if (invocation.tabId === tabId) finishInvocation(token, tabId, invocation.requestId, { error: 'The tab disconnected before the function finished.' });
    }
}

export async function verifiedInvocation(token, tabId) {
    const invocation = invocations.get(token);
    if (!invocation || invocation.tabId !== tabId) return null;
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
        const url = (await chrome.tabs.get(caller.tabId).catch(() => null))?.url || '';
        const itemPolicy = evaluateAccessPolicy({ policy: matches[0], executionWorld: caller.executionWorld, url, allowMainWorld: globals.allowMainWorldFunctions });
        const projectPolicy = evaluateProjectAccess({ settings, project: caller.project, category: 'functions', executionWorld: caller.executionWorld, url, globals });
        if (!itemPolicy.allowed || !projectPolicy.allowed) return null;
    }
    return invocation;
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
