import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { avatarRecords } from '../role-avatar-store.js';
import { archiveRoleWorldEntries, roleWorldEntries } from '../role-worldbook.js';
import { schemaCode, schemaDocument } from '../script-schema.js';
import { prepareValidatedMvuSnapshots } from '../mvu-compat.js';
import { scriptSupport } from '../scripts.js';
import { ScriptRuntime } from '../script-runtime.js';

test('Zod schema runs locally with prefault, coercion and transforms; invalid snapshots never commit', async () => {
    const source = `import { registerMvuSchema } from 'https://example.test/util/mvu_zod.js';
export const Schema = z.object({money:z.coerce.number().prefault(5),tags:z.array(z.string()).prefault([]).transform(items=>_.uniq(items))});
$(()=>registerMvuSchema(Schema));`;
    const library = await fs.readFile(new URL('../vendor/zod.min.js', import.meta.url), 'utf8');
    const context = vm.createContext({ window: {}, _: { uniq: values => [...new Set(values)] }, $: fn => fn(), registerMvuSchema: schema => { context.schema = schema; } });
    vm.runInContext(library, context); context.z = context.window.z; vm.runInContext(schemaCode(source), context);
    assert.equal(context.schema.parse({}).money, 5);
    assert.equal(context.schema.parse({ money: '9', tags: ['a', 'a'] }).tags.length, 1);
    assert.equal(scriptSupport({ content: source }).adapter, 'mvu-schema');
    assert.ok(!schemaDocument(source, library).includes('https://example.test/'));
    const chat = [{ mes: '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/money","value":2}]</JSONPatch></UpdateVariable>' }];
    const planned = await prepareValidatedMvuSnapshots(chat, { money: '9' }, message => message.mes, data => context.schema.parseAsync(data));
    assert.equal(chat[0].variables, undefined); planned.commit(); assert.equal(chat[0].variables[0].stat_data.money, 11);
    const invalid = [{ mes: '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/money","value":"invalid"}]</JSONPatch></UpdateVariable>' }];
    await assert.rejects(prepareValidatedMvuSnapshots(invalid, { money: 9 }, message => message.mes, data => context.schema.parseAsync(data))); assert.equal(invalid[0].variables, undefined);
});

test('avatar persistence accepts bounded local image records and rejects remote or duplicate data', () => {
    const record = { 键: 'test', 显示名: 'Test', 别名: [], 图片: 'data:image/png;base64,AAAA', 更新时间: 1 };
    assert.deepEqual(avatarRecords([record]), [record]); assert.throws(() => avatarRecords([record, record]));
    assert.throws(() => avatarRecords([{ ...record, 图片: 'https://example.test/avatar.png' }]));
    assert.throws(() => avatarRecords([{ ...record, 别名: ['x'.repeat(201)] }]));
});

test('archive writes add native entries, retain all existing fields and reject unrelated changes or removal', () => {
    const book = { keep: true, entries: { 0: { uid: 0, comment: 'Init', content: 'preserve', disable: false, extra: { keep: 2 } } } };
    const entries = roleWorldEntries(book);
    const added = { name: 'Char_Test', enabled: true, content: 'archive', strategy: { type: 'selective', keys: ['Test'], scan_depth: 'same_as_global' }, position: { type: 'before_character_definition', role: 'system', order: 41 }, recursion: { prevent_incoming: true, prevent_outgoing: true }, probability: 100 };
    const result = archiveRoleWorldEntries(book, [...entries, added]);
    assert.deepEqual(result.entries[0], book.entries[0]); assert.equal(result.entries[1].comment, 'Char_Test'); assert.deepEqual(result.entries[1].key, ['Test']); assert.equal(result.entries[1].excludeRecursion, true); assert.equal(result.keep, true);
    const read = roleWorldEntries(result); read[1].content = 'updated'; const overwritten = archiveRoleWorldEntries(result, read); assert.equal(overwritten.entries[1].content, 'updated');
    assert.throws(() => archiveRoleWorldEntries(book, [])); assert.throws(() => archiveRoleWorldEntries(book, [{ ...entries[0], content: 'bad' }]));
    const noUid = { entries: { 4: { comment: 'Init', content: '' } } }; assert.equal(archiveRoleWorldEntries(noUid, [...roleWorldEntries(noUid), added]).entries[5].uid, 5);
    const mismatched = { entries: { 5: { uid: 4, comment: 'Init', content: 'keep' } } }; const safe = archiveRoleWorldEntries(mismatched, [...roleWorldEntries(mismatched), added]); assert.deepEqual(safe.entries[5], mismatched.entries[5]); assert.equal(safe.entries[6].comment, 'Char_Test');
});

test('role archive messages use saved user instructions, cannot execute arbitrary commands or retry failed generation automatically', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function roleScriptAction('), source.indexOf('async function normalizeRoleMvu('));
    let current = 'chat', draft = '', generated = 0;
    const state = { chat: [], character: { avatar: 'card.png' } };
    const context = vm.createContext({ state, panelDirty: false, scriptIdentity: () => current, assertSaved() { if(state.busy) throw Error('busy'); }, $: () => ({ value: draft }), persona: () => ({ name: 'User' }), list: { setMessages() {}, update() {} }, saveChat: async () => {}, scriptSnapshot: value => ({ chat: structuredClone(value.chat) }), generate: async () => { generated++; return { completed: false }; } });
    vm.runInContext(fn, context);
    const invoke = (action, payload) => context.roleScriptAction(action, payload, 'chat', 'role-archive');
    await assert.rejects(invoke('create-messages', { messages: [{ role: 'assistant', message: 'bad' }] })); assert.equal(state.chat.length, 0);
    draft = 'unsent'; await assert.rejects(invoke('create-messages', { messages: [{ role: 'user', message: 'test' }] })); draft = '';
    const created = await invoke('create-messages', { messages: [{ role: 'user', message: 'test' }] }); assert.equal(created.snapshot.chat[0].mes, 'test');
    await assert.rejects(invoke('slash', { command: '/trigger await=true' }), /未完成/);
    await assert.rejects(invoke('slash', { command: '/trigger' }), /已尝试/); assert.equal(generated, 1);
    await assert.rejects(invoke('slash', { command: '/exec arbitrary' }));
    await invoke('slash', { command: '/hide 0' }); assert.equal(state.chat[0].is_system, true);
    current = 'other'; await assert.rejects(invoke('slash', { command: '/hide 0' }));
});

test('role RPC capabilities reject unknown script IDs and calls outside the assigned adapter', async () => {
    const replies = []; let calls = 0;
    const runtime = new ScriptRuntime({ roleAction: async () => { calls++; return { value: true }; } });
    const frame = { postMessage: value => replies.push(value) }; runtime.frame = { contentWindow: frame }; runtime.identity = 'chat';
    runtime.statusRows.set('avatars', { dataset: { adapter: 'role-avatar' } });
    const request = (scriptId, action) => runtime.receive({ source: frame, data: { channel: 'st-new-scripts', type: 'request', id: 1, action: 'role-action', payload: { scriptId, action, payload: {} } } });
    await request('unknown', 'avatars'); await request('avatars', 'replace-worldbook'); assert.equal(calls, 0); assert.ok(replies.every(reply => reply.error));
    await request('avatars', 'avatars'); assert.equal(calls, 1); assert.equal(replies.at(-1).value.value, true);
});
