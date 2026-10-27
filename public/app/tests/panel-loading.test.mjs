import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings } from '../load-timings.js';
const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('const nextPaint ='), source.indexOf('function action('));
class Node {
    constructor(text = '') { this.textContent = text; this.children = []; this.attributes = {}; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    remove() { this.removed = true; }
    querySelector() { return this.children[0] || null; }
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const frames = [], logs = new LoadTimings(), state = { ready: true };
    const context = vm.createContext({ state, panelRevision: 1, panelLoads: new WeakMap(), loadTimings: logs,
        requestAnimationFrame: callback => frames.push(callback), setTimeout: callback => callback(),
        loadingIndicator: text => new Node(text), el: (tag, className, text) => new Node(text), action: text => new Node(text),
    });
    vm.runInContext(helper, context);
    const host = new Node(); context.host = host;
    return { host, context, state, logs, paint: async () => { frames.shift()?.(); await tick(); }, run: (render, retainContent = false) => { context.render = render; context.options = { retainContent }; return vm.runInContext("loadPanelContent(host, '测试页面', render, () => {}, options)", context); } };
}
test('even cached pages paint a loader before rendering and finish after their content is displayed', async () => {
    const f = fixture(); let rendered = false;
    const running = f.run(content => { rendered = true; content.append(new Node('内容')); });
    assert.equal(f.host.attributes['aria-busy'], 'true'); assert.equal(rendered, false);
    await f.paint(); assert.equal(rendered, true); assert.equal(f.host.attributes['aria-busy'], 'true');
    await f.paint(); await running;
    assert.equal(f.host.attributes['aria-busy'], undefined);
    assert.equal(f.host.children[0].children[0].textContent, '内容');
    assert.equal(f.logs.snapshot()[0].status, 'success');
});
test('a slower previous page cannot overwrite the current page or remove its loader', async () => {
    const f = fixture(), slow = deferred();
    const first = f.run(async content => { await slow.promise; content.append(new Node('旧内容')); }); await f.paint();
    f.context.panelRevision++;
    const second = f.run(content => content.append(new Node('新内容')));
    slow.resolve(); await first;
    assert.equal(f.host.attributes['aria-busy'], 'true');
    await f.paint(); await f.paint(); await second;
    assert.equal(f.host.children[0].children[0].textContent, '新内容');
    assert.deepEqual(f.logs.snapshot().filter(entry => entry.kind === 'page').map(entry => entry.status), ['cancelled', 'success']);
});
test('page failures remove the spinner, show retry and record failure', async () => {
    const f = fixture(), running = f.run(() => { throw new Error('offline'); });
    const rejected = assert.rejects(running, /offline/);
    await f.paint(); await rejected;
    assert.equal(f.host.attributes['aria-busy'], undefined);
    assert.match(f.host.children[0].textContent, /加载失败/);
    assert.equal(f.host.children[1].textContent, '重新加载');
    assert.equal(f.logs.snapshot()[0].status, 'error');
});
test('a page replaced before its first paint disposes its paused background work', async () => {
    const f = fixture(); let started = 0, disposed = 0;
    const running = f.run(content => { content._onReady = () => started++; content._dispose = () => disposed++; });
    await f.paint(); f.context.panelRevision++;
    await f.paint(); await running;
    assert.equal(started, 0); assert.equal(disposed, 1);
    assert.equal(f.logs.snapshot()[0].status, 'cancelled');
});

test('category switches retain the old content until async rendering succeeds', async () => {
    const f = fixture(), ready = deferred(), old = new Node('当前分类');
    let disposed = 0; old._dispose = () => disposed++;
    f.host.append(old);
    const running = f.run(async content => { await ready.promise; content.append(new Node('新分类')); }, true);
    assert.equal(f.host.children[0], old);
    assert.equal(old.inert, true);
    assert.equal(disposed, 0);
    ready.resolve(); await tick();
    assert.equal(f.host.children[0].children[0].textContent, '新分类');
    assert.equal(disposed, 1);
    await f.paint(); await running;
    assert.equal(f.host.attributes['aria-busy'], undefined);
});

test('a stale category cannot replace a newer category', async () => {
    const f = fixture(), slow = deferred();
    f.host.append(new Node('初始分类'));
    const first = f.run(async content => { await slow.promise; content.append(new Node('旧分类')); }, true);
    f.context.panelRevision++;
    const second = f.run(content => content.append(new Node('最新分类')), true);
    await tick(); slow.resolve(); await first; await f.paint(); await second;
    assert.equal(f.host.children[0].children[0].textContent, '最新分类');
    assert.equal(f.host.attributes['aria-busy'], undefined);
});
