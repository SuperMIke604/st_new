import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { defaultDatabase, sourceHash, storeDatabase, databaseForChat, databaseSettings, databaseSummaryTriggered, messageSummaryRange, parseUpdate, DatabaseFormatError } from '../database.js';

import { databaseSummaryHistory, deleteDatabaseSummaryHistory } from '../database-overview.js';
import { startDatabaseLog, finishDatabaseLog, clearDatabaseLog, databaseLogText, databaseLogExport, retainMalformedDatabaseResponse } from '../database-log.js';
import { readEvents } from '../api.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function assertDatabaseWritable('), source.indexOf('const tokenCounts ='));
function fixture() {
    const template = defaultDatabase();
    const state = { character: { avatar: 'A.png', name: 'A' }, file: 'chat', header: { chat_metadata: { integrity: 'keep' } },
        chat: [{ is_user: true, mes: 'question' }, { is_user: false, mes: 'answer', extra: { keep: true } }], own: {}, settings: {}, busy: false, controller: null };
    const settings = databaseSettings({ template, worldbookConfig: {} }), writes = [], notices = [], panels = [], requests = [];
    let resolveResponse, rejectResponse, requestSignal, panelContext;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const context = vm.createContext({ state, cancelMessageEdit() {}, panelDirty: false, panelRevision: 1, AbortController, DOMException,
        sourceHash, storeDatabase, deleteDatabaseSummaryHistory, databaseSummaryTriggered, messageSummaryRange, startDatabaseLog, finishDatabaseLog, retainMalformedDatabaseResponse, DatabaseFormatError, readEvents, copy: structuredClone, currentDatabase: () => ({ ...databaseForChat(state.chat, state.header, template), settings }),
        databaseConnection: () => ({}), generationBody: () => ({}), databaseWorlds: async () => [],
        profileStore: { profiles: [] }, persona: () => ({ name: 'User' }), referenceDatabaseText: () => '', sheetText: () => '',
        fillMessages: (...args) => { requests.push(args); return []; }, expand: text => text,
        api: { post: async () => ({ token_count: 100 }), response: async (_path, _body, options) => { requestSignal = options.signal; return (await response)(); } },
        parseUpdate: (_text, data, counts) => { counts.operations++; return { ...structuredClone(data), updated: true }; },
        databaseUpdateNotice: counts => `updated ${counts.operations}`,
        saveChat: async () => writes.push(structuredClone(state.chat)), rememberChat: async () => {},
        notify: (...args) => notices.push(args), list: { setMessages() {} },
        assertViewable() {}, assertIdle() {}, status() {}, synchronize() {}, showPanel: () => { panels.push('open'); return { append() {} }; },
        renderDatabasePanel: (_body, value) => { panelContext = value; },
        el: () => ({}), field() {}, apiKeyField() {}, action() {}, icon() {}, pickFile() {}, databaseModels() {},
    });
    vm.runInContext(functions, context);
    vm.runInContext('databaseProgress = () => ({ update() {}, close() {} })', context);
    return { state, settings, requests, context, writes, notices, panels, run: code => vm.runInContext(code, context),
        panel: () => panelContext, signal: () => requestSignal,
        finish: (content = 'update') => resolveResponse(() => Response.json({ choices: [{ message: { content } }] })),
        respond: value => resolveResponse(() => value),
        fail: rejectResponse };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('database summary applies bare operations to the latest snapshot without dialogue or hiding messages', async () => {
    const f = fixture();
    f.context.parseUpdate = parseUpdate;
    storeDatabase(f.state.chat, f.state.header, { ...defaultDatabase(), marker: 'latest' }, 1, { kind: 'message', to: 1 });
    f.settings.autoHideMessages = true; // Old settings cannot re-enable removed behavior.
    const task = f.run("updateDatabase(0, 0, false, 'database')"); await tick();
    assert.equal(f.requests[0][1].marker, 'latest'); assert.equal(f.requests[0][2].length, 0); assert.equal(f.requests[0][6], 'database');
    f.finish('{"operations":[{"action":"insert","sheet":"sheet_0","data":{"0":"状态","1":"已总结"}}]}'); await task;
    assert.equal(f.writes.length, 1); assert.equal(f.state.chat[1].extra.independentDatabase.kind, 'database');
    assert.equal(f.writes[0][1].TavernDB_ACU_Data.sheet_0.content[1][2], '已总结');
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

test('update logs distinguish HTTP, parser and save failures while keeping copied summaries free of raw content', async () => {
    clearDatabaseLog();
    const request = fixture();
    const task = request.run('updateDatabase(0, 1)'); await tick();
    request.fail(Object.assign(Error('private upstream response'), { status: 429 }));
    await assert.rejects(task, /private upstream response/);
    assert.match(databaseLogText(), /失败[^\n]*\n阶段 · 请求模型\n.*HTTP 429/);

    const parsing = fixture();
    parsing.context.parseUpdate = parseUpdate;
    const parseTask = parsing.run('updateDatabase(0, 1)'); await tick(); parsing.finish();
    await assert.rejects(parseTask, /未产生有效/);
    assert.match(databaseLogText(), /阶段 · 解析并应用更新\n.*响应 6 字符\n缺少完整的 <dataUpdate>/);

    const saving = fixture();
    saving.context.saveChat = async () => { throw Error('private chat data'); };
    const saveTask = saving.run('updateDatabase(0, 1)'); await tick(); saving.finish();
    await assert.rejects(saveTask, /private chat data/);
    assert.match(databaseLogText(), /阶段 · 保存聊天\n.*已解析 1 条操作/);
    assert.doesNotMatch(databaseLogText(), /private upstream response|private chat data|\bupdate\b/);
    assert.deepEqual(databaseLogExport().entries.map(entry => entry.malformedResponse?.text), [undefined, 'update', undefined]);
});

test('JSON export includes the full latest malformed response and clearing removes it', async () => {
    clearDatabaseLog();
    const raw = '原始回复\r\n' + '长回复🚧\n'.repeat(60000) + '回复末尾';
    const malformed = fixture();
    malformed.context.parseUpdate = parseUpdate;
    const task = malformed.run('updateDatabase(0, 1)'); await tick(); malformed.finish(raw);
    await assert.rejects(task, /未产生有效/);
    assert.equal(JSON.parse(JSON.stringify(databaseLogExport())).entries[0].malformedResponse.text, raw);
    assert.doesNotMatch(databaseLogText(), /原始回复|回复末尾/);

    const invalidTable = fixture();
    invalidTable.context.parseUpdate = parseUpdate;
    const badTable = '<dataUpdate>{"sheet_0":{"content":[[null,"列"],[null]]}}</dataUpdate>';
    const tableTask = invalidTable.run('updateDatabase(0, 1)'); await tick(); invalidTable.finish(badTable);
    await assert.rejects(tableTask, /列数不一致/);
    assert.deepEqual(databaseLogExport().entries[0].malformedResponse, { source: '模型回复', text: badTable });
    assert.equal(databaseLogExport().entries[1].malformedResponse, undefined);

    const invalidHttp = fixture();
    const httpTask = invalidHttp.run('updateDatabase(0, 1)'); await tick();
    const body = '\n  <html>Bad response</html>\r\n';
    invalidHttp.respond(new Response(body));
    await assert.rejects(httpTask, { name: 'SyntaxError' });
    assert.deepEqual(databaseLogExport().entries[0].malformedResponse, { source: 'HTTP 响应体', text: body });

    const invalidSse = fixture();
    const sseTask = invalidSse.run('updateDatabase(0, 1)'); await tick();
    invalidSse.respond(new Response('data: {malformed\ndata: payload}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    await assert.rejects(sseTask, /无法解析的流式数据/);
    assert.deepEqual(databaseLogExport().entries[0].malformedResponse, { source: 'SSE 事件数据', text: '{malformed\npayload}' });
    clearDatabaseLog();
    assert.deepEqual(databaseLogExport().entries, []);
});

test('finishing fill does not reopen management or clear a different panel draft', async () => {
    const f = fixture(); await f.run('databasePanel()');
    const task = f.panel().fill(0, 1); await tick();
    f.context.panelRevision++; f.context.panelDirty = true;
    f.finish(); await task;
    assert.equal(f.panels.length, 1); assert.equal(f.context.panelDirty, true);
    f.panel().dirty(false); assert.equal(f.context.panelDirty, true);
});


test('overview context keeps chat history and seed bound to the opened conversation', async () => {
    const f = fixture();
    const seed = defaultDatabase(), history = [{ index: 1, data: defaultDatabase() }];
    f.state.header.chat_metadata.independentDatabase = { seed, history };
    await f.run('databasePanel()');
    const panel = f.panel();
    assert.equal(panel.characterName, 'A'); assert.equal(panel.chatName, 'chat');
    assert.equal(panel.seed, seed); assert.equal(panel.chat, f.state.chat);
    f.state.header = { chat_metadata: { independentDatabase: { history: [{ index: 99 }] } } };
    f.state.chat = []; f.state.file = 'other';
    assert.equal(panel.history(), history);
    assert.equal(panel.chat.length, 2);
});


test('history deletion persists only the opened chat and restores on save failure', async () => {
    const f = fixture(); storeDatabase(f.state.chat, f.state.header, defaultDatabase(), 1);
    await f.run('databasePanel()');
    const expected = databaseSummaryHistory(f.state.chat);
    await f.panel().deleteHistory('message-1', expected);
    assert.equal(f.writes.length, 1); assert.equal(f.state.chat[1].TavernDB_ACU_Data, undefined);
    assert.equal(f.state.databaseHistorySaving, false);
    const g = fixture(); storeDatabase(g.state.chat, g.state.header, defaultDatabase(), 1);
    await g.run('databasePanel()');
    const expectedDeletion = databaseSummaryHistory(g.state.chat);
    g.run("saveChat = () => { state.dirty = true; return state.saves = Promise.reject(Error('save failed')); }");
    await assert.rejects(g.panel().deleteHistory(['message-1'], expectedDeletion), /save failed/);
    assert.ok(g.state.chat[1].TavernDB_ACU_Data); assert.equal(g.state.databaseHistorySaving, false);
    assert.equal(g.state.dirty, false);
    g.run("saveChat = async () => {}");
    await g.panel().deleteHistory(['message-1'], expectedDeletion);
    assert.equal(g.state.chat[1].TavernDB_ACU_Data, undefined);
});

test('history deletion rejects switched chats, updates and chat generation', async () => {
    const f = fixture(); await f.run('databasePanel()');
    f.state.busy = true;
    await assert.rejects(f.panel().deleteHistory('all', databaseSummaryHistory(f.state.chat)), /等待生成/);
    f.state.busy = false; f.state.databaseController = {};
    await assert.rejects(f.panel().deleteHistory('all', databaseSummaryHistory(f.state.chat)), /数据库更新/);
    f.state.databaseController = null; f.state.file = 'other';
    await assert.rejects(f.panel().deleteHistory('all', databaseSummaryHistory(f.state.chat)), /聊天已切换/);
    assert.equal(f.writes.length, 0);
});


test('preview guard rejects legacy snapshot deletion even when message text is unchanged', () => {
    const f = fixture(); f.run('guard = databaseWriteGuard(1)');
    f.state.chat[1].extra.independentDatabase = { snapshotDeleted: true };
    assert.throws(() => f.run('guard.check()'), /数据库已变化/);
});
