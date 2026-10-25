import test from 'node:test';
import assert from 'node:assert/strict';
import { roleWorldEntries, toggleRoleWorldEntries } from '../role-worldbook.js';
import vm from 'node:vm';
import fs from 'node:fs/promises';
test('scene switches change only enabled flags while preserving entry content and book metadata', () => {
    const book = { keep: { yes: true }, entries: { 0: { uid: 0, comment: 'Scene', content: 'preserve', disable: true, extra: { keep: 1 } }, 2: { uid: 2, comment: 'Other', content: 'also preserve', disable: false } } };
    const entries = roleWorldEntries(book); entries[0].enabled = true; entries[0].content = 'must not overwrite';
    const changed = toggleRoleWorldEntries(book, entries); assert.equal(changed.entries[0].disable, false); assert.equal(changed.entries[0].content, 'preserve'); assert.deepEqual(changed.keep, { yes: true }); assert.equal(book.entries[0].disable, true);
    assert.throws(() => toggleRoleWorldEntries(book, entries.slice(1)));
    assert.throws(() => toggleRoleWorldEntries(book, [entries[0], entries[0]]));
});
test('script worldbook RPC is confined to the current bound book and rejects writes while generating', async () => {
    const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
    const functions = source.slice(source.indexOf('async function roleWorldbook('), source.indexOf('async function prepareRoleMvu('));
    let identity = 'chat', calls = 0, book = { meta: { keep: true }, entries: { 0: { uid: 0, comment: 'Scene', content: 'keep', disable: true } } };
    const state = { character: { data: { extensions: { world: 'bound' } } } };
    const context = vm.createContext({ state, panelDirty: false, scriptIdentity: () => identity, assertSaved() { if (state.busy) throw Error('busy'); }, roleWorldEntries, toggleRoleWorldEntries, AbortSignal,
        api: { post: async (path, body) => { calls++; if (path.endsWith('/edit')) { book = structuredClone(body.data); return 'OK'; } return structuredClone(book); } }
    });
    vm.runInContext(functions, context);
    await assert.rejects(context.scriptWorldbook('read-worldbook', { name: 'other' }, 'chat'), /只允许/); assert.equal(calls, 0);
    const entries = await context.scriptWorldbook('read-worldbook', { name: 'bound' }, 'chat'); entries[0].enabled = true;
    await context.scriptWorldbook('toggle-worldbook', { name: 'bound', entries }, 'chat'); assert.equal(book.entries[0].disable, false); assert.equal(book.entries[0].content, 'keep'); assert.deepEqual(book.meta, { keep: true });
    state.busy = true; const before = calls; await assert.rejects(context.scriptWorldbook('toggle-worldbook', { name: 'bound', entries }, 'chat'), /busy/); assert.equal(calls, before); state.busy = false;
    identity = 'other-chat'; await assert.rejects(context.scriptWorldbook('read-worldbook', { name: 'bound' }, 'chat'), /只允许/);
});
