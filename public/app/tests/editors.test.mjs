import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { presetDraft, promptOrder, promptRows, movePrompt, addPrompt, removePrompt, validatePreset, createPreset, uniquePresetName } from '../preset-editor.js';
import { libraryState, addFolder, renameFolder, deleteFolder, moveCards, filterCards } from '../library.js';
import { buildPrompt } from '../engine.js';
const source = JSON.parse(await fs.readFile(new URL('./fixtures/Default.json', import.meta.url), 'utf8'));

test('new preset is independent, validates and produces a complete prompt without copied regexes', () => {
    const first = createPreset(); const second = createPreset();
    assert.equal(validatePreset(first).temperature, 1);
    first.prompts[0].content = 'changed'; assert.notEqual(second.prompts[0].content, 'changed');
    assert.equal(second.extensions?.regex_scripts, undefined);
    const result = buildPrompt({ character: { name: 'C' }, persona: { name: 'U' }, preset: second, chat: [{ is_user: true, mes: 'hello' }] });
    assert.equal(result.messages.at(-1).content, 'hello'); assert.match(result.messages[0].content, /C.*U/);
});
test('new and duplicate preset names avoid overwriting existing saved names', () => {
    assert.equal(uniquePresetName('新预设', ['新预设', '新预设 2']), '新预设 3');
    assert.equal(uniquePresetName('测试（副本）', ['测试']), '测试（副本）');
});

test('form draft preserves unknown fields and other prompt-order scopes', () => {
    const input = structuredClone(source); input.unrecognized = { value: 'keep' };
    const snapshot = JSON.stringify(input); const draft = presetDraft(input);
    const group = structuredClone(draft.prompt_order.find(scope => Number(scope.character_id) === 100000));
    movePrompt(draft, 'main', 1);
    const main = draft.prompts.find(prompt => prompt.identifier === 'main'); main.content = 'edited';
    const result = validatePreset(draft);
    assert.deepEqual(result.unrecognized, { value: 'keep' });
    assert.deepEqual(result.prompt_order.find(scope => Number(scope.character_id) === 100000), group);
    assert.equal(JSON.stringify(input), snapshot);
});
test('item order, enabled state and custom text reach the generated prompt', () => {
    const draft = presetDraft(source);
    addPrompt(draft, 'custom-test');
    draft.prompts.find(prompt => prompt.identifier === 'custom-test').content = '最后的约定';
    draft.prompts.find(prompt => prompt.identifier === 'main').content = '不应出现';
    promptOrder(draft).find(item => item.identifier === 'main').enabled = false;
    const result = buildPrompt({ character: { name: '林', data: {} }, persona: { name: '旅人' }, preset: validatePreset(draft), chat: [{ is_user: true, mes: '你好' }] });
    assert.equal(result.messages.at(-1).content, '最后的约定');
    assert.ok(!result.messages.some(message => message.content.includes('不应出现')));
});
test('moving at boundaries is safe; adding and removing entries keeps identifiers consistent', () => {
    const draft = presetDraft(source); const original = structuredClone(promptOrder(draft));
    movePrompt(draft, original[0].identifier, -1); assert.deepEqual(promptOrder(draft), original);
    addPrompt(draft, 'copy-test'); assert.ok(promptRows(draft).some(row => row.prompt.identifier === 'copy-test'));
    assert.throws(() => addPrompt(draft, 'copy-test'), /已存在/);
    removePrompt(draft, 'copy-test');
    assert.ok(!draft.prompts.some(prompt => prompt.identifier === 'copy-test'));
    assert.ok(!promptOrder(draft).some(item => item.identifier === 'copy-test'));
    assert.throws(() => removePrompt(draft, 'chatHistory'), /不能删除/);
});
test('form validation catches disabled history and invalid numerical parameters', () => {
    const draft = presetDraft(source); draft.temperature = -1;
    assert.throws(() => validatePreset(draft), /Temperature/);
    draft.temperature = 1;
    promptOrder(draft).find(item => item.identifier === 'chatHistory').enabled = false;
    assert.throws(() => validatePreset(draft), /聊天历史/);
});
test('presets with a single order get a separate single-chat editing scope', () => {
    const input = structuredClone(source); input.prompt_order = [input.prompt_order[0]];
    const draft = presetDraft(input);
    assert.equal(draft.prompt_order.length, 2);
    movePrompt(draft, 'main', 1);
    assert.equal(draft.prompt_order[0].order[0].identifier, 'main');
});
test('folders support create and rename without modifying source or losing metadata', () => {
    const raw = { future: { preserve: true }, folders: [], assignments: {} };
    let next = addFolder(raw, 'f1', '奇幻'); next = renameFolder(next, 'f1', '奇幻世界');
    assert.equal(next.folders[0].name, '奇幻世界');
    assert.deepEqual(next.future, raw.future); assert.equal(raw.folders.length, 0);
    assert.throws(() => addFolder(next, 'f2', '奇幻世界'), /同名/);
    assert.throws(() => addFolder(next, 'f2', '   '), /名称/);
});
test('bulk moving is keyed by avatar, supports duplicate names, and survives reorder', () => {
    let library = addFolder({}, 'f1', '故事');
    library = moveCards(library, ['one.png', 'two.png'], 'f1');
    const cards = [{ avatar: 'two.png', name: '同名' }, { avatar: 'one.png', name: '同名' }, { avatar: 'three.png', name: '其他' }];
    assert.equal(filterCards(cards, library, 'f1').length, 2);
    assert.equal(filterCards(cards, library, 'unfiled')[0].avatar, 'three.png');
    library = moveCards(library, ['one.png'], '');
    assert.equal(filterCards(cards, library, 'unfiled').length, 2);
    assert.throws(() => moveCards(library, ['one.png'], 'missing'), /不存在/);
});
test('deleting a category unfiles the cards without deleting or mutating them', () => {
    let library = addFolder({}, 'f1', '临时'); library = moveCards(library, ['one.png'], 'f1');
    const cards = [{ avatar: 'one.png', name: '角色' }]; const snapshot = JSON.stringify(cards);
    library = deleteFolder(library, 'f1');
    assert.equal(library.folders.length, 0); assert.equal(filterCards(cards, library, 'unfiled').length, 1);
    assert.equal(JSON.stringify(cards), snapshot);
});
test('folder data roundtrips JSON; filtering and sorting are independent of stored data', () => {
    let library = addFolder({}, 'f1', '分类'); library = moveCards(library, ['a.png'], 'f1');
    const roundtrip = libraryState(JSON.parse(JSON.stringify(library)));
    const cards = [{ avatar: 'b.png', name: 'Beta', create_date: '2026-01-02' }, { avatar: 'a.png', name: 'Alpha', create_date: '2026-01-01' }];
    assert.equal(filterCards(cards, roundtrip, 'all', 'ALP')[0].avatar, 'a.png');
    assert.equal(filterCards(cards, roundtrip, 'all', '', 'recent')[0].avatar, 'b.png');
    assert.deepEqual(roundtrip, library);
});
