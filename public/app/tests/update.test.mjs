import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, manualUpdate, UPDATE_URL } from '../update.js';
import { BUILD } from '../version.js';

test('same build is silent and anonymous update checks bypass browser cache', async () => {
    let observed;
    const result = await checkForUpdate({ fetcher: async (url, options) => { observed = { url, options }; return { ok: true, json: async () => BUILD }; } });
    assert.equal(result, null);
    assert.ok(observed.url.startsWith(UPDATE_URL + '?t='));
    assert.equal(observed.options.cache, 'no-store');
    assert.equal(observed.options.credentials, 'omit');
});
test('different build returns a notice candidate without executing remote content', async () => {
    const remote = { schema: 1, revision: BUILD.revision === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64) };
    assert.deepEqual(await checkForUpdate({ fetcher: async () => ({ ok: true, json: async () => remote }) }), remote);
});
test('network and malformed manifests fail explicitly', async () => {
    await assert.rejects(checkForUpdate({ fetcher: async () => ({ ok: false, status: 404 }) }), /404/);
    await assert.rejects(checkForUpdate({ fetcher: async () => ({ ok: true, json: async () => ({ revision: 'bad' }) }) }), /格式无效/);
    await assert.rejects(checkForUpdate({ fetcher: async () => { throw Error('offline'); } }), /offline/);
});


test('canceling manual confirmation never installs an update', async () => {
    const originalFetch = globalThis.fetch, originalConfirm = globalThis.confirm;
    const calls = [];
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ schema: 1, revision: 'f'.repeat(64) }) });
    globalThis.confirm = () => false;
    try {
        await manualUpdate({ guard() {}, notify() {}, api: { post: async route => { calls.push(route); return { available: true }; } } });
        assert.deepEqual(calls, ['/api/plugins/st-new-updater/status']);
    } finally { globalThis.fetch = originalFetch; globalThis.confirm = originalConfirm; }
});
