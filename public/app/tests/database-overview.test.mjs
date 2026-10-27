import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseSummaryHistory, deleteDatabaseSummaryHistory } from '../database-overview.js';
import { defaultDatabase, storeDatabase, databaseForChat } from '../database.js';

test('overview shows only supplied chat snapshots and labels retained versions separately', () => {
    const chat = [{ is_user: true }, { is_user: false, mes: 'reply' }], header = {};
    const first = defaultDatabase(); first.sheet_0.content.push([null, '地点', '书店']);
    storeDatabase(chat, header, first, 1, { kind: 'message', from: 0, to: 1 });
    const second = structuredClone(first); second.sheet_0.content[1][2] = '公园';
    storeDatabase(chat, header, second, 1, { kind: 'database', messageSummaryTo: 1 });
    const before = structuredClone({ chat, header });
    const { records, invalid } = databaseSummaryHistory(chat, header.chat_metadata.independentDatabase.history);
    assert.equal(invalid, 0); assert.equal(records.length, 2);
    assert.equal(records[0].kind, 'database'); assert.equal(records[1].archived, true);
    assert.equal(records[1].data.sheet_0.content[1][2], '书店');
    records[0].data.sheet_0.content[1][2] = 'changed in view';
    assert.deepEqual({ chat, header }, before);
    assert.deepEqual(databaseSummaryHistory([]), { records: [], invalid: 0 });
});

test('overview supports legacy carriers, stale snapshots and explicit seeds without reading user data', () => {
    const legacy = defaultDatabase();
    const chat = [{ is_user: true, TavernDB_ACU_Data: legacy },
        { mes: `<dataUpdate>${JSON.stringify(legacy)}</dataUpdate>` },
        { TavernDB_ACU_Data: legacy, extra: { independentDatabase: { kind: 'message', from: 0, to: 2, stale: true } } }];
    const { records } = databaseSummaryHistory(chat, [], legacy);
    assert.deepEqual(records.map(record => record.id), ['message-2', 'message-1', 'seed']);
    assert.equal(records[0].stale, true); assert.equal(records[0].from, 0);
    assert.equal(records[1].legacy, true); assert.equal(records[2].seed, true);
});

test('malformed histories do not hide valid summaries and ordering follows chat floors', () => {
    const data = defaultDatabase();
    const result = databaseSummaryHistory([{ TavernDB_ACU_Data: data }, { TavernDB_ACU_Data: { sheet_0: { content: [] } } }],
        [{ index: 3, data }, { index: 0, data: { mate: { type: 'other' } } }, null]);
    assert.equal(result.invalid, 3);
    assert.deepEqual(result.records.map(record => record.index), [3, 0]);
});


test('single deletion suppresses legacy re-extraction without modifying text or unrelated metadata', async () => {
    const data = defaultDatabase(), text = `<dataUpdate>${JSON.stringify(data)}</dataUpdate>`;
    const chat = [{ mes: text, extra: { keep: 42 }, swipe_info: [{ keep: true }] }], header = { chat_metadata: { integrity: 'keep' } };
    const expected = databaseSummaryHistory(chat);
    let saved;
    await deleteDatabaseSummaryHistory(chat, header, 'message-0', expected, async () => { saved = structuredClone(chat); });
    assert.equal(chat[0].mes, text); assert.equal(chat[0].extra.keep, 42);
    assert.equal(saved[0].extra.independentDatabase.snapshotDeleted, true);
    assert.deepEqual(chat[0].swipe_info, [{ keep: true }]);
    assert.equal(databaseSummaryHistory(saved).records.length, 0);
    assert.equal(databaseForChat(saved, header).index, -1);
    assert.equal(header.chat_metadata.integrity, 'keep');
});

test('all deletion removes live, archived, malformed and seed data, preserving other header fields', async () => {
    const data = defaultDatabase(), header = { chat_metadata: { integrity: 'keep', independentDatabase: { seed: data, history: [{ index: 0, data }], autoStart: 3 } } };
    const chat = [{ TavernDB_ACU_Data: data }, { TavernDB_ACU_Data: { sheet_bad: null } }];
    const expected = databaseSummaryHistory(chat, header.chat_metadata.independentDatabase.history, data);
    const result = await deleteDatabaseSummaryHistory(chat, header, 'all', expected, async () => {});
    assert.deepEqual(result, { records: [], invalid: 0 });
    assert.equal(header.chat_metadata.independentDatabase.autoStart, 3);
    assert.equal(header.chat_metadata.integrity, 'keep');
    assert.equal(chat[0].TavernDB_ACU_Data, undefined);
});

test('deletion failure restores exact fields and stale selection rejects without saving', async () => {
    const data = defaultDatabase(), chat = [{ TavernDB_ACU_Data: data, extra: { unrelated: true } }];
    const header = { chat_metadata: { independentDatabase: { seed: data, history: [{ index: 0, data }] } } };
    const before = structuredClone({ chat, header }), expected = databaseSummaryHistory(chat, header.chat_metadata.independentDatabase.history, data);
    await assert.rejects(deleteDatabaseSummaryHistory(chat, header, 'all', expected, async () => { throw Error('offline'); }), /offline/);
    assert.deepEqual({ chat, header }, before);
    chat[0].TavernDB_ACU_Data = { ...data, marker: 'new' };
    await assert.rejects(deleteDatabaseSummaryHistory(chat, header, 'message-0', expected, async () => { throw Error('should not save'); }), /历史总结数据已变化/);
    await deleteDatabaseSummaryHistory(chat, header, 'archive-0', databaseSummaryHistory(chat, header.chat_metadata.independentDatabase.history, data), async () => {});
    assert.equal(header.chat_metadata.independentDatabase.history.length, 0); assert.ok(chat[0].TavernDB_ACU_Data);
});
