import test from 'node:test';
import assert from 'node:assert/strict';
import { PresetTokenPreview, TokenCountCache } from '../preset-tokens.js';
import { expand } from '../engine.js';
import { applyRegex } from '../regex.js';
import { defaultDatabase } from '../database.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(overrides = {}) {
    const calls = [], cache = overrides.cache || new TokenCountCache();
    let active = 0, peak = 0;
    const options = { model: 'test', character: { name: '角色', data: { description: '角色描述' } }, persona: { name: '用户', description: '用户描述' }, preset: {}, chat: [], settings: {}, header: {}, loadBooks: async () => [], cache,
        api: { async post(path, messages, { signal }) {
            active++; peak = Math.max(peak, active); calls.push({ path, messages: structuredClone(messages), signal });
            try { await sleep(3); signal.throwIfAborted(); return { token_count: messages.reduce((total, message) => total + message.content.length, 0) }; }
            finally { active--; }
        } }, ...overrides };
    return { options, preview: new PresetTokenPreview(options), calls, peak: () => peak };
}
test('preview waits for the page to start it, limits requests to two and reuses exact counts', async () => {
    const f = fixture();
    const jobs = Array.from({ length: 12 }, (_, i) => f.preview.count({ content: `条目 ${i}`, role: 'system' }));
    await sleep(10); assert.equal(f.calls.length, 0);
    f.preview.start(); const counts = await Promise.all(jobs);
    assert.ok(f.peak() <= 2); assert.equal(f.calls.length, 12);
    assert.deepEqual(counts, Array.from({ length: 12 }, (_, i) => `条目 ${i}`.length));
    f.preview.dispose();
    const second = fixture({ cache: f.options.cache }); second.preview.start();
    assert.equal(await second.preview.count({ content: '条目 0', role: 'system' }), 4);
    assert.equal(second.calls.length, 0);
    assert.equal(await second.preview.count({ content: '条目 0', role: 'user' }), 4);
    assert.equal(second.calls.length, 1, 'role is part of the cache key');
    second.preview.dispose();
});
test('database extraction stays lazy and shared while world variables remain isolated per entry', async () => {
    let databaseReads = 0, bookReads = 0;
    const data = defaultDatabase(); data.sheet_custom = structuredClone(data.sheet_0);
    const f = fixture({
        readDatabase: () => { databaseReads++; return data; },
        loadBooks: async () => { bookReads++; return [{ entries: { seed: { constant: true, position: 0, content: '{{setvar::seed::世界状态}}世界书内容' } } }]; },
    });
    f.preview.start();
    await f.preview.count({ content: '{{char}} 与 {{user}}' });
    assert.equal(databaseReads, 0); assert.equal(bookReads, 0);
    await Promise.all([
        f.preview.count({ content: '{{setvar::seed::修改}}{{getvar::seed}}' }),
        f.preview.count({ content: '{{getvar::seed}}' }),
        f.preview.count({ marker: true, identifier: 'worldInfoBefore' }),
    ]);
    assert.equal(bookReads, 1); assert.equal(databaseReads, 0);
    assert.ok(f.calls.some(call => call.messages[0].content === '修改'));
    assert.ok(f.calls.some(call => call.messages[0].content === '世界状态'));
    await Promise.all([
        f.preview.count({ content: '{{tabledata}}' }),
        f.preview.count({ content: '{{sheet_0}}' }),
        f.preview.count({ content: '{{sheet_custom}}' }),
    ]);
    assert.equal(databaseReads, 1);
    assert.ok(f.calls.every(call => !call.messages.some(message => /{{(?:tabledata|sheet_)/.test(message.content))));
    f.preview.dispose();
});
test('301-message history preserves regex/macros and yields to the browser between chunks', async () => {
    const chat = Array.from({ length: 301 }, (_, index) => ({ is_user: index % 2 === 1, mes: `楼层 ${index} secret {{user}}` }));
    const rule = { promptOnly: true, findRegex: 'secret', replaceString: 'visible', placement: [1, 2] };
    const f = fixture({ chat, settings: { extension_settings: { regex: [rule] } } });
    let browserTaskRan = false;
    const job = f.preview.count({ marker: true, identifier: 'chatHistory' }); f.preview.start();
    setTimeout(() => { browserTaskRan = true; }, 0);
    await job;
    assert.equal(browserTaskRan, true);
    const variables = { user: '用户', char: '角色' };
    const expected = chat.map((message, index) => ({ role: message.is_user ? 'user' : 'assistant', content: expand(applyRegex(message.mes, [rule], message.is_user ? 1 : 2, { phase: 'prompt', depth: chat.length - index - 1, variables }), variables) }));
    assert.deepEqual(f.calls[0].messages, expected);
    assert.equal(chat[300].mes, '楼层 300 secret {{user}}');
    f.preview.dispose();
});
test('closing a panel cancels active requests and never starts the queued entries', async () => {
    let calls = 0;
    const f = fixture({ api: { post(path, messages, { signal }) {
        calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('closed', 'AbortError')), { once: true }));
    } } });
    const jobs = Array.from({ length: 30 }, (_, i) => f.preview.count({ content: `条目 ${i}` }));
    const settled = Promise.allSettled(jobs); f.preview.start();
    await sleep(15); f.preview.dispose();
    assert.ok(calls <= 2);
    assert.ok((await settled).every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
    const before = calls; await sleep(10); assert.equal(calls, before);
});
test('identical in-flight requests are shared and the cache stays bounded', async () => {
    const f = fixture(); f.preview.start();
    await Promise.all([f.preview.count({ content: '一样' }), f.preview.count({ content: '一样' })]);
    assert.equal(f.calls.length, 1); f.preview.dispose();
    const cache = new TokenCountCache(5, 2);
    cache.set('aa', 1); cache.set('bb', 2); cache.get('aa'); cache.set('cc', 3);
    assert.equal(cache.get('bb'), undefined); assert.equal(cache.get('aa'), 1);
    cache.set('toolarge', 4); assert.ok(cache.chars <= 5);
});
