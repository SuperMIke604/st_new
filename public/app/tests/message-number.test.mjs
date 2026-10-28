import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function messageNumber('), source.indexOf('function renderMessage(')), context);
const label = context.messageNumber;
const timing = { gen_started: '2026-10-28T00:00:00.000Z', gen_finished: '2026-10-28T00:00:12.600Z' };

test('AI generation seconds follow tokens; user messages and unknown durations retain their labels', () => {
    assert.equal(label(timing, 2, 123), '#2 · 123 · 13s');
    assert.equal(label({ ...timing, is_user: true }, 1, 3), '#1 · 3');
    assert.equal(label({}, 0, 188), '#0 · 188');
    assert.equal(label({ ...timing, gen_finished: null }, 2), '#2 · -');
    assert.equal(label({ ...timing, gen_finished: 'invalid' }, 2), '#2 · -');
    assert.equal(label({ ...timing, gen_finished: '2026-10-27T00:00:00Z' }, 2), '#2 · -');
    assert.equal(label({ ...timing, gen_finished: timing.gen_started }, 2, 0), '#2 · 0 · 0s');
});

test('reply candidates use their own timing even when their text and token count match', () => {
    const message = { ...timing, swipe_id: 1, swipe_info: [timing, { ...timing, gen_finished: '2026-10-28T00:00:25Z' }] };
    assert.equal(label(message, 2, 123), '#2 · 123 · 25s');
    message.swipe_id = 0;
    assert.equal(label(message, 2, 123), '#2 · 123 · 13s');
    message.swipe_info[0] = { extra: {} };
    assert.equal(label(message, 2, 123), '#2 · 123');
});
