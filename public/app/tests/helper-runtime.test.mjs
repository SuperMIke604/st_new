import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptRuntime } from '../script-runtime.js';
function fixture() {
    const posted = [], calls = [];
    const runtime = new ScriptRuntime({ notify() {}, helperAction: async (...args) => { calls.push(args); return { value: true }; } });
    runtime.frame = { contentWindow: { postMessage: value => posted.push(value) }, remove() {} }; runtime.identity = 'chat';
    runtime.statusRows.set('character-mvu', { dataset: { adapter: 'remote-module', active: 'true' } });
    const send = data => runtime.receive({ source: runtime.frame?.contentWindow, data: { channel: 'st-new-scripts', ...data } });
    return { runtime, posted, calls, send };
}
test('helper permissions require an active script, authenticate frame source and bind button changes to the caller', async () => {
    const f = fixture(), request = { type: 'request', id: 1, action: 'helper', payload: { scriptId: 'character-mvu', operation: 'save-buttons', payload: { scriptId: 'other-script', value: [] } } };
    await f.runtime.receive({ source: {}, data: { channel: 'st-new-scripts', ...request } }); assert.equal(f.calls.length, 0);
    await f.send(request); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].scriptId, 'character-mvu');
    await f.send({ type: 'failed', id: 'character-mvu', error: true, text: 'module failed' });
    await f.send(request); assert.equal(f.calls.length, 1); assert.match(f.posted.at(-1).error, /权限/);
    await f.send({ type: 'helper-ready', id: 'character-mvu' }); assert.equal(f.runtime.helperReady, false);
});

test('ordinary global and character scripts can call all helper operations without an adapter identity', async () => {
    const f = fixture();
    for (const scriptId of ['global-tool', 'character-tool']) {
        f.runtime.statusRows.set(scriptId, { dataset: { adapter: '', active: 'true' } });
        for (const operation of ['save-variables', 'set-messages', 'save-chat', 'read-worldbook', 'save-settings', 'save-globals', 'save-lore-settings', 'save-buttons']) {
            await f.send({ type: 'request', id: 2, action: 'helper', payload: { scriptId, operation, payload: {} } });
            assert.equal(f.posted.at(-1).error, undefined);
            assert.equal(f.calls.at(-1)[1].scriptId, scriptId);
        }
    }
    assert.equal(f.calls.length, 16);
    await f.send({ type: 'failed', id: 'character-tool', error: true, text: 'failed' });
    await f.send({ type: 'request', id: 3, action: 'helper', payload: { scriptId: 'character-tool', operation: 'save-chat', payload: {} } });
    assert.equal(f.calls.length, 16);
});

test('ordinary scripts receive lifecycle events without an MVU module', async () => {
    const f = fixture(); f.runtime.statusRows.clear();
    f.runtime.statusRows.set('global-tool', { dataset: { adapter: '', active: 'true' } });
    await f.send({ type: 'ready' }); assert.equal(f.runtime.helperReady, true);
    const pending = f.runtime.dispatch('message_received', [0], {}, 'chat');
    await f.send({ type: 'helper-event-result', id: f.posted.at(-1).id });
    assert.equal(await pending, true);
});
test('lifecycle dispatch waits for awaited iframe handlers and rejects stale frame acknowledgements', async () => {
    const f = fixture(); f.runtime.helperReady = true;
    const pending = f.runtime.dispatch('message_received', [4], {}, 'chat');
    assert.equal(f.runtime.processing, true); const id = f.posted.at(-1).id;
    await f.runtime.receive({ source: {}, data: { channel: 'st-new-scripts', type: 'helper-event-result', id } });
    assert.equal(f.runtime.pendingEvents.size, 1);
    await f.send({ type: 'helper-event-result', id }); assert.equal(await pending, true);
    assert.equal(f.runtime.processing, false);
});
test('a lifecycle timeout destroys its script environment so late callbacks cannot write', async t => {
    const oldDocument = globalThis.document, oldWindow = globalThis.window;
    globalThis.document = { getElementById: () => null }; globalThis.window = { removeEventListener() {} };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const f = fixture(); f.runtime.helperReady = true;
        const pending = assert.rejects(f.runtime.dispatch('message_received', [0], {}, 'chat'), /超时/);
        t.mock.timers.tick(30000); await pending;
        assert.equal(f.runtime.frame, null); assert.equal(f.runtime.processing, false); assert.equal(f.runtime.helperReady, false);
    } finally { globalThis.document = oldDocument; globalThis.window = oldWindow; }
});
