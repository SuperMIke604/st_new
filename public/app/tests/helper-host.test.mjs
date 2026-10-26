import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { helperMessageRevision, patchHelperVariables, patchHelperMessages } from '../helper-state.js';
import { validateVariables } from '../variable-manager.js';
import { scriptSnapshot } from '../scripts.js';
const main = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const hostSource = main.slice(main.indexOf('async function helperHostAction('), main.indexOf('\nfunction variableManagerPanel('));
function fixture() {
    let records = [{ chat_metadata: { integrity: 'identity' } }, { mes: 'reply', swipe_id: 0, variables: { 0: { score: 2 } } }], settings = { extension_settings: { independentHelper: { keep: 42 } }, world_info_settings: { world_info: { globalSelect: ['Enabled'] } } }, writes = 0;
    const state = { character: { avatar: 'card.png', data: { extensions: { world: 'Allowed' } } }, file: 'chat', header: structuredClone(records[0]), chat: structuredClone(records.slice(1)), settings: structuredClone(settings) };
    const scriptRuntime = { processing: false };
    const context = vm.createContext({ state, scriptRuntime, inlineEdit: null, panelDirty: false, variablesSaving: false, structuredClone, AbortSignal, copy: structuredClone,
        patchHelperVariables, patchHelperMessages, validateVariables, scriptSnapshot, scriptIdentity: () => 'identity', settingsOwn: () => ({}),
        nativeScriptPlan: () => [{ scope: 'character', id: 'mvu', enabled: true }, { scope: 'global', id: 'ordinary', enabled: true }], scriptSupport: () => ({ adapter: 'remote-module' }),
        roleWorldEntries: book => book.entries, list: { setMessages() {} }, generationPreload: { invalidate() {} },
        api: {
            readCache: { clear() {} },
            post: async (path, payload) => path === '/api/worldinfo/get' ? { entries: [{ name: payload.name }] } : structuredClone(records),
            saveChat: async (_avatar, _file, header, messages) => { writes++; records = structuredClone([header, ...messages]); },
            patchSettings: async fn => { const next = structuredClone(settings); await fn(next); writes++; settings = next; },
            settings: async () => ({ settings: structuredClone(settings) }),
        },
    });
    vm.runInContext(hostSource, context);
    return { state, context, scriptRuntime, records: () => records, settings: () => settings, writes: () => writes, call: (operation, payload, identity = 'identity') => context.helperHostAction(operation, payload, identity) };
}
test('host saves a fresh variable transaction, verifies persistence and retains generation message references', async () => {
    const f = fixture(), reference = f.state.chat[0];
    const result = await f.call('save-variables', { changes: [{ type: 'message', message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, value: { 0: { score: 5 } } }] });
    assert.equal(f.records()[1].variables[0].score, 5); assert.equal(f.state.chat[0], reference);
    assert.equal(result.snapshot.chat[0].variables[0].score, 5); assert.equal(f.context.variablesSaving, false);
});
test('host rejects another chat, unsaved edits, ordinary generation and stale updates without writing', async () => {
    const f = fixture();
    await assert.rejects(f.call('save-variables', { changes: [] }, 'other'), /切换/);
    f.state.busy = true; await assert.rejects(f.call('save-variables', { changes: [] }), /生成/);
    f.state.busy = false; f.context.panelDirty = true; await assert.rejects(f.call('save-variables', { changes: [] }), /编辑/); f.context.panelDirty = false;
    await assert.rejects(f.call('save-variables', { changes: [{ type: 'message', message_id: 0, revision: 'stale', base: {}, value: {} }] }), /变化/);
    assert.equal(f.writes(), 0); assert.equal(f.context.variablesSaving, false);
});
test('host permits only explicitly dispatched lifecycle writes during generation', async () => {
    const f = fixture(); f.state.busy = true; f.scriptRuntime.processing = true;
    await f.call('save-variables', { changes: [{ type: 'chat', base: {}, value: { score: 2 } }] });
    assert.equal(f.records()[0].chat_metadata.variables.score, 2);
});
test('settings and global-variable saves touch only their own namespaces and reject stale bases', async () => {
    const f = fixture();
    await f.call('save-settings', { base: {}, value: { mvu_settings: { notify: false } } });
    assert.equal(f.settings().extension_settings.independentHelper.keep, 42);
    assert.equal(f.settings().extension_settings.independentHelper.mvu.mvu_settings.notify, false);
    await assert.rejects(f.call('save-settings', { base: {}, value: { changed: true } }), /变化/);
    await f.call('save-globals', { base: {}, value: { counter: 1 } });
    assert.equal(f.settings().extension_settings.variables.global.counter, 1);
    assert.equal(f.settings().world_info_settings.world_info.globalSelect[0], 'Enabled');
});
test('worldbook reads are restricted to current role bindings and enabled global books', async () => {
    const f = fixture();
    assert.equal((await f.call('read-worldbook', { name: 'Allowed' })).value[0].name, 'Allowed');
    assert.equal((await f.call('read-worldbook', { name: 'Enabled' })).value[0].name, 'Enabled');
    await assert.rejects(f.call('read-worldbook', { name: 'Unrelated' }), /只允许/);
});

test('ordinary scripts save their own settings without changing legacy MVU settings or another script', async () => {
    const f = fixture(); f.context.scriptSupport = () => ({});
    await f.call('save-settings', { scriptId: 'global-ordinary', base: {}, value: { enabled: true } });
    assert.equal(f.settings().extension_settings.independentHelper.scriptSettings['global-ordinary'].enabled, true);
    assert.equal(f.settings().extension_settings.independentHelper.mvu, undefined);
    await assert.rejects(f.call('save-settings', { scriptId: 'unknown', base: {}, value: {} }), /脚本目标/);
    await f.call('save-buttons', { scriptId: 'global-ordinary', value: [{ name: 'Run', visible: true }] });
    assert.equal(f.settings().extension_settings.independentHelper.scriptButtons['global-ordinary'][0].name, 'Run');
});
