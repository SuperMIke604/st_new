import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualChat } from '../virtual-chat.js';

class Element {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.mounts = 0; this.scrollTop = 0; }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
    addEventListener() {}
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); for (const node of nodes) this.insertBefore(node, null); }
    insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, node); node.parent = this; node.mounts++; }
    remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
}

test('scrolling preserves mounted messages and iframe documents inside the retained window', () => {
    const oldDocument = globalThis.document, oldObserver = globalThis.ResizeObserver;
    globalThis.document = { createElement: () => new Element() };
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    try {
        const root = new Element();
        const rendered = [];
        const list = new VirtualChat(root, (message, index, node) => {
            rendered.push(index);
            return node || Object.assign(new Element(), { messageIndex: index });
        });
        list.messages = Array.from({ length: 100 }, () => ({})); list.calculate(); list.paint(20);
        const stable = new Map(list.nodes);
        for (let i = 0; i < 5; i++) list.paint(20);
        for (const node of stable.values()) assert.equal(node.mounts, 1, 'ordinary wheel paints must not detach mounted cards');
        rendered.length = 0;
        list.paint(21, { reuse: true });
        assert.deepEqual(rendered, [52], 'scrolling only renders a message entering the window');
        for (const [index, node] of stable) if (list.nodes.has(index)) { assert.equal(list.nodes.get(index), node); assert.equal(node.mounts, 1); }
        list.paint(19);
        assert.deepEqual(root.children.slice(1, -1).map(node => node.messageIndex), [...list.nodes.keys()]);
        assert.ok(list.nodes.size <= 40);
    } finally { globalThis.document = oldDocument; globalThis.ResizeObserver = oldObserver; }
});

test('sending keeps the list at the bottom across viewport changes and still allows reading back', t => {
    const root = new Element();
    let top = 0, resize, scroll;
    root.clientHeight = 320;
    root.scrollHeight = 1800;
    root.addEventListener = (type, handler) => { if (type === 'scroll') scroll = handler; };
    Object.defineProperty(root, 'scrollTop', {
        get: () => Math.min(top, root.scrollHeight - root.clientHeight),
        set: value => { top = Math.min(value, root.scrollHeight - root.clientHeight); },
    });
    const globals = {
        document: { createElement: () => new Element() },
        ResizeObserver: class {
            constructor(handler) { resize = handler; }
            observe() {}
        },
        getComputedStyle: () => ({ marginBlockEnd: '0px' }),
        requestAnimationFrame: () => 1,
    };
    for (const [key, value] of Object.entries(globals)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { value, configurable: true });
        t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
    }
    const rendered = [];
    const earlier = { mes: 'long previous reply' }, pending = { mes: 'new user message' };
    const list = new VirtualChat(root, (message, _index, node) => {
        rendered.push(message);
        return node || new Element();
    });
    list.setMessages([earlier], { latest: true });
    const previousNode = list.nodes.get(0);
    rendered.length = 0;
    list.setMessages([earlier, pending], { latest: true, appendPreview: true });
    assert.deepEqual(rendered, [pending]);
    assert.equal(list.nodes.get(0), previousNode);
    assert.equal(root.scrollTop, 1480);

    root.clientHeight = 720;
    root.scrollTop = root.scrollTop; // Native scrolling clamps to the new maximum before ResizeObserver.
    scroll();
    root.clientHeight = 320;
    resize([{ target: root }]);
    assert.equal(root.scrollTop, 1480, 'resizing back should still show the new message at the bottom');

    root.scrollTop = 700;
    scroll();
    root.scrollHeight = 2000;
    resize([{ target: root }]);
    assert.equal(list.follow, false);
    assert.equal(root.scrollTop, 700, 'a manual scroll up should keep its reading position');
});
