export const contentPorts = new Map();

export function contentPort(tabId, documentId) {
    const port = contentPorts.get(tabId);
    if (!port || port.sender?.frameId !== 0 || port.sender?.documentId !== documentId) {
        throw new Error('The page connection is unavailable. Reload the page and try again.');
    }
    return port;
}

export function postToContent(tabId, documentId, message) {
    contentPort(tabId, documentId).postMessage(message);
}
