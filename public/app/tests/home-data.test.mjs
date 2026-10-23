import test from 'node:test';
import assert from 'node:assert/strict';
import { RecentCharacters } from '../home-data.js';
test('concurrent slow home requests share one request and reuse result', async () => {
    let resolve, calls = 0; const store = new RecentCharacters({ post: async () => { calls++; return new Promise(done => { resolve = done; }); } });
    const a = store.load(), b = store.load(); resolve([{ avatar: 'a.png' }]);
    assert.deepEqual(await a, await b); await store.load(); assert.equal(calls, 1);
});
test('missing module uses bounded fallback, server failures are not disguised as an empty home', async () => {
    const calls = []; const store = new RecentCharacters({ post: async (route, body) => { calls.push({ route, body }); if (calls.length === 1) throw Object.assign(Error('missing'), { status: 404 }); return []; } });
    assert.deepEqual(await store.load(), []); assert.equal(calls[1].body.max, 12);
    const broken = new RecentCharacters({ post: async () => { throw Object.assign(Error('disk error'), { status: 500 }); } });
    await assert.rejects(broken.load(), /disk error/);
});
test('home cache invalidates after chat changes', async () => {
    let calls = 0; const store = new RecentCharacters({ post: async () => [{ avatar: `${++calls}.png` }] });
    assert.equal((await store.load())[0].avatar, '1.png'); store.invalidate(); assert.equal((await store.load())[0].avatar, '2.png');
});
