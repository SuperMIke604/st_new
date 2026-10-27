import test from 'node:test';
import assert from 'node:assert/strict';
import { worldDraft, newWorldEntry, renderWorldEntries } from '../world-editor.js';
import { activateWorlds } from '../engine.js';

test('world drafts preserve unknown metadata and do not mutate the source', () => {
    const source = { extensions: { future: true }, entries: { 8: { uid: 8, key: ['雨'], content: '旧内容', futureRule: { value: 3 } } } };
    const draft = worldDraft(source); draft.entries[8].content = '新内容';
    assert.equal(source.entries[8].content, '旧内容');
    assert.deepEqual(draft.entries[8].futureRule, { value: 3 });
    assert.deepEqual(draft.extensions, { future: true });
    assert.deepEqual(worldDraft(JSON.parse(JSON.stringify(draft))), draft);
});

test('new entries avoid uid collisions and edits reach world activation', () => {
    const draft = worldDraft({ entries: { 0: { uid: 1, disable: true } } });
    const id = newWorldEntry(draft); assert.equal(id, '2');
    Object.assign(draft.entries[id], { key: ['书店'], content: '书店里有一只猫。' });
    const active = activateWorlds([draft], [{ mes: '我走进书店' }]);
    assert.equal(active.length, 1); assert.equal(active[0].content, '书店里有一只猫。');
    draft.entries[id].disable = true;
    assert.equal(activateWorlds([draft], [{ mes: '我走进书店' }]).length, 0);
});

test('entry arrays import as editable maps and invalid data is rejected', () => {
    assert.equal(worldDraft({ entries: [{ uid: 7, content: 'a' }] }).entries[7].content, 'a');
    for (const data of [null, [], {}, { entries: { 0: null } }, { entries: { 0: 'text' } }, { entries: [{ uid: 1 }, { uid: 1 }] }, { entries: { 0: { key: 'text' } } }]) assert.throws(() => worldDraft(data));
});

function editorFixture(book) {
    class Element {
        constructor(tag, classes = '', text = '') { this.tag = tag; this.classes = new Set(classes.split(' ')); this.children = []; this.dataset = {}; this.events = {}; this.textContent = text; this.isConnected = true; this.classList = { contains: name => this.classes.has(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
        append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(item => item !== node); node.parentElement = this; this.children.push(node); } }
        replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
        setAttribute() {}
        addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
        async emit(name) { for (const fn of this.events[name] || []) await fn(); }
        querySelectorAll() { return this.children.filter(node => node.classes.has('prompt-item')); }
        closest() { return this.parentElement; }
    }
    const fields = [], counts = [], container = new Element('div'); let changes = 0;
    renderWorldEntries(container, book, {
        el: (...args) => new Element(...args), icon: () => new Element('svg'), dirty: () => { changes++; },
        action: (label, fn) => { const node = new Element('button', '', label); node.run = fn; return node; },
        field: (parent, label, value) => { const wrap = new Element('label', 'field'), node = new Element('input'); node.value = value; wrap.append(node); parent.append(wrap); fields.push({ label, node }); return node; },
        countTokens: async text => { counts.push(text); return 5; },
    });
    return { container, fields, counts, changes: () => changes };
}

test('large world lists create editor fields only on expansion and preserve edits across closing', async () => {
    const book = { entries: Object.fromEntries(Array.from({ length: 240 }, (_, id) => [id, { uid: id, comment: `Entry ${id}`, content: 'body', order: id, future: { keep: true } }])) };
    const f = editorFixture(book), row = f.container.children[1], id = row.dataset.entryId;
    assert.equal(f.container.children.length, 241); assert.equal(f.fields.length, 0); assert.equal(f.counts.length, 0);
    const placement = row.children[0].children.at(-1), position = placement.children.at(-1).children[0];
    position.value = '4'; await position.emit('change'); assert.equal(book.entries[id].position, 4);
    row.open = true; await row.emit('toggle');
    const built = f.fields.length; assert.ok(built > 0 && built < 12); assert.equal(f.counts.length, 1);
    assert.equal(f.fields.find(item => item.label === '聊天深度').node.parentElement.hidden, false);
    const content = f.fields.find(item => item.label === '条目内容').node;
    content.value = 'edited'; await content.emit('input'); assert.equal(book.entries[id].content, 'edited');
    row.open = false; await row.emit('toggle'); row.open = true; await row.emit('toggle');
    assert.equal(f.fields.length, built); assert.equal(content.value, 'edited');
    assert.deepEqual(book.entries[id].future, { keep: true });
    f.container._dispose(); const calls = f.counts.length;
    await row.emit('toggle'); assert.equal(f.counts.length, calls, 'disposed rows cannot create counters or forms');
});
