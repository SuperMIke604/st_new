import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { PresetTokenClient } from '../preset-token-client.js';

// Run the real browser worker module on a separate thread in Node.
class BrowserWorker {
    constructor(url) {
        const bootstrap = `
            import { parentPort } from 'node:worker_threads';
            globalThis.self = { postMessage: value => parentPort.postMessage(value) };
            await import(${JSON.stringify(url.href)});
            parentPort.on('message', data => self.onmessage({ data }));
        `;
        this.thread = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`));
        this.thread.on('message', data => this.onmessage({ data }));
        this.thread.on('error', error => this.onerror(error));
    }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { void this.thread.terminate(); }
}

test('worker counts automatically, serializes cold startup, reuses results across refresh, and aborts active requests', { timeout: 5000 }, async t => {
    const storage = new Map();
    const savedGlobals = { Worker: globalThis.Worker, sessionStorage: globalThis.sessionStorage };
    Object.defineProperties(globalThis, {
        Worker: { configurable: true, value: BrowserWorker },
        sessionStorage: { configurable: true, value: {
            getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
        } },
    });
    const clients = [];
    t.after(() => {
        for (const client of clients) client.dispose();
        for (const [key, value] of Object.entries(savedGlobals)) {
            if (value === undefined) delete globalThis[key];
            else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        }
    });

    const calls = [];
    let notifyPending;
    const pending = new Promise(resolve => { notifyPending = resolve; });
    const options = {
        preset: {}, character: { name: '角色' }, persona: { name: '用户' },
        chat: [{ is_user: true, mes: '合成聊天数据' }], loadBooks: async () => [], model: 'test',
        api: { async post(path, _messages, { serializedBody, signal }) {
            const messages = JSON.parse(serializedBody);
            calls.push({ path, messages });
            if (messages[0].content === 'wait') {
                notifyPending(signal);
                await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
            }
            return { token_count: messages[0].content.length };
        } },
    };
    const addClient = (Client, overrides = {}) => {
        const client = new Client({ ...options, ...overrides });
        clients.push(client);
        return client;
    };
    const history = { marker: true, identifier: 'chatHistory' };
    const first = addClient(PresetTokenClient);
    const count = first.count(history);
    assert.equal(calls.length, 0);
    first.start();
    assert.equal(await count, 6);
    assert.equal(calls.length, 1);
    first.dispose();
    const cache = JSON.parse([...storage.values()][0]);
    assert.match(cache[0][0], /^[0-9a-f]{64}$/);
    assert.equal(cache[0][1], 6);
    assert.equal(JSON.stringify(cache).includes('合成聊天数据'), false);

    const { PresetTokenClient: ReloadedClient } = await import('../preset-token-client.js?reload');
    const second = addClient(ReloadedClient);
    second.start();
    assert.equal(await second.count(history), 6);
    assert.equal(calls.length, 1);

    const changed = addClient(ReloadedClient, { model: 'another-model' });
    changed.start();
    assert.equal(await changed.count(history), 6);
    assert.equal(calls.length, 2);
    const job = changed.count({ content: 'wait' });
    const requestSignal = await pending;
    const aborted = assert.rejects(job, { name: 'AbortError' });
    changed.dispose();
    await aborted;
    assert.equal(requestSignal.aborted, true);

    let finishStartup, receivedBoth;
    const startup = new Promise(resolve => { finishStartup = resolve; });
    const bothJobs = new Promise(resolve => { receivedBoth = resolve; });
    let received = 0, sent = 0;
    const cold = addClient(ReloadedClient, { model: 'cold-tokenizer', api: { async post() {
        if (++sent === 1) await startup;
        return { token_count: 8 };
    } } });
    const receive = cold.receive.bind(cold);
    t.mock.method(cold, 'receive', (worker, data) => {
        if (data.type === 'tokenize' && ++received === 2) receivedBoth();
        return receive(worker, data);
    });
    cold.start();
    const coldCounts = ['cold-one', 'cold-two'].map(content => cold.count({ content }));
    await bothJobs;
    assert.equal(sent, 1);
    finishStartup();
    assert.deepEqual(await Promise.all(coldCounts), [8, 8]);
    assert.equal(sent, 2);
});
