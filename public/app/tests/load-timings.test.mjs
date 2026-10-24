import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadTimings, loadTimings, timedFetch } from '../load-timings.js';

test('timings include pending duration, finish only once and retain a bounded history', () => {
    let time = 0, saved;
    const logs = new LoadTimings({ now: () => time, limit: 2, storage: { setItem(key, value) { saved = value; } } });
    const finish = logs.start('预设'); time = 31.24;
    assert.equal(logs.snapshot()[0].durationMs, 31.2);
    finish(); time = 80; finish('error');
    assert.equal(logs.snapshot()[0].status, 'success');
    assert.equal(logs.snapshot()[0].durationMs, 31.2);
    logs.start('世界书')('error'); logs.start('角色卡')('cancelled');
    assert.deepEqual(logs.snapshot().map(entry => entry.label), ['世界书', '角色卡']);
    const restored = new LoadTimings({ storage: { getItem: () => saved } });
    assert.equal(restored.snapshot().length, 2);
    logs.clear(); assert.deepEqual(logs.snapshot(), []);
});
test('failures and refresh-interrupted loads are recorded without exposing exception text', async () => {
    let saved;
    const logs = new LoadTimings({ storage: { setItem(key, value) { saved = value; } } });
    await assert.rejects(logs.measure('世界书', 'page', async () => { throw new Error('private response'); }));
    assert.equal(logs.snapshot()[0].status, 'error');
    assert.ok(!JSON.stringify(logs.snapshot()).includes('private response'));
    logs.start('全局初始化', 'startup');
    const restored = new LoadTimings({ storage: { getItem: () => saved } });
    assert.equal(restored.snapshot().at(-1).status, 'interrupted');
    const blocked = new LoadTimings({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
    assert.doesNotThrow(() => blocked.start('可用页面')());
});
test('a long page total remains available after many nested requests overflow the history', () => {
    const logs = new LoadTimings({ limit: 2 }), finish = logs.start('全局初始化');
    logs.start('请求一')(); logs.start('请求二')(); finish();
    assert.equal(logs.snapshot().length, 2);
    assert.equal(logs.snapshot().at(-1).label, '全局初始化');
    assert.equal(logs.snapshot().at(-1).status, 'success');
});
test('request timings omit query values and bodies and preserve HTTP error behavior', async () => {
    const original = globalThis.fetch;
    loadTimings.clear();
    try {
        globalThis.fetch = async () => new Response('private-response', { status: 500 });
        const response = await timedFetch('/api/example?key=private-query', { method: 'POST', body: 'private-body' });
        assert.equal(response.status, 500);
        const entry = loadTimings.snapshot().at(-1);
        assert.equal(entry.label, '/api/example'); assert.equal(entry.status, 'error');
        assert.ok(!JSON.stringify(entry).includes('private-'));
        globalThis.fetch = async () => { throw new DOMException('private-error', 'AbortError'); };
        await assert.rejects(timedFetch('/api/cancelled'));
        assert.equal(loadTimings.snapshot().at(-1).status, 'cancelled');
    } finally { globalThis.fetch = original; }
});
