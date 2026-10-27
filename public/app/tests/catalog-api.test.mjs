import test from 'node:test';
import assert from 'node:assert/strict';
import { TavernAPI } from '../api.js';

test('catalog reads use lightweight endpoints; mutations invalidate them and details stay native', async () => {
    const original = globalThis.fetch, paths = [], api = new TavernAPI();
    globalThis.fetch = async path => {
        paths.push(path);
        return Response.json(path.endsWith('/get') ? { data: { description: 'full', extensions: { unknown: 7 } } } : [{ avatar: 'a.png', name: 'A' }]);
    };
    try {
        const cards = await api.post('/api/characters/all'); cards[0].name = 'mutated';
        assert.equal((await api.post('/api/characters/all'))[0].name, 'A');
        await api.post('/api/worldinfo/list'); await api.post('/api/worldinfo/list');
        await api.post('/api/worldinfo/edit', { name: 'a', data: {} });
        await api.post('/api/worldinfo/list');
        assert.equal((await api.post('/api/characters/get', { avatar_url: 'a.png' })).data.extensions.unknown, 7);
        assert.deepEqual(paths, ['/api/plugins/st-new-updater/characters', '/api/plugins/st-new-updater/worlds', '/api/worldinfo/edit', '/api/plugins/st-new-updater/worlds', '/api/characters/get']);
    } finally { globalThis.fetch = original; }
});

test('old plugins fall back only on 404 and remember unsupported endpoints until reload', async () => {
    const original = globalThis.fetch, paths = [], api = new TavernAPI();
    globalThis.fetch = async path => { paths.push(path); return path.startsWith('/api/plugins/') ? new Response('', { status: 404 }) : Response.json([]); };
    try {
        for (const path of ['/api/characters/all', '/api/worldinfo/list']) {
            await api.post(path, {}, { signal: new AbortController().signal });
            await api.post(path, {}, { signal: new AbortController().signal });
        }
        assert.deepEqual(paths, ['/api/plugins/st-new-updater/characters', '/api/characters/all', '/api/characters/all', '/api/plugins/st-new-updater/worlds', '/api/worldinfo/list', '/api/worldinfo/list']);
        const broken = new TavernAPI(); paths.length = 0;
        globalThis.fetch = async path => { paths.push(path); return new Response('', { status: 500 }); };
        await assert.rejects(broken.post('/api/characters/all'), error => error.status === 500);
        assert.deepEqual(paths, ['/api/plugins/st-new-updater/characters']);
    } finally { globalThis.fetch = original; }
});
