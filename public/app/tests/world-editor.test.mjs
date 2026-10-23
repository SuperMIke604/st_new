import test from 'node:test';
import assert from 'node:assert/strict';
import { worldDraft, newWorldEntry } from '../world-editor.js';
import { activateWorlds } from '../engine.js';

test('world drafts preserve unknown metadata and do not mutate the source', () => {
    const source = { extensions: { future: true }, entries: { 8: { uid: 8, key: ['雨'], content: '旧内容', futureRule: { value: 3 } } } };
    const draft = worldDraft(source); draft.entries[8].content = '新内容';
    assert.equal(source.entries[8].content, '旧内容');
    assert.deepEqual(draft.entries[8].futureRule, { value: 3 });
    assert.deepEqual(draft.extensions, { future: true });
    assert.deepEqual(worldDraft(JSON.parse(JSON.stringify(draft))), draft);
});

test('new entries avoid uid collisions and edits reach world activation', () => {
    const draft = worldDraft({ entries: { 0: { uid: 1, disable: true } } });
    const id = newWorldEntry(draft); assert.equal(id, '2');
    Object.assign(draft.entries[id], { key: ['书店'], content: '书店里有一只猫。' });
    const active = activateWorlds([draft], [{ mes: '我走进书店' }]);
    assert.equal(active.length, 1); assert.equal(active[0].content, '书店里有一只猫。');
    draft.entries[id].disable = true;
    assert.equal(activateWorlds([draft], [{ mes: '我走进书店' }]).length, 0);
});

test('entry arrays import as editable maps and invalid data is rejected', () => {
    assert.equal(worldDraft({ entries: [{ uid: 7, content: 'a' }] }).entries[7].content, 'a');
    for (const data of [null, [], {}, { entries: { 0: null } }, { entries: { 0: 'text' } }, { entries: [{ uid: 1 }, { uid: 1 }] }, { entries: { 0: { key: 'text' } } }]) assert.throws(() => worldDraft(data));
});
