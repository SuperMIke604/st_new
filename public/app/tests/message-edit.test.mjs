import test from 'node:test';
import assert from 'node:assert/strict';
import { installMessageEdit, installMessageEditDismiss } from '../message-edit.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('other controls cancel editing in capture phase while editor controls and reading preserve it', () => {
    const events = new Map(); let cancelled = 0;
    installMessageEditDismiss({ addEventListener(type, callback, capture) { assert.equal(capture, true); events.set(type, callback); } }, () => cancelled++);
    const event = (inside, control) => ({ target: { closest: selector => selector === '.inline-editor' ? inside : control } });
    for (const type of ['click', 'focusin']) {
        events.get(type)(event(true, true));
        events.get(type)(event(false, false));
        assert.equal(cancelled, type === 'click' ? 0 : 1);
        events.get(type)(event(false, true));
    }
    assert.equal(cancelled, 2);
});

test('cancelling an inline edit restores its message without writing the draft or saving', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function cancelMessageEdit('), source.indexOf('installMessageEditDismiss(document'));
    const message = { mes: 'original', swipes: ['original'] }, updates = [];
    const context = vm.createContext({ state: { chat: [message] }, inlineEdit: { message, text: 'discarded draft' }, list: { update: index => updates.push(index) } });
    vm.runInContext(fn, context);
    context.cancelMessageEdit(); context.cancelMessageEdit();
    assert.equal(context.inlineEdit, null);
    assert.deepEqual(updates, [0]);
    assert.deepEqual(message, { mes: 'original', swipes: ['original'] });
    context.inlineEdit = { message: {}, text: 'old chat' };
    context.cancelMessageEdit();
    assert.deepEqual(updates, [0]);
});
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
