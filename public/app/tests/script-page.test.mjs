import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptRuntime, scriptClip } from '../script-runtime.js';
import { scriptLayoutNodes } from '../script-layout.js';

test('page script hit regions exclude empty space and reject malformed geometry', () => {
    assert.equal(scriptClip([], 400, 800), 'path("M0 0Z")');
    assert.equal(scriptClip([[10, 80, 350, 600]], 400, 800), 'path("M10 80H360V680H10Z")');
    assert.equal(scriptClip([[-5, -4, 55, 54], [390, 790, 50, 50]], 400, 800), 'path("M0 0H50V50H0Z M390 790H400V800H390Z")');
    assert.equal(scriptClip([[NaN, 0, 10, 10], [0, 0, -1, 4], [900, 0, 20, 20]], 400, 800), 'path("M0 0Z")');
    assert.equal(scriptClip(Array(65).fill([0, 0, 1, 1]), 400, 800), 'path("M0 0Z")');
});

test('floating script clips include outer shadows and round fractional edges outwards', () => {
    const widget = (boxShadow, rect) => ({ tagName: 'DIV', style: { boxShadow }, getBoundingClientRect: () => rect });
    const calendar = widget('none', { x: 337.6, y: 66.2, width: 42, height: 42 });
    const phone = widget('rgba(227, 192, 136, 0.45) 0px 0px 0px 1px, rgba(227, 192, 136, 0.08) 0px 0px 12px 0px inset, rgba(0, 0, 0, 0.6) 0px 6px 18px 0px', { x: 10, y: 80, width: 50, height: 50 });
    const noOuterShadow = widget('rgba(0, 0, 0, 0) 0px 0px 100px 0px, rgba(0, 0, 0, 0.8) 0px 0px 40px 0px inset', { x: 150, y: 200, width: 10, height: 20 });
    const large = widget('rgb(5, 5, 5) 800px -900px 600px 0px', { x: 250, y: 400, width: 30, height: 10 });
    const layout = scriptLayoutNodes({ body: { children: [calendar, phone, noOuterShadow, large] } }, node => node.style);
    assert.deepEqual(layout.rects, [[337, 66, 43, 43], [-17, 59, 104, 104], [150, 200, 10, 20], [150, 272, 258, 138]]);
    assert.equal(scriptClip(layout.rects.slice(0, 2), 400, 800), 'path("M337 66H380V109H337Z M0 59H87V163H0Z")');
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
