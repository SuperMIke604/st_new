import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCharacterRegexes } from '../regex.js';

test('character regex saves accept native OK and object responses and read back uncached data', async () => {
    for (const response of ['OK', { ok: true }]) {
        for (const rules of [[], [{ id: 'a', disabled: true, custom: { keep: 42 } }], [{ id: 'b' }, { id: 'a' }]]) {
            const calls = [], extensions = { regex_scripts: structuredClone(rules), tavern_helper: { variables: { keep: true }, scripts: [{ content: 'void 0' }] }, unknown: true };
            const card = { data: { extensions } };
            const api = { post: async (path, body, options) => { calls.push({ path, body, options }); return path.endsWith('/get') ? card : response; } };
            const saved = await saveCharacterRegexes(api, 'card.png', rules);
            assert.equal(saved, card);
            assert.deepEqual(calls[0], { path: '/api/characters/merge-attributes', body: { avatar: 'card.png', data: { extensions: { regex_scripts: rules } } }, options: undefined });
            assert.notEqual(calls[0].body.data.extensions.regex_scripts, rules);
            assert.equal(calls[1].path, '/api/characters/get');
            assert.deepEqual(calls[1].body, { avatar_url: 'card.png' });
            assert.ok(calls[1].options.signal instanceof AbortSignal);
            assert.deepEqual(extensions.tavern_helper, { variables: { keep: true }, scripts: [{ content: 'void 0' }] });
            assert.equal(extensions.unknown, true);
        }
    }
});

test('character regex saves reject unsuccessful responses before reading the card', async () => {
    for (const response of [null, {}, { ok: false }, 'failed']) {
        let calls = 0;
        await assert.rejects(saveCharacterRegexes({ post: async () => { calls++; return response; } }, 'card.png', []), /正则保存失败/);
        assert.equal(calls, 1);
    }
});

test('character regex saves reject a successful response if the persisted rules differ', async () => {
    await assert.rejects(saveCharacterRegexes({ post: async path => path.endsWith('/get') ? { data: { extensions: { regex_scripts: [] } } } : 'OK' }, 'card.png', [{ id: 'missing' }]), /核验失败/);
    for (const card of [null, {}, { data: { extensions: {} } }]) {
        await assert.rejects(saveCharacterRegexes({ post: async path => path.endsWith('/get') ? card : 'OK' }, 'card.png', []), /核验失败/);
    }
    const failure = Error('write failed');
    await assert.rejects(saveCharacterRegexes({ post: async () => { throw failure; } }, 'card.png', []), error => error === failure);
    await assert.rejects(saveCharacterRegexes({ post: async path => { if (path.endsWith('/get')) throw failure; return 'OK'; } }, 'card.png', []), error => error === failure);
});
