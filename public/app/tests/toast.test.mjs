import test from 'node:test';
import assert from 'node:assert/strict';
import { createToast } from '../toast.js';
function fixture() {
    let time = 0, sequence = 0;
    const timers = new Map();
    const document = { createElement: () => node(), activeElement: null };
    function node() {
        return { children: [], events: {}, attrs: {}, dataset: {}, ownerDocument: document,
            classList: { toggle() {} }, setAttribute(key, value) { this.attrs[key] = value; },
            matches: () => false, addEventListener(key, value) { this.events[key] = value; },
            append(child) { this.children.push(child); child.parent = this; },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
        };
    }
    const element = node(); element.hidden = true;
    const toast = createToast(element, {
        now: () => time, schedule(fn, delay) { timers.set(++sequence, { fn, at: time + delay }); return sequence; },
        cancel(id) { timers.delete(id); },
    });
    function tick(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time && timers.has(id)) { timers.delete(id); timer.fn(); } }
    return { toast, element, tick, timers };
}
test('each type expires independently at its specified duration; loading uses its dismissal handle', () => {
    for (const [type, duration] of [['success', 3000], ['info', 3000], ['warning', 4000], ['error', 5000]]) {
        const f = fixture(); f.toast.show('反馈', type); f.tick(duration - 1); assert.equal(f.element.hidden, false);
        f.tick(1); assert.equal(f.element.hidden, true);
    }
    const f = fixture(); const loading = f.toast.show('正在保存', 'loading'); f.tick(60000); assert.equal(f.element.hidden, false);
    loading.dismiss(); f.toast.show('保存完成'); f.tick(3000); assert.equal(f.element.hidden, true);
});
test('new notifications append below older ones without suppressing low priority messages', () => {
    const f = fixture(); f.toast.show('失败原因', true); f.tick(1000); f.toast.show('已保存'); f.toast.show('状态', 'info');
    assert.deepEqual(f.element.children.map(node => node.textContent), ['失败原因', '已保存', '状态']);
    assert.equal(f.element.children[0].attrs['aria-live'], 'assertive');
    f.tick(2999); assert.equal(f.element.children.length, 3);
    f.tick(1); assert.equal(f.element.children.length, 1); f.tick(1000); assert.equal(f.element.hidden, true);
});
test('hover and focus pause one item independently of other notifications', () => {
    const f = fixture(); const first = f.toast.show('已保存').element; f.toast.show('另一个操作');
    f.tick(500); first.events.pointerenter(); first.events.focus(); f.tick(2500);
    assert.deepEqual(f.element.children, [first]); first.events.pointerleave(); f.tick(9000); assert.equal(f.element.hidden, false);
    first.events.blur(); f.tick(2499); assert.equal(f.element.hidden, false); f.tick(1); assert.equal(f.element.hidden, true);
});
test('duplicates refresh only their own timeout without rebuilding or moving the item', () => {
    const f = fixture(); const first = f.toast.show('状态', 'info'); f.toast.show('其他', 'warning');
    f.tick(2500); const repeated = f.toast.show('状态', 'info'); assert.equal(first, repeated);
    assert.equal(f.element.children.length, 2); assert.equal(f.element.children[0], first.element);
    f.tick(1500); assert.equal(f.element.children.length, 1); f.tick(1500); assert.equal(f.element.hidden, true);
});
test('click and keyboard dismiss only the targeted plain text toast', () => {
    for (const key of [null, 'Enter', ' ', 'Escape']) {
        const f = fixture(); const item = f.toast.show('<b>不解析 HTML</b>', 'loading').element; f.toast.show('保留');
        assert.equal(item.textContent, '<b>不解析 HTML</b>'); assert.equal(item.children.length, 0);
        if (key) item.events.keydown({ key, preventDefault() {} }); else item.events.click();
        assert.equal(f.element.children.length, 1); assert.equal(f.element.children[0].textContent, '保留');
        f.toast.dismiss(); assert.equal(f.element.hidden, true); assert.equal(f.timers.size, 0);
    }
});

test('only identical original text and type merge, preserving whitespace and punctuation differences', () => {
    const f = fixture(); const original = f.toast.show('已保存');
    for (const text of [' 已保存', '已保存 ', '已保存。', '已 保存', '已保存\n']) f.toast.show(text);
    f.toast.show('已保存', 'info');
    assert.equal(f.element.children.length, 7);
    assert.equal(f.toast.show('已保存'), original);
    assert.equal(f.element.children.length, 7);
    f.toast.show('   '); assert.equal(f.element.children.length, 7);
});
