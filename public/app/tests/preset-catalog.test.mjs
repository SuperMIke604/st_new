import test from 'node:test';
import assert from 'node:assert/strict';
import { presetCatalog, presetDraft } from '../preset-editor.js';

test('listing many presets does not parse every unused preset or repeat JSON parsing', () => {
    let reads = 0;
    const raw = new Proxy(['{"prompts":[],"prompt_order":[]}', 'malformed unused preset'], { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); } });
    const bundle = { openai_setting_names: ['已选预设', '未使用预设'], openai_settings: raw };
    const catalog = presetCatalog(bundle);
    assert.deepEqual(catalog.map(item => item.name), ['已选预设', '未使用预设']);
    assert.equal(reads, 0);
    const selected = catalog[0].data;
    assert.equal(reads, 1);
    assert.equal(presetCatalog(bundle)[0].data, selected); assert.equal(reads, 1);
    const draft = presetDraft(selected); draft.prompts.push({ identifier: 'new' });
    assert.equal(selected.prompts.length, 0, 'editing a draft cannot mutate the cached preset');
    assert.throws(() => catalog[1].data, SyntaxError);
});
test('a newly loaded server bundle invalidates the catalog snapshot', () => {
    const first = { openai_setting_names: ['A'], openai_settings: ['{"temperature":1}'] };
    const next = { openai_setting_names: ['A'], openai_settings: ['{"temperature":2}'] };
    assert.equal(presetCatalog(first)[0].data.temperature, 1);
    assert.equal(presetCatalog(next)[0].data.temperature, 2);
});
