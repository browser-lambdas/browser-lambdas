import { matchesUrlPattern, parseUrlPattern } from './urlPattern.js';

export function normalizeAccessPolicy(item = {}) {
    return {
        urlAllowlistEnabled: item.urlAllowlistEnabled === true,
        allowedWorlds: !Object.hasOwn(item, 'allowedWorlds') ? ['user_scripts']
            : Array.isArray(item.allowedWorlds) ? [...new Set(item.allowedWorlds.filter((world) => ['user_scripts', 'main'].includes(world)))] : [],
        urlPatterns: Array.isArray(item.urlPatterns)
            ? item.urlPatterns.filter((pattern) => typeof pattern === 'string').map((pattern) => pattern.trim()).filter(Boolean) : []
    };
}

export function normalizeExecutionWorld(world) {
    return world === 'MAIN_WORLD' ? 'main' : world === 'USER_SCRIPT_WORLD' ? 'user_scripts' : null;
}

export function evaluateAccessPolicy({ policy, executionWorld, url, allowMainWorld }) {
    const normalized = normalizeAccessPolicy(policy);
    const world = normalizeExecutionWorld(executionWorld);
    const reasons = [];
    if (!world) reasons.push('unverified_world');
    if (world === 'main' && allowMainWorld !== true) reasons.push('global_main_disabled');
    if (world && !normalized.allowedWorlds.includes(world)) reasons.push('world_denied');
    reasons.push(...evaluateUrlAccessPolicy({ policy: normalized, url }).reasons);
    return { allowed: reasons.length === 0, reasons };
}

export function evaluateUrlAccessPolicy({ policy, url }) {
    const normalized = normalizeAccessPolicy(policy);
    const reasons = [];
    if (!url) reasons.push('page_denied');
    else if (normalized.urlAllowlistEnabled) {
        if (!normalized.urlPatterns.length) reasons.push('no_pages');
        else if (!normalized.urlPatterns.some((pattern) => {
            try { return matchesUrlPattern(pattern, url); } catch { return false; }
        })) reasons.push('page_denied');
    }
    return { allowed: reasons.length === 0, reasons };
}

export function validateAccessPolicy(item) {
    for (const [enabled, list] of [['projectsEnabled', 'allowedProjects'], ['functionsEnabled', 'allowedFunctions']]) {
        if (Object.hasOwn(item, enabled) && typeof item[enabled] !== 'boolean') throw new Error('Invalid caller restriction.');
        if (Object.hasOwn(item, list) && (!Array.isArray(item[list]) || item[list].some((name) => typeof name !== 'string'))) throw new Error('Caller restrictions must be lists of names.');
    }
    const policy = normalizeAccessPolicy(item);
    if (!policy.urlAllowlistEnabled) return;
    for (const pattern of policy.urlPatterns) {
        const { source, flags } = parseUrlPattern(pattern);
        new RegExp(source, flags);
    }
}

export function accessDenialReasons(reasons, executionWorld, kind) {
    const world = normalizeExecutionWorld(executionWorld);
    const messages = {
        unverified_world: 'the execution world could not be verified',
        global_main_disabled: `main-world ${kind} access is disabled globally`,
        world_denied: `the ${world} execution world is not allowed for this ${kind}`,
        no_pages: 'no allowed URL patterns are configured',
        page_denied: 'the current URL does not match any allowed pattern'
    };
    return reasons.map((reason) => messages[reason]);
}

// Collapse the former read/write grants without granting a previously denied operation.
export function normalizeStoragePolicy(item = {}) {
    const policy = normalizeAccessPolicy(item);
    const grants = (field) => Object.hasOwn(item, field)
        ? normalizeAccessPolicy({ allowedWorlds: item[field] }).allowedWorlds : policy.allowedWorlds;
    return { ...policy, ...normalizeCallerRestrictions(item), allowedWorlds: grants('allowedReadWorlds').filter((world) => grants('allowedWriteWorlds').includes(world)) };
}

export function normalizeCallerRestrictions(item = {}) {
    const normalized = {};
    for (const key of ['projectsEnabled', 'functionsEnabled']) if (Object.hasOwn(item, key)) normalized[key] = item[key] === true;
    for (const key of ['allowedProjects', 'allowedFunctions']) if (Object.hasOwn(item, key)) normalized[key] = Array.isArray(item[key]) ? [...new Set(item[key].filter((name) => typeof name === 'string').map((name) => name.trim()).filter(Boolean))] : [];
    return normalized;
}

export function normalizeStorageItem(item) {
    const normalized = { ...item, ...normalizeStoragePolicy(item) };
    delete normalized.allowedReadWorlds;
    delete normalized.allowedWriteWorlds;
    return normalized;
}

export function functionExecutionOptions(item, allowMainWorld) {
    const { allowedWorlds } = normalizeAccessPolicy(item);
    const worlds = [];
    if (allowedWorlds.includes('user_scripts')) worlds.push('USER_SCRIPT');
    if (allowMainWorld === true && allowedWorlds.includes('main')) worlds.push('MAIN');
    return { worlds, selected: worlds.includes(item.world) ? item.world : worlds[0] || null };
}
