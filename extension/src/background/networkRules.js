const STATE_KEY = 'tab_network_rules';
const methods = ['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'OTHER'];
const resourceTypes = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, label) {
    if (!object(value)) throw new Error(`${label} must be an object.`);
    for (const field of Object.keys(value)) if (!allowed.includes(field)) throw new Error(`Unsupported ${label} field: ${field}.`);
}
function url(value, wildcard = false) {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value) || /[\s\\]/.test(value)) throw new Error('Network URLs must be absolute HTTP(S) URLs.');
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash || parsed.host.includes('*')) throw new Error('Network URLs cannot contain credentials, fragments or wildcard hosts.');
    const count = (value.match(/\*/g) || []).length;
    if (count > (wildcard ? 1 : 0)) throw new Error('Network URLs support at most one path/query wildcard.');
    return parsed.href;
}
function list(value, allowed, label, convert = (entry) => entry) {
    if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== 'string' || !allowed.includes(convert(entry)))) throw new Error(`Invalid ${label}.`);
    return [...new Set(value.map(convert))].sort();
}
function headers(value) {
    fields(value, ['headers'], 'request/response');
    fields(value.headers, ['set', 'remove'], 'headers');
    const set = new Map(), remove = new Set();
    function name(value) {
        if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) throw new Error('Invalid header name.');
        return value.toLowerCase();
    }
    if (value.headers.set !== undefined) {
        fields(value.headers.set, Object.keys(value.headers.set || {}), 'headers.set');
        for (const [key, valueText] of Object.entries(value.headers.set)) {
            const keyName = name(key);
            if (set.has(keyName) || typeof valueText !== 'string' || /[\r\n\0]/.test(valueText)) throw new Error('Invalid or duplicate header value.');
            set.set(keyName, valueText);
        }
    }
    if (value.headers.remove !== undefined) {
        if (!Array.isArray(value.headers.remove)) throw new Error('headers.remove must be a list.');
        for (const key of value.headers.remove) remove.add(name(key));
    }
    if ([...remove].some((key) => set.has(key))) throw new Error('A header cannot be set and removed by the same rule.');
    if (!set.size && !remove.size) throw new Error('At least one header change is required.');
    return { headers: {
        ...(set.size ? { set: Object.fromEntries([...set].sort(([a], [b]) => a.localeCompare(b))) } : {}),
        ...(remove.size ? { remove: [...remove].sort() } : {})
    } };
}
export function normalizeNetworkRule(input) {
    fields(input, ['match', 'redirect', 'block', 'request', 'response'], 'network rule');
    fields(input.match, ['url', 'methods', 'resourceTypes'], 'match');
    const match = { url: url(input.match.url, true) };
    if (input.match.methods !== undefined) match.methods = list(input.match.methods, methods, 'request methods', (value) => value.toUpperCase());
    if (input.match.resourceTypes !== undefined) match.resourceTypes = list(input.match.resourceTypes, resourceTypes, 'resource types');
    const kinds = Number(input.redirect !== undefined) + Number(input.block !== undefined) + Number(input.request !== undefined || input.response !== undefined);
    if (kinds !== 1) throw new Error('Choose redirect, block, or header changes.');
    if (input.redirect !== undefined) {
        const target = url(input.redirect, true);
        if (target.includes('*') && !match.url.includes('*')) throw new Error('A redirect wildcard needs a matching URL wildcard.');
        if (target === match.url) throw new Error('A redirect cannot target its own matching URL.');
        return { match, redirect: target };
    }
    if (input.block !== undefined) {
        if (input.block !== true) throw new Error('block must be true.');
        return { match, block: true };
    }
    return { match, ...(input.request !== undefined ? { request: headers(input.request) } : {}), ...(input.response !== undefined ? { response: headers(input.response) } : {}) };
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function compileNetworkRule(rule, { nativeId, tabId, priority }) {
    const condition = {
        tabIds: [tabId],
        regexFilter: `^${rule.match.url.split('*').map(escapeRegex).join('(.*)')}$`,
        isUrlFilterCaseSensitive: true,
        resourceTypes: rule.match.resourceTypes || resourceTypes,
        ...(rule.match.methods ? { requestMethods: rule.match.methods.map((value) => value.toLowerCase()) } : {})
    };
    let action;
    if (rule.redirect) action = { type: 'redirect', redirect: rule.redirect.includes('*')
        ? { regexSubstitution: rule.redirect.replace('*', '\\1') }
        : { url: rule.redirect } };
    else if (rule.block) action = { type: 'block' };
    else {
        const changes = (side) => [
            ...Object.entries(side.headers.set || {}).map(([header, value]) => ({ header, operation: 'set', value })),
            ...(side.headers.remove || []).map((header) => ({ header, operation: 'remove' }))
        ];
        action = { type: 'modifyHeaders', ...(rule.request ? { requestHeaders: changes(rule.request) } : {}), ...(rule.response ? { responseHeaders: changes(rule.response) } : {}) };
    }
    return { id: nativeId, priority, action, condition };
}
const origin = (value) => { try { const parsed = new URL(value); return /^https?:$/.test(parsed.protocol) ? parsed.origin : null; } catch { return null; } };
const stable = (value) => JSON.stringify(value, (_key, entry) => object(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const nativeRule = (record) => compileNetworkRule(record.rule, record);

export function createNetworkRules(browser) {
    let state, queue = Promise.resolve();
    const dnr = browser.declarativeNetRequest;
    const save = (next) => browser.storage.session.set({ [STATE_KEY]: next });
    async function initialize() {
        if (state) return;
        const [stored, installed] = await Promise.all([browser.storage.session.get(STATE_KEY), dnr.getSessionRules()]);
        const saved = stored[STATE_KEY] || { nextId: 1, records: [] };
        const records = [];
        for (const record of saved.records) {
            const tab = await browser.tabs.get(record.tabId).catch(() => null);
            if (tab && origin(tab.url) === record.origin && installed.some((rule) => stable(rule) === stable(nativeRule(record)))) records.push(record);
        }
        const ids = new Set(records.map((record) => record.nativeId));
        const orphans = installed.filter((rule) => !ids.has(rule.id)).map((rule) => rule.id);
        if (orphans.length) await dnr.updateSessionRules({ removeRuleIds: orphans });
        state = { nextId: saved.nextId, records };
        try { await save(state); } catch (error) { state = undefined; throw error; }
    }
    function run(work) {
        const result = queue.then(async () => { await initialize(); return work(); });
        queue = result.catch(() => {});
        return result;
    }
    async function update(records, nextId = state.nextId, expiring = false) {
        const old = state.records;
        const removed = old.filter((entry) => !records.some((record) => record.id === entry.id));
        const added = records.filter((entry) => !old.some((record) => record.id === entry.id));
        if (!removed.length && !added.length) return;
        await dnr.updateSessionRules({ removeRuleIds: removed.map((record) => record.nativeId), addRules: added.map(nativeRule) });
        const next = { nextId, records };
        try { await save(next); }
        catch (error) {
            if (expiring) {
                state = undefined;
                throw error;
            }
            try { await dnr.updateSessionRules({ removeRuleIds: added.map((record) => record.nativeId), addRules: removed.map(nativeRule) }); }
            catch { state = undefined; throw new Error('Network rule storage and rollback failed. Retry to reconcile installed rules.'); }
            throw error;
        }
        state = next;
    }
    const publicRule = (record) => ({ id: record.id, ...structuredClone(record.rule) });
    async function expire(tabId, targetOrigin) {
        await update(state.records.filter((record) => record.tabId !== tabId || record.origin === targetOrigin), state.nextId, true);
    }
    return {
        ready: () => run(() => undefined),
        add: (tabId, input, { callers = [], authorize = async () => {} } = {}) => run(async () => {
            const rule = normalizeNetworkRule(input);
            await authorize();
            const tab = await browser.tabs.get(tabId);
            const tabOrigin = origin(tab.url);
            if (!tabOrigin || (tab.pendingUrl && origin(tab.pendingUrl) !== tabOrigin)) throw new Error('Open a stable HTTP(S) page before installing network rules.');
            await expire(tabId, tabOrigin);
            const existing = state.records.find((record) => record.tabId === tabId && JSON.stringify(record.rule.match) === JSON.stringify(rule.match));
            if (existing && JSON.stringify(existing.rule) === JSON.stringify(rule)) return publicRule(existing);
            if (state.nextId >= 2147483647) throw new Error('Network rule identifiers exhausted. Restart the browser.');
            const record = { id: crypto.randomUUID(), nativeId: state.nextId, priority: state.nextId, tabId, origin: tabOrigin, rule, callers: structuredClone(callers) };
            const compiled = nativeRule(record);
            const supported = await dnr.isRegexSupported({ regex: compiled.condition.regexFilter, isCaseSensitive: true, requireCapturing: Boolean(rule.redirect?.includes('*')) });
            if (!supported.isSupported) throw new Error(`Unsupported network URL pattern: ${supported.reason || 'browser regular-expression limit'}.`);
            await update([...state.records.filter((entry) => entry !== existing), record], state.nextId + 1);
            try { await authorize(); }
            catch (error) {
                await update(state.records.filter((entry) => entry.id !== record.id), state.nextId, true);
                throw error;
            }
            const current = await browser.tabs.get(tabId).catch(() => null);
            if (!current || origin(current.url) !== tabOrigin || (current.pendingUrl && origin(current.pendingUrl) !== tabOrigin)) {
                await expire(tabId, null);
                throw new Error('The tab navigated while the network rule was installed. Run the function again.');
            }
            return publicRule(record);
        }),
        list: (tabId) => run(async () => {
            const tab = await browser.tabs.get(tabId).catch(() => null);
            await expire(tabId, origin(tab?.pendingUrl || tab?.url));
            return state.records.filter((record) => record.tabId === tabId).map(publicRule);
        }),
        remove: (tabId, id) => run(async () => {
            const records = state.records.filter((record) => record.tabId !== tabId || record.id !== id);
            if (records.length === state.records.length) return false;
            await update(records);
            return true;
        }),
        clear: (tabId) => run(async () => {
            const records = state.records.filter((record) => record.tabId !== tabId);
            const count = state.records.length - records.length;
            await update(records);
            return count;
        }),
        navigation: (tabId, targetUrl) => run(() => expire(tabId, origin(targetUrl))),
        prune: (allowed) => run(async () => {
            const records = state.records.filter(allowed);
            const count = state.records.length - records.length;
            await update(records, state.nextId, true);
            return count;
        })
    };
}
