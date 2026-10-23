import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnection, modelOptions, inheritedConnection, visibleConnectionPassword, connectionProfiles, upsertConnection } from '../connection.js';
import { TavernAPI } from '../api.js';
test('profiles retain distinct endpoints, passwords and model options across refresh and switching', () => {
    const original = { version: 1, activeId: 'a', profiles: [{ id: 'a', name: '甲', url: 'https://a.example/v1', proxyPassword: 'sample-a', model: 'model-a', stream: false }] };
    const next = upsertConnection(original, { id: 'b', name: '乙', url: 'https://b.example/v1', proxyPassword: 'sample-b', model: 'model-b', stream: true });
    const read = connectionProfiles(JSON.parse(JSON.stringify(next)));
    assert.equal(read.activeId, 'b'); assert.equal(read.profiles[0].proxyPassword, 'sample-a'); assert.equal(read.profiles[1].proxyPassword, 'sample-b');
    assert.equal(read.profiles[0].url, 'https://a.example/v1'); assert.equal(read.profiles[0].stream, false);
    assert.equal(original.profiles.length, 1);
    read.activeId = 'missing'; assert.equal(connectionProfiles(read).activeId, 'a');
    assert.throws(() => connectionProfiles({ version: 1, profiles: [] }), /无效/);
    assert.throws(() => connectionProfiles({ version: 1, profiles: [{ id: 'a', url: 'https://a' }, { id: 'a', url: 'https://b' }] }), /重复/);
});
test('dedicated connection file uses UTF-8 and is independent from native settings saves', async () => {
    const api = new TavernAPI(); const oldFetch = globalThis.fetch;
    const data = { version: 1, activeId: 'a', profiles: [{ id: 'a', name: '连接一', url: 'https://a.example/v1', proxyPassword: 'sample' }] };
    let stored;
    api.post = async (path, body) => { assert.equal(path, '/api/files/upload'); assert.equal(body.name, 'independent-frontend-connections.json'); stored = JSON.parse(Buffer.from(body.data, 'base64').toString('utf8')); return { path: 'files/independent-frontend-connections.json' }; };
    globalThis.fetch = async (path, options) => { assert.equal(path, '/user/files/independent-frontend-connections.json'); assert.equal(options.cache, 'no-store'); return new Response(JSON.stringify(stored)); };
    try { await api.saveConnections(data); assert.deepEqual(await api.loadConnections(), data); }
    finally { globalThis.fetch = oldFetch; }
});
test('connection passwords survive refresh and native proxy passwords are matched to their own secret', () => {
    const settings = { oai_settings: { reverse_proxy: 'https://relay.example/v1', proxy_password: 'native-sample' } };
    const connection = { source: 'custom', url: 'https://relay.example/v1/', secretId: 'native-id' };
    const secrets = { api_key_custom: [{ id: 'native-id', label: '独立前端·原生反代' }] };
    assert.equal(visibleConnectionPassword(connection, settings, secrets), 'native-sample');
    assert.equal(visibleConnectionPassword({ ...connection, secretId: 'other-id' }, settings, secrets), '');
    assert.equal(visibleConnectionPassword({ ...connection, url: 'https://other.example/v1' }, settings, secrets), '');
    assert.equal(visibleConnectionPassword({ ...connection, proxyPassword: 'saved-sample' }, settings), 'saved-sample');
    assert.equal(visibleConnectionPassword(connection, settings, { api_key_custom: true }), '');
});
test('native reverse proxy is inherited instead of falling back to the official address', () => {
    const settings = { oai_settings: { chat_completion_source: 'openai', reverse_proxy: 'https://relay.example/v1', openai_model: 'test' } };
    assert.deepEqual(inheritedConnection(settings), { source: 'custom', url: 'https://relay.example/v1', model: 'test' });
    settings.independent_frontend = { connection: { source: 'custom', url: 'https://chosen.example/v1' } };
    assert.equal(inheritedConnection(settings).url, 'https://chosen.example/v1');
});

test('third-party URL uses custom backend and never reuses an official secret id', () => {
    const value = normalizeConnection({ source: 'openai', url: 'https://relay.example/v1/', model: ' test ', secretId: 'official-secret' });
    assert.deepEqual(value, { source: 'custom', url: 'https://relay.example/v1', model: 'test' });
});
test('normalizes endpoint suffixes and preserves proxy paths and custom credentials', () => {
    for (const suffix of ['/models', '/chat/completions/']) {
        const value = normalizeConnection({ source: 'custom', url: 'https://relay.example/proxy/v1' + suffix, secretId: 'custom-secret' });
        assert.equal(value.url, 'https://relay.example/proxy/v1'); assert.equal(value.secretId, 'custom-secret');
    }
    assert.equal(normalizeConnection({ source: 'openai', url: 'https://api.openai.com/v1' }).source, 'openai');
    assert.throws(() => normalizeConnection({ source: 'custom', url: '' }), /基础地址/);
    assert.throws(() => normalizeConnection({ source: 'custom', url: 'file:///private' }), /HTTP/);
});
test('model lists accept common formats and reject backend error envelopes and empty lists', () => {
    assert.deepEqual(modelOptions({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] }), [['a', 'a'], ['b', 'b']]);
    assert.deepEqual(modelOptions({ models: [{ name: 'a' }] }), [['a', 'a']]);
    assert.deepEqual(modelOptions(['a']), [['a', 'a']]);
    assert.throws(() => modelOptions({ error: true, data: { data: [] } }), /读取模型失败/);
    assert.throws(() => modelOptions({ data: [] }), /空模型/);
});
