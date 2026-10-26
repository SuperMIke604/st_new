import test from 'node:test';
import assert from 'node:assert/strict';
import { createToast } from '../toast.js';

function fixture() {
    let time = 0, sequence = 0;
    const timers = new Map(), events = {}, attrs = {}, classes = new Set();
    const document = { createElement: () => ({ setAttribute() {} }), activeElement: null };
    const element = {
        hidden: true, dataset: {}, ownerDocument: document,
        classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); } },
        setAttribute(name, value) { attrs[name] = value; },
        matches: () => false, replaceChildren(...children) { this.children = children; },
        addEventListener(name, handler) { events[name] = handler; },
    };
    const toast = createToast(element, {
        now: () => time, schedule(fn, delay) { timers.set(++sequence, { fn, at: time + delay }); return sequence; },
        cancel(id) { timers.delete(id); },
    });
    function tick(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } }
    return { toast, element, events, attrs, tick, timers };
}

test('each type expires at its specified duration; loading waits for result', () => {
    for (const [type, duration] of [['success', 2000], ['info', 3000], ['warning', 4000], ['error', 5000]]) {
        const f = fixture(); f.toast.show('反馈', type); f.tick(duration - 1); assert.equal(f.element.hidden, false);
        f.tick(1); assert.equal(f.element.hidden, true);
    }
    const f = fixture(); f.toast.show('正在保存', 'loading'); f.tick(60000); assert.equal(f.element.hidden, false);
    f.toast.show('保存完成'); f.tick(2000); assert.equal(f.element.hidden, true);
});

test('hover and focus pause independently and resume only the remaining time', () => {
    const f = fixture(); f.toast.show('已保存'); f.tick(500); f.events.pointerenter();
    f.events.focus(); f.tick(9000); f.events.pointerleave(); f.tick(9000); assert.equal(f.element.hidden, false);
    f.events.blur(); f.tick(1499); assert.equal(f.element.hidden, false); f.tick(1); assert.equal(f.element.hidden, true);
});

test('duplicate refreshes timeout without rebuilding; lower priority cannot overwrite failure', () => {
    const f = fixture(); f.toast.show('失败原因', true); const children = f.element.children;
    f.tick(4000); f.toast.show('失败原因', true); assert.equal(f.element.children, children);
    f.toast.show('已删除'); assert.equal(f.element.dataset.type, 'error'); assert.equal(f.attrs['aria-live'], 'assertive');
    f.tick(4999); assert.equal(f.element.hidden, false); f.tick(1); assert.equal(f.element.hidden, true);
    f.toast.show('状态', 'info'); assert.equal(f.element.dataset.type, 'info');
});

test('click or keyboard dismisses loading without a business cancellation callback', () => {
    for (const key of [null, 'Enter', ' ', 'Escape']) {
        const f = fixture(); f.toast.show('<b>不解析 HTML</b>', 'loading');
        assert.equal(f.element.children[1].textContent, '<b>不解析 HTML</b>');
        if (key) f.events.keydown({ key, preventDefault() {} }); else f.events.click();
        assert.equal(f.element.hidden, true); assert.equal(f.timers.size, 0);
        f.toast.show('新结果', false); f.tick(2000); assert.equal(f.element.hidden, true);
    }
});
