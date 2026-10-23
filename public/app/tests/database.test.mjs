import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDatabase, validateDatabase, databaseSettings, migrateLegacySettings, applyOperations, parseUpdate, databaseForChat, storeDatabase, invalidateDatabases, databaseText, fillMessages, sourceHash } from '../database.js';
import { buildPrompt, fitPrompt } from '../engine.js';

const messages = () => [{ name: '角色', is_user: false, mes: '开场白', extra: {} }, { name: '用户', is_user: true, mes: '时间是早上。' }, { name: '角色', is_user: false, mes: '我们到了书店。', extra: {} }];
const filled = () => applyOperations(defaultDatabase(), [{ action: 'insert', sheet: 'sheet_0', data: { 0: '地点', 1: '书店' } }]);
test('table schema imports old chatSheets and preserves metadata without source mutation', () => {
    const old = defaultDatabase(); old.sheet_0.extensions = { future: true }; old.mate.extra = 9;
    const validated = validateDatabase(old); validated.sheet_0.name = 'changed';
    assert.equal(old.sheet_0.name, '当前状态'); assert.equal(validated.sheet_0.extensions.future, true);
    assert.equal(validated.mate.extra, 9);
    for (const value of [null, [], { mate: { type: 'x' } }, { sheet_0: { content: [[null, 'a'], [null, 'b', 'c']] } }, { sheet_0: { content: [[null, 'a'], [null, {}]] } }]) assert.throws(() => validateDatabase(value));
});
test('insert/update/delete operations are atomic, bounded and resolve sheet names', () => {
    const original = defaultDatabase();
    const result = applyOperations(original, [{ action: 'insert', sheet: 0, data: { 0: '时间', 1: '早上' } }, { action: 'update', sheet: '当前状态', row: 0, data: { 1: '中午' } }]);
    assert.equal(original.sheet_0.content.length, 1); assert.equal(result.sheet_0.content[1][2], '中午');
    assert.equal(applyOperations(result, [{ action: 'delete', sheet: 'sheet_0', row: 0 }]).sheet_0.content.length, 1);
    for (const operation of [{ action: 'delete', sheet: 0, row: -1 }, { action: 'update', sheet: 0, row: 100000, data: {} }, { action: 'insert', sheet: 0, data: { 50: 'x' } }, { action: 'eval', sheet: 0 }, { action: 'insert', sheet: '__proto__', data: {} }]) {
        assert.throws(() => applyOperations(original, [{ action: 'insert', sheet: 0, data: { 0: 'x' } }, operation])); assert.equal(original.sheet_0.content.length, 1);
    }
});
test('AI response parses tags/fences and full sheet replacement without executing code', () => {
    const raw = '<dataUpdate>{"operations":[{"action":"insert","sheet":"sheet_0","data":{"0":"时间","1":"早上"}}]}</dataUpdate>';
    assert.equal(parseUpdate(raw, defaultDatabase()).sheet_0.content[1][2], '早上');
    assert.throws(() => parseUpdate('```json\n{"operations":[]}\n```', defaultDatabase()));
    assert.equal(parseUpdate('<dataUpdate>'+JSON.stringify({ sheet_0: filled().sheet_0 })+'</dataUpdate>', defaultDatabase()).sheet_0.content.length, 2);
    for (const value of ['not JSON', 'null', '[]', '{"operations":"bad"}', '(()=>alert(1))()']) assert.throws(() => parseUpdate(value, defaultDatabase()));
});
test('reference snapshots are chat-scoped and retain the latest attached database', () => {
    const chat = messages(), header = { chat_metadata: {} };
    storeDatabase(chat, header, filled(), 0); assert.equal(databaseForChat(chat, header).index, 0);
    storeDatabase(chat, header, filled(), 2); assert.equal(databaseForChat(chat, header).index, 2);
    chat[2].mes = '新回复'; assert.equal(databaseForChat(chat, header).index, 2);
    assert.equal(databaseForChat(messages(), { chat_metadata: {} }).index, -1);
    invalidateDatabases(chat, 0); assert.equal(databaseForChat(chat, header).index, 2);
    const other = []; storeDatabase(other, header, filled()); assert.equal(databaseForChat(other, header).data.sheet_0.content.length, 2);
    const old = messages(); old[2].TavernDB_ACU_Data = filled(); assert.equal(databaseForChat(old, {}).legacy, true);
    assert.notEqual(sourceHash(old), sourceHash([{ ...old[0], mes: 'different' }]));
});
test('fill placeholders preserve literal data and reference settings migrate without dropping fields', () => {
    const config = databaseSettings({ presets: [{ id: 'p', name: 'custom', messages: [{ role: 'user', content: '$0\n$1\n$4' }] }] });
    const chat = [{ is_user: true, mes: '文本中的 $0 不应二次替换' }];
    const result = fillMessages(config, filled(), chat, 0, 0, '参考'); assert.ok(result[0].content.includes('文本中的 $0')); assert.ok(result[0].content.includes('参考'));
    const migrated = migrateLegacySettings({ apiConfig: { apiKey: 'private' }, autoUpdateEnabled: true, worldbookConfig: { injectionTarget: 'do not migrate' }, charCardPrompts: [{ name: '旧预设', prompt: [{ role: 'USER', content: '$0 $1' }], overviewTemplate: JSON.stringify(filled()) }] });
    assert.equal(migrated.presets[0].messages[0].role, 'user'); assert.equal(migrated.template.sheet_0.content.length, 2); assert.equal(migrated.auto, true);
    assert.equal(migrated.apiConfig.apiKey,'private'); assert.equal(migrated.worldbookConfig.injectionTarget,'do not migrate');
    for (const value of [{ batch: 0 }, { frequency: -1 }, { maxTokens: 0 }, { temperature: 9 }]) assert.throws(() => databaseSettings(value));
});
test('database injection is temporary, counted in context fitting and never mutates chat', async () => {
    const chat = messages(), original = structuredClone(chat);
    const input = { character: { name: '角色' }, chat, settings: {}, preset: { openai_max_context: 1000, openai_max_tokens: 100, prompts: [{ identifier: 'chatHistory', marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }] }, databaseText: databaseText(filled()) };
    const built = buildPrompt(input); assert.ok(built.messages[0].content.includes('书店')); assert.deepEqual(chat, original);
    const fit = await fitPrompt(input, async value => JSON.stringify(value).length); assert.ok(fit.tokens > 0); assert.ok(fit.messages.some(message => message.content.includes('当前聊天数据库')));
    await assert.rejects(() => fitPrompt({ ...input, databaseText: 'x'.repeat(2000) }, async value => JSON.stringify(value).length));
});
test('database macros support old presets without duplicate injection or expanding cell macros', () => {
    const input = { character: { name: '角色' }, chat: messages(), databaseText: 'full table', databaseMacros: { tabledata: 'literal {{keep}} $0', sheet_0: 'one sheet' }, preset: {
        prompts: [{ identifier: 'main', role: 'system', content: '{{tableData}}\n{{sheet_0}}' }, { identifier: 'chatHistory', marker: true }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
    } };
    const result = buildPrompt(input);
    assert.ok(result.messages.some(message => message.content.includes('literal {{keep}} $0')));
    assert.ok(result.messages.some(message => message.content.includes('one sheet')));
    assert.ok(!result.messages.some(message => message.content.includes('当前聊天数据库（作为参考资料')));
});
test('overwriting a snapshot retains a bounded restorable previous version', () => {
    const chat = messages(), header = { chat_metadata: {} }; storeDatabase(chat, header, filled(), 2);
    for (let index = 0; index < 12; index++) {
        const value = filled(); value.sheet_0.content[1][2] = String(index); storeDatabase(chat, header, value, 2);
    }
    const versions = header.chat_metadata.independentDatabase.history;
    assert.equal(versions.length, 8); assert.equal(versions.at(-1).data.sheet_0.content[1][2], '10');
    assert.equal(databaseForChat(chat, header).data.sheet_0.content[1][2], '11');
    const original = structuredClone({ chat, header });
    assert.throws(() => storeDatabase(chat, header, defaultDatabase(), 1));
    assert.deepEqual({ chat, header }, original);
});


test('edited template survives serialized settings and active preset restoration', () => {
    const settings = databaseSettings();
    settings.template.sheet_0 = { name: '修改后的模板', content: [[null, '地点', '天气']] };
    const saved = databaseSettings(settings);
    const restored = databaseSettings(JSON.parse(JSON.stringify(saved)));
    assert.equal(restored.template.sheet_0.name, '修改后的模板');
    assert.deepEqual(restored.presets.find(item => item.id === restored.activePreset).template, restored.template);
});
