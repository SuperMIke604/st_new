import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { previewDocument, decorateCodeBlocks } from '../code-blocks.js';

test('late iframe registration remeasures unchanged content and routes card sends', () => {
    const original = { window: globalThis.window, document: globalThis.document, confirm: globalThis.confirm };
    const guestEvents = new Map(), hostEvents = new Map(), frames = [], sent = [], measured = [];
    const parent = {};
    const frame = {
        isConnected: true, style: {},
        setAttribute() {}, addEventListener(type, fn) { this[type] = fn; },
        getBoundingClientRect() { return { height: Number.parseFloat(this.style.height) || 1 }; },
    };
    const guest = { postMessage(data) { guestEvents.get('message')?.({ source: parent, data }); } };
    frame.contentWindow = guest;
    parent.postMessage = data => {
        if (data.type === 'tavern-html-height') measured.push(data.height);
        hostEvents.get('message')?.({ source: guest, data });
    };
    const body = { scrollHeight: 1085, getBoundingClientRect: () => ({ height: 1084.8 }) };
    const context = {
        parent, document: { body, addEventListener() {} },
        addEventListener: (type, fn) => guestEvents.set(type, fn),
        getComputedStyle: () => ({ marginTop: '0', marginBottom: '0' }),
        requestAnimationFrame: fn => frames.push(fn),
        ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    };
    context.window = context;
    vm.runInNewContext(previewDocument('').match(/<script>([\s\S]*?)<\/script>/)[1], context);
    const flush = () => { while (frames.length) frames.shift()(); };
    try {
        globalThis.window = { addEventListener: (type, fn) => hostEvents.set(type, fn) };
        globalThis.document = { createElement: () => frame };
        globalThis.confirm = () => true;
        // DOMContentLoaded occurs before the host knows this WindowProxy.
        guestEvents.get('DOMContentLoaded')(); flush();
        assert.equal(measured.length, 1);
        assert.equal(frame.style.height, undefined);
        const code = { parentElement: { replaceWith() {} }, textContent: '<div>Card</div>', classList: ['language-html'] };
        decorateCodeBlocks({ querySelectorAll: () => [code] }, { send: text => sent.push(text) });
        flush();
        assert.equal(frame.style.height, '1085px');
        assert.equal(measured.length, 2, 'registration requests the same height again');
        frame.load(); flush();
        assert.equal(frame.style.height, '1085px');
        context.triggerSlash('/send 姓名: 测试\n备注: A|B|/trigger');
        assert.deepEqual(sent, ['姓名: 测试\n备注: A|B']);
        globalThis.confirm = () => false;
        context.triggerSlash('/send cancelled|/trigger');
        assert.equal(sent.length, 1);
        assert.throws(() => context.triggerSlash('/delete 0'), /仅支持/);
        frame.isConnected = false;
        globalThis.confirm = () => true;
        context.triggerSlash('/send detached|/trigger');
        assert.equal(sent.length, 1, 'detached cards cannot send into another chat');
    } finally {
        Object.assign(globalThis, original);
    }
});
