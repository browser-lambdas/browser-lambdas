import { getLambdas } from './getLambdas.js';
import { ALLOW_MAIN_WORLD_FUNCTIONS_KEY } from './constants.js';
import { evaluateAccessPolicy, accessDenialReasons } from '../shared/accessPolicy.js';
import { getProjectSettings, evaluateProjectAccess } from '../shared/projectPolicy.js';
import { verifiedInvocation, invocationActive } from './invocations.js';

const MAIN_TIMEOUT = 30000;

// This function also runs as a packaged MAIN-world helper, without extension bindings.
async function pageOperation(operation, path, args, callback, arg) {
    const snapshot = (value, ancestors = new Set(), depth = 0) => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object' || depth > 50 || ancestors.has(value)) {
            throw new Error('Only plain JSON data can cross the MAIN boundary.');
        }
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
            || Object.getOwnPropertySymbols(value).length) {
            throw new Error('Only plain JSON data can cross the MAIN boundary.');
        }
        ancestors.add(value);
        const result = array ? [] : Object.create(null);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (array && Object.keys(descriptors).length !== value.length + 1) {
            throw new Error('Only dense arrays can cross the MAIN boundary.');
        }
        if (array) {
            for (let index = 0; index < value.length; index++) {
                if (!Object.hasOwn(descriptors, index)) throw new Error('Only dense arrays can cross the MAIN boundary.');
            }
        }
        for (const key of Object.keys(descriptors)) {
            if (array && key === 'length') continue;
            const descriptor = descriptors[key];
            if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
                throw new Error('Only plain JSON data can cross the MAIN boundary.');
            }
            result[key] = snapshot(descriptor.value, ancestors, depth + 1);
        }
        ancestors.delete(value);
        return result;
    };
    try {
        let value;
        if (operation === 'snapshot') value = args[0];
        else if (operation === 'run') value = await callback(arg);
        else {
            const parts = path.split('.');
            let owner = window;
            for (const part of parts.slice(0, -1)) owner = owner[part];
            const member = owner[parts.at(-1)];
            if (operation === 'get') value = await member;
            else {
                if (typeof member !== 'function') throw new Error('The MAIN path is not a function.');
                value = await Reflect.apply(member, owner, args);
            }
        }
        return value === undefined ? { ok: true, defined: false }
            : { ok: true, defined: true, json: JSON.stringify(snapshot(value)) };
    } catch (error) {
        return { ok: false, error: String(error?.message || error).slice(0, 500) };
    }
}

async function plainArgument(value) {
    const result = await pageOperation('snapshot', null, [value]);
    if (!result.ok) throw new Error(result.error);
    return result.defined ? JSON.parse(result.json) : undefined;
}

async function authorizeMain(invocation, token) {
    if (!invocationActive(token, invocation)
        || await verifiedInvocation(token, invocation.tabId) !== invocation) {
        throw new Error('MAIN access blocked: the invocation ended, its document changed or access was revoked.');
    }
    const [lambdas, settings, stored] = await Promise.all([
        getLambdas(), getProjectSettings(), chrome.storage.local.get(ALLOW_MAIN_WORLD_FUNCTIONS_KEY)
    ]);
    const globals = { allowMainWorldFunctions: stored[ALLOW_MAIN_WORLD_FUNCTIONS_KEY] === true };
    for (const caller of invocation.callers) {
        const matches = lambdas.filter((lambda) => (caller.id == null || lambda.id === caller.id)
            && lambda.name === caller.name && (lambda.project || 'default') === caller.project);
        if (matches.length !== 1) throw new Error('MAIN access blocked: a calling function could not be verified.');
        const url = (await chrome.tabs.get(caller.tabId).catch(() => null))?.url || '';
        const item = evaluateAccessPolicy({ policy: matches[0], executionWorld: 'MAIN_WORLD', url,
            allowMainWorld: globals.allowMainWorldFunctions });
        const project = evaluateProjectAccess({ settings, project: caller.project, category: 'functions',
            executionWorld: 'MAIN_WORLD', url, globals });
        if (!item.allowed || !project.allowed) {
            throw new Error(`MAIN access blocked: ${[...accessDenialReasons(item.reasons, 'MAIN_WORLD', 'function'),
                ...project.reasons].join('; ')}.`);
        }
    }
    if (!invocationActive(token, invocation)) throw new Error('The invocation ended before the MAIN operation.');
}

export async function handleMainRequest(msg, invocation, token) {
    const response = { type: 'MAIN_RESPONSE', id: msg.id };
    let timeout;
    try {
        if (!['get', 'call', 'run'].includes(msg.operation)) throw new Error('Unsupported MAIN operation.');
        if (!invocation?.documentId || !Number.isInteger(invocation.tabId)) throw new Error('The target document could not be verified.');
        if (msg.operation !== 'run' && (typeof msg.path !== 'string' || !msg.path.length
            || msg.path.length > 2048 || msg.path.split('.').some((part) => !part))) {
            throw new Error('A window-relative dot path is required.');
        }
        const args = msg.operation === 'call' ? await plainArgument(msg.args) : [];
        if (!Array.isArray(args)) throw new Error('MAIN call arguments must be an array of plain JSON data.');
        const arg = msg.operation === 'run' ? await plainArgument(msg.arg) : undefined;
        if (msg.operation === 'run' && (typeof msg.source !== 'string' || !msg.source.trim())) {
            throw new Error('A serialized MAIN callback is required.');
        }
        await authorizeMain(invocation, token);
        const target = { tabId: invocation.tabId, documentIds: [invocation.documentId] };
        let execution;
        if (msg.operation === 'run') {
            if (!chrome.userScripts?.execute) throw new Error('MAIN callbacks require user-script execution support.');
            // The callback expression is outside the helper's lexical scope.
            const code = `(${pageOperation.toString()})("run",null,null,(${msg.source}),${arg === undefined ? 'undefined' : JSON.stringify(arg)})`;
            execution = chrome.userScripts.execute({ target, world: 'MAIN', js: [{ code }] });
        } else {
            execution = chrome.scripting.executeScript({ target, world: 'MAIN', func: pageOperation,
                args: [msg.operation, msg.path, args] });
        }
        const results = await Promise.race([execution, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('The MAIN operation timed out. Page effects may already have occurred.')), MAIN_TIMEOUT);
        })]);
        await authorizeMain(invocation, token);
        const result = results?.find((entry) => entry.documentId === invocation.documentId);
        if (!result || result.error || !result.result || typeof result.result.ok !== 'boolean') {
            throw new Error('The MAIN operation failed or its target document is no longer available.');
        }
        const payload = result.result;
        if (!payload.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The MAIN operation failed.');
        if (payload.defined !== true && payload.defined !== false) throw new Error('The MAIN result is invalid.');
        const value = payload.defined ? await plainArgument(JSON.parse(payload.json)) : undefined;
        return { ...response, value };
    } catch (error) {
        return { ...response, error: String(error?.message || error).slice(0, 500) };
    } finally {
        clearTimeout(timeout);
    }
}
