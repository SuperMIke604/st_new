import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInitialVariables, initialVariablesFromBook, applyMvuPatch, messageMvuPatch, prepareMvuSnapshots } from '../mvu-compat.js';
const update = operations => `<UpdateVariable><Analysis>notes</Analysis><JSONPatch>${JSON.stringify(operations)}</JSONPatch></UpdateVariable>`;
test('InitVar reads the card YAML subset and rejects executable tags and unsafe keys', () => {
    const value = parseInitialVariables('主角:\n  姓名: 待定\n  年龄: 18\n财务:\n  钱财: 5000\n关系: {}\n列表: []\n');
    assert.equal(value.主角.年龄, 18); assert.deepEqual(value.列表, []);
    assert.deepEqual(initialVariablesFromBook({ entries: { 0: { comment: '[InitVar]', disable: true, content: '值: 1' } } }), { 值: 1 });
    for (const source of ['__proto__: {}', 'a: !!js/function hi', 'a: &anchor {}', 'a: |\n  text']) assert.throws(() => parseInitialVariables(source));
});
test('MVU insert and delta plus JSONPatch operations are atomic and do not mutate original data', () => {
    const seed = { money: 10, values: ['a'], records: {}, nested: { old: 1 } };
    const result = applyMvuPatch(seed, [{ op: 'delta', path: '/money', value: 5 }, { op: 'insert', path: '/records/new', value: 'x' }, { op: 'insert', path: '/values/-', value: 'b' }, { op: 'copy', from: '/nested/old', path: '/nested/copy' }, { op: 'move', from: '/nested/old', path: '/nested/new' }, { op: 'test', path: '/money', value: 15 }]);
    assert.equal(result.money, 15); assert.deepEqual(result.values, ['a', 'b']); assert.deepEqual(result.nested, { copy: 1, new: 1 }); assert.equal(seed.money, 10);
    assert.throws(() => applyMvuPatch(seed, [{ op: 'replace', path: '/money', value: 0 }, { op: 'replace', path: '/missing', value: 1 }])); assert.equal(seed.money, 10);
    assert.throws(() => applyMvuPatch(seed, [{ op: 'insert', path: '/money', value: 1 }]));
    assert.throws(() => applyMvuPatch(seed, [{ op: 'delta', path: '/values', value: 1 }]));
    assert.throws(() => applyMvuPatch(seed, [{ op: 'add', path: '/__proto__/polluted', value: true }])); assert.equal({}.polluted, undefined);
});
test('updates are read only inside complete UpdateVariable blocks', () => {
    assert.deepEqual(messageMvuPatch('<JSONPatch>[{"op":"remove","path":"/x"}]</JSONPatch>'), []);
    assert.equal(messageMvuPatch(update([{ op: 'replace', path: '/x', value: 2 }])).length, 1);
    assert.throws(() => messageMvuPatch(update([]) + '<UpdateVariable>broken'), /未闭合/);
    assert.throws(() => messageMvuPatch('<UpdateVariable><JSONPatch>[]</UpdateVariable>'), /未闭合/);
});
test('snapshot preparation initializes missing data, is idempotent and preserves imported snapshots', () => {
    const chat = [{ mes: 'opening' }, { is_user: true, mes: 'question' }, { mes: update([{ op: 'delta', path: '/money', value: 5 }]) }];
    const ready = prepareMvuSnapshots(chat, { money: 10 }); assert.equal(chat[0].variables, undefined); ready.commit(); assert.equal(chat[2].variables[0].stat_data.money, 15);
    assert.equal(prepareMvuSnapshots(chat, { money: 10 }).count, 0);
    chat[0].mes = update([{ op: 'delta', path: '/money', value: 2 }]); const changed = prepareMvuSnapshots(chat, { money: 10 }); changed.commit(); assert.equal(chat[2].variables[0].stat_data.money, 17);
    const imported = { mes: update([{ op: 'delta', path: '/money', value: 100 }]), variables: { 0: { stat_data: { money: 42 }, keep: true } } };
    assert.equal(prepareMvuSnapshots([imported], { money: 10 }).count, 0); assert.equal(imported.variables[0].stat_data.money, 42);
});
test('regeneration writes its new swipe from the preceding message, and parse errors commit nothing', () => {
    const first = { mes: 'old', variables: { 0: { stat_data: { money: 10 } } } }, last = { swipe_id: 1, mes: update([{ op: 'delta', path: '/money', value: 5 }]), variables: { 0: { stat_data: { money: 99 } } } };
    prepareMvuSnapshots([first, last], { money: 0 }).commit(); assert.equal(last.variables[1].stat_data.money, 15); assert.equal(last.variables[0].stat_data.money, 99);
    const missing = { mes: 'opening' }, bad = { mes: '<UpdateVariable><JSONPatch>bad</JSONPatch></UpdateVariable>' };
    assert.throws(() => prepareMvuSnapshots([missing, bad], { money: 0 })); assert.equal(missing.variables, undefined);
});
test('raw reply updates survive output regex removal without being reapplied on reopen', () => {
    const message = { mes: 'Visible response' }, raw = update([{ op: 'delta', path: '/money', value: 5 }]);
    prepareMvuSnapshots([message], { money: 10 }, () => raw).commit(); assert.equal(message.variables[0].stat_data.money, 15);
    assert.equal(prepareMvuSnapshots([message], { money: 10 }).count, 0);
    message.mes = 'Edited visible response'; prepareMvuSnapshots([message], { money: 10 }).commit(); assert.equal(message.variables[0].stat_data.money, 15);
});
