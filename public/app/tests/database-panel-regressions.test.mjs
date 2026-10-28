import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const ui = await readFile(new URL('../database-ui.js', import.meta.url), 'utf8');
const uuidSource = await readFile(new URL('../uuid.js', import.meta.url), 'utf8');
test('LAN HTTP crypto without randomUUID generates unique RFC 4122 v4 identifiers', () => {
    const context = vm.createContext({ crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } });
    vm.runInContext(uuidSource.replace('export function', 'function'), context);
    const ids = Array.from({ length: 100 }, () => vm.runInContext('uuid()', context));
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.doesNotMatch(ui, /crypto\.randomUUID\(/);
});

test('applying a template opens chat data with a save path and preserves the prior draft for undo', () => {
    const callback = ui.match(/toolbarButton\(toolbar, '应用模板到当前聊天', 'refresh', \(\) => \{([\s\S]*?)\n            \}\);/)[1];
    for (const accepted of [false, true]) {
        const old = { sheet_0: { name: 'old' } }, template = { sheet_0: { name: 'template' } };
        const context = vm.createContext({ confirm: () => accepted, structuredClone, validateDatabase: structuredClone,
            data: old, book: template, undo: { data: [] }, dataDirty: false, tab: 'template',
            context: { dirty() {} }, render() {} });
        vm.runInContext(`(() => { ${callback} })()`, context);
        assert.equal(context.tab, accepted ? 'data' : 'template');
        assert.equal(context.dataDirty, accepted);
        assert.deepEqual(context.data, accepted ? template : old);
        if (accepted) assert.deepEqual(context.undo.data[0], old);
    }
    assert.match(ui, /dataDirty \|\| tab === 'data' \? \[\['data', '聊天数据'\]\]/);
    assert.match(ui, /'保存数据', 'edit', template \? saveSettings : saveData/);
});
