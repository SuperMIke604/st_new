import test from 'node:test';
import assert from 'node:assert/strict';
import { installMessageEdit } from '../message-edit.js';
test('double click and touch double tap edit; single taps, controls and cancelled gestures do not', () => {
    const events = new Map(); let edits = 0, time = 0;
    installMessageEdit({ addEventListener: (type, fn) => events.set(type, fn) }, () => edits++, { now: () => time });
    const event = (control = false) => ({ target: { closest: () => control }, clientX: 30, clientY: 40, pointerType: 'touch', preventDefault() {} });
    events.get('pointerup')(event()); assert.equal(edits, 0);
    time = 200; events.get('pointerup')(event()); assert.equal(edits, 1);
    events.get('dblclick')(event(true)); assert.equal(edits, 1);
    events.get('dblclick')(event()); assert.equal(edits, 2);
    time = 600; events.get('pointerup')(event()); events.get('pointercancel')(); time = 700; events.get('pointerup')(event()); assert.equal(edits, 2);
});
