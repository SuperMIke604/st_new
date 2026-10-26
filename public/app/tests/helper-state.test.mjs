import test from 'node:test';
import assert from 'node:assert/strict';
import { helperMessageRevision, patchHelperVariables, patchHelperMessages } from '../helper-state.js';
const records = () => [{ chat_metadata: { variables: { keep: true }, unrelated: 42 } }, { mes: 'old reply', swipe_id: 1, swipes: ['first reply', 'old reply'], variables: { 0: { old: true }, 1: { score: 2 } }, extra: { keep: true } }];
const change = source => ({ type: 'message', message_id: 0, revision: helperMessageRevision(source[1]), base: structuredClone(source[1].variables), value: { ...source[1].variables, 1: { score: 5 } } });
test('helper variable transaction preserves all text, other branches and unknown metadata', () => {
    const source = records(), next = patchHelperVariables(source, [change(source), { type: 'chat', base: { keep: true }, value: { keep: true, score: 5 } }]);
    assert.equal(next[1].variables[1].score, 5); assert.equal(source[1].variables[1].score, 2);
    assert.equal(next[1].mes, source[1].mes); assert.deepEqual(next[1].variables[0], { old: true });
    assert.deepEqual(next[1].extra, { keep: true }); assert.equal(next[0].chat_metadata.unrelated, 42);
});
test('helper batches reject stale text, branch changes, stale variables, duplicate targets and invalid indices atomically', () => {
    const source = records(), first = change(source);
    for (const mutate of [copy => copy[1].mes += 'edited', copy => copy[1].swipe_id = 0, copy => copy[1].variables[1].score = 9]) {
        const fresh = structuredClone(source); mutate(fresh); const before = structuredClone(fresh);
        assert.throws(() => patchHelperVariables(fresh, [first])); assert.deepEqual(fresh, before);
    }
    assert.throws(() => patchHelperVariables(source, [first, first]), /重复/);
    assert.throws(() => patchHelperVariables(source, [{ ...first, value: { 9: { invalid: true } } }]), /分支/);
    assert.throws(() => patchHelperVariables(source, [first, { type: 'global', value: {}, base: {} }]), /范围/);
    assert.equal(source[1].variables[1].score, 2);
});
test('helper message editing persists current-branch text and all-swipe data without replacing other metadata', () => {
    const source = records(), next = patchHelperMessages(source, [{ message_id: 0, revision: helperMessageRevision(source[1]), base: source[1].variables, message: 'updated', swipes_data: [{ score: 1 }, { score: 5 }] }]);
    assert.deepEqual(next[1].swipes, ['first reply', 'updated']); assert.equal(next[1].mes, 'updated');
    assert.equal(next[1].variables[1].score, 5); assert.deepEqual(next[1].extra, { keep: true }); assert.equal(source[1].mes, 'old reply');
    assert.throws(() => patchHelperMessages(source, [{ message_id: 0, revision: helperMessageRevision(source[1]), base: source[1].variables, swipes_data: [{}] }]), /数量/);
    assert.throws(() => patchHelperMessages(source, [{ message_id: 0, revision: helperMessageRevision(source[1]), is_hidden: true }]), /字段/);
});
test('helper changes reject prototype payloads and unsafe data before touching the original records', () => {
    const source = records(), patch = change(source);
    patch.value = JSON.parse('{"0":{"__proto__":{"polluted":true}}}');
    assert.throws(() => patchHelperVariables(source, [patch]), /字段/);
    assert.equal({}.polluted, undefined); assert.equal(source[1].variables[1].score, 2);
});
