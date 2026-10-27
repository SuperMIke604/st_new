import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { defaultDatabase, sourceHash, storeDatabase, databaseForChat, databaseSettings, databaseSummaryTriggered, messageSummaryRange } from '../database.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function assertDatabaseWritable('), source.indexOf('const tokenCounts ='));
function fixture() {
    const template = defaultDatabase();
    const state = { character: { avatar: 'A.png', name: 'A' }, file: 'chat', header: { chat_metadata: { integrity: 'keep' } },
        chat: [{ is_user: true, mes: 'question' }, { is_user: false, mes: 'answer', extra: { keep: true } }], own: {}, settings: {}, busy: false, controller: null };
    const settings = databaseSettings({ template, worldbookConfig: {} }), writes = [], notices = [], panels = [], requests = [];
    let resolveResponse, rejectResponse, requestSignal, panelContext;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const context = vm.createContext({ state, inlineEdit: null, panelDirty: false, panelRevision: 1, AbortController, DOMException,
        sourceHash, storeDatabase, databaseSummaryTriggered, messageSummaryRange, copy: structuredClone, currentDatabase: () => ({ ...databaseForChat(state.chat, state.header, template), settings }),
        databaseConnection: () => ({}), generationBody: () => ({}), databaseWorlds: async () => [],
        profileStore: { profiles: [] }, persona: () => ({ name: 'User' }), referenceDatabaseText: () => '', sheetText: () => '',
        fillMessages: (...args) => { requests.push(args); return []; }, expand: text => text,
        api: { post: async () => ({ token_count: 100 }), response: async (_path, _body, options) => { requestSignal = options.signal; return response; } },
        parseUpdate: (_text, data, counts) => { counts.operations++; return { ...structuredClone(data), updated: true }; },
        databaseUpdateNotice: counts => `updated ${counts.operations}`,
        saveChat: async () => writes.push(structuredClone(state.chat)), rememberChat: async () => {},
        notify: (...args) => notices.push(args), list: { setMessages() {} },
        assertViewable() {}, showPanel: () => { panels.push('open'); return { append() {} }; },
        renderDatabasePanel: (_body, value) => { panelContext = value; },
        el: () => ({}), field() {}, action() {}, icon() {}, pickFile() {}, databaseModels() {},
    });
    vm.runInContext(functions, context);
    vm.runInContext('databaseProgress = () => ({ update() {}, close() {} })', context);
    return { state, settings, requests, context, writes, notices, panels, run: code => vm.runInContext(code, context),
        panel: () => panelContext, signal: () => requestSignal,
        finish: () => resolveResponse({ headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'update' } }] }) }),
        fail: rejectResponse };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('database summary uses latest snapshot without dialogue and never hides messages', async () => {
    const f = fixture();
    storeDatabase(f.state.chat, f.state.header, { ...defaultDatabase(), marker: 'latest' }, 1, { kind: 'message', to: 1 });
    f.settings.autoHideMessages = true; // Old settings cannot re-enable removed behavior.
    const task = f.run("updateDatabase(0, 0, false, 'database')"); await tick();
    assert.equal(f.requests[0][1].marker, 'latest'); assert.equal(f.requests[0][2].length, 0); assert.equal(f.requests[0][6], 'database');
    f.finish(); await task;
    assert.equal(f.writes.length, 1); assert.equal(f.state.chat[1].extra.independentDatabase.kind, 'database');
    assert.equal(f.state.chat[1].extra.independentDatabase.messageSummaryTo, 1);
    assert.ok(f.state.chat.every(message => message.is_system === undefined));
    assert.equal(f.state.header.chat_metadata.independentDatabase.history.length, 1);
});

test('database summary rejects a newer snapshot arriving while request is running', async () => {
    const f = fixture();storeDatabase(f.state.chat, f.state.header, defaultDatabase(), 1);
    const task = f.run("updateDatabase(0, 0, false, 'database')"); await tick();
    f.state.chat.push({ is_user: false, mes: 'new', TavernDB_ACU_Data: defaultDatabase() });
    f.finish(); await assert.rejects(task, /最新数据库已变化/); assert.equal(f.writes.length, 0);
});

test('automatic database summary runs with message summary disabled and avoids repeated compaction', async () => {
    const f = fixture();
    storeDatabase(f.state.chat, f.state.header, defaultDatabase(), 1);
    f.settings.auto = false; f.settings.databaseSummaryAuto = true; f.settings.databaseSummaryTokens = 100;
    const task = f.run('autoUpdateDatabase()'); await tick();f.finish(); await task;
    assert.equal(f.writes.length, 1); assert.equal(f.requests[0][6], 'database');
    await f.run('autoUpdateDatabase()'); assert.equal(f.writes.length, 1);
});

test('automatic message summary completes before database threshold evaluation', async () => {
    const f = fixture();f.settings.auto = true; f.settings.databaseSummaryAuto = true;
    f.settings.databaseSummaryTokens = 100;
    const task = f.run('autoUpdateDatabase()'); await tick();f.finish(); await task;
    assert.equal(f.writes.length, 2); assert.deepEqual(f.requests.map(args => args[6]), ['message', 'database']);
    assert.equal(f.state.chat[1].extra.independentDatabase.messageSummaryTo, 1);
});

test('reached table threshold does not depend on tokenizer availability', async () => {
    const f = fixture();const data=defaultDatabase();data.sheet_0.content.push([null,'地点','书店']);
    storeDatabase(f.state.chat,f.state.header,data,1);
    Object.assign(f.settings,{databaseSummaryAuto:true,databaseSummaryTokens:100,databaseSummaryRows:1,databaseSummaryTable:'sheet_0'});
    f.context.api.post=async()=>{throw Error('tokenizer offline')};
    const task=f.run('autoUpdateDatabase()');await tick();f.finish();await task;
    assert.equal(f.writes.length,1);
});

test('stopping automatic message summary cancels the following database summary', async () => {
    const f = fixture();Object.assign(f.settings,{auto:true,databaseSummaryAuto:true,databaseSummaryTokens:100});
    const task=f.run('autoUpdateDatabase()');await tick();f.state.databaseController.abort();f.finish();await task;
    assert.equal(f.writes.length,0);assert.equal(f.requests.length,1);
});

test('fill preserves chat generation state and accepts appended or streaming later replies', async () => {
    const f = fixture(), controller = new AbortController();
    f.state.busy = true; f.state.controller = controller;
    const task = f.run('updateDatabase(0, 1)'); await tick();
    assert.equal(f.state.busy, true); assert.equal(f.state.controller, controller);
    assert.notEqual(f.signal(), controller.signal);
    f.state.chat.push({ is_user: true, mes: 'next' }, { is_user: false, mes: 'streaming' });
    f.state.generation = { reply: f.state.chat.at(-1) };
    f.context.panelDirty = true;
    f.finish(); await task;
    assert.equal(f.writes.length, 1); assert.equal(f.state.chat[1].TavernDB_ACU_Data.updated, true);
    assert.equal(f.state.chat.at(-1).mes, 'streaming'); assert.equal(f.state.chat[1].extra.keep, true);
    assert.equal(f.state.header.chat_metadata.integrity, 'keep');
    assert.equal(f.state.busy, true); assert.equal(f.state.controller, controller);
    assert.equal(f.context.panelDirty, true); assert.equal(f.state.databaseController, null);
});

test('chat stop leaves fill running; fill stop leaves chat running', async () => {
    for (const stopFill of [false, true]) {
        const f = fixture(), controller = new AbortController();
        f.state.busy = true; f.state.controller = controller;
        const task = f.run('updateDatabase(0, 1)'); await tick();
        if (stopFill) f.state.databaseController.abort(); else controller.abort();
        assert.equal(f.signal().aborted, stopFill); assert.equal(controller.signal.aborted, !stopFill);
        f.finish(); await task;
        assert.equal(f.writes.length, stopFill ? 0 : 1);
        assert.equal(f.state.busy, true); assert.equal(f.state.controller, controller);
    }
});

test('fill alone does not activate the chat composer busy state and rejects duplicate fills', async () => {
    const f = fixture(), task = f.run('updateDatabase(0, 1)'); await tick();
    assert.equal(f.state.busy, false); assert.equal(f.state.controller, null);
    await assert.rejects(f.run('updateDatabase(0, 1)'), /数据库正在更新/);
    f.finish(); await task;
});

test('fill rejects changed source, database, and switched chat without writing', async () => {
    for (const change of [f => { f.state.chat[1].mes = 'edited'; }, f => { f.state.chat[0].TavernDB_ACU_Data = {}; }, f => { f.state.file = 'other'; }, f => { f.state.chat = structuredClone(f.state.chat); }]) {
        const f = fixture(), task = f.run('updateDatabase(0, 1)'); await tick();
        change(f); f.finish(); await assert.rejects(task, /变化/);
        assert.equal(f.writes.length, 0); assert.equal(f.state.databaseController, null);
    }
});

test('preview write guard allows streaming outside its source range and protects concurrent edits', () => {
    const f = fixture();
    f.run('globalThis.guard = databaseWriteGuard(1)');
    f.state.busy = true;
    f.state.chat.push({ is_user: false, mes: 'streaming' });
    f.state.generation = { reply: f.state.chat.at(-1) };
    f.run('guard.check()');
    f.state.chat[1].TavernDB_ACU_Data = defaultDatabase();
    assert.throws(() => f.run('guard.check()'), /数据库已变化/);
    f.run('guard.saved(); guard.check()');
    f.state.generation.reply = f.state.chat[1];
    assert.throws(() => f.run('guard.check()'), /该楼层正在生成/);
});

test('fill failures clean up only the database task', async () => {
    const f = fixture(), controller = new AbortController();
    f.state.busy = true; f.state.controller = controller;
    const task = f.run('updateDatabase(0, 1)'); await tick();
    f.fail(Error('offline')); await assert.rejects(task, /offline/);
    assert.equal(f.state.busy, true); assert.equal(f.state.controller, controller);
    assert.equal(f.state.databaseController, null); assert.equal(f.writes.length, 0);
});

test('finishing fill does not reopen management or clear a different panel draft', async () => {
    const f = fixture(); await f.run('databasePanel()');
    const task = f.panel().fill(0, 1); await tick();
    f.context.panelRevision++; f.context.panelDirty = true;
    f.finish(); await task;
    assert.equal(f.panels.length, 1); assert.equal(f.context.panelDirty, true);
    f.panel().dirty(false); assert.equal(f.context.panelDirty, true);
});
