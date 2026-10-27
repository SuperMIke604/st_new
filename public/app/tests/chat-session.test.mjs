import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings } from '../load-timings.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function openCharacter('), source.indexOf('async function chatsPanel('));
function fixture(post, failSettings = false) {
    const state = { character: { avatar: 'A.png', name: 'A' }, file: 'A-chat', header: { chat_metadata: { integrity: 'A-integrity' } }, chat: [{ mes: 'A private chat' }], own: {}, settings: {}, saves: Promise.resolve() };
    const input = { value: 'unsent draft' }, writes = [], patches = [], rendered = [], loading = [], stages = [], preloads = [], cancellations = [];
    const context = vm.createContext({ state, loadTimings: new LoadTimings(), copy: structuredClone, api: { post, saveChat: async (...args) => writes.push(args) },
        assertSaved() {}, synchronize() { loading.push(!!state.loading); }, status: text => stages.push(text), uuid: () => 'new-id', safeName: value => value,
        persona: () => ({ name: 'User' }), $: () => input, clearWelcome() {},
        list: { setMessages: chat => rendered.push(chat) }, recentCharacters: { invalidate() {} },
        sessionStorage: { getItem: () => null, setItem() {} }, generationPreload: { invalidate() {}, cancelScheduled() { cancellations.push(state.chat); } },
        preloadNextGeneration() { preloads.push({ chat: state.chat, character: state.character, loading: state.loading, patches: patches.length }); },
        saveOwn: async patch => { if (failSettings) throw Error('settings offline'); patches.push(structuredClone(patch)); Object.assign(state.own, patch); },
    });
    vm.runInContext(functions, context);
    return { state, input, writes, patches, rendered, loading, stages, preloads, cancellations, run: code => vm.runInContext(code, context) };
}
const card = { avatar: 'B.png', name: 'B', data: { first_mes: '**欢迎**' } };
const chatData = [{ chat_metadata: { integrity: 'B-integrity' } }, { mes: 'B message' }];
function postWithChat(load) {
    return async path => path === '/api/characters/get' ? card : path === '/api/characters/chats' ? [{file_name:'B-chat.jsonl', last_mes:1}] : load();
}
test('failed or malformed chat load preserves the complete old session, draft and next save target', async () => {
    for (const load of [() => { throw Error('chat offline'); }, () => ({error:true})]) {
        const f = fixture(postWithChat(load));
        const before = { ...f.state };
        await assert.rejects(f.run("openCharacter('B.png')"));
        for (const key of ['character', 'file', 'header', 'chat']) assert.equal(f.state[key], before[key]);
        assert.equal(f.input.value, 'unsent draft'); assert.equal(f.rendered.length, 0);
        assert.equal(f.state.loading, false);
        assert.equal(f.preloads.length, 0, 'failed loading must not warm the old chat');
        await f.run('saveChat()');
        assert.equal(f.writes[0][0], 'A.png'); assert.equal(f.writes[0][1], 'A-chat');
        assert.equal(f.writes[0][3][0].mes, 'A private chat');
    }
});
test('character reads overlap, session commits after chat read, and selection saves only once', async () => {
    const calls = [], pending = new Map();
    const f = fixture(path => { calls.push(path); return new Promise(resolve => pending.set(path, resolve)); });
    const opening = f.run("openCharacter('B.png')");
    assert.deepEqual(calls, ['/api/characters/get', '/api/characters/chats']);
    pending.get(calls[0])(card); pending.get(calls[1])([{file_name:'B-chat.jsonl',last_mes:1}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.character.avatar, 'A.png');
    pending.get('/api/chats/get')(chatData);
    await opening;
    assert.equal(f.state.character.avatar, 'B.png'); assert.equal(f.state.file, 'B-chat');
    assert.equal(f.state.header.chat_metadata.integrity, 'B-integrity');
    assert.equal(f.state.chat[0].mes, 'B message'); assert.equal(f.input.value, '');
    assert.equal(f.patches.length, 1);
    assert.equal(f.patches[0].lastCharacter, 'B.png'); assert.equal(f.patches[0].lastChats['B.png'], 'B-chat');
    assert.equal(f.loading[0], true); assert.equal(f.loading.at(-1), false);
    assert.ok(f.stages.includes('读取聊天记录…'));
    assert.ok(f.stages.includes('正在保存聊天位置…'));
    assert.equal(f.cancellations.length, 1);
    assert.equal(f.preloads.length, 1, 'internal load must not schedule a duplicate warmup');
    assert.equal(f.preloads[0].chat, f.state.chat);
    assert.equal(f.preloads[0].character, f.state.character);
    assert.equal(f.preloads[0].loading, false);
    assert.equal(f.preloads[0].patches, 1, 'warm only after selection persistence completes');
});
test('preference save failure leaves a coherent loaded session', async () => {
    const f = fixture(postWithChat(() => chatData), true);
    await assert.rejects(f.run("openCharacter('B.png')"), /settings offline/);
    assert.equal(f.state.character.avatar, 'B.png'); assert.equal(f.state.file, 'B-chat');
    assert.equal(f.state.chat[0].mes, 'B message'); assert.equal(f.state.loading, false);
    assert.equal(f.loading.at(-1), false, 'a failed preference save must dismiss the loading overlay');
    assert.equal(f.preloads.length, 0);
});

test('switching history and opening a new chat warm the committed session without focusing the input', async () => {
    const f = fixture(async () => chatData);
    const old = f.state.chat;
    await f.run("loadChat('other-chat')");
    assert.equal(f.cancellations[0], old);
    assert.equal(f.preloads.length, 1);
    assert.equal(f.preloads[0].chat, f.state.chat);
    assert.equal(f.preloads[0].loading, false);
    await f.run('loadChat(null)');
    assert.equal(f.preloads.length, 2);
    assert.equal(f.preloads[1].chat, f.state.chat);
    assert.equal(f.preloads[1].loading, false);
});
test('new character greeting and repeated selection do not require redundant settings writes', async () => {
    const f = fixture(async path => path === '/api/characters/get' ? card : []);
    await f.run("openCharacter('B.png')");
    assert.equal(f.state.chat[0].mes, '**欢迎**'); assert.equal(f.patches.length, 1);
    await f.run("openCharacter('B.png')");
    assert.equal(f.patches.length, 1);
});
