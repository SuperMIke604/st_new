import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { helperMessageRevision, patchHelperVariables, patchHelperMessages } from '../helper-state.js';
import { validateVariables } from '../variable-manager.js';
import { scriptSnapshot } from '../scripts.js';
import { LoadTimings } from '../load-timings.js';
const main = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const hostSource = main.slice(main.indexOf('function hasChatPanelDraft('), main.indexOf('\nasync function variableManagerPanel('));
function fixture({ unpersisted = false, stored } = {}) {
    let records = [{ chat_metadata: { integrity: 'identity' } }, { mes: 'reply', swipe_id: 0, variables: { 0: { score: 2 } } }], settings = { extension_settings: { independentHelper: { keep: 42 } }, world_info_settings: { world_info: { globalSelect: ['Enabled'] } } }, writes = 0, paints = 0;
    const state = { character: { avatar: 'card.png', data: { extensions: { world: 'Allowed' } } }, file: 'chat', header: structuredClone(records[0]), chat: structuredClone(records.slice(1)), settings: structuredClone(settings) };
    state.chatUnpersisted = unpersisted;
    if (stored !== undefined) records = structuredClone(stored);
    const scriptRuntime = { processing: false };
    const panel = { className: 'variable-panel', matches: selector => selector.split(', ').includes('.' + panel.className) };
    const context = vm.createContext({ state, scriptRuntime, inlineEdit: null, panelDirty: false, $: () => panel, variablesSaving: false, structuredClone, AbortSignal, copy: structuredClone,
        patchHelperVariables, patchHelperMessages, validateVariables, scriptSnapshot, scriptIdentity: () => 'identity', settingsOwn: () => ({}),
        nativeScriptPlan: () => [{ scope: 'character', id: 'mvu', enabled: true }, { scope: 'global', id: 'ordinary', enabled: true }], scriptSupport: () => ({ adapter: 'remote-module' }),
        roleWorldEntries: book => book.entries, list: { setMessages() { paints++; } }, generationPreload: { invalidate() {} },
        api: {
            readCache: { clear() {} },
            post: async (path, payload) => path === '/api/worldinfo/get' ? { entries: [{ name: payload.name }] } : structuredClone(records),
            saveChat: async (_avatar, _file, header, messages) => { writes++; records = structuredClone([header, ...messages]); },
            patchSettings: async fn => { const next = structuredClone(settings); await fn(next); writes++; settings = next; },
            settings: async () => ({ settings: structuredClone(settings) }),
        },
    });
    vm.runInContext(hostSource, context);
    return { state, context, panel, scriptRuntime, records: () => records, settings: () => settings, writes: () => writes, paints: () => paints, call: (operation, payload, identity = 'identity') => context.helperHostAction(operation, payload, identity) };
}
test('host saves a fresh variable transaction, verifies persistence and retains generation message references', async () => {
    const f = fixture(), reference = f.state.chat[0];
    const result = await f.call('save-variables', { changes: [{ type: 'message', message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, value: { 0: { score: 5 } } }] });
    assert.equal(f.records()[1].variables[0].score, 5); assert.equal(f.state.chat[0], reference);
    assert.equal(result.snapshot.chat[0].variables[0].score, 5); assert.equal(f.context.variablesSaving, false);
});

test('the first helper write initializes an unsaved chat for each chat mutation API', async () => {
    for (const operation of ['save-variables', 'set-messages', 'save-chat']) {
        const f = fixture({ unpersisted: true, stored: [] }), reference = f.state.chat[0];
        const change = { type: 'message', message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, value: { 0: { score: 5 } } };
        const patch = { message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, data: { score: 5 } };
        await f.call(operation, { changes: [change], messages: operation === 'save-chat' ? [] : [patch] });
        assert.equal(f.records()[0].chat_metadata.integrity, 'identity');
        assert.equal(f.records()[1].mes, 'reply');
        assert.equal(f.records()[1].variables[0].score, 5);
        assert.equal(f.state.chat[0], reference);
        assert.equal(f.state.chatUnpersisted, false);
        assert.equal(f.writes(), 1);
    }
});

test('helper initialization rejects absent saved chats and invalid server responses', async () => {
    for (const [unpersisted, stored] of [[false, []], [true, null], [true, {}], [true, [{ mes: 'missing header' }]]]) {
        const f = fixture({ unpersisted, stored });
        await assert.rejects(f.call('save-variables', { changes: [{ type: 'chat', base: {}, value: { score: 5 } }] }), /格式/);
        assert.equal(f.writes(), 0);
    }
});

test('unsaved-chat initialization still rejects stale variables and preserves fresh server metadata', async () => {
    const f = fixture({ unpersisted: true, stored: [] });
    await assert.rejects(f.call('save-variables', { changes: [{ type: 'chat', base: { stale: true }, value: { score: 5 } }] }), /修改/);
    assert.equal(f.writes(), 0); assert.equal(f.state.chatUnpersisted, true);
    const stored = [{ chat_metadata: { integrity: 'identity', serverOnly: 42 } }, structuredClone(f.state.chat[0])];
    const existing = fixture({ unpersisted: true, stored });
    await existing.call('save-variables', { changes: [{ type: 'chat', base: {}, value: { score: 5 } }] });
    assert.equal(existing.records()[0].chat_metadata.serverOnly, 42);
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
    assert.equal(f.paints(), 1);
    f.state.generation = { dispatchingMessageSent: true };
    const reference = f.state.chat[0];
    const result = await f.call('save-chat', {
        changes: [{ type: 'chat', base: { score: 2 }, value: { score: 3 } }],
        messages: [{ message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, data: { score: 5 }, message: 'updated' }],
    });
    assert.equal(f.writes(), 2);
    assert.equal(f.paints(), 1, 'message_sent writes share the generation repaint');
    assert.equal(f.state.chat[0], reference);
    assert.equal(f.records()[1].variables[0].score, 5);
    assert.equal(result.snapshot.chat[0].mes, 'updated');
});
test('reply variables save while a preset or character card draft is open', async () => {
    for (const className of ['preset-panel', '']) {
        const f = fixture();
        f.state.busy = true;
        f.scriptRuntime.processing = true;
        f.panel.className = className;
        f.context.panelDirty = true;
        await f.call('save-variables', { changes: [{ type: 'chat', base: {}, value: { score: 2 } }] });
        assert.equal(f.records()[0].chat_metadata.variables.score, 2);
        assert.equal(f.context.panelDirty, true);
    }
});
test('message_sent applies the confirmed increment without a full chat round trip', async () => {
    const f = fixture();
    f.state.busy = true;
    f.state.generation = { dispatchingMessageSent: true };
    f.scriptRuntime.processing = true;
    const reference = f.state.chat[0];
    f.context.api.canSaveChatDelta = () => true;
    f.context.api.trySaveChatDelta = async (_avatar, _file, next) => {
        assert.equal(next[1].variables[0].score, 5);
        return true;
    };
    f.context.api.post = () => assert.fail('must not download the full chat');
    const result = await f.call('save-variables', { changes: [
        { type: 'message', message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, value: { 0: { score: 5 } } },
    ] });
    assert.equal(f.writes(), 0);
    assert.equal(f.state.chat[0], reference);
    assert.equal(result.snapshot.chat[0].variables[0].score, 5);
});
test('message_received saves just the target branch and defers repaint', async () => {
    const f = fixture(), timings = new LoadTimings();
    const finish = timings.start('event', 'generation');
    const controller = new AbortController();
    f.state.busy = true;
    f.state.replyScriptEvent = { signal: controller.signal, timing: timings.scope(finish.id) };
    f.scriptRuntime.processing = true;
    const reference = f.state.chat[0];
    reference.swipe_id = 1; reference.swipes = ['old', 'reply'];
    const change = { type: 'message', message_id: 0, revision: helperMessageRevision(reference), base: reference.variables, value: { 0: { score: 2 }, 1: { score: 5 } } };
    f.context.api.canSaveChatDelta = () => true;
    f.context.api.trySaveChatDelta = async (_avatar, _file, next, signal, { onWrite }) => {
        assert.equal(signal, controller.signal);
        onWrite();
        assert.deepEqual(next[1].variables, change.value);
        assert.deepEqual(next[1].swipes, ['old', 'reply']);
        return true;
    };
    f.context.api.post = () => assert.fail('unexpected full chat read');
    await f.call('save-variables', { changes: [change] });
    assert.equal(f.state.chat[0], reference);
    assert.equal(f.paints(), 0);
    assert.equal(f.state.replyScriptEvent.writePending, false);
    assert.equal(timings.snapshot().find(entry => entry.label === '助手校验聊天变更').parentId, finish.id);
});

test('message_received falls back to fresh read and verification only for unsupported deltas', async () => {
    for (const conflict of [false, true]) {
        const f = fixture(), controller = new AbortController();
        f.state.busy = true; f.scriptRuntime.processing = true;
        f.state.replyScriptEvent = { signal: controller.signal };
        f.context.api.canSaveChatDelta = () => true;
        f.context.api.trySaveChatDelta = async () => {
            if (conflict) throw Object.assign(Error('聊天已变化'), { status: 409, chatDelta: true });
            return false;
        };
        let reads = 0;
        const post = f.context.api.post;
        f.context.api.post = (...args) => { reads++; return post(...args); };
        const write = f.call('save-variables', { changes: [{ type: 'chat', base: {}, value: { score: 5 } }] });
        if (conflict) {
            await assert.rejects(write, /聊天已变化/);
            assert.equal(f.state.chatConflict, '聊天已变化');
            assert.equal(reads, 0); assert.equal(f.writes(), 0);
        } else {
            await write;
            assert.equal(f.records()[0].chat_metadata.variables.score, 5);
            assert.equal(reads, 2); assert.equal(f.writes(), 1);
        }
    }
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
