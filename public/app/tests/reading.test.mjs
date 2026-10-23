import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSettings, applyReading } from '../reading.js';
test('reading settings survive persisted values and support zero spacing', () => {
    const input = { fontSize: '21', letterSpacing: '0', lineHeight: '2.25', paragraphSpacing: '0' };
    const value = readingSettings(input, true);
    assert.deepEqual(value, { fontSize: 21, letterSpacing: 0, lineHeight: 2.25, paragraphSpacing: 0 });
    assert.deepEqual(readingSettings(JSON.parse(JSON.stringify(value))), value);
    const style = new Map(); applyReading(value, { style: { setProperty: (key, value) => style.set(key, value) } });
    assert.equal(style.get('--reading-fontSize'), '21px'); assert.equal(style.get('--reading-lineHeight'), '2.25'); assert.equal(style.get('--reading-paragraphSpacing'), '0px');
});
test('invalid settings fall back safely on load and are rejected on save', () => {
    assert.equal(readingSettings({ fontSize: 'oops' }).fontSize, 15);
    assert.equal(readingSettings({ fontSize: 999 }).fontSize, 36);
    for (const value of [{ fontSize: 50 }, { letterSpacing: -1 }, { lineHeight: 0 }, { paragraphSpacing: -2 }]) assert.throws(() => readingSettings(value, true));
});
