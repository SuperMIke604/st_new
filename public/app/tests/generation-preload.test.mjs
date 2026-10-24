import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationPreload, generationDatabaseResources } from '../generation-preload.js';
import { defaultDatabase } from '../database.js';
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

test('scheduled preload yields to user actions and cancelled work never runs', async () => {
    const cache = new GenerationPreload(() => ({})); let calls = 0;
    cache.schedule(async () => { calls++; });
    assert.equal(calls, 0);
    cache.cancelScheduled();
    await new Promise(resolve => setTimeout(resolve, 180)); assert.equal(calls, 0);
    cache.schedule(async () => { calls++; throw Error('optional warmup failed'); });
    await new Promise(resolve => setTimeout(resolve, 180)); assert.equal(calls, 1);
});

test('background warmup reads books and both histories, but stops when the chat changes', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function preloadNextGeneration('), source.indexOf('async function preparePrompt('));
    let scheduled, bookReads = 0, histories = [], finishes = [];
    const state = { chat: [{ mes: 'old' }, { mes: 'latest' }], header: {}, character: {}, own: {} };
    const context = vm.createContext({ state, panelDirty: false, generationPreload: { schedule: task => { scheduled = task; }, get: chat => histories.push(chat.length) }, activeRegexes: () => [], warmHistoryRegex: async () => {}, loadBooks: async () => { bookReads++; }, nextPaint: async () => {}, loadTimings: { start: () => status => finishes.push(status) } });
    vm.runInContext(fn, context); vm.runInContext('preloadNextGeneration()', context);
    await scheduled(); assert.equal(bookReads, 1); assert.deepEqual(histories, [2, 1]); assert.deepEqual(finishes, ['success']);
    histories = []; vm.runInContext('preloadNextGeneration()', context); state.chat = [];
    await scheduled(); assert.equal(bookReads, 1); assert.deepEqual(histories, []);
    vm.runInContext('preloadNextGeneration()', context);
    context.loadBooks = async () => { state.chat = []; };
    await scheduled(); assert.deepEqual(histories, []); assert.equal(finishes.at(-1), 'cancelled');
});
