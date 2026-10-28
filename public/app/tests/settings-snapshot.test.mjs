import test from 'node:test';
import assert from 'node:assert/strict';
import { TavernAPI } from '../api.js';
import { loadTimings } from '../load-timings.js';

test('lightweight settings writes and readback stay fresh and preserve unknown fields', async () => {
    const original = globalThis.fetch, paths = [];
    let stored = { unknown: { keep: 42 }, extension_settings: { independent_frontend: {} } };
    globalThis.fetch = async (url, options) => {
        paths.push(url);
        if (url === '/api/settings/save') { stored = JSON.parse(options.body); return Response.json({ result: 'ok' }); }
        assert.equal(url, '/api/plugins/st-new-updater/settings');
        return Response.json({ settings: stored });
    };
    try {
        const api = new TavernAPI();
        await Promise.all([
            api.patchSettings(s => { s.extension_settings.independent_frontend.lastCharacter = 'A'; }, { source: '保存聊天位置设置' }),
            api.patchSettings(s => { s.extension_settings.independent_frontend.lastChats = { A: 'chat' }; }),
        ]);
        stored.externalEdit = true;
        const readback = await api.settings({ lightweight: true, source: '核验聊天位置设置' });
        assert.deepEqual(readback.settings, stored);
        assert.deepEqual(stored.extension_settings.independent_frontend, { lastCharacter: 'A', lastChats: { A: 'chat' } });
        assert.equal(stored.unknown.keep, 42);
        assert.equal(paths.filter(p => p === '/api/plugins/st-new-updater/settings').length, 3);
        assert.equal(paths.filter(p => p === '/api/settings/save').length, 2);
        assert.ok(loadTimings.snapshot().some(e => e.label === '核验聊天位置设置' && e.status === 'success'));
        assert.ok(loadTimings.snapshot().some(e => e.label.includes('settings · 接收响应体') && e.metrics.responseChars > 0));
    } finally { globalThis.fetch = original; }
});

test('missing settings endpoint falls back once and bypasses cached native bundles', async () => {
    const original = globalThis.fetch, paths = [];
    let version = 0;
    globalThis.fetch = async url => {
        paths.push(url);
        return url.startsWith('/api/plugins/') ? new Response('', { status: 404 }) : Response.json({ settings: { version: ++version }, openai_settings: ['preset'] });
    };
    try {
        const api = new TavernAPI();
        assert.equal((await api.settings()).settings.version, 1);
        assert.equal((await api.settings({ lightweight: true })).settings.version, 2);
        assert.equal((await api.settings({ lightweight: true })).settings.version, 3);
        assert.equal(paths.filter(p => p.startsWith('/api/plugins/')).length, 1);
        assert.equal((await api.settings()).bundle.openai_settings[0], 'preset');
    } finally { globalThis.fetch = original; }
});

test('failed or corrupt snapshots never fall back or write settings', async () => {
    const original = globalThis.fetch;
    try {
        for (const response of [() => new Response('', { status: 500 }), () => Response.json({ settings: 'broken' }), () => Response.json({ settings: [] }), () => Response.json(null)]) {
            const paths = [];
            globalThis.fetch = async url => { paths.push(url); return response(); };
            await assert.rejects(new TavernAPI().patchSettings(s => { s.changed = true; }));
            assert.deepEqual(paths, ['/api/plugins/st-new-updater/settings']);
        }
    } finally { globalThis.fetch = original; }
});
