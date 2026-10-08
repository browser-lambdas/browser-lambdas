import { uuid } from './uuid.js';
import { normalizeAccessPolicy, normalizeStoragePolicy } from './accessPolicy.js';

// Factories for new records. Existing records retain their fields and permissions;
// accessPolicy.js owns policy normalization and validation, storageRecords.js parsing.
export function newLambda(name = '', func = '', project = '', world = 'USER_SCRIPT') {
    return { id: uuid(), name, project, func, world, ...normalizeAccessPolicy() };
}

export function newStorageItem(key = '', value = '') {
    return { id: uuid(), key, value, ...normalizeStoragePolicy() };
}

// Runtime-created KV items intentionally have broader defaults than workspace items.
// The background still enforces the verified world and global main-world setting.
export function newRuntimeStorageItem(key, value) {
    return { ...newStorageItem(key, value), allowedWorlds: ['user_scripts', 'main'] };
}

export function newSecret(key = '', value = '') {
    return { id: uuid(), key, value, ...normalizeAccessPolicy() };
}

export function newTrigger(name = '', patterns = [], commands = [], project = '') {
    return { id: uuid(), name, project, patterns: [...patterns], commands: [...commands], allowedWorlds: ['user_scripts'] };
}

export function newStyle(name = '', css = '', project = '') {
    return { id: uuid(), name, project, css, selected: false };
}
