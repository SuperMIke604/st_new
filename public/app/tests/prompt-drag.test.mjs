import test from 'node:test';
import assert from 'node:assert/strict';
import { installPromptDrag } from '../prompt-drag.js';

test('long press reorders complete prompt identities; cancellation restores the original order', async () => {
    const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
    let frame;
    globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { frame = null; };
    try {
        const rows = new EventTarget(); rows.children = []; rows.isConnected = true;
        rows.append = row => { rows.children = rows.children.filter(item => item !== row); rows.children.push(row); };
        rows.insertBefore = (row, next) => { rows.children = rows.children.filter(item => item !== row); rows.children.splice(rows.children.indexOf(next), 0, row); };
        const createRow = id => {
            const row = { dataset: { promptId: id }, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ top: rows.children.indexOf(row) * 50, height: 50 }) };
            let captured = false;
            row.summary = { parentElement: row, setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; } };
            return row;
        };
        rows.children = ['main', 'history', 'last'].map(createRow);
        const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top: -100, bottom: 500 }) };
        const commits = [];
        const dispose = installPromptDrag(rows, scroller, ids => commits.push(ids));
        const send = (type, row, y) => {
            const event = new Event(type, { cancelable: true });
            Object.defineProperties(event, { target: { value: { closest: selector => selector === '.prompt-summary' ? row.summary : null } }, button: { value: 0 }, pointerId: { value: 1 }, clientX: { value: 80 }, clientY: { value: y }, pointerType: { value: 'touch' } });
            rows.dispatchEvent(event);
        };
        const first = rows.children[0];
        send('pointerdown', first, 20); send('pointerup', first, 20);
        assert.equal(commits.length, 0, 'a normal tap must not sort');
        send('pointerdown', first, 20);
        await new Promise(resolve => setTimeout(resolve, 450));
        send('pointermove', first, 145); frame(); send('pointerup', first, 145);
        assert.deepEqual(commits, [['history', 'last', 'main']]);
        send('pointerdown', first, 120);
        await new Promise(resolve => setTimeout(resolve, 450));
        send('pointermove', first, 0); frame(); send('pointercancel', first, 0);
        assert.deepEqual(rows.children.map(row => row.dataset.promptId), ['history', 'last', 'main']);
        assert.equal(commits.length, 1);
        dispose();
    } finally { globalThis.requestAnimationFrame = oldRAF; globalThis.cancelAnimationFrame = oldCancel; }
});
