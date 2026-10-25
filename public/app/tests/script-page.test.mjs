import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptRuntime, scriptClip } from '../script-runtime.js';

test('page script hit regions exclude empty space and reject malformed geometry', () => {
    assert.equal(scriptClip([], 400, 800), 'path("M0 0Z")');
    assert.equal(scriptClip([[10, 80, 350, 600]], 400, 800), 'path("M10 80H360V680H10Z")');
    assert.equal(scriptClip([[-5, -4, 55, 54], [390, 790, 50, 50]], 400, 800), 'path("M0 0H50V50H0Z M390 790H400V800H390Z")');
    assert.equal(scriptClip([[NaN, 0, 10, 10], [0, 0, -1, 4], [900, 0, 20, 20]], 400, 800), 'path("M0 0Z")');
    assert.equal(scriptClip(Array(65).fill([0, 0, 1, 1]), 400, 800), 'path("M0 0Z")');
});

test('page script messages are bound to the current frame and place registered actions in quick replies', async () => {
    const previous = globalThis.document;
    const posted = [], nodes = [];
    const toggle = { setAttribute: (key, value) => posted.push([key, value]) };
    globalThis.document = { getElementById: () => toggle, createElement: () => ({}) };
    try {
        const runtime = new ScriptRuntime({ notify() {} });
        runtime.frame = { contentWindow: { postMessage: (...args) => posted.push(args) }, style: {}, clientWidth: 400, clientHeight: 800 };
        runtime.actions = { hidden: true, querySelector: () => null, append: node => nodes.push(node) };
        runtime.statusRows.set('character-scenes', {});
        await runtime.receive({ source: {}, data: { channel: 'st-new-scripts', type: 'layout', rects: [[0, 0, 400, 800]] } });
        assert.equal(runtime.frame.style.clipPath, undefined);
        const send = data => runtime.receive({ source: runtime.frame.contentWindow, data: { channel: 'st-new-scripts', ...data } });
        await send({ type: 'layout', rects: [[10, 80, 50, 50]] }); assert.equal(runtime.frame.style.clipPath, 'path("M10 80H60V130H10Z")');
        await send({ type: 'buttons', id: 'unregistered', buttons: [{ name: 'ignore', visible: true }] }); assert.equal(nodes.length, 0);
        await send({ type: 'buttons', id: 'character-scenes', buttons: [{ name: '日常篇', visible: true }, { name: 'hidden', visible: false }] });
        assert.equal(nodes.length, 1); assert.equal(runtime.actions.hidden, true, 'registration must not open the menu');
        runtime.actions.hidden = false; nodes[0].onclick(); assert.equal(runtime.actions.hidden, true);
        assert.equal(posted.at(-1)[0].event, 'character-scenes:日常篇');
    } finally { globalThis.document = previous; }
});
