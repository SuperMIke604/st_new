import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorldSettings } from '../world-settings.js';
import { activateWorlds } from '../engine.js';
test('global world settings validate boundaries and preserve unrelated settings', () => {
    const settings = { world_info_depth: 0, world_info_budget: 25, world_info_budget_cap: 0, world_info_max_recursion_steps: 0, world_info: { globalSelect: ['book'] }, future: true };
    assert.deepEqual(validateWorldSettings(settings), settings);
    for (const value of [{ world_info_depth: -1 }, { world_info_budget: 101 }, { world_info_budget_cap: NaN }, { world_info_max_recursion_steps: 1.5 }]) assert.throws(() => validateWorldSettings(value));
});
test('zero scan depth skips history keywords but retains constant entries', () => {
    const books = [{ entries: { 0: { key: ['雨'], content: '关键词', position: 0 }, 1: { constant: true, content: '常驻', position: 0 } } }];
    const active = activateWorlds(books, [{ mes: '雨' }], { world_info_settings: { world_info_depth: 0 } });
    assert.deepEqual(active.map(entry => entry.content), ['常驻']);
});
test('recursive world scanning respects the configured pass limit', () => {
    const books = [{ entries: { 0: { key: ['third'], content: 'done' }, 1: { key: ['second'], content: 'third' }, 2: { key: ['first'], content: 'second' } } }];
    const settings = limit => ({ world_info_settings: { world_info_recursive: true, world_info_max_recursion_steps: limit } });
    assert.equal(activateWorlds(books, [{ mes: 'first' }], settings(1)).length, 1);
    assert.equal(activateWorlds(books, [{ mes: 'first' }], settings(0)).length, 3);
});
test('global matching, scan depth, recursion and budget override imported entry settings', () => {
    const books = [{ entries: { 0: { key: ['OLD'], content: 'excluded', scanDepth: 100 }, 1: { key: ['cat'], content: 'second', caseSensitive: true, matchWholeWords: true, preventRecursion: true, ignoreBudget: true }, 2: { key: ['second'], content: 'done', excludeRecursion: true } } }];
    const chat = [{ mes: 'OLD' }, { mes: 'CATCH' }];
    const wi = { world_info_depth: 1, world_info_recursive: false, world_info_case_sensitive: false, world_info_match_whole_words: false };
    const once = activateWorlds(books, chat, { world_info_settings: wi });
    assert.deepEqual(once.map(entry => entry.content), ['second']); assert.equal(once[0].ignoreBudget, false);
    assert.equal(activateWorlds(books, chat, { world_info_settings: { ...wi, world_info_recursive: true } }).length, 1);
    assert.equal(activateWorlds(books, chat, { world_info_settings: { ...wi, world_info_case_sensitive: true } }).length, 0);
    assert.equal(activateWorlds(books, chat, { world_info_settings: { ...wi, world_info_match_whole_words: true } }).length, 0);
});
test('legacy probability fields do not randomly suppress an activated entry', () => {
    const books = [{ entries: { 0: { constant: true, content: 'always', useProbability: true, probability: 0 } } }];
    assert.equal(activateWorlds(books, [], {}, {}, () => 1).length, 1);
});

test('world entries send highest order first and newest first on ties', () => {
 const books = [{entries:{0:{constant:true,content:'old',order:100,independentCreatedAt:1},1:{constant:true,content:'new',order:100,independentCreatedAt:2},2:{constant:true,content:'high',order:200}}}];
 assert.deepEqual(activateWorlds(books, []).map(entry => entry.content), ['high','new','old']);
});
