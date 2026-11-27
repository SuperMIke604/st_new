import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedWorld, hasEmbeddedWorld, importCharacterWorld, saveCharacterWorldBinding } from '../character-world.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { filterCards, libraryState, moveCards } from '../library.js';

test('card import opens the card and leaves it unfiled even when its filename had a category', async () => {
    const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
    const importer = source.slice(source.indexOf('async function importCharacter('), source.indexOf('function themeDefaultAvatar('));
    for (const assignments of [{ 'other.png': 'first' }, { 'new.png': 'first', 'other.png': 'first' }]) {
        const own = { characterLibrary: { folders: [{ id: 'first', name: 'First' }], assignments } };
        const state = { own }, opened = [];
        let writes = 0;
        const context = vm.createContext({
            state, libraryState, moveCards, FormData, panelDirty: false,
            assertSaved() {}, pickFile: async () => new File(['{}'], 'new.json'),
            api: {
                post: async () => ({ file_name: 'new' }),
                patchSettings: async patch => { writes++; const settings = { independent_frontend: structuredClone(own) }; patch(settings); return settings; },
            },
            settingsOwn: settings => settings.independent_frontend,
            importCharacterWorld: async () => ({ imported: false }), safeName: value => value,
            characterCatalog: { invalidate() {} }, loadCharacterCatalog() {}, closePanel() {}, notify() {},
            openCharacter: async avatar => opened.push(avatar),
        });
        vm.runInContext(importer, context);
        await context.importCharacter();
        assert.deepEqual(opened, ['new.png']);
        assert.equal(writes, Number(Object.hasOwn(assignments, 'new.png')));
        assert.deepEqual(filterCards([{ avatar: 'new.png' }], state.own.characterLibrary, 'unfiled'), [{ avatar: 'new.png' }]);
        assert.equal(state.own.characterLibrary.assignments['other.png'], 'first');
    }
});

test('embedded lore converts native activation fields without changing original card', () => {
    const character = { data: { name: '林', character_book: { name: '书店', entries: [{ id: 4, keys: ['雨'], secondary_keys: ['猫'], content: '书店背景', enabled: false, insertion_order: 35, position: 'after_char', extensions: { scan_depth: 6, ignore_budget: true, future: 9 } }] } } };
    const before = structuredClone(character), book = embeddedWorld(character), entry = book.entries[4];
    assert.deepEqual(entry.key, ['雨']); assert.equal(entry.disable, true); assert.equal(entry.position, 1); assert.equal(entry.order, 35);
    assert.equal(entry.scanDepth, 6); assert.equal(entry.ignoreBudget, true); assert.equal(entry.future, 9);
    assert.deepEqual(book.originalData, character.data.character_book); assert.deepEqual(character, before);
});

test('materializing embedded lore avoids collisions, links the character and is idempotent', async () => {
    const character = { avatar: 'card.png', data: { name: '林', extensions: { regex_scripts: [{ id: 'keep' }] }, character_book: { name: '书店', entries: [{ keys: ['猫'], content: '背景', enabled: true }] } } };
    const books = new Map([['书店', { entries: { 0: { content: '不得覆盖' } } }]]);
    let writes = 0;
    const api = { async post(path, body) {
        if (path === '/api/characters/get') return structuredClone(character);
        if (path === '/api/worldinfo/list') return [...books.keys()].map(file_id => ({ file_id }));
        if (path === '/api/worldinfo/edit') { books.set(body.name, body.data); writes++; return { ok: true }; }
        if (path === '/api/characters/merge-attributes') { Object.assign(character.data.extensions, body.data.extensions); return { ok: true }; }
        throw new Error(path);
    } };
    const result = await importCharacterWorld(api, 'card.png', name => name);
    assert.equal(result.name, '书店 2'); assert.equal(result.imported, true);
    assert.equal(character.data.extensions.world, '书店 2'); assert.equal(character.data.extensions.regex_scripts[0].id, 'keep');
    assert.equal(books.get('书店').entries[0].content, '不得覆盖');
    assert.equal((await importCharacterWorld(api, 'card.png', name => name)).imported, false); assert.equal(writes, 1);
});

test('missing named lore can be recovered from embedded entries; cards without lore make no writes', async () => {
    const character = { data: { extensions: { world: 'missing' } } };
    const api = { post: async path => { assert.equal(path, '/api/characters/get'); return character; } };
    const result = await importCharacterWorld(api, 'card.png', name => name);
    assert.equal(result.imported, false); assert.equal(embeddedWorld(character), null);
});

test('binding and replacing lore update only the role link; explicit unbinding preserves but disables embedded lore', async () => {
    const book = { entries: [{ keys: ['猫'], content: '背景' }] };
    const character = { data: { extensions: { future: { keep: true } }, character_book: book } };
    const updates = [];
    const api = { async post(path, body) {
        if (path === '/api/characters/get') {
            assert.equal(body.avatar_url, 'card.png');
            return structuredClone(character);
        }
        assert.equal(path, '/api/characters/merge-attributes');
        assert.equal(body.avatar, 'card.png');
        updates.push(body.data);
        Object.assign(character.data.extensions, body.data.extensions);
    } };
    for (const world of ['第一次绑定', '替换']) {
        const saved = await saveCharacterWorldBinding(api, 'card.png', world);
        assert.deepEqual(updates.at(-1), { extensions: { world } });
        assert.equal(saved.data.extensions.world, world);
    }
    const saved = await saveCharacterWorldBinding(api, 'card.png', '', { disableEmbedded: true });
    assert.equal(saved.data.extensions.world, '');
    assert.deepEqual(saved.data.extensions.future, { keep: true });
    assert.deepEqual(saved.data.character_book, book);
    assert.equal(hasEmbeddedWorld(saved.data), false);
    assert.equal((await importCharacterWorld(api, 'card.png', String)).imported, false);
});

test('a write rejected by the host or missing from readback does not report a saved binding', async () => {
    const rejected = { post: async () => { throw new Error('write failed'); } };
    await assert.rejects(saveCharacterWorldBinding(rejected, 'card.png', 'new'), /write failed/);
    const unchanged = { post: async () => ({ data: { extensions: { world: 'old' } } }) };
    await assert.rejects(saveCharacterWorldBinding(unchanged, 'card.png', 'new'), /回读核验失败/);
});
