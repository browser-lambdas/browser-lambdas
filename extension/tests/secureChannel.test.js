import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const context = createContext({ crypto, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout, queueMicrotask });
runInContext(readFileSync(new URL('../src/shared/secureChannel.js', import.meta.url), 'utf8'), context);
const createSecureChannel = runInContext('createSecureChannel', context);
const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const defaults = () => ({ key: key(), sessionId: crypto.randomUUID(), purpose: 'menu', timeoutMs: 500 });
function transport(port, post = (packet) => port.postMessage(packet)) {
    return {
        get onmessage() { return port.onmessage; },
        set onmessage(handler) { port.onmessage = handler; },
        get onmessageerror() { return port.onmessageerror; },
        set onmessageerror(handler) { port.onmessageerror = handler; },
        start: () => port.start(), close: () => port.close(), postMessage: post,
        addEventListener: (...args) => port.addEventListener(...args),
        removeEventListener: (...args) => port.removeEventListener(...args)
    };
}
function channel(options) {
    const result = createSecureChannel(options);
    // Failures are asserted explicitly below; observe immediate startup failures too.
    result.ready.catch(() => {});
    return result;
}

test('secure channels authenticate, encrypt both directions and retain send order', { timeout: 3000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const shared = defaults(), leftWire = [], rightWire = [], receivedLeft = [], receivedRight = [], errors = [];
    const leftDone = deferred(), rightDone = deferred();
    const left = channel({ ...shared, role: 'host', port: transport(port1, (packet) => { leftWire.push(packet); port1.postMessage(packet); }),
        onMessage: (value) => { receivedLeft.push(value.index); if (receivedLeft.length === 12) leftDone.resolve(); }, onError: (error) => errors.push(error) });
    const right = channel({ ...shared, role: 'client', port: transport(port2, (packet) => { rightWire.push(packet); port2.postMessage(packet); }),
        onMessage: (value) => { receivedRight.push(value.index); if (receivedRight.length === 12) rightDone.resolve(); }, onError: (error) => errors.push(error) });
    try {
        await Promise.all(Array.from({ length: 12 }, (_, index) => Promise.all([
            left.send({ index, secret: 'private action' }), right.send({ index, secret: 'private response' })
        ])));
        await Promise.all([left.ready, right.ready, leftDone.promise, rightDone.promise]);
        const expected = Array.from({ length: 12 }, (_, i) => i);
        assert.deepEqual(receivedLeft, expected);
        assert.deepEqual(receivedRight, expected);
        assert.deepEqual(errors, []);
        for (const wire of [leftWire, rightWire]) {
            assert.equal(wire.length, 13, 'one internal HELLO plus twelve application messages');
            assert.deepEqual(wire.map((packet) => packet.seq), Array.from({ length: 13 }, (_, i) => i));
            for (const packet of wire) {
                assert.equal(packet.v, 1);
                assert.equal(Buffer.from(packet.iv, 'base64').length, 12);
                assert.equal(typeof packet.ct, 'string');
                assert.doesNotMatch(JSON.stringify(packet), /private|secret|index|HELLO/);
            }
        }
        assert.equal(new Set([...leftWire, ...rightWire].map((packet) => packet.iv)).size, 26);
    } finally { left.close(); right.close(); }
});

test('plaintext and modified ciphertext fail closed without delivering application data', { timeout: 3000 }, async () => {
    for (const failure of ['plaintext', 'ciphertext', 'iv', 'version']) {
        const { port1, port2 } = new MessageChannel();
        const shared = defaults(), failed = deferred();
        let delivered = 0, errors = 0;
        const host = channel({ ...shared, role: 'host', port: port1, onMessage: () => delivered++, onError: () => { errors++; failed.resolve(); } });
        const client = channel({ ...shared, role: 'client', port: transport(port2, (packet) => {
            if (packet.seq === 1) {
                packet = structuredClone(packet);
                if (failure === 'plaintext') packet = { type: 'ACTION', action: 'shell' };
                if (failure === 'version') packet.v = 2;
                if (failure === 'ciphertext' || failure === 'iv') {
                    const field = failure === 'iv' ? 'iv' : 'ct';
                    const bytes = Buffer.from(packet[field], 'base64'); bytes[0] ^= 1;
                    packet[field] = bytes.toString('base64');
                }
            }
            port2.postMessage(packet);
        }), onMessage: () => {}, onError: () => {} });
        try {
            await Promise.all([host.ready, client.ready]);
            await client.send({ type: 'ACTION', action: 'shell' });
            await failed.promise;
            assert.equal(delivered, 0, failure);
            assert.equal(errors, 1, failure);
            await host.send({ type: 'STATUS' });
            host.close();
            assert.equal(errors, 1, 'failure is reported once');
        } finally { host.close(); client.close(); }
    }
});

test('client-side inbound tampering notifies both peers without delivering an action', { timeout: 2000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const shared = defaults(), hostFailed = deferred(), clientFailed = deferred();
    const hostWire = [], clientWire = [];
    let delivered = 0, hostErrors = 0, clientErrors = 0;
    const host = channel({ ...shared, role: 'host', port: transport(port1, (packet) => {
        hostWire.push(packet);
        if (packet.seq === 1) {
            packet = structuredClone(packet);
            const bytes = Buffer.from(packet.ct, 'base64'); bytes[0] ^= 1;
            packet.ct = bytes.toString('base64');
        }
        port1.postMessage(packet);
    }), onMessage: () => delivered++, onError: () => { hostErrors++; hostFailed.resolve(); } });
    const client = channel({ ...shared, role: 'client', port: transport(port2, (packet) => { clientWire.push(packet); port2.postMessage(packet); }),
        onMessage: () => delivered++, onError: () => { clientErrors++; clientFailed.resolve(); } });
    try {
        await Promise.all([host.ready, client.ready]);
        await host.send({ type: 'ACTION', secret: 'never delivered' });
        await Promise.all([hostFailed.promise, clientFailed.promise]);
        assert.equal(delivered, 0);
        assert.equal(hostErrors, 1);
        assert.equal(clientErrors, 1);
        assert.equal(hostWire.length, 2, 'HELLO and the corrupted outbound action; no failure echo');
        assert.equal(clientWire.length, 2, 'HELLO and an encrypted failure control');
        assert.doesNotMatch(JSON.stringify(clientWire), /close|ACTION|never delivered/);
        await Promise.all([host.send({ action: 'ignored' }), client.send({ action: 'ignored' })]);
        assert.equal(hostWire.length, 2);
        assert.equal(clientWire.length, 2);
    } finally { host.close(); client.close(); }
});

test('wrong keys, sessions and purposes cannot authenticate', { timeout: 3000 }, async () => {
    for (const mismatch of [{ key: key() }, { sessionId: 'another-session' }, { purpose: 'lambda' }]) {
        const { port1, port2 } = new MessageChannel();
        const shared = defaults(), errors = [];
        let delivered = 0;
        const host = channel({ ...shared, role: 'host', port: port1, onMessage: () => delivered++, onError: (error) => errors.push(error) });
        const client = channel({ ...shared, ...mismatch, role: 'client', port: port2, onMessage: () => delivered++, onError: (error) => errors.push(error) });
        try {
            const results = await Promise.allSettled([host.ready, client.ready]);
            assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected']);
            assert.equal(delivered, 0);
            assert.equal(errors.length, 2);
        } finally { host.close(); client.close(); }
    }
});

test('replayed and out-of-order encrypted packets are rejected', { timeout: 3000 }, async () => {
    for (const failure of ['replay', 'out-of-order']) {
        const { port1, port2 } = new MessageChannel();
        const shared = defaults(), packets = [], failed = deferred(), first = deferred();
        let delivered = 0, errors = 0;
        const host = channel({ ...shared, role: 'host', port: port1, onMessage: () => { delivered++; first.resolve(); }, onError: () => { errors++; failed.resolve(); } });
        const client = channel({ ...shared, role: 'client', port: transport(port2, (packet) => {
            if (packet.seq > 0) packets.push(packet);
            if (packet.seq === 0 || failure === 'replay') port2.postMessage(packet);
        }), onMessage: () => {}, onError: () => {} });
        try {
            await Promise.all([host.ready, client.ready]);
            await client.send({ action: 'first' });
            if (failure === 'replay') {
                await first.promise;
                port2.postMessage(packets[0]);
            } else {
                await client.send({ action: 'second' });
                port2.postMessage(packets[1]);
            }
            await failed.promise;
            assert.equal(errors, 1);
            assert.equal(delivered, failure === 'replay' ? 1 : 0);
        } finally { host.close(); client.close(); }
    }
});

test('directional keys reject reflected handshake packets', { timeout: 2000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    let errors = 0, delivered = 0;
    port2.onmessage = ({ data }) => port2.postMessage(data);
    const host = channel({ ...defaults(), role: 'host', port: port1, onMessage: () => delivered++, onError: () => errors++ });
    try {
        await assert.rejects(host.ready);
        assert.equal(errors, 1);
        assert.equal(delivered, 0);
    } finally { host.close(); port2.close(); }
});

test('application sends wait for peer authentication and cancel cleanly on failure', { timeout: 2000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const hello = deferred(), failed = deferred(), wire = [];
    let errors = 0, ready = false, delivered = 0;
    const host = channel({ ...defaults(), role: 'host', port: transport(port1, (packet) => { wire.push(packet); port1.postMessage(packet); hello.resolve(); }),
        onMessage: () => delivered++, onError: () => { errors++; failed.resolve(); } });
    host.ready.then(() => { ready = true; }, () => {});
    const pending = host.send({ action: 'must stay private until authenticated' });
    try {
        await hello.promise;
        assert.equal(ready, false);
        assert.equal(wire.length, 1);
        assert.equal(delivered, 0);
        port2.postMessage({ type: 'HELLO' });
        await failed.promise;
        await assert.rejects(host.ready);
        await pending;
        assert.equal(errors, 1);
        assert.equal(wire.length, 2, 'only the encrypted HELLO and failure control were transmitted');
    } finally { host.close(); port2.close(); }
});

test('handshake timeout closes the channel once; explicit close cancels without onError', { timeout: 2000 }, async () => {
    const firstPorts = new MessageChannel();
    let errors = 0;
    const timedOut = channel({ ...defaults(), timeoutMs: 20, role: 'host', port: firstPorts.port1, onMessage: () => {}, onError: () => errors++ });
    try {
        await assert.rejects(timedOut.ready);
        assert.equal(errors, 1);
        await timedOut.send({ action: 'ignored after timeout' });
        timedOut.close();
        assert.equal(errors, 1);
    } finally { timedOut.close(); firstPorts.port2.close(); }
    const secondPorts = new MessageChannel();
    let posted = 0, closeErrors = 0;
    const cancelled = channel({ ...defaults(), role: 'host', port: transport(secondPorts.port1, () => posted++), onMessage: () => {}, onError: () => closeErrors++ });
    const pending = cancelled.send({ action: 'cancelled' });
    cancelled.close();
    try {
        await assert.rejects(cancelled.ready);
        await pending;
        await cancelled.send({ action: 'also cancelled' });
        assert.equal(posted, 0);
        assert.equal(closeErrors, 0);
    } finally { cancelled.close(); secondPorts.port2.close(); }
});

test('asynchronous callbacks cannot block a later reply needed by the first callback', { timeout: 2000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const shared = defaults(), reply = deferred(), done = deferred(), seen = [], errors = [];
    const host = channel({ ...shared, role: 'host', port: port1, onMessage: () => {}, onError: (error) => errors.push(error) });
    const client = channel({ ...shared, role: 'client', port: port2, onMessage: async (data) => {
        seen.push(data.step);
        if (data.step === 1) { await reply.promise; done.resolve(); }
        else reply.resolve();
    }, onError: (error) => errors.push(error) });
    try {
        await Promise.all([host.send({ step: 1 }), host.send({ step: 2 }), done.promise]);
        assert.deepEqual(seen, [1, 2]);
        assert.deepEqual(errors, []);
    } finally { host.close(); client.close(); }
});

test('callback rejection and invalid encryption keys fail closed', { timeout: 2000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const shared = defaults(), failed = deferred();
    let errors = 0;
    const host = channel({ ...shared, role: 'host', port: port1, onMessage: () => {}, onError: () => {} });
    const client = channel({ ...shared, role: 'client', port: port2, onMessage: async () => { throw new Error('callback failed'); }, onError: () => { errors++; failed.resolve(); } });
    try {
        await host.send({ action: 'trigger callback failure' });
        await failed.promise;
        assert.equal(errors, 1);
        await client.send({ action: 'ignored after callback rejection' });
    } finally { host.close(); client.close(); }
    const invalidPorts = new MessageChannel();
    let posted = 0, keyErrors = 0;
    const invalid = channel({ ...defaults(), key: 'invalid-key', role: 'host', port: transport(invalidPorts.port1, () => posted++), onMessage: () => {}, onError: () => keyErrors++ });
    try {
        await assert.rejects(invalid.ready);
        await invalid.send({ action: 'never plaintext' });
        assert.equal(posted, 0);
        assert.equal(keyErrors, 1);
    } finally { invalid.close(); invalidPorts.port2.close(); }
});
