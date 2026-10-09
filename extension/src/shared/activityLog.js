(function () {
  const serialize = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };

  const write = (level, values) => {
    const message = values.map(serialize).join(' ');
    try {
      const result = chrome.runtime.sendMessage({ type: 'ACTIVITY_LOG', level, message });
      result?.catch?.(() => {});
    } catch {
      // The extension may have been reloaded while this document was open.
    }
  };

  globalThis.log = Object.freeze({
    err: (...values) => write('error', values),
    dbg: (...values) => write('debug', values),
    info: (...values) => write('info', values)
  });
})();
