import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { databaseSettings } from '../database.js';

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

test('database management excludes chat-data editing and retains template save and undo', () => {
    assert.doesNotMatch(ui, /聊天数据|应用模板到当前聊天|context\.saveData/);
    assert.match(ui, /'保存模板', 'edit', saveSettings/);
    assert.match(ui, /'撤销编辑', 'history', \(\) => \{ replace\(history\.pop\(\)\);/);
});

test('main API database requests use a per-channel model without changing the saved connection', async () => {
    const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');
    const source = main.slice(main.indexOf('function databaseConnection('), main.indexOf('async function readConnectionModels('));
    const profiles = [
        { id: 'main', source: 'custom', url: 'https://example.test/v1', secretId: 'fixture', model: 'chat-default' },
        { id: 'other', source: 'openai', model: 'other-default' },
    ];
    const context = vm.createContext({ profileStore: { profiles } });
    const connect = vm.runInContext(`${source}\ndatabaseConnection`, context);
    const saved = { apiMode: 'tavern', tavernProfile: 'main', tavernModels: { main: ' summary-model ' } };
    const settings = databaseSettings(saved);
    assert.deepEqual({ ...connect(settings) }, { ...profiles[0], model: 'summary-model' });
    assert.equal(profiles[0].model, 'chat-default');
    assert.equal(connect(databaseSettings({ ...saved, tavernProfile: 'other' })).model, 'other-default');
    assert.equal(connect(databaseSettings({ profileId: 'main' })).model, 'chat-default');
    assert.equal(connect(databaseSettings({ ...saved, apiMode: 'custom', apiConfig: { model: 'custom-model' } })).model, 'custom-model');
});
