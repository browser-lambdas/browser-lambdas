import { matchesUrlPattern, parseUrlPattern } from './urlPattern.js';
import { sameStorageRecord } from './storageRecords.js';

export const PROJECT_SETTINGS_KEY = 'local_storage_key_project_settings';
const categories = ['functions', 'triggers', 'styles'];
const booleans = ['enabled', 'userWorld', 'mainWorld', 'restrictUrls', 'poll', 'review', 'lock'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const lines = (value) => (typeof value === 'string' ? value.split('\n') : Array.isArray(value) ? value : []).map((line) => {
    if (typeof line !== 'string') throw new Error('URL patterns must be text.');
    return line.trim();
}).filter(Boolean);

export function normalizeProjectCategorySettings(input, category = 'functions') {
    if (!object(input)) throw new Error('Project settings are invalid.');
    const result = {};
    for (const key of booleans) {
        if (category === 'functions' && key === 'enabled') continue;
        if (category !== 'functions' && ['userWorld', 'mainWorld'].includes(key)) continue;
        if (category === 'styles' && key === 'restrictUrls') continue;
        if (!Object.hasOwn(input, key)) continue;
        if (typeof input[key] !== 'boolean') throw new Error(`Invalid project setting: ${key}.`);
        result[key] = input[key];
    }
    if (category === 'functions' && Object.hasOwn(input, 'enabled')) {
        if (typeof input.enabled !== 'boolean') throw new Error('Invalid project setting: enabled.');
        if (!input.enabled) Object.assign(result, { userWorld: false, mainWorld: false });
    }
    if (category === 'functions' && Object.hasOwn(input, 'mode')) {
        if (!['USER_SCRIPT', 'MAIN'].includes(input.mode)) throw new Error('Invalid execution mode.');
        result.mode = input.mode;
    }
    if (category !== 'styles' && Object.hasOwn(input, 'urlPatterns')) {
        if (typeof input.urlPatterns !== 'string' && !Array.isArray(input.urlPatterns)) throw new Error('URL patterns must be a list.');
        const patterns = lines(input.urlPatterns);
        for (const pattern of patterns) {
            const { source, flags } = parseUrlPattern(pattern);
            new RegExp(source, flags);
        }
        result.urlPatterns = patterns.join('\n');
    }
    return result;
}

export function normalizeProjectSettings(input = {}) {
    if (!object(input)) throw new Error('Saved project settings are invalid.');
    return Object.fromEntries(Object.entries(input).map(([project, settings]) => {
        if (!object(settings)) throw new Error('Saved project settings are invalid.');
        return [project, Object.fromEntries(categories.filter((category) => Object.hasOwn(settings, category))
            .map((category) => [category, normalizeProjectCategorySettings(settings[category], category)]))];
    }));
}

export async function getProjectSettings() {
    const stored = await chrome.storage.local.get(PROJECT_SETTINGS_KEY);
    return normalizeProjectSettings(stored[PROJECT_SETTINGS_KEY] ?? {});
}

export function getProjectCategorySettings(settings, project, category, globals = {}) {
    if (!categories.includes(category)) throw new Error('Unknown project category.');
    const name = project || 'default';
    const projectSettings = Object.hasOwn(settings, name) ? settings[name] : {};
    const saved = normalizeProjectCategorySettings(projectSettings[category] || {}, category);
    const mainWorld = globals.allowMainWorldFunctions === true && saved.mainWorld !== false;
    return {
        enabled: category === 'functions'
            ? saved.userWorld !== false || mainWorld
            : saved.enabled !== false,
        ...(category === 'functions' ? { userWorld: saved.userWorld !== false, mainWorld, mode: saved.mode } : {}),
        restrictUrls: saved.restrictUrls === true,
        urlPatterns: lines(saved.urlPatterns),
        poll: globals.baahPollChanges !== false && saved.poll !== false,
        review: globals.baahRequireReview !== false || saved.review === true,
        lock: saved.lock === true
    };
}

export function evaluateProjectAccess({ settings, project, category, executionWorld, url, globals = {} }) {
    const policy = getProjectCategorySettings(settings, project, category, globals);
    const reasons = [];
    const label = `project ${JSON.stringify(project || 'default')}`;
    if (!policy.enabled) reasons.push(`${category} are disabled for ${label}`);
    if (category === 'functions') {
        if (['MAIN', 'MAIN_WORLD'].includes(executionWorld) && !policy.mainWorld) reasons.push(`main-world access is disabled for ${label}`);
        if (['USER_SCRIPT', 'USER_SCRIPT_WORLD'].includes(executionWorld) && !policy.userWorld) reasons.push(`user-world access is disabled for ${label}`);
    }
    if (policy.restrictUrls && (!url || !policy.urlPatterns.some((pattern) => matchesUrlPattern(pattern, url)))) reasons.push(`the URL is not allowed by ${label}`);
    return { allowed: reasons.length === 0, reasons };
}

let saveQueue = Promise.resolve();
export function saveProjectSettings({ project, settings, expected }) {
    const save = saveQueue.then(async () => {
        if (typeof project !== 'string' || !project) throw new Error('A project is required.');
        const normalized = normalizeProjectSettings({ [project]: settings })[project];
        const stored = await getProjectSettings();
        const current = Object.hasOwn(stored, project) ? stored[project] : {};
        if (!sameStorageRecord(current, expected || {})) return { success: false, conflict: true, error: 'Project settings changed elsewhere. Reopen the project settings before saving.' };
        await chrome.storage.local.set({ [PROJECT_SETTINGS_KEY]: { ...stored, [project]: normalized } });
        return { success: true, settings: normalized };
    });
    saveQueue = save.catch(() => {});
    return save;
}
