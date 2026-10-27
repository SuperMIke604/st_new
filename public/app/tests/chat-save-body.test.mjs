import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareChatSaveBody } from '../chat-save-body.js';
import { TavernAPI } from '../api.js';
import { loadTimings } from '../load-timings.js';

const header = { chat_metadata: { integrity: 'test-integrity', unknown: { keep: true } } };
const messages = [{ name: '角色', mes: '中文重复内容🙂'.repeat(40000), swipe_id: 1, swipes: ['previous', 'current'], swipe_info: [{ unknown: 1 }], variables: { 1: { score: 2 } }, extra: { unknown: ['preserved'] } }];
const decode = async options => options.headers['Content-Encoding'] === 'gzip' ? new Response(new Blob([options.body]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : options.body;

test('gzip upload is lossless for Unicode, integrity, branches and unknown fields', async () => {
    const json = JSON.stringify({ avatar_url: 'test.png', file_name: 'test', chat: [header, ...messages] });
    const encoded = await prepareChatSaveBody(json);
    assert.equal(encoded.metrics.gzip, 1); assert.ok(encoded.metrics.transferBytes < encoded.metrics.payloadBytes / 10);
    assert.equal(await decode({ headers: { 'Content-Encoding': 'gzip' }, body: encoded.body }), json);
});

test('small payloads, unsupported compression and compression errors retain ordinary JSON', async () => {
    for (const options of [{}, { threshold: 0, Compression: null }, { threshold: 0, Compression: class { constructor() { throw Error('unavailable'); } } }]) {
        const encoded = await prepareChatSaveBody('{"keep":"中文"}', options);
        assert.equal(encoded.metrics.gzip, 0); assert.equal(encoded.body, '{"keep":"中文"}');
    }
});

test('save sends one prepared body and explicit encoding without logging payload contents', async () => {
    const original = globalThis.fetch; let received;
    loadTimings.clear();
    globalThis.fetch = async (path, options) => { assert.equal(path, '/api/chats/save'); received = JSON.parse(await decode(options)); return Response.json({ ok: true }); };
    try { await new TavernAPI().saveChat('test.png', 'test', header, messages); }
    finally { globalThis.fetch = original; }
    assert.deepEqual(received, { avatar_url: 'test.png', file_name: 'test', chat: [header, ...messages] });
    assert.ok(!Object.hasOwn(received, 'force'));
    const log = JSON.stringify(loadTimings.snapshot()); assert.ok(!log.includes('中文重复内容')); assert.ok(!log.includes('test-integrity'));
    assert.equal(loadTimings.snapshot().find(entry => entry.label === '准备聊天保存传输').metrics.gzip, 1);
});

test('415 retries uncompressed and remembers compatibility, while integrity failures never bypass validation', async () => {
    const original = globalThis.fetch, encodings = [], api = new TavernAPI();
    globalThis.fetch = async (_path, options) => { encodings.push(options.headers['Content-Encoding'] || 'identity'); return encodings.length === 1 ? new Response('unsupported encoding', { status: 415 }) : Response.json({ ok: true }); };
    try {
        await api.saveChat('test.png', 'test', header, messages); await api.saveChat('test.png', 'test', header, messages);
        assert.deepEqual(encodings, ['gzip', 'identity', 'identity']);
        let calls = 0;
        globalThis.fetch = async () => { calls++; return Response.json({ error: 'integrity' }, { status: 400 }); };
        await assert.rejects(new TavernAPI().saveChat('test.png', 'test', header, messages), error => error.status === 400);
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});
