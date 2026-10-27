import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadTimings, loadTimings, timedFetch, requestFailure, timingStatusText, timingDetailText } from '../load-timings.js';
import { TavernAPI } from '../api.js';
import { RecentCharacters } from '../home-data.js';

test('synchronous diagnostics preserve return values and exceptions without exporting private data', () => {
    let time = 0;
    const logs = new LoadTimings({ now: () => time });
    const value = { text: 'private text' };
    assert.equal(logs.measureSync('同步构建', 'generation', () => { time = 75; return value; }), value);
    const error = new Error('private failure');
    assert.throws(() => logs.measureSync('同步失败', 'generation', () => { throw error; }), caught => caught === error);
    assert.equal(logs.snapshot()[0].durationMs, 75);
    assert.deepEqual(logs.snapshot().map(entry => entry.status), ['success', 'error']);
    assert.ok(!JSON.stringify(logs.snapshot()).includes('private'));
});

test('clearing diagnostics preserves in-flight durations and throwing loggers cannot break work', () => {
    let time = 0;
    const logs = new LoadTimings({ now: () => time, logger: { info() { throw Error('logger failed'); } } });
    logs.start('旧记录')();
    const finish = logs.start('生成中', 'generation');
    time = 100; logs.clear();
    assert.deepEqual(logs.snapshot().map(entry => entry.label), ['生成中']);
    assert.equal(logs.snapshot()[0].durationMs, 100);
    time = 200; assert.doesNotThrow(() => finish());
    assert.equal(logs.snapshot()[0].durationMs, 200);
    assert.equal(logs.snapshot()[0].status, 'success');
});

test('diagnostic metrics allow only finite nonnegative known numbers', () => {
    const logs = new LoadTimings();
    logs.measureSync('历史处理', 'generation', () => 1, () => ({ metrics: { hits: 2, macroMs: 1.234, misses: -1, messages: Infinity, privateText: 'secret' } }));
    assert.deepEqual(logs.snapshot()[0].metrics, { hits: 2, macroMs: 1.2 });
    assert.match(timingDetailText(logs.snapshot()[0]), /缓存命中：2/);
    assert.ok(!JSON.stringify(logs.snapshot()).includes('secret'));
});

test('character count is retained in logs without storing character names', () => {
    const logs = new LoadTimings(); logs.start('读取角色列表', 'data')('success', { itemCount: 12 });
    assert.equal(logs.snapshot()[0].itemCount, 12);
    assert.equal(timingDetailText(logs.snapshot()[0]), '读取到 12 项');
});

test('independent panel scopes correlate stages and close unfinished work without affecting another panel', async () => {
    const logs = new LoadTimings(), first = logs.start('角色卡', 'page'), second = logs.start('世界书', 'page');
    const a = logs.scope(first.id), b = logs.scope(second.id);
    a.start('未完成阶段'); b.measureSync('构建界面', 'data', () => 42, () => ({ metrics: { renderedItems: 4 } }));
    a.close('cancelled');
    await assert.rejects(b.measure('读取资料', 'data', async () => { throw new Error('private-content'); }));
    b.close('error'); first('cancelled'); second('error');
    const entries = logs.snapshot();
    assert.equal(entries.find(entry => entry.label === '未完成阶段').parentId, first.id);
    assert.equal(entries.find(entry => entry.label === '未完成阶段').status, 'cancelled');
    assert.equal(entries.find(entry => entry.label === '构建界面').parentId, second.id);
    assert.equal(entries.find(entry => entry.label === '构建界面').metrics.renderedItems, 4);
    assert.equal(entries.find(entry => entry.label === '读取资料').status, 'error');
    assert.ok(!JSON.stringify(entries).includes('private-content'));
});

test('panel request diagnostics distinguish headers, response body and shared cache without revealing resource names', async () => {
    const original = globalThis.fetch, api = new TavernAPI(), logs = new LoadTimings();
    const rootA = logs.start('世界书', 'page'), rootB = logs.start('世界书', 'page');
    let stream;
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    try {
        const first = api.post('/api/worldinfo/get', { name: 'private-book-name' }, { timing: logs.scope(rootA.id) });
        await new Promise(resolve => setImmediate(resolve));
        const second = api.post('/api/worldinfo/get', { name: 'private-book-name' }, { timing: logs.scope(rootB.id) });
        assert.equal(logs.snapshot().find(entry => entry.label === '/api/worldinfo/get').status, 'success');
        assert.equal(logs.snapshot().find(entry => entry.label.endsWith('接收响应体')).status, 'loading');
        stream.enqueue(new TextEncoder().encode('{"entries":{"private-entry":{"content":"private-text"}}}')); stream.close();
        assert.deepEqual(await first, await second);
        const shared = logs.snapshot().find(entry => entry.label.endsWith('复用读取缓存'));
        assert.equal(shared.parentId, rootB.id); assert.equal(shared.metrics.sharedRequest, 1);
        const body = logs.snapshot().find(entry => entry.label.endsWith('接收响应体'));
        assert.equal(body.parentId, rootA.id); assert.ok(body.metrics.responseChars > 0);
        assert.ok(!JSON.stringify(logs.snapshot()).includes('private-'));
    } finally { globalThis.fetch = original; }
});

test('generation records correlate by id and batched persistence can flush on navigation', () => {
    let writes = 0;
    const logs = new LoadTimings({ flushDelay: 1000, storage: { setItem() { writes++; } } });
    const finish = logs.start('发送消息', 'generation');
    logs.start('阶段', 'generation')(); logs.start('/api/test', 'request')();
    assert.equal(writes, 0);
    assert.ok(logs.snapshot().every(entry => entry.generationId === finish.id));
    logs.flush(); assert.equal(writes, 1);
    finish(); assert.equal(logs.generationId, null); logs.flush();
    const controller = new AbortController(); controller.abort(new DOMException('user-stop', 'AbortError'));
    assert.equal(requestFailure(controller.signal.reason, controller.signal).reason, 'user-stop');
});

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
        assert.equal(entry.httpStatus, 500); assert.equal(entry.reason, 'http-error');
        assert.match(timingDetailText(entry), /HTTP 500.*服务端/);
        assert.ok(!JSON.stringify(entry).includes('private-'));
        globalThis.fetch = async () => { throw new DOMException('private-error', 'AbortError'); };
        await assert.rejects(timedFetch('/api/cancelled'));
        assert.equal(loadTimings.snapshot().at(-1).status, 'cancelled');
    } finally { globalThis.fetch = original; }
});
test('optional updater 404s are compatibility records while native fallbacks still complete', async () => {
    const original = globalThis.fetch;
    loadTimings.clear();
    const paths = [];
    globalThis.fetch = async path => {
        paths.push(path);
        if (path.startsWith('/api/plugins/')) return new Response('not installed', { status: 404 });
        return new Response(JSON.stringify(path === '/api/settings/get' ? { settings: '{}' } : [{ avatar: 'test.png' }]));
    };
    try {
        const api = new TavernAPI();
        await api.bootstrapSettings();
        assert.equal((await new RecentCharacters(api).load())[0].avatar, 'test.png');
        assert.deepEqual(paths, ['/api/plugins/st-new-updater/bootstrap', '/api/settings/get', '/api/plugins/st-new-updater/recent', '/api/chats/recent']);
        const records = loadTimings.snapshot();
        assert.deepEqual(records.map(entry => entry.status), ['fallback', 'success', 'fallback', 'success']);
        assert.equal(records[0].httpStatus, 404);
        assert.equal(timingStatusText(records[0]), '兼容回退');
        assert.match(timingDetailText(records[0]), /HTTP 404.*兼容接口/);
    } finally { globalThis.fetch = original; }
});
test('missing initial config files are expected while optional endpoint 500s stay real failures', async () => {
    const original = globalThis.fetch;
    loadTimings.clear();
    try {
        const api = new TavernAPI();
        globalThis.fetch = async () => new Response('', { status: 404 });
        assert.equal(await api.loadConnections(), null);
        assert.equal(await api.loadPresetSelection(), null);
        assert.ok(loadTimings.snapshot().every(entry => entry.status === 'fallback' && entry.reason === 'missing-configuration'));
        globalThis.fetch = async () => new Response('server error', { status: 500 });
        await assert.rejects(api.bootstrapSettings(), error => error.status === 500);
        await assert.rejects(new RecentCharacters(api).load(), error => error.status === 500);
        assert.ok(loadTimings.snapshot().slice(-2).every(entry => entry.status === 'error' && entry.httpStatus === 500));
        await assert.rejects(api.post('/api/not-optional'), error => error.status === 500);
        assert.equal(loadTimings.snapshot().at(-1).status, 'error');
    } finally { globalThis.fetch = original; }
});
test('abort, navigation, timeout and real network failure remain distinguishable', () => {
    const error = new TypeError('private endpoint');
    const cancelled = new AbortController(); cancelled.abort(new Error('private reason'));
    assert.deepEqual(requestFailure(error, cancelled.signal), { status: 'cancelled', reason: 'aborted' });
    assert.deepEqual(requestFailure(error, undefined, true), { status: 'interrupted', reason: 'navigation' });
    const timeout = new AbortController(); timeout.abort(new DOMException('private reason', 'TimeoutError'));
    assert.deepEqual(requestFailure(error, timeout.signal), { status: 'error', reason: 'timeout' });
    assert.deepEqual(requestFailure(error), { status: 'error', reason: 'network' });
    assert.equal(timingDetailText({ status: 'error' }), '旧记录未保存状态码或原因');
    assert.equal(timingDetailText({ status: 'cancelled', kind: 'page' }), '页面已切换或关闭');
});
