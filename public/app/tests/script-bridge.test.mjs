import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { scriptBridge } from '../script-bridge.js';
import { ScriptRuntime } from '../script-runtime.js';

test('iframe bridge reads snapshots, isolates variable copies and authenticates host replies', async () => {
    const listeners = new Map(), sent = [], parent = { postMessage: value => sent.push(value) };
    const snapshot = { userName: 'User', characterName: 'Card', chatVariables: {}, characterVariables: {}, chat: [{ mes: 'reply', variables: { 0: { stat_data: { value: 1 } } } }] };
    const context = vm.createContext({ parent, structuredClone, setTimeout, clearTimeout, document: { getElementById: () => ({ children: [], append() {} }) }, addEventListener: (type, fn) => listeners.set(type, fn) });
    context.window = context; vm.runInContext(`(${scriptBridge.toString()})(${JSON.stringify(snapshot)})`, context);
    const value = context.Mvu.getMvuData({ message_id: 'latest' }); value.stat_data.value = 3;
    assert.equal(context.Mvu.getMvuData().stat_data.value, 1);
    const saving = context.replaceVariables(value, { type: 'message', message_id: 0 });
    const request = sent.at(-1); assert.equal(request.action, 'variables'); assert.equal(request.payload.message_id, 0);
    listeners.get('message')({ source: {}, data: { channel: 'st-new-scripts', type: 'response', id: request.id, error: 'spoof' } });
    listeners.get('message')({ source: parent, data: { channel: 'st-new-scripts', type: 'response', id: request.id, value: true } }); assert.equal(await saving, true);
    snapshot.chat[0].variables[0].stat_data.value = 7;
    listeners.get('message')({ source: parent, data: { channel: 'st-new-scripts', type: 'snapshot', snapshot } });
    assert.equal(context.Mvu.getMvuData().stat_data.value, 7);
});
test('host accepts script variable writes only for the current chat and preserves message text', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const functions = source.slice(source.indexOf('function scriptIdentity('), source.indexOf('async function openScriptWorkspace('));
    let saved = 0; const state = { character: { avatar: 'a.png' }, file: 'chat', header: { chat_metadata: { integrity: 'id' } }, chat: [{ mes: 'unchanged', swipe_id: 1, variables: { 0: { keep: true } } }] };
    const context = vm.createContext({ state, panelDirty: false, copy: structuredClone, assertSaved() { if (state.busy) throw Error('busy'); }, saveChat: async () => { saved++; } });
    vm.runInContext(functions, context);
    const payload = { type: 'message', message_id: 0, variables: { stat_data: { value: 2 } } };
    await assert.rejects(context.applyScriptVariables(payload, 'other'), /聊天已切换/);
    state.busy = true; await assert.rejects(context.applyScriptVariables(payload, 'a.png/chat/id'), /busy/); state.busy = false;
    await context.applyScriptVariables(payload, 'a.png/chat/id'); assert.equal(saved, 1); assert.equal(state.chat[0].mes, 'unchanged'); assert.equal(state.chat[0].variables[0].keep, true); assert.equal(state.chat[0].variables[1].stat_data.value, 2);
    await assert.rejects(context.applyScriptVariables({ ...payload, type: 'global' }, 'a.png/chat/id'), /写入范围/);
    await assert.rejects(context.applyScriptVariables({ ...payload, message_id: -1 }, 'a.png/chat/id'), /写入范围/);
});
test('runtime ignores requests from other frames and returns write errors to its own frame', async () => {
    let writes = 0; const responses = [], frameWindow = { postMessage: value => responses.push(value) };
    const runtime = new ScriptRuntime({ notify() {}, applyVariables: async () => { writes++; throw Error('busy'); } }); runtime.frame = { contentWindow: frameWindow }; runtime.identity = 'chat';
    const data = { channel: 'st-new-scripts', type: 'request', id: 1, action: 'variables', payload: {} };
    await runtime.receive({ source: {}, data }); assert.equal(writes, 0);
    await runtime.receive({ source: frameWindow, data }); assert.equal(writes, 1); assert.equal(responses[0].error, 'busy');
});
