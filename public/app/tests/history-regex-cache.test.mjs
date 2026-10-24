import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRegexCache } from '../history-regex-cache.js';
import { applyRegex } from '../regex.js';
const rule = { findRegex: String.raw`/<hidden>[\s\S]*?<\/hidden>/g`, replaceString: '', placement: [1, 2], promptOnly: true, minDepth: null, maxDepth: 2 };
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
