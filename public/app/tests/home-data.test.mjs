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
test('native recent chats resolve the current name without changing the avatar or chat filename', async () => {
    const recent = [{ avatar: 'old.png', file_name: 'chat.jsonl' }, { avatar: 'old.png', file_name: 'earlier.jsonl' }, { avatar: 'gone.png' }];
    const reads = [];
    const store = new RecentCharacters({ post: async (route, body) => {
        if (route.endsWith('updater/recent')) throw Object.assign(Error('missing'), { status: 404 });
        if (route.endsWith('chats/recent')) return recent;
        reads.push(body.avatar_url);
        if (body.avatar_url === 'gone.png') throw Object.assign(Error('missing'), { status: 404 });
        return { name: '旧名字', data: { name: '新名字' } };
    } });
    assert.deepEqual(await store.load(), [{ ...recent[0], characterName: '新名字' }, { ...recent[1], characterName: '新名字' }, recent[2]]);
    assert.deepEqual(reads, ['old.png', 'gone.png']);
});
