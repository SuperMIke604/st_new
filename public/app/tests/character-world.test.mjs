import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedWorld, importCharacterWorld } from '../character-world.js';

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
