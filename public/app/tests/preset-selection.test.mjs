import test from 'node:test';
import assert from 'node:assert/strict';
import { PresetSelection } from '../preset-selection.js';
const names = ['first', 'chosen'];
function server() { let value = null; return { loadPresetSelection: async () => value && structuredClone(value), savePresetSelection: async patch => { value = structuredClone(patch); } }; }
test('server selection survives new client, username changes and stale native settings', async () => {
    const api = server(); const first = new PresetSelection(api);
    await first.load({ username: 'old' }, names); await first.save('chosen');
    const restarted = new PresetSelection(api);
    assert.equal(await restarted.load({ username: 'new', independent_frontend: { preset: 'first' }, extension_settings: { independent_frontend: { preset: 'first' } } }, names), 'chosen');
});
test('empty legacy extension does not mask root selection during one-time migration', async () => {
    const api = server(); const store = new PresetSelection(api);
    assert.equal(await store.load({ independent_frontend: { preset: 'chosen' }, extension_settings: { independent_frontend: {} } }, names), 'chosen');
    assert.equal((await api.loadPresetSelection()).name, 'chosen');
});
test('missing canonical preset is retained instead of silently replacing it with first', async () => {
    const api = server(); await api.savePresetSelection({ version: 1, name: 'deleted' });
    const store = new PresetSelection(api); assert.equal(await store.load({}, names), 'deleted'); assert.equal((await api.loadPresetSelection()).name, 'deleted');
});
test('read failure never creates or overwrites server selection', async () => {
    let writes = 0; const store = new PresetSelection({ loadPresetSelection: async () => { throw Error('offline'); }, savePresetSelection: async () => writes++ });
    await assert.rejects(store.load({}, names), /offline/); assert.equal(writes, 0); assert.equal(store.name, null);
});
test('save failure keeps the previous confirmed selection', async () => {
    const api = server(); const store = new PresetSelection(api); await store.save('chosen'); api.savePresetSelection = async () => { throw Error('disk full'); };
    await assert.rejects(store.save('first'), /disk full/); assert.equal(store.name, 'chosen');
});
