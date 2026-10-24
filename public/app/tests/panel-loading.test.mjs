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
    return { host, context, state, logs, paint: async () => { frames.shift()?.(); await tick(); }, run: render => { context.render = render; return vm.runInContext("loadPanelContent(host, '测试页面', render, () => {})", context); } };
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
    assert.deepEqual(f.logs.snapshot().map(entry => entry.status), ['cancelled', 'success']);
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
