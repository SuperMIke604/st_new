import test from 'node:test';
import assert from 'node:assert/strict';
import { installMessageEdit, installMessageEditGuard } from '../message-edit.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('other controls wait for an edit decision while editor clicks and reading pass through', () => {
    const requests = [];
    let onClick, editing = true;
    installMessageEditGuard({
        addEventListener(type, callback, capture) {
            assert.equal(type, 'click');
            assert.equal(capture, true);
            onClick = callback;
        },
    }, () => editing, callback => requests.push(callback));
    const event = (inside, control) => ({
        target: { closest: selector => selector.startsWith('.inline-editor') ? inside : control },
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
    });
    for (const gesture of [event(true, true), event(false, false)]) {
        onClick(gesture);
        assert.equal(gesture.prevented, undefined);
    }
    assert.equal(requests.length, 0);
    const outside = event(false, true);
    onClick(outside);
    assert.equal(outside.prevented, true);
    assert.equal(outside.stopped, true);
    assert.equal(requests.length, 1);
    editing = false;
    onClick(event(false, true));
    assert.equal(requests.length, 1);
});

test('cancelling an inline edit restores its message without writing the draft or saving', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function cancelMessageEdit('), source.indexOf('async function saveMessageEdit('));
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
test('pending operations wait for a decision and resume only after a successful save or discard', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function resolveMessageEdit('), source.indexOf('installMessageEditGuard(document'));
    const message = { mes: 'original' };
    let onClose, opens = 0, saves = 0, resumed = 0, focused = 0, shouldFail = false;
    const dialog = {
        returnValue: '',
        addEventListener(type, callback) { assert.equal(type, 'close'); onClose = callback; },
        showModal() { opens++; },
    };
    const context = vm.createContext({
        inlineEdit: { message, text: 'draft', originalText: 'original' },
        resolvingMessageEdit: false,
        $: () => dialog,
        document: { querySelector: () => ({ focus() { focused++; } }) },
        run: callback => callback(),
        cancelMessageEdit() { context.inlineEdit = null; },
        async saveMessageEdit(target) {
            assert.equal(target, message);
            saves++;
            if (shouldFail) throw Error('save failed');
            context.inlineEdit = null;
        },
    });
    vm.runInContext(fn, context);
    const operate = () => context.afterMessageEdit(() => { resumed++; });
    const choose = value => { dialog.returnValue = value; onClose(); };

    let operation = operate();
    assert.equal(opens, 1);
    await operate();
    choose('continue');
    await operation;
    assert.equal(resumed, 0);
    assert.equal(context.inlineEdit.text, 'draft');
    assert.equal(focused, 1);

    shouldFail = true;
    operation = operate();
    choose('save');
    await assert.rejects(operation, /save failed/);
    assert.equal(resumed, 0);

    shouldFail = false;
    operation = operate();
    choose('save');
    await operation;
    assert.equal(saves, 2);
    assert.equal(resumed, 1);

    context.inlineEdit = { message, text: 'draft', originalText: 'original' };
    operation = operate();
    choose('discard');
    await operation;
    assert.equal(context.inlineEdit, null);
    assert.equal(message.mes, 'original');
    assert.equal(saves, 2);
    assert.equal(resumed, 2);

    context.inlineEdit = { message, text: 'original', originalText: 'original' };
    await operate();
    assert.equal(opens, 4);
    assert.equal(resumed, 3);
});

function gestureFixture() {
    const events = new Map(), edits = [];
    let time = 0, hit;
    const list = {
        addEventListener: (type, callback) => events.set(type, callback),
        ownerDocument: { elementFromPoint: () => hit },
    };
    const first = { parentElement: list, message: { floor: 1 } };
    const second = { parentElement: list, message: { floor: 2 } };
    const target = (node, control = false) => ({ closest: selector => selector.startsWith('article') ? node : control });
    const event = (node, detail, control = false) => ({
        target: target(node, control), detail, clientX: 30, clientY: 40, pointerType: 'touch', pointerId: 1,
        preventDefault() {},
    });
    const fire = (kind, node, detail, control) => events.get(kind)(event(node, detail, control));
    const tap = (node, { underFinger = node, control = false } = {}) => {
        hit = target(underFinger, control);
        fire('pointerdown', node, 0, control);
        fire('pointerup', node, 0, control);
        time += 100;
    };
    installMessageEdit(list, node => node.message, message => edits.push(message.floor), { now: () => time });
    return { edits, first, second, fire, tap };
}

test('desktop editing requires two clicks on the same message, even if the browser reports a double click across floors', () => {
    const { edits, first, second, fire } = gestureFixture();
    fire('click', second, 1);
    fire('click', first, 2);
    fire('dblclick', first, 2);
    assert.deepEqual(edits, []);

    fire('click', second, 1);
    second.message = { floor: 3 };
    fire('click', second, 2);
    fire('dblclick', second, 2);
    assert.deepEqual(edits, []);

    fire('click', second, 1, true);
    fire('click', second, 2);
    fire('dblclick', second, 2);
    assert.deepEqual(edits, []);

    fire('click', second, 1);
    fire('click', second, 2);
    fire('dblclick', second, 2);
    assert.deepEqual(edits, [3]);
});

test('touch taps cannot combine across floors or use a stale pointer target after layout moves', () => {
    const { edits, first, second, fire, tap } = gestureFixture();
    tap(first);
    tap(second);
    tap(first);
    assert.deepEqual(edits, []);

    tap(first, { underFinger: second });
    tap(first);
    assert.deepEqual(edits, []);
    fire('pointercancel', first, 0);
    tap(first);
    assert.deepEqual(edits, []);

    tap(first);
    tap(second, { control: true });
    tap(second);
    tap(second);
    assert.deepEqual(edits, [1, 2]);
});

test('delete while editing checks current message and saves only the selected floor; cancel keeps the draft', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function deleteEditedMessage('), source.indexOf('async function chatHistoryPanel('));
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
