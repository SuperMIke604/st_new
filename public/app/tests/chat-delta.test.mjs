import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError, TavernAPI } from '../api.js';
import { chatDelta, chatLines } from '../chat-delta.js';

const header = { chat_metadata: { integrity: 'keep' } };
const history = { mes: '历史正文', extra: { unknown: 'keep' } };
const user = { mes: '最新消息', is_user: true };
const revision = records => createHash('sha256').update(records.map(item => JSON.stringify(item)).join('\n')).digest('hex');

test('plain HTTP uses the same revision for Unicode without Web Crypto', async () => {
    const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
        const delta = await chatDelta(chatLines([header, history]), chatLines([header, history, user]));
        assert.equal(delta.base, revision([header, history]));
        assert.equal(delta.result, revision([header, history, user]));
    } finally {
        if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
        else delete globalThis.crypto;
    }
});

test('new messages and script changes use the last confirmed revision and send only the delta', async () => {
    const api = new TavernAPI(), posts = [];
    api.rememberChatBase('card.png', 'chat', [header, history]);
    api.post = async (path, payload) => {
        posts.push({ path, payload });
        return { ok: true, revision: payload.result };
    };
    await api.saveChat('card.png', 'chat', header, [history, user], { incremental: true });
    assert.deepEqual(posts[0], { path: '/api/plugins/st-new-updater/chat-delta', payload: {
        avatar_url: 'card.png', file_name: 'chat', base: revision([header, history]), result: revision([header, history, user]),
        patches: [], append: [user],
    } });
    const changed = { ...user, variables: { 0: { score: 5 } } };
    assert.equal(await api.trySaveChatDelta('card.png', 'chat', [header, history, changed]), true);
    assert.deepEqual(posts[1].payload.patches, [{ index: 2, fields: { variables: changed.variables }, remove: [] }]);
    assert.deepEqual(posts[1].payload.append, []);
    assert.equal(posts[1].payload.base, posts[0].payload.result);
});

test('unsupported plugins fall back once; revision conflicts never trigger an overwrite', async () => {
    for (const status of [404, 409, 500]) {
        const api = new TavernAPI(), paths = [];
        api.rememberChatBase('card.png', 'chat', [header, history]);
        api.post = async path => {
            paths.push(path);
            if (path.endsWith('chat-delta')) throw new ApiError('failed', status);
            return { ok: true };
        };
        const save = api.saveChat('card.png', 'chat', header, [history, user], { incremental: true });
        if (status === 404) {
            await save;
            assert.deepEqual(paths, ['/api/plugins/st-new-updater/chat-delta', '/api/chats/save']);
            assert.equal(api.canSaveChatDelta('card.png', 'chat'), false);
        } else {
            await assert.rejects(save, { status, chatDelta: true });
            assert.deepEqual(paths, ['/api/plugins/st-new-updater/chat-delta']);
        }
    }
});
