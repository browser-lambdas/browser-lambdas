// Keep values and absent policy fields intact. Missing legacy IDs are stable until saved.
export function parseStorageRecords(raw) {
    const records = raw == null ? [] : JSON.parse(raw);
    if (!Array.isArray(records) || records.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('Storage data is invalid. No changes were saved.');
    }
    const usedIds = new Set(records.map((item) => item.id).filter((id) => typeof id === 'string'));
    return records.map((item, index) => {
        let id = item.id;
        if (typeof id !== 'string') {
            id = `legacy-storage-${index}`;
            while (usedIds.has(id)) id += '-';
            usedIds.add(id);
        }
        return { ...item, id };
    });
}

export function sameStorageRecord(left, right) {
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
