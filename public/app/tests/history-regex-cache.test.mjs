import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRegexCache, warmHistoryRegex } from '../history-regex-cache.js';
import { buildPrompt } from '../engine.js';
import { LoadTimings } from '../load-timings.js';
import { applyRegex } from '../regex.js';
const rule = { findRegex: String.raw`/<hidden>[\s\S]*?<\/hidden>/g`, replaceString: '', placement: [1, 2], promptOnly: true, minDepth: null, maxDepth: 2 };

test('history diagnostics separate regex and macros and identify cache hits and dynamic bypass', async () => {
    const logs = new LoadTimings();
    const input = { character: { name: 'test' }, chat: [{ mes: '{{user}}<hidden>private</hidden>', is_user: false }], settings: { username: 'Example', extension_settings: { regex: [rule] } } };
    const expected = buildPrompt(input);
    const result = buildPrompt({ ...input, measureBuild: (label, task, details) => logs.measureSync(label, 'generation', task, details) });
    assert.deepEqual(result, expected);
    const metrics = logs.snapshot().find(entry => entry.label === '历史消息正则与宏展开').metrics;
    assert.equal(metrics.messages, 1); assert.equal(metrics.hits, 1);
    assert.ok(metrics.regexMs >= 0); assert.ok(metrics.macroMs >= 0);
    assert.ok(!JSON.stringify(logs.snapshot()).includes('private'));
    const warmed = await warmHistoryRegex(input.chat, [{ ...rule, replaceString: '{{user}}' }]);
    assert.equal(warmed.status, 'success'); assert.equal(warmed.metrics.dynamicSkips, 1);
    const cancelled = await warmHistoryRegex(input.chat, [rule], () => false);
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.metrics.messages, 0);
});
test('cached history respects placement, depth boundaries and changed regex configuration', () => {
    const cache = new HistoryRegexCache(), transform = cache.prepare([rule]);
    const text = 'Visible<hidden>private</hidden>';
    for (const depth of [0, 1, 2, 3, 20]) for (const placement of [1, 2, 5]) assert.equal(transform(text, placement, depth), applyRegex(text, [rule], placement, { phase: 'prompt', depth }));
    const before = cache.hits; transform(text, 2, 1); assert.ok(cache.hits > before);
    const changed = cache.prepare([{ ...rule, replaceString: 'new' }]); assert.equal(changed(text, 2, 1), 'Visiblenew');
    assert.equal(transform(text, 2, 1), 'Visible', 'old warmup cannot contaminate a new configuration');
    assert.equal(changed(text, 2, 1), 'Visiblenew');
});
test('dynamic regex replacements are recalculated and never warmed with guessed variables', () => {
    const cache = new HistoryRegexCache(), dynamic = { ...rule, replaceString: '{{user}}' }, transform = cache.prepare([dynamic]);
    assert.equal(transform('<hidden>x</hidden>', 2, 0, {}, true), null);
    assert.equal(transform('<hidden>x</hidden>', 2, 0, { user: 'A' }), 'A');
    assert.equal(transform('<hidden>x</hidden>', 2, 0, { user: 'B' }), 'B');
    assert.equal(cache.entries.size, 0);
});
test('history cache is bounded and source macros remain for live expansion', () => {
    const cache = new HistoryRegexCache(70), transform = cache.prepare([{ ...rule, maxDepth: null }]);
    assert.equal(transform('{{lastusermessage}}<hidden>x</hidden>', 2, 0), '{{lastusermessage}}');
    for (let index = 0; index < 20; index++) transform('message-' + index + '<hidden>x</hidden>', 2, 0);
    assert.ok(cache.chars <= 70);
});

test('517-message history and its next turn fit without sequential cache churn', () => {
    const cache = new HistoryRegexCache(); cache.reserve(517);
    const transform = cache.prepare([{ ...rule, maxDepth: null }]);
    const messages = Array.from({ length: 517 }, (_, i) => `message-${i}<hidden>removed</hidden>`);
    for (let i = 0; i < messages.length; i++) assert.equal(transform(messages[i], 2, messages.length - i - 1), `message-${i}`);
    const before = cache.stats();
    for (let i = 0; i < messages.length; i++) transform(messages[i], 2, messages.length - i);
    transform('new user message', 1, 0);
    assert.equal(cache.hits - before.hits, 517); assert.equal(cache.misses - before.misses, 1);
    assert.equal(cache.evictions, 0); assert.ok(cache.entries.size <= cache.maxEntries); assert.ok(cache.chars <= cache.maxChars);
    cache.reserve(100000); assert.equal(cache.maxEntries, 4096);
});

test('cold scans preserve hot results and capacity diagnostics distinguish count and character pressure', () => {
    const cache = new HistoryRegexCache(8000000, 10), transform = cache.prepare([{ ...rule, maxDepth: null }]);
    for (let i = 0; i < 5; i++) { transform(`hot-${i}`, 2, 0); transform(`hot-${i}`, 2, 0); }
    for (let i = 0; i < 100; i++) transform(`cold-${i}`, 2, 0);
    const before = cache.hits;
    for (let i = 0; i < 5; i++) transform(`hot-${i}`, 2, 0);
    assert.equal(cache.hits - before, 5); assert.ok(cache.entryLimitEvictions > 0); assert.equal(cache.charLimitEvictions, 0);
    const small = new HistoryRegexCache(80), smallTransform = small.prepare([{ ...rule, maxDepth: null }]);
    for (let i = 0; i < 30; i++) smallTransform(`message-${i}`, 2, 0);
    assert.ok(small.charLimitEvictions > 0); assert.equal(small.entryLimitEvictions, 0); assert.ok(small.chars <= 80);
});
