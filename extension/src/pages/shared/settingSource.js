export function settingValue(value) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (value === 'USER_SCRIPT') return 'User world';
  if (value === 'MAIN') return 'Main world';
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Source links are trusted markup supplied by the settings UI.
export function settingSource({ value, explicit = false, from = '', controlled = '', warning = '' }) {
  const current = warning || (controlled ? `${settingValue(value)} in ${controlled}` : !explicit && from ? `From ${from}` : '');
  return current ? `<span class="setting-source">${current}</span>` : '';
}
