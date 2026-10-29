import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { scriptHelper } from '../script-helper.js';
import { helperMessageRevision, patchHelperVariables, patchHelperMessages } from '../helper-state.js';

function fixture() {
    let settings = {};
    let records = [{ chat_metadata: { variables: { count: 0 } } }, { name: 'Card', mes: 'first', swipes: ['first', 'second'], swipe_id: 1, variables: { 0: { score: 1 }, 1: { score: 2 } } }];
    const snapshot = () => ({ chat: records.slice(1).map((message, message_id) => ({ ...structuredClone(message), message_id, revision: helperMessageRevision(message) })), chatVariables: structuredClone(records[0].chat_metadata.variables), helperSettings: structuredClone(settings), helperGlobals: {}, characterVariables: {}, worldbookName: 'Allowed', characterName: 'Card', userName: 'User', chatId: 'identity' });
    const parent = { realApplication: true }, messages = [], callbacks = new Map();
    const element = () => ({ dataset: {}, append() {}, style: {}, addEventListener() {} });
    const context = vm.createContext({ structuredClone, setTimeout, parent, document: { createElement: element, head: { append() {} }, body: { append() {} } }, initial: snapshot() }); context.window = context;
    context.SillyTavern = { chat: context.initial.chat, chatMetadata: context.initial.chatVariables };
    context.tavern_events = {}; context.toastr = { error: text => messages.push({ error: text }) }; context.__scriptReport = value => messages.push(value);
    context.eventRemoveListener = (event, fn) => callbacks.get(event)?.delete(fn);
    let helper;
    context.options = {
        scriptId: 'character-one',
        on(event, fn) { if (!callbacks.has(event)) callbacks.set(event, new Set()); callbacks.get(event).add(fn); return () => callbacks.get(event)?.delete(fn); },
        async emit(event, ...args) { for (const fn of [...callbacks.get(event) || []]) await fn(...args); },
        update(value) { helper.refresh(value); },
        async request(action, { operation, payload }) {
            assert.equal(action, 'helper'); messages.push({ operation });
            if (operation === 'save-variables') records = patchHelperVariables(records, payload.changes);
            else if (operation === 'save-chat') records = patchHelperMessages(patchHelperVariables(records, payload.changes), payload.messages);
            else if (operation === 'set-messages') records = patchHelperMessages(records, payload.messages);
            else if (operation === 'save-settings') settings = structuredClone(payload.value);
            else throw Error('unsupported');
            return { value: true, snapshot: snapshot() };
        },
    };
    helper = vm.runInContext(`(${scriptHelper.toString()})(initial, options)`, context);
    return { context, helper, messages, records: () => records, settings: () => settings, parent };
}
test('native-style host saves variables and exposes only the compatibility parent', async () => {
    const f = fixture(); assert.equal(vm.runInContext('parent === window', f.context), true); assert.equal(f.parent.realApplication, true);
    assert.equal(await f.context.getTavernHelperVersion(), '0.1.0');
    await f.context.updateVariablesWith(value => { value.score += 3; return value; }, { type: 'message', message_id: -1 });
    assert.equal(f.records()[1].variables[1].score, 5); assert.equal(f.records()[1].variables[0].score, 1);
    assert.equal(f.context.getVariables({ type: 'message', message_id: -1 }).score, 5);
    f.context.SillyTavern.chat[0].variables[1].score = 7; await f.context.SillyTavern.saveChat();
    assert.equal(f.records()[1].variables[1].score, 7);
});

test('ordinary helper scripts wait for a real namespace and merge variables without exposing references', async () => {
    const f = fixture();
    f.context.Mvu = { original: true };
    await f.context.waitGlobalInitialized('Mvu');
    const variables = f.context.getAllVariables();
    assert.equal(variables.score, 2);
    variables.score = 99;
    assert.equal(f.context.getAllVariables().score, 2);
    assert.equal(f.context.Mvu.original, true);
});
test('concurrent async updaters are serialized and retain both changes', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 3 }, () => f.context.updateVariablesWith(async value => { await Promise.resolve(); value.count++; return value; }, { type: 'chat' })));
    assert.equal(f.records()[0].chat_metadata.variables.count, 3);
});
test('native message API reads negative indexes and edits active text while retaining historical branches', async () => {
    const f = fixture(), message = f.context.getChatMessages(-1, { include_swipes: true })[0];
    assert.equal(message.message_id, 0); assert.equal(message.swipes_data[1].score, 2);
    message.data.score = 99; assert.equal(f.records()[1].variables[1].score, 2);
    await f.context.setChatMessages([{ message_id: 0, message: 'updated' }]);
    assert.equal(f.records()[1].mes, 'updated'); assert.equal(f.records()[1].swipes[0], 'first'); assert.equal(f.records()[1].swipes[1], 'updated');
    assert.equal(f.context.SillyTavern.getCurrentChatId(), 'identity');
});
test('native event handles can stop listeners and once callbacks run only once', async () => {
    const f = fixture(); let calls = 0;
    const stop = f.context.eventOn('change', () => { calls++; }); assert.equal(stop.stop, stop);
    await f.context.eventEmit('change'); stop.stop(); await f.context.eventEmit('change');
    assert.equal(calls, 1);
    f.context.eventOnce('once', async () => { calls++; }); await f.context.eventEmit('once'); await f.context.eventEmit('once');
    assert.equal(calls, 2);
});
test('rapid settings changes keep the latest desired value across earlier save replies', async () => {
    const f = fixture();
    f.context.SillyTavern.extensionSettings = { mvu_settings: { enabled: true } }; f.context.SillyTavern.saveSettingsDebounced();
    f.context.SillyTavern.extensionSettings = { mvu_settings: { enabled: false } }; f.context.SillyTavern.saveSettingsDebounced();
    await f.helper.idle(); assert.equal(f.settings().mvu_settings.enabled, false);
    assert.equal(f.context.SillyTavern.extensionSettings.mvu_settings.enabled, false);
});
