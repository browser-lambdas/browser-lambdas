import { LAMBDA_STORAGE_KEY } from './constants.js';
import { parseStorageRecords, sameStorageRecord } from '../shared/storageRecords.js';
import { normalizeStoragePolicy, normalizeStorageItem, validateAccessPolicy } from '../shared/accessPolicy.js';

let mutationQueue = Promise.resolve();
export async function readStorageRecords() {
    const stored = await chrome.storage.local.get(LAMBDA_STORAGE_KEY);
    return parseStorageRecords(stored[LAMBDA_STORAGE_KEY]);
}

export function mutateStorageRecords(mutate) {
    const operation = mutationQueue.then(async () => {
        const records = await readStorageRecords();
        const result = await mutate(records);
        if (result.changed) await chrome.storage.local.set({ [LAMBDA_STORAGE_KEY]: JSON.stringify(records) });
        return result;
    });
    mutationQueue = operation.catch(() => {});
    return operation;
}

export function isWorkspaceSender(sender) {
    if (sender.id !== chrome.runtime.id || !sender.url) return false;
    try {
        const url = new URL(sender.url);
        url.search = '';
        url.hash = '';
        return url.href === chrome.runtime.getURL('workspace.html');
    } catch { return false; }
}

export function mutateWorkspaceStorage(message) {
    return mutateStorageRecords((records) => {
        const { operation, expected, item } = message;
        const index = records.findIndex((record) => record.id === expected?.id);
        if (!['create', 'update', 'delete'].includes(operation)) throw new Error('Unknown storage operation.');
        if (operation !== 'create' && (index < 0 || !sameStorageRecord(records[index], expected))) {
            return { changed: false, success: false, conflict: true, error: 'This storage item changed or was deleted elsewhere. Reopen it from the sidebar before saving or deleting.' };
        }
        if (operation === 'delete') {
            records.splice(index, 1);
            return { changed: true, success: true };
        }
        if (!item || typeof item.key !== 'string' || !Object.hasOwn(item, 'value')) throw new Error('Invalid storage item.');
        validateAccessPolicy(item);
        const next = normalizeStorageItem({
            ...(operation === 'update' ? normalizeStorageItem(records[index]) : {}),
            id: operation === 'create' ? crypto.randomUUID() : records[index].id,
            key: item.key, value: item.value, ...normalizeStoragePolicy(item)
        });
        if (operation === 'create') records.push(next);
        else records[index] = next;
        return { changed: true, success: true, item: next };
    });
}
