import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterCatalog } from '../character-catalog.js';

const cards = [{ avatar: 'a.png', name: 'A' }];
const options = { pause: async () => {} };
test('two empty lists and a valid current card recover automatically on the final fresh read', async () => {
    let reads = 0;
    const catalog = new CharacterCatalog({ post: async path => path.endsWith('/get') ? cards[0] : ++reads < 3 ? [] : cards }, options);
    assert.deepEqual(await catalog.load({ knownAvatar: 'a.png' }), cards); assert.equal(reads, 3);
});
test('a transient empty HTTP 200 triggers a fresh bounded read and recovers', async () => {
    let reads = 0;
    const catalog = new CharacterCatalog({ post: async (path, body, options) => {
        assert.equal(path, '/api/characters/all'); assert.ok(options.signal); return ++reads === 1 ? [] : cards;
    } }, options);
    assert.deepEqual(await catalog.load(), cards); assert.equal(reads, 2);
    assert.deepEqual(await catalog.load(), cards); assert.equal(reads, 2);
});
test('genuine empty libraries are allowed but never stick across reopening', async () => {
    let reads = 0;
    const catalog = new CharacterCatalog({ post: async () => { reads++; return []; } }, options);
    assert.deepEqual(await catalog.load(), []); assert.equal(reads, 2);
    assert.deepEqual(await catalog.load(), []); assert.equal(reads, 4);
});
test('known existing character prevents a false empty-library success, retry can recover', async () => {
    let empty = true;
    const catalog = new CharacterCatalog({ post: async path => path.endsWith('/get') ? cards[0] : empty ? [] : cards }, options);
    await assert.rejects(catalog.load({ knownAvatar: 'a.png' }), /当前角色仍存在/);
    assert.equal(catalog.cache, null); empty = false;
    assert.deepEqual(await catalog.load(), cards);
});
test('a genuinely removed current character permits the confirmed empty response', async () => {
    const catalog = new CharacterCatalog({ post: async path => { if (path.endsWith('/get')) throw Object.assign(Error('missing'), { status: 404 }); return []; } }, options);
    assert.deepEqual(await catalog.load({ knownAvatar: 'deleted.png' }), []);
});
test('errors and malformed responses never replace a good library; expiry and refresh fetch again', async () => {
    let now = 0, reads = 0, result = cards;
    const catalog = new CharacterCatalog({ post: async () => { reads++; if (result instanceof Error) throw result; return result; } }, { ...options, now: () => now });
    await catalog.load(); now = 30001; result = Error('offline');
    await assert.rejects(catalog.load(), /offline/); assert.deepEqual(catalog.cache.items, cards);
    result = { error: true }; await assert.rejects(catalog.load(), /格式异常/);
    result = [null]; await assert.rejects(catalog.load(), /格式异常/);
    result = cards; await catalog.load(); await catalog.load({ force: true }); assert.equal(reads, 6);
});
test('concurrent opens share one request and invalidation blocks stale writes', async () => {
    let resolve, reads = 0;
    const catalog = new CharacterCatalog({ post: () => { reads++; return new Promise(done => { resolve = done; }); } }, options);
    const a = catalog.load(), b = catalog.load(); assert.equal(reads, 1);
    resolve(cards); assert.deepEqual(await a, await b);
    const stale = catalog.load({ force: true }); catalog.invalidate(); resolve(cards);
    await assert.rejects(stale, { name: 'AbortError' }); assert.equal(catalog.cache, null);
});
