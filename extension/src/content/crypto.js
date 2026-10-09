const decodeBase64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const encodeBase64 = (buf) => btoa(String.fromCharCode(...buf));
const decrypt = async (enc, key) => {
    const raw = decodeBase64(key);
    const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const iv = decodeBase64(enc.iv), ct = decodeBase64(enc.ct);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
    return JSON.parse(new TextDecoder().decode(pt));
};
const encrypt = async (payload, key) => {
    const raw = decodeBase64(key);
    const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, data);
    return { iv: encodeBase64(iv), ct: encodeBase64(new Uint8Array(ct)) };
};
