const ACTIVITY_LOG_KEY = 'activityLogs';
const MAX_ACTIVITY_LOGS = 1000;
let writeQueue = Promise.resolve();

const serialize = (value) => {
    if (value instanceof Error)
        return value.stack || value.message;
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
};

export function appendActivityLog(level, values, context = {}) {
    const message = values.map(serialize).join(' ');
    const entry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        tabId: context.tabId ?? null,
        uri: context.uri || '',
        message,
        level
    };
    writeQueue = writeQueue.then(async () => {
        const stored = await chrome.storage.local.get(ACTIVITY_LOG_KEY);
        const logs = Array.isArray(stored[ACTIVITY_LOG_KEY]) ? stored[ACTIVITY_LOG_KEY] : [];
        await chrome.storage.local.set({ [ACTIVITY_LOG_KEY]: [...logs, entry].slice(-MAX_ACTIVITY_LOGS) });
        return entry;
    });
    return writeQueue;
}

export const log = Object.freeze({
    err: (...values) => void appendActivityLog('error', values),
    dbg: (...values) => void appendActivityLog('debug', values),
    info: (...values) => void appendActivityLog('info', values)
});
