import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDatabasePreview } from '../database-preview.js';

function fixture({ fail = false, settings = {} } = {}) {
    const el = (tag, className = '', textContent = '') => {
        const node = { tag, className, textContent, children: [], style: {}, dataset: {}, attributes: {}, events: {},
            append(...children) { this.children.push(...children); },
            replaceChildren(...children) { this.children = children; },
            setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name]; },
            addEventListener(name, callback) { this.events[name] = callback; },
            querySelectorAll(selector) { const all = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]); return all.filter(child => selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector); },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }, focus() {},
        };
        node.classList = { add(...classes) { node.className += ' ' + classes.join(' '); }, remove(value) { node.className = node.className.split(' ').filter(item => item !== value).join(' '); }, toggle(value, on) { if (on) this.add(value); else this.remove(value); } };
        return node;
    };
    const body = el('main'), writes = [], preferences = [];
    const data = { sheet_0: { name: '人物', content: [[null, '姓名', '备注'], ...Array.from({ length: 45 }, (_, index) => [null, `人物${index}`, '备注'])] }, sheet_1: { name: '事件', content: [[null, '时间'], [null, '现在']] } };
    const context = { el, data, settings, saveData: async value => { if (fail) throw Error('保存失败'); writes.push(structuredClone(value)); }, savePreferences: async value => { if (fail) throw Error('保存失败'); preferences.push(structuredClone(value)); },
        action(label, callback) { const button = el('button', 'button', label); button.callback = callback; return button; },
        field(parent, label, value) { const input = el('textarea'); input.value = value; parent.append(input); return input; },
    };
    renderDatabasePreview(body, context);
    const button = label => body.querySelectorAll('button').find(node => node.textContent === label);
    return { body, button, data, writes, preferences };
}

test('table labels show total rows independently of current page', () => {
    const view = fixture();
    assert.ok(view.button('人物（45）'));
    assert.ok(view.button('事件（1）'));
    assert.equal(view.button('1').getAttribute('aria-current'), 'page');
    view.button('3').callback();
    assert.equal(view.button('3').getAttribute('aria-current'), 'page');
    assert.equal(view.button('1').getAttribute('aria-current'), undefined);
    assert.equal(view.body.querySelectorAll('article').length, 5);
    assert.ok(view.button('人物（45）'));
    assert.equal(view.body.querySelector('.reference-card-head').querySelector('small').textContent, '#41');
});

test('navigation and status precede the scroll area and pagination follows it', () => {
    const view = fixture();
    const layout = view.body.querySelector('.reference-preview-layout');
    assert.deepEqual(layout.children.map(node => node.className), ['reference-preview-fixed', 'reference-preview-grid', 'db-pager']);
    assert.ok(layout.children[0].querySelector('.db-table-tabs'));
    assert.ok(layout.children[0].querySelector('.reference-preview-status'));
    assert.ok(layout.children[0].querySelector('.reference-preview-toolbar'));
});

test('failed cell save retains the draft and never enables undo', async () => {
    const view = fixture({ fail: true });
    const value = view.body.querySelector('.reference-preview-cell');
    value.events.click({ target: { closest: () => null } });
    const input = view.body.querySelector('textarea'); input.value = '新值';
    await assert.rejects(view.button('保存').callback(), /保存失败/);
    assert.equal(input.value, '新值');
    assert.equal(view.button('撤销').disabled, true);
    assert.equal(view.data.sheet_0.content[1][1], '人物0');
});

test('table totals update after deletion and undo restores them', async () => {
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
        const view = fixture();
        await view.button('删除整行').callback();
        assert.ok(view.button('人物（44）'));
        assert.equal(view.writes[0].sheet_0.content.length, 45);
        await view.button('撤销').callback();
        assert.ok(view.button('人物（45）'));
        assert.equal(view.writes[1].sheet_0.content.length, 46);
    } finally { globalThis.confirm = previousConfirm; }
});
