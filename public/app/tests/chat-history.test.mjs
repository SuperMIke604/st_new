import test from 'node:test';
import assert from 'node:assert/strict';
import { changeChatHistory, persistChatHistory } from '../chat-history.js';

const fixture = () => Array.from({ length: 5 }, (_, id) => ({ name: 'Synthetic', mes: String(id), is_user: id % 2 === 0, is_system: false, swipes: [String(id), 'other'], swipe_id: 0, variables: { 0: { stat_data: { id } } }, TavernDB_ACU_Data: { id }, extra: { keep: id }, unknown: { id } }));
test('batch visibility preserves branches, variables, snapshots and unknown fields without mutating input', () => {
    const original = fixture(), before = structuredClone(original);
    const hidden = changeChatHistory(original, 'hide', [1, 3]).messages;
    assert.deepEqual(hidden.map(message => message.is_system), [false, true, false, true, false]);
    assert.deepEqual(changeChatHistory(hidden, 'show', [1, 3]).messages, original);
    for (const id of [1, 3]) for (const key of ['swipes', 'variables', 'TavernDB_ACU_Data', 'extra', 'unknown']) assert.deepEqual(hidden[id][key], original[id][key]);
    assert.deepEqual(original, before);
});
test('move preserves disjoint selections in original order and deletion can remove all messages', () => {
    const messages = fixture(), contents = list => list.map(message => message.mes);
    assert.deepEqual(contents(changeChatHistory(messages, 'move', [3, 1], { target: 0 }).messages), ['1', '3', '0', '2', '4']);
    assert.deepEqual(contents(changeChatHistory(messages, 'move', [1, 3], { target: 5 }).messages), ['0', '2', '4', '1', '3']);
    assert.deepEqual(contents(changeChatHistory(messages, 'delete', [3, 1]).messages), ['0', '2', '4']);
    assert.deepEqual(changeChatHistory(messages, 'delete', [0, 1, 2, 3, 4]).messages, []);
    assert.deepEqual(contents(messages), ['0', '1', '2', '3', '4']);
});
test('insertion accepts first and final positions and validates floor bounds and content', () => {
    const messages = fixture(), message = { mes: 'new', is_user: true };
    for (const target of [0, 5]) assert.deepEqual(changeChatHistory(messages, 'insert', [], { target, message }).messages[target], message);
    for (const target of [-1, 6, NaN, 0.5]) assert.throws(() => changeChatHistory(messages, 'insert', [], { target, message }));
    assert.throws(() => changeChatHistory(messages, 'insert', [], { target: 1, message: { mes: ' ' } }));
    for (const ids of [[], [-1], [8], [1.5]]) assert.throws(() => changeChatHistory(messages, 'delete', ids));
    assert.throws(() => changeChatHistory(messages, 'move', [1, 3], { target: 3 }));
});
function persistence({ before, after, failure, check = () => {} } = {}) {
    const header = { chat_metadata: { integrity: 'synthetic', unknown: 42 } }, original = fixture(), messages = changeChatHistory(original, 'hide', [1]).messages;
    const reads = [], writes = [];
    const api = { post: async (path, payload, options) => { reads.push({ path, payload, options }); return reads.length === 1 ? before ?? [header, ...original] : after ?? [header, ...messages]; }, saveChat: async (...args) => { writes.push(args); if (failure) throw failure; } };
    return { header, original, messages, reads, writes, save: extra => persistChatHistory(api, { avatar: 'synthetic.png', file: 'audit', header, original, messages, check, ...extra }) };
}
test('save checks original server data, preserves the header and confirms an uncached reread', async () => {
    const f = persistence(); assert.deepEqual(await f.save(), f.messages);
    assert.deepEqual(f.writes[0], ['synthetic.png', 'audit', f.header, f.messages]);
    assert.equal(f.reads.length, 2);
    for (const read of f.reads) { assert.ok(read.options.signal instanceof AbortSignal); assert.equal(read.path, '/api/chats/get'); }
});
test('stale messages, changed header and switched identity prevent overwriting server data', async () => {
    for (const before of [[], [{ chat_metadata: { integrity: 'other' } }, ...fixture()], [{ chat_metadata: { integrity: 'synthetic', unknown: 42 } }, ...fixture().slice(1)]]) {
        const f = persistence({ before }); await assert.rejects(f.save(), /已被其他操作修改/); assert.equal(f.writes.length, 0);
    }
    const f = persistence({ check: () => { throw Error('switched'); } });
    await assert.rejects(f.save(), /switched/); assert.equal(f.reads.length, 0);
});
test('new unsaved chats are allowed only when explicitly identified; write and reread failures are reported', async () => {
    const fresh = persistence({ before: [] }); assert.deepEqual(await fresh.save({ allowMissing: true }), fresh.messages);
    const failed = persistence({ failure: Error('disk failed') }); await assert.rejects(failed.save(), /disk failed/); assert.equal(failed.reads.length, 1);
    const wrong = persistence({ after: [] }); await assert.rejects(wrong.save(), /核验失败/);
});
