import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRegexCache, historyRegexCache, warmHistoryRegex } from '../history-regex-cache.js';
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

const effectiveRules = [
    { findRegex: '/KEEP/g', replaceString: 'keep', placement: [1, 2], promptOnly: true },
    { findRegex: '/^[\\s\\S]*$/g', replaceString: '', placement: [1, 2], promptOnly: true, minDepth: 30, maxDepth: null },
];

test('5000 floors retaining 30 messages use compact empty markers instead of copying every old body', t => {
    const chat = Array.from({ length: 5000 }, (_, i) => ({ mes: `KEEP ${i} ` + 'x'.repeat(2048), is_user: !!(i % 2) }));
    const legacy = new HistoryRegexCache(); legacy.reserve(chat.length);
    const full = legacy.prepare(effectiveRules), lean = new HistoryRegexCache(), transform = lean.prepare(effectiveRules);
    for (let i = 0; i < chat.length; i++) {
        const m = chat[i], depth = chat.length - i - 1, placement = m.is_user ? 1 : 2;
        assert.equal(transform(m.mes, placement, depth, {}, false, m), full(m.mes, placement, depth));
    }
    transform.finish();
    assert.equal(lean.filteredResults, 4970); assert.equal(lean.entries.size, 30); assert.equal(lean.maxEntries, 512);
    assert.ok(lean.chars < legacy.chars / 20, `${lean.chars} vs ${legacy.chars} retained text characters`);
    t.diagnostic(`Retained cache text: ${legacy.chars} -> ${lean.chars} characters; full entries ${lean.entries.size}; filtered messages ${lean.filteredResults}. This excludes chat source strings and marker metadata.`);
    const before = lean.stats(), repeat = lean.prepare(effectiveRules);
    for (let i = 0; i < chat.length; i++) { const m = chat[i]; repeat(m.mes, m.is_user ? 1 : 2, chat.length - i - 1, {}, false, m); }
    repeat.finish();
    assert.equal(lean.filteredHits - before.filteredHits, 4970); assert.equal(lean.misses - before.misses, 0); assert.equal(lean.evictions, 0);
});

test('empty markers validate exact source, depth-specific rules and configuration', () => {
    const cache = new HistoryRegexCache(), message = { mes: 'KEEP source' }, transform = cache.prepare(effectiveRules);
    assert.equal(transform(message.mes, 2, 30, {}, false, message), '');
    assert.equal(transform(message.mes, 2, 31, {}, false, message), ''); assert.equal(cache.filteredHits, 1);
    assert.equal(transform(message.mes, 2, 29, {}, false, message), 'keep source');
    message.mes = 'KEEP edited'; const misses = cache.misses;
    assert.equal(transform(message.mes, 2, 30, {}, false, message), ''); assert.equal(cache.misses, misses + 1);
    const changed = cache.prepare([{ ...effectiveRules[1], replaceString: 'retained' }]);
    assert.equal(changed(message.mes, 2, 30, {}, false, message), 'retained');
});

function uncachedPrompt(input) {
    const original = historyRegexCache.prepare;
    historyRegexCache.prepare = rules => Object.assign((text, placement, depth, variables) => applyRegex(text, rules, placement, { phase: 'prompt', depth, variables }), { finish() {} });
    try { return buildPrompt(input); } finally { historyRegexCache.prepare = original; }
}

test('filtered caching preserves final prompts, names, dynamic rules and macro side effects across send and regeneration', () => {
    const chat = Array.from({ length: 80 }, (_, i) => ({ mes: `KEEP ${i} {{user}}`, name: i % 2 ? 'User' : 'Character', is_user: !!(i % 2) }));
    chat[65].mes = '{{setvar::flag::kept}}'; chat[79].mes = '{{getvar::flag}}';
    const rules = [...effectiveRules, { findRegex: '/keep/', replaceString: '{{user}}', promptOnly: true, placement: [1], maxDepth: 3 }];
    for (const names_behavior of [0, 1, 2]) for (const messages of [chat, [...chat, { mes: 'new question', is_user: true }], chat.slice(0, -1)]) {
        const logs = new LoadTimings(), input = { character: { name: 'Character' }, settings: { username: 'User', extension_settings: { regex: rules } }, preset: { names_behavior }, chat: messages };
        const expected = uncachedPrompt(input);
        const actual = buildPrompt({ ...input, measureBuild: (label, task, details) => logs.measureSync(label, 'generation', task, details) });
        assert.deepEqual(actual, expected); assert.deepEqual(buildPrompt(input), expected);
        const metrics = logs.snapshot().find(entry => entry.label === '历史消息正则与宏展开').metrics;
        assert.ok(metrics.filteredMessages > 0); assert.ok(metrics.effectiveMessages > 0);
    }
});

test('cancelled warmup never shrinks capacity using an incomplete effective-history count', async () => {
    historyRegexCache.reserve(1000); const capacity = historyRegexCache.maxEntries;
    let visits = 0;
    const result = await warmHistoryRegex(Array.from({ length: 1000 }, () => ({ mes: 'KEEP source' })), effectiveRules, () => visits++ < 5);
    assert.equal(result.status, 'cancelled'); assert.equal(historyRegexCache.maxEntries, capacity);
});
