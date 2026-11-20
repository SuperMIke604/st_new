import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationPreload, generationDatabaseResources, prepareDatabaseResources } from '../generation-preload.js';
import { databaseSettings, defaultDatabase, fillMessages } from '../database.js';
import { fitPrompt } from '../engine.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('send and regeneration reuse distinct resources without dropping the new user input', () => {
    const first = { mes: 'first', is_user: false }, last = { mes: 'last', is_user: false };
    const chat = [first, { mes: 'question', is_user: true }, last], header = {};
    let builds = 0;
    const cache = new GenerationPreload(messages => ({ build: ++builds, length: messages.length }));
    const send = cache.get(chat, header, {}), regenerate = cache.get(chat.slice(0, -1), header, {});
    assert.equal(cache.get([...chat, { mes: 'new question', is_user: true }], header, {}), send);
    assert.equal(cache.get(chat.slice(0, -1), header, {}), regenerate);
    assert.equal(builds, 2);
    last.mes = 'edited'; assert.notEqual(cache.get(chat, header, {}), send);
    const previous = cache.get(chat, header, {});
    last.TavernDB_ACU_Data = defaultDatabase(); assert.notEqual(cache.get(chat, header, {}), previous);
    const current = cache.get(chat, header, {});
    assert.notEqual(cache.get(chat, header, { inject: true }), current);
    assert.notEqual(cache.get(chat, {}, {}), current);
    cache.invalidate(); assert.equal(cache.entries.length, 0);
});

test('preloaded database strings match fresh preparation and respond to changed snapshots', () => {
    const header = {}, snapshot = defaultDatabase();
    snapshot.sheet_0.content.push([null, 'location', 'home']);
    const chat = [{ mes: 'reply', TavernDB_ACU_Data: snapshot }];
    const cache = new GenerationPreload(generationDatabaseResources);
    const ready = cache.get(chat, header, { inject: true });
    assert.deepEqual(ready, generationDatabaseResources(chat, header, { inject: true }));
    assert.match(ready.databaseText, /home/);
    // All persisted edits invalidate, including edits to an existing object.
    snapshot.sheet_0.content[1][2] = 'outside'; cache.invalidate();
    assert.match(cache.get(chat, header, { inject: true }).databaseText, /outside/);
});

test('keyword rows deduplicate multi-value matches and scan the actual send history after warmup', () => {
    const snapshot = defaultDatabase();
    snapshot.sheet_1.content.push([null, '（陈澄、周凛, 陈澄；林淑芬\n周老师）', '赵月', 'matched-detail'], [null, '赵阳', '', 'unmatched-detail']);
    snapshot.sheet_0.content.push([null, '地点', 'constant-detail（提到周老师）']);
    const template = structuredClone(snapshot);
    template.sheet_1.injection = { mode: 'keyword', depth: 1, columns: [1, 2] };
    const config = { inject: true, template }, header = {};
    const chat = [{ mes: '赵阳', TavernDB_ACU_Data: snapshot }];
    const cache = new GenerationPreload(prepareDatabaseResources);
    cache.get(chat, header, config, { warm: true });
    const send = mes => cache.get([...chat, { mes, is_user: true }], header, config);
    for (const name of ['陈澄', '周凛', '林淑芬', '周老师', '赵月', '陈澄和赵月']) {
        const { databaseText, databaseMacros } = send(name);
        assert.equal(databaseText.match(/matched-detail/g)?.length, 1);
        assert.doesNotMatch(databaseText, /unmatched-detail/);
        assert.match(databaseMacros.sheet_1, /matched-detail/);
        assert.doesNotMatch(databaseMacros.sheet_1, /unmatched-detail/);
        assert.match(databaseMacros.tabledata, /constant-detail/);
    }
    const noMatch = send('没有提到名字');
    assert.match(noMatch.databaseText, /constant-detail/);
    assert.doesNotMatch(noMatch.databaseText, /matched-detail/);
    assert.equal(noMatch.databaseMacros.sheet_1, '');
    assert.match(noMatch.databaseMacros.tabledata, /unmatched-detail/);
    assert.match(fillMessages(databaseSettings(config), snapshot, [], 0, 0).map(message => message.content).join('\n'), /unmatched-detail/);
    template.sheet_1.injection.depth = 2;
    assert.match(send('没有提到名字').databaseText, /unmatched-detail/);
    template.sheet_1.injection.depth = 0;
    assert.doesNotMatch(send('周老师').databaseText, /matched-detail/);
    assert.equal(send('周老师').databaseMacros.sheet_1, '');
    template.sheet_1.injection.depth = 1;
    const manual = generationDatabaseResources([...chat, { mes: '周老师', is_user: true }], header, { ...config, inject: false });
    assert.equal(manual.databaseText, '');
    assert.match(manual.databaseMacros.sheet_1, /matched-detail/);
    assert.doesNotMatch(manual.databaseMacros.sheet_1, /unmatched-detail/);
    assert.equal(snapshot.sheet_1.content.length, 3);
});

test('blocked keywords only suppress their own trigger in the selected chat and table', () => {
    const template = defaultDatabase();
    for (const key of ['sheet_0', 'sheet_1']) {
        const table = template[key];
        table.injection = { mode: 'keyword', columns: [1] };
        table.content.push(table.content[0].map((_, column) => column === 1 ? '周老师、Zhao' : column === 2 ? `record-${key}` : null));
    }
    const metadata = { blockedKeywords: { sheet_0: ['周老师', 'ZHAO'] } };
    const header = { chat_metadata: { independentDatabase: metadata } };
    const config = { template, inject: true };
    const chat = [{ mes: '周老师', is_user: true }];
    const cache = new GenerationPreload(prepareDatabaseResources);
    cache.get(chat, header, config, { warm: true });
    const blocked = cache.get(chat, header, config);
    assert.doesNotMatch(blocked.databaseText, /record-sheet_0/);
    assert.match(blocked.databaseText, /record-sheet_1/);
    assert.equal(blocked.databaseMacros.sheet_0, '');
    assert.match(blocked.databaseMacros.tabledata, /record-sheet_0/);
    assert.match(cache.get(chat, {}, config).databaseText, /record-sheet_0/);
    metadata.blockedKeywords = { sheet_0: ['周老师'] };
    assert.match(cache.get([{ mes: '周老师和Zhao', is_user: true }], header, config).databaseText, /record-sheet_0/);
    delete metadata.blockedKeywords;
    assert.match(cache.get(chat, header, config).databaseText, /record-sheet_0/);
});

test('Chinese keyword matches are selected by relevance and emitted in original table order', () => {
    const template = defaultDatabase();
    template.sheet_1.injection = { mode: 'keyword', columns: [1], maxRows: 4 };
    template.sheet_1.content.push(
        [null, '旧港仓', '', 'exact-current'],
        [null, '旧港仓库', '', 'three-character-hit'],
        [null, '旧港码头、银钥链', '', 'two-keyword-hit'],
        [null, '旧港码头', '', 'two-character-hit'],
        [null, '赵月', '', 'history-only'],
        [null, '旧仓院', '', 'nonconsecutive'],
        [null, '旧港仓禁', '', 'blocked-hit'],
    );
    const header = { chat_metadata: { independentDatabase: { blockedKeywords: { sheet_1: ['旧港仓禁'] } } } };
    const chat = [{ mes: '赵月在门口' }, { is_user: true, mes: '去旧港仓找银钥匙' }];
    const resources = generationDatabaseResources(chat, header, { template, inject: true });
    const ordered = ['exact-current', 'three-character-hit', 'two-keyword-hit', 'two-character-hit'];
    for (const text of [resources.databaseText, resources.databaseMacros.sheet_1]) {
        assert.deepEqual([...text.matchAll(/exact-current|two-keyword-hit|three-character-hit|two-character-hit/g)].map(match => match[0]), ordered);
        assert.doesNotMatch(text, /history-only|nonconsecutive|blocked-hit/);
    }
    const stats = resources.databaseKeywordRows.find(row => row.key === 'sheet_1');
    assert.equal(stats.matched, 5);
    assert.match(resources.databaseMacros.tabledata, /blocked-hit/);
});

test('an enabled source column links exact keywords in other tables for one hop', () => {
    const template = {
        mate: { type: 'chatSheets' },
        sheet_0: { name: '地点', injection: { mode: 'keyword', columns: [1], linkEnabled: true, linkColumn: 2 }, content: [
            [null, '地点', '相关角色'], [null, '旧港仓库', '周凛、李微'], [null, '周凛', 'same-table'],
        ] },
        sheet_1: { name: '人物', injection: { mode: 'keyword', columns: [1], linkEnabled: true, linkColumn: 2 }, content: [
            [null, '姓名', '相关物品'], [null, '周凛', '银钥匙'], [null, '周凛然', 'near-name'], [null, '李微', 'blocked-person'],
        ] },
        sheet_2: { name: '物品', injection: { mode: 'keyword', columns: [1] }, content: [
            [null, '物品', '信息'], [null, '银钥匙', 'second-hop'],
        ] },
    };
    const header = { chat_metadata: { independentDatabase: { blockedKeywords: { sheet_1: ['李微'] } } } };
    const send = mes => generationDatabaseResources([{ mes, is_user: true }], header, { template, inject: true });
    const { databaseText, databaseMacros, databaseKeywordRows } = send('去旧港');
    assert.match(databaseMacros.sheet_1, /周凛/);
    assert.doesNotMatch(databaseText, /same-table|near-name|blocked-person|second-hop/);
    assert.equal(databaseMacros.sheet_2, '');
    assert.equal(databaseKeywordRows.find(row => row.key === 'sheet_1').matched, 1);
    assert.equal(send('去旧港找周凛').databaseMacros.sheet_1.match(/姓名: 周凛\n/g)?.length, 1);
    template.sheet_0.injection.linkEnabled = false;
    assert.equal(send('去旧港').databaseMacros.sheet_1, '');
});

test('keyword budget ranks within each table, reserves high priority current hits and reports the final macro rows', async () => {
    const template = {
        mate: { type: 'chatSheets' },
        sheet_0: { name: '过往事件', injection: { mode: 'keyword', columns: [1], priority: 'low', maxRows: 3 }, content: [
            [null, '参与者', '内容'], [null, '陈澄、周凛', 'row-multi-old'], [null, '陈澄、周凛', 'row-multi-new'],
            [null, '陈澄', 'row-single'], [null, '赵月、王平、李强', 'row-history'],
        ] },
        sheet_1: { name: '重要角色', injection: { mode: 'keyword', columns: [1], priority: 'high' }, content: [
            [null, '姓名', '身份'], [null, '陈澄', 'row-character'],
        ] },
        sheet_2: { name: '物品', injection: { mode: 'keyword', columns: [1] }, content: [
            [null, '相关人物', '名称'], [null, '陈澄', 'row-item'],
        ] },
    };
    const chat = [{ mes: '赵月、王平、李强' }, { is_user: true, mes: '陈澄问周凛，陈澄再次开口。' }];
    const config = { template, inject: true, keywordInjectionTokens: 2 };
    const resources = generationDatabaseResources(chat, {}, config);
    assert.ok(resources.databaseMacros.sheet_0.indexOf('row-multi-old') < resources.databaseMacros.sheet_0.indexOf('row-multi-new'));
    assert.ok(resources.databaseMacros.sheet_0.indexOf('row-multi-new') < resources.databaseMacros.sheet_0.indexOf('row-single'));
    assert.doesNotMatch(resources.databaseMacros.sheet_0, /row-history/);
    assert.match(resources.databaseMacros.tabledata, /row-history/);
    // Charge one unit per record, including repeated macros, using the same final-prompt path as the tokenizer.
    const count = async messages => messages.map(message => message.content).join('\n').match(/row-[a-z-]+/g)?.length ?? 0;
    const input = { character: { name: '角色' }, chat, preset: {}, settings: {}, ...resources };
    const automatic = await fitPrompt(input, count);
    assert.deepEqual(automatic.databaseKeywordRows.map(row => [row.matched, row.limited, row.sent]), [[4, 3, 0], [1, 1, 1], [1, 1, 1]]);
    const explicit = await fitPrompt({ ...input, preset: { prompts: [{ identifier: 'main', role: 'system', content: '{{sheet_0}}\n{{sheet_0}}' }] } }, count);
    assert.deepEqual(explicit.databaseKeywordRows.map(row => [row.key, row.sent]), [['sheet_0', 1]]);
    assert.deepEqual(explicit.databaseKeywordMacros.map(({ key, occurrences }) => [key, occurrences]), [['sheet_0', 2]]);
    assert.equal(await count(explicit.messages), 2);
    assert.match(explicit.messages.map(message => message.content).join('\n'), /row-multi-new/);
});

test('table macros use archived fallback and refresh when the archive is removed', () => {
    const snapshot = place => {
        const data = defaultDatabase();
        data.sheet_0.content.push([null, 'location', place]);
        return data;
    };
    const chat = [{ TavernDB_ACU_Data: snapshot('old-floor') }, { mes: 'later reply' }];
    const history = [{ index: 1, data: snapshot('archive-floor') }];
    const header = { chat_metadata: { independentDatabase: { history } } };
    const cache = new GenerationPreload(generationDatabaseResources);
    const { databaseMacros } = cache.get(chat, header, {});
    assert.match(databaseMacros.tabledata, /archive-floor/);
    assert.match(databaseMacros.sheet_0, /archive-floor/);
    assert.match(cache.get(chat.slice(0, 1), header, {}).databaseMacros.tabledata, /old-floor/);
    history.pop();
    assert.match(cache.get(chat, header, {}).databaseMacros.tabledata, /old-floor/);
});

test('scheduled preload yields to user actions and cancelled work never runs', async () => {
    const cache = new GenerationPreload(() => ({})); let calls = 0;
    cache.schedule(async () => { calls++; });
    assert.equal(calls, 0);
    cache.cancelScheduled();
    await new Promise(resolve => setTimeout(resolve, 180)); assert.equal(calls, 0);
    cache.schedule(async () => { calls++; throw Error('optional warmup failed'); });
    await new Promise(resolve => setTimeout(resolve, 180)); assert.equal(calls, 1);
});

test('same-chat triggers merge and replacement waits for cancelled work to exit', async () => {
    const preload = new GenerationPreload(() => ({}));
    let release, firstSignal, active = 0, peak = 0, starts = 0;
    const blocked = new Promise(resolve => { release = resolve; });
    const first = async signal => { firstSignal = signal; starts++; active++; peak = Math.max(peak, active); await blocked; active--; return true; };
    preload.schedule(first, ['chat-a']);
    await new Promise(resolve => setTimeout(resolve, 180));
    for (let i = 0; i < 20; i++) preload.schedule(first, ['chat-a']);
    assert.equal(starts, 1); assert.equal(preload.stats().mergedTriggers, 20);
    preload.schedule(async () => { starts++; active++; peak = Math.max(peak, active); active--; return true; }, ['chat-b']);
    assert.equal(firstSignal.aborted, true);
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(starts, 1, 'new work waits even if old work has not yet acknowledged cancellation');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 2); assert.equal(peak, 1);
    preload.schedule(() => { throw Error('completed work must be reused'); }, ['chat-b']);
    assert.equal(preload.stats().startedTasks, 2);
    assert.equal(preload.stats().mergedTriggers, 21);
    preload.cancelScheduled(); assert.equal(preload.stats().activeTasks, 0);
});

test('background warmup reads books and both histories, but stops when the chat changes', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function preloadNextGeneration('), source.indexOf('async function preparePrompt('));
    let scheduled, bookReads = 0, histories = [], finishes = [];
    const state = { chat: [{ mes: 'old' }, { mes: 'latest' }], header: {}, character: {}, own: {} };
    const context = vm.createContext({ state, panelDirty: false, generationPreload: { schedule: task => { scheduled = task; }, get: chat => histories.push(chat.length) }, activeRegexes: () => [], warmHistoryRegex: async () => {}, loadBooks: async () => { bookReads++; }, nextPaint: async () => {}, loadTimings: { start: () => status => finishes.push(status), measure: (_label, _kind, task) => task() } });
    vm.runInContext(fn, context); vm.runInContext('preloadNextGeneration()', context);
    await scheduled(new AbortController().signal, () => ({})); assert.equal(bookReads, 1); assert.deepEqual(histories, [2, 1]); assert.deepEqual(finishes, ['success', 'success']);
    histories = []; vm.runInContext('preloadNextGeneration()', context); state.chat = [];
    await scheduled(new AbortController().signal, () => ({})); assert.equal(bookReads, 1); assert.deepEqual(histories, []);
    vm.runInContext('preloadNextGeneration()', context);
    context.loadBooks = async () => { state.chat = []; };
    await scheduled(new AbortController().signal, () => ({})); assert.deepEqual(histories, []); assert.equal(finishes.at(-1), 'cancelled');
});
