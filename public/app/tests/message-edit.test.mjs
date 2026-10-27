import test from 'node:test';
import assert from 'node:assert/strict';
import { installMessageEdit } from '../message-edit.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
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

test('delete while editing checks current message and saves only the selected floor; cancel keeps the draft', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function deleteEditedMessage('), source.indexOf('function chatHistoryPanel('));
    const first = { mes: 'first' }, selected = { mes: 'selected', is_user: true }, last = { mes: 'last' };
    const state = { chat: [first, selected, last] }; let confirmed = false, saved = 0, invalidated = -1, rendered = 0;
    const context = vm.createContext({ state, inlineEdit: { message: selected, text: 'draft' }, assertIdle() { if (state.busy) throw Error('busy'); }, confirm: () => confirmed,
        invalidateDatabases(chat, index) { invalidated = index; }, list: { setMessages() { rendered++; } }, saveChat: async () => { saved++; }
    });
    vm.runInContext(fn, context);
    await context.deleteEditedMessage(selected); assert.equal(state.chat.length, 3); assert.equal(context.inlineEdit.text, 'draft'); assert.equal(saved, 0);
    confirmed = true; state.busy = true; await assert.rejects(context.deleteEditedMessage(selected), /busy/); state.busy = false;
    state.dirty = true; await assert.rejects(context.deleteEditedMessage(selected), /保存/); state.dirty = false;
    await assert.rejects(context.deleteEditedMessage(first), /消息已变化/);
    await context.deleteEditedMessage(selected); assert.deepEqual(state.chat, [first, last]); assert.equal(context.inlineEdit, null); assert.equal(invalidated, 1); assert.equal(saved, 1); assert.equal(rendered, 1);
});
