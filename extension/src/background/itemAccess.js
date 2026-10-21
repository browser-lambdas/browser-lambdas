import { ALLOW_MAIN_WORLD_SECRETS_KEY, ALLOW_MAIN_WORLD_STORAGE_KEY, LAMBDA_SECRETS_KEY } from './constants.js';
import { evaluateAccessPolicy, accessDenialReasons, normalizeStoragePolicy, normalizeStorageItem } from '../shared/accessPolicy.js';
import { readStorageRecords, mutateStorageRecords } from './storageRepository.js';
import { appendActivityLog } from './activityLog.js';
import { newRuntimeStorageItem } from '../shared/records.js';
import { verifiedInvocation, callerAccessReasons } from './invocations.js';

export async function handleItemAccess(msg, tabId) {
    const secret = msg.type === 'GET_SECRET_REQUEST';
    const write = msg.type === 'SET_STORAGE_REQUEST';
    const kind = secret ? 'secret' : 'storage';
    const response = { type: msg.type.replace('_REQUEST', '_RESPONSE'), id: msg.id, value: write ? false : null };
    let url = '';
    try {
        if (typeof msg.key !== 'string' || (write && !Object.hasOwn(msg, 'value'))) throw new Error('Invalid storage request.');
        const operate = async (records) => {
            const invocation = await verifiedInvocation(msg.invocationToken, tabId);
            if (Object.hasOwn(msg, 'invocationToken') && !invocation) {
                return { changed: false, ...response, error: 'Access blocked: the calling function could not be verified or its access was revoked. Run the function again.' };
            }
            const executionWorld = invocation?.executionWorld || msg.executionWorld;
            url = tabId == null ? '' : (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
            const settingKey = secret ? ALLOW_MAIN_WORLD_SECRETS_KEY : ALLOW_MAIN_WORLD_STORAGE_KEY;
            const setting = await chrome.storage.local.get(settingKey);
            const item = records.find((record) => record.key === msg.key);
            if (!item && !secret && !write) return { changed: false, ...response, found: false, key: msg.key };
            if (!item && write) {
                const created = newRuntimeStorageItem(msg.key, msg.value);
                const policy = evaluateAccessPolicy({ policy: created, executionWorld, url, allowMainWorld: setting[settingKey] });
                if (!policy.allowed) {
                    return { changed: false, ...response, error: `Storage write blocked for key ${JSON.stringify(msg.key)}: ${accessDenialReasons(policy.reasons, executionWorld, kind).join('; ')}.` };
                }
                records.push(created);
                return { changed: true, ...response, value: true };
            }
            const itemPolicy = secret ? item || {} : normalizeStoragePolicy(item || {});
            const policy = evaluateAccessPolicy({ policy: itemPolicy, executionWorld, url, allowMainWorld: setting[settingKey] });
            const reasons = item ? [...accessDenialReasons(policy.reasons, executionWorld, kind), ...callerAccessReasons(item, invocation)] : [`the ${kind} does not exist`];
            if (reasons.length) {
                const label = secret ? 'Secret access' : `Storage ${write ? 'write' : 'read'}`;
                return { changed: false, ...response, error: `${label} blocked for key ${JSON.stringify(msg.key)}: ${reasons.join('; ')}.` };
            }
            if (write) {
                Object.assign(item, normalizeStorageItem(item), { value: msg.value });
                delete item.allowedReadWorlds;
                delete item.allowedWriteWorlds;
            }
            return { changed: write, ...response, value: write ? true : item.value, found: true };
        };
        let result;
        if (write) result = await mutateStorageRecords(operate);
        else if (secret) {
            const stored = await chrome.storage.local.get(LAMBDA_SECRETS_KEY);
            const records = JSON.parse(stored[LAMBDA_SECRETS_KEY] || '[]');
            if (!Array.isArray(records) || records.some((item) => !item || typeof item !== 'object')) throw new Error('Invalid secrets.');
            result = await operate(records);
        } else result = await operate(await readStorageRecords());
        delete result.changed;
        if (result.error) await appendActivityLog('error', [result.error], { tabId, uri: url }).catch(() => {});
        return result;
    } catch {
        // Parsing/serialization exceptions can contain stored values: never relay their text.
        const error = `${secret ? 'Secret access' : `Storage ${write ? 'write' : 'read'}`} failed for key ${JSON.stringify(String(msg.key))}: data or page context is unavailable or invalid. No changes were saved.`;
        await appendActivityLog('error', [error], { tabId, uri: url }).catch(() => {});
        return { ...response, error };
    }
}
