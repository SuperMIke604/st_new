import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRegex, presetRegexes, scopedRegexes, activeRegexes } from '../regex.js';
import { buildPrompt, generationBody } from '../engine.js';
import { presetDraft, validatePreset } from '../preset-editor.js';
let postProcessPrompt;
try { ({ postProcessPrompt } = await import('../../../src/prompt-converters.js')); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const rule = (extra = {}) => ({ scriptName: 'test', findRegex: '/secret/g', replaceString: 'public', placement: [2], trimStrings: [], ...extra });
const preset = rules => ({ temperature: 1, top_p: 1, openai_max_context: 8192, openai_max_tokens: 512,
    prompts: [{ identifier: 'chatHistory', marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }], extensions: { regex_scripts: rules } });

test('global, preset and character scopes remain separate and execute in native order', () => {
    const settings = { extension_settings: { regex: [rule({ replaceString: 'global', promptOnly: true })] } };
    const p = preset([rule({ findRegex: '/global/g', replaceString: 'preset', promptOnly: true })]);
    const character = { name: 'C', data: { extensions: { regex_scripts: [rule({ findRegex: '/preset/g', replaceString: 'character', promptOnly: true })] } } };
    const before = JSON.stringify({ settings, p, character });
    const scopes = scopedRegexes({ settings, preset: p, character });
    assert.equal(scopes.global.length, 1); assert.equal(scopes.preset.length, 1); assert.equal(scopes.character.length, 1);
    assert.equal(applyRegex('secret', activeRegexes({ settings, preset: p, character }), 2, { phase: 'prompt' }), 'character');
    const output = buildPrompt({ settings, preset: p, character, chat: [{ is_user: false, mes: 'secret' }] });
    assert.equal(output.messages[0].content, 'character');
    assert.equal(JSON.stringify({ settings, p, character }), before);
    assert.equal(activeRegexes({ settings, preset: p }).length, 2);
    assert.equal(activeRegexes({ settings, character }).length, 2);
});

test('embedded preset regexes survive import drafts and save validation including unknown data', () => {
    const source = preset([rule({ extraUnknown: 123 })]); const original = JSON.stringify(source);
    const output = validatePreset(presetDraft(source));
    assert.deepEqual(presetRegexes(output), source.extensions.regex_scripts);
    assert.equal(JSON.stringify(source), original);
    assert.equal(presetRegexes({ regex_scripts: [rule()] }).length, 1);
});
test('regex phases, placement and disabled flags are independent', () => {
    const rules = [rule({ replaceString: 'display', markdownOnly: true }), rule({ replaceString: 'prompt', promptOnly: true })];
    assert.equal(applyRegex('secret', rules, 2), 'secret');
    assert.equal(applyRegex('secret', rules, 2, { phase: 'display' }), 'display');
    assert.equal(applyRegex('secret', rules, 2, { phase: 'prompt' }), 'prompt');
    assert.equal(applyRegex('secret', rules, 1, { phase: 'display' }), 'secret');
    assert.equal(applyRegex('secret', [rule({ disabled: true })], 2), 'secret');
});
test('regex depth bounds, edit behavior, ordering and cached global patterns work', () => {
    const rules = [rule({ minDepth: 1, maxDepth: 2, runOnEdit: true }), rule({ findRegex: '/public/g', replaceString: 'done', runOnEdit: true })];
    assert.equal(applyRegex('secret secret', rules, 2, { depth: 1, edit: true }), 'done done');
    assert.equal(applyRegex('secret', rules, 2, { depth: 3 }), 'secret');
    assert.equal(applyRegex('secret', [rule()], 2, { edit: true }), 'secret');
    assert.equal(applyRegex('secret', [rule()], 2), 'public');
    assert.equal(applyRegex('secret', [rule()], 2), 'public');
});
test('regex substitutions support capture groups, named groups, match, trims and escaped macros', () => {
    assert.equal(applyRegex('[A]', [rule({ findRegex: '/\\[(?<letter>A)\\]/g', replaceString: '$<letter>:$0:{{match}}', trimStrings: ['[', ']'] })], 2), 'A:A:A');
    assert.equal(applyRegex('a.b axb', [rule({ findRegex: '/{{char}}/g', substituteRegex: 2, replaceString: '{{user}}' })], 2, { variables: { char: 'a.b', user: 'U' } }), 'U axb');
    assert.equal(applyRegex('secret', [rule({ findRegex: '/[/' })], 2), 'secret');
});
test('prompt-only regex transforms request messages, not stored history or rendered display', () => {
    const p = preset([rule({ promptOnly: true })]); const chat = [{ is_user: false, mes: 'secret' }];
    const result = buildPrompt({ character: { name: 'C' }, preset: p, chat });
    assert.equal(result.messages[0].content, 'public'); assert.equal(chat[0].mes, 'secret');
    assert.equal(applyRegex(chat[0].mes, presetRegexes(p), 2, { phase: 'display' }), 'secret');
});
test('world info regex is applied before injection', () => {
    const p = preset([rule({ placement: [5], promptOnly: true })]);
    p.prompts.unshift({ identifier: 'worldInfoBefore', marker: true }); p.prompt_order[0].order.unshift({ identifier: 'worldInfoBefore', enabled: true });
    const output = buildPrompt({ character: { name: 'C' }, preset: p, chat: [{ is_user: true, mes: 'hi' }], books: [{ entries: { a: { constant: true, content: 'secret', position: 0 } } }] });
    assert.equal(output.messages[0].content, 'public');
});
test('stream is configurable and default post-processing uses native same-role merge', { skip: !postProcessPrompt && 'Requires SillyTavern backend sources' }, () => {
    const connection = { source: 'custom', url: 'https://example.com/v1', model: 'test' };
    const messages = [{ role: 'system', content: 'A' }, { role: 'system', content: 'B' }, { role: 'user', content: 'C' }];
    const body = generationBody(connection, {}, messages);
    assert.equal(body.stream, true); assert.equal(body.custom_prompt_post_processing, 'merge');
    const merged = postProcessPrompt(structuredClone(body.messages), body.custom_prompt_post_processing);
    assert.equal(merged.length, 2); assert.match(merged[0].content, /A[\s\S]*B/);
    const nonstream = generationBody({ ...connection, stream: false, postProcessing: '' }, {}, messages);
    assert.equal(nonstream.stream, false); assert.equal(nonstream.custom_prompt_post_processing, '');
});
