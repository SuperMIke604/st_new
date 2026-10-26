import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings, timingStatusText, timingDetailText } from '../load-timings.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const panel = source.slice(source.indexOf('function timingPanel()'), source.indexOf('\nfunction field('));
class Node {
    constructor(tag, className, text) { this.tag = tag; this.className = className; this.textContent = text; this.children = []; this.dataset = {}; this.events = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(type, callback) { this.events[type] = callback; }
    showModal() { this.open = true; }
    show() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    remove() { this.removed = true; }
    click() { this.clicked = true; }
}

test('log refresh, export and clear remain independent of pending generation and editor state', async () => {
    const root = new Node('body'), buttons = new Map(), logs = new LoadTimings();
    const completed = logs.start('旧记录'); completed();
    const finish = logs.start('模型等待', 'generation');
    const controller = new AbortController();
    const state = { busy: true, dirty: true, controller };
    let exported;
    const context = vm.createContext({ state, panelDirty: true, variablesSaving: true, loadTimings: logs, timingStatusText, timingDetailText,
        document: { body: root, getElementById: () => null }, matchMedia: () => ({ matches: true }),
        el: (...args) => new Node(...args), note: (parent, text) => parent.append(new Node('p', '', text)),
        action: (label, callback) => { const node = new Node('button', '', label); buttons.set(label, callback); return node; },
        Blob, URL: { createObjectURL: blob => { exported = blob; return 'blob:test'; }, revokeObjectURL() {} }, setTimeout: callback => callback(),
        showPanel() { throw Error('must not enter shared editor lifecycle'); },
    });
    vm.runInContext(panel, context); vm.runInContext('timingPanel()', context);
    assert.equal(root.children[0].open, true);
    buttons.get('刷新记录')(); buttons.get('导出日志')();
    assert.equal(JSON.parse(await exported.text()).entries.at(-1).status, 'loading');
    buttons.get('清空日志')();
    assert.deepEqual(logs.snapshot().map(entry => entry.label), ['模型等待']);
    assert.equal(controller.signal.aborted, false); assert.equal(state.busy, true); assert.equal(state.dirty, true);
    assert.equal(vm.runInContext('panelDirty && variablesSaving', context), true);
    finish(); assert.equal(logs.snapshot()[0].status, 'success');
    buttons.get('关闭日志')(); assert.equal(root.children[0].removed, true);
});
