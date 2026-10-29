import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { installPopoverToggle } from '../popover-toggle.js';

const uuidSource = await readFile(new URL('../uuid.js', import.meta.url), 'utf8');
const selectSource = await readFile(new URL('../world-select.js', import.meta.url), 'utf8');

class Element {
    children = []; attributes = {}; dataset = {}; listeners = new Map(); value = '';
    constructor(tag, className = '', text = '') { Object.assign(this, { tag, className, text }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
}

test('world selector renders, filters and updates selection on LAN HTTP without randomUUID', () => {
    const context = vm.createContext({
        crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
        installPopoverToggle,
    });
    vm.runInContext(uuidSource.replace('export function', 'function'), context);
    vm.runInContext(selectSource.replace(/^import .*;\r?\n/gm, '').replace('export function', 'function'), context);
    const selected = new Set(['one']); let changes = 0;
    const containers = [new Element('section'), new Element('section')];
    for (const container of containers) {
        context.renderGlobalWorldSelect(container, [{ file_id: 'one', name: 'World One' }, { file_id: 'two', name: 'World Two' }], selected, {
            el: (...args) => new Element(...args), icon: () => new Element('svg'), changed: () => { changes++; },
        });
    }
    const [, control, popup] = containers[0].children;
    assert.notEqual(popup.id, containers[1].children[2].id);
    assert.equal(control.children[1].attributes['aria-controls'], popup.id);
    const [search, list, empty] = popup.children;
    assert.equal(list.children.length, 2);
    assert.equal(list.children[0].children[0].checked, true);
    search.value = 'two'; search.listeners.get('input')();
    assert.equal(list.children[0].hidden, true);
    assert.equal(list.children[1].hidden, false);
    assert.equal(empty.hidden, true);
    const check = list.children[1].children[0];
    check.checked = true; check.listeners.get('change')();
    assert.equal(selected.has('two'), true);
    assert.equal(changes, 1);
    assert.equal(control.children[0].children.length, 2);
});
