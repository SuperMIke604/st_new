import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

test('the update menu installs while generating and still checks for unsaved edits', async t => {
    const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const guards = ['assertIdle', 'assertMessageEditClosed', 'assertSaved'].map(name =>
        source.match(new RegExp('^function ' + name + '\\([^\\n]*?(?:\\n[^\\n]*?)*?\\}(?=\\r?$)', 'm'))[0]);
    const menuEntry = source.split(/\r?\n/).find(line => line.trimStart().startsWith("['检查更新',"));
    const state = { busy: true };
    const notices = [];
    const revision = BUILD.revision === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    let remote = { schema: 1, revision: BUILD.revision };
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => remote }));
    const post = t.mock.fn(async route => route.endsWith('/status') ? { available: true } : { ok: true });
    const confirmFrontendUpdate = t.mock.fn(async () => { state.busy = true; return true; });
    const checkUpdate = runInNewContext(guards.join('\n') + '\n[' + menuEntry + '][0][2]', {
        state, api: { post }, confirmFrontendUpdate, notify: text => notices.push(text),
        variablesSaving: false, scriptRuntime: {}, inlineEdit: null, resolvingMessageEdit: false, panelDirty: false,
        manualUpdate: options => manualUpdate({ ...options, progress: () => ({ close() {} }) }),
    });
    await checkUpdate();
    assert.equal(notices.at(-1), '当前已是最新版本');
    assert.equal(confirmFrontendUpdate.mock.callCount(), 0);

    remote = { schema: 1, revision };
    await checkUpdate();
    assert.match(notices.at(-1), /更新完成.*聊天空闲.*刷新网页/);

    state.busy = false;
    await checkUpdate();
    assert.equal(state.busy, true);
    assert.equal(post.mock.calls.filter(call => call.arguments[0].endsWith('/install')).length, 2);

    state.dirty = true;
    await checkUpdate();
    assert.match(notices.at(-1), /发现新版本.*尚未保存/);
    assert.equal(confirmFrontendUpdate.mock.callCount(), 2);
    assert.ok(post.mock.calls.at(-1).arguments[0].endsWith('/status'));
});


test('manual update waits for the app dialog and does not install after cancellation', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const opened = Promise.withResolvers();
    const response = Promise.withResolvers();
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ schema: 1, revision: 'f'.repeat(64) }) });
    try {
        const running = manualUpdate({
            guard() {}, notify() {},
            confirmUpdate: question => { opened.resolve(question); return response.promise; },
            api: { post: async route => { calls.push(route); return { available: true }; } },
        });
        assert.match(await Promise.race([opened.promise, running]), /发现新版本/);
        assert.deepEqual(calls, ['/api/plugins/st-new-updater/status']);
        response.resolve(false);
        await running;
        assert.deepEqual(calls, ['/api/plugins/st-new-updater/status']);
    } finally { globalThis.fetch = originalFetch; }
});


test('installation progress remains active until install settles', async () => {
    const originalFetch=globalThis.fetch, originalConfirm=globalThis.confirm;
    let resolveInstall, closed=false;
    globalThis.fetch=async()=>({ok:true,json:async()=>({schema:1,revision:'e'.repeat(64)})});globalThis.confirm=()=>true;
    try {
        const running=manualUpdate({guard(){},notify(){},progress:()=>({close(){closed=true;}}),api:{post:async route=>route.endsWith('/status')?{available:true}:new Promise(resolve=>{resolveInstall=resolve;})}});
        while(!resolveInstall) await new Promise(resolve=>setImmediate(resolve));
        assert.equal(closed,false);resolveInstall({ok:true});await running;assert.equal(closed,true);
    } finally {globalThis.fetch=originalFetch;globalThis.confirm=originalConfirm;}
});

test('backend update is offered even when frontend revision matches, and restart is explained', async () => {
    const originalFetch = globalThis.fetch, originalConfirm = globalThis.confirm;
    const notices = [], questions = [], calls = [];
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...BUILD, backend: { sha256: 'a'.repeat(64) } }) });
    globalThis.confirm = text => { questions.push(text); return true; };
    try {
        await manualUpdate({ guard() {}, notify: text => notices.push(text), progress: () => ({ close() {} }), api: { post: async route => {
            calls.push(route); return route.endsWith('/status') ? { available: true, selfUpdate: true, installedHash: 'b'.repeat(64) } : { ok: true, restartRequired: true };
        } } });
        assert.equal(calls.length, 2); assert.match(questions[0], /前端与后端/); assert.match(notices.at(-1), /重启酒馆/);
    } finally { globalThis.fetch = originalFetch; globalThis.confirm = originalConfirm; }
});
test('legacy updater reports its one-time upgrade requirement instead of claiming backend is current', async () => {
    const originalFetch = globalThis.fetch;
    const notices = [], calls = [];
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...BUILD, backend: { sha256: 'a'.repeat(64) } }) });
    try {
        await manualUpdate({ guard() {}, notify: text => notices.push(text), api: { post: async route => { calls.push(route); return { available: true }; } } });
        assert.equal(calls.length, 1); assert.match(notices.at(-1), /一次安装脚本/);
    } finally { globalThis.fetch = originalFetch; }
});
