import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualChat } from '../virtual-chat.js';

test('scrolling preserves mounted messages and iframe documents inside the retained window', () => {
    class Element {
        constructor() { this.children = []; this.style = {}; this.dataset = {}; this.mounts = 0; this.scrollTop = 0; }
        get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
        addEventListener() {}
        replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); for (const node of nodes) this.insertBefore(node, null); }
        insertBefore(node, before) { node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, node); node.parent = this; node.mounts++; }
        remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
    }
    const oldDocument = globalThis.document, oldObserver = globalThis.ResizeObserver;
    globalThis.document = { createElement: () => new Element() };
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    try {
        const root = new Element();
        const list = new VirtualChat(root, (message, index, node) => node || Object.assign(new Element(), { messageIndex: index }));
        list.messages = Array.from({ length: 100 }, () => ({})); list.calculate(); list.paint(20);
        const stable = new Map(list.nodes);
        for (let i = 0; i < 5; i++) list.paint(20);
        for (const node of stable.values()) assert.equal(node.mounts, 1, 'ordinary wheel paints must not detach mounted cards');
        list.paint(21);
        for (const [index, node] of stable) if (list.nodes.has(index)) { assert.equal(list.nodes.get(index), node); assert.equal(node.mounts, 1); }
        list.paint(19);
        assert.deepEqual(root.children.slice(1, -1).map(node => node.messageIndex), [...list.nodes.keys()]);
        assert.ok(list.nodes.size <= 40);
    } finally { globalThis.document = oldDocument; globalThis.ResizeObserver = oldObserver; }
});
