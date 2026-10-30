import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings, requestFailure } from '../load-timings.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const generate = source.slice(source.indexOf('async function generate('), source.indexOf('\nfunction beginMessageEdit('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ native = false } = {}) {
    const prepared = deferred(), response = deferred(), statuses = [], renders = [], notices = [], postGeneration = [];
    const state = { character: { name: '角色' }, chat: [{ name: '角色', mes: '原来的回复', extra: {} }], preset: {}, own: {}, dirty: false };
    const input = { value: '测试消息' };
    let requests = 0; const mvuCalls = [], helperEvents = [], saved = [];
    const scriptRuntime = { generate: (body, { signal, fetch }) => fetch(body, signal), helperReady: native, frame: native ? {} : null, identity: 'test', dispatch: async (event, args) => {
        helperEvents.push(event);
        if (native && event === 'message_received') {
            const message = state.chat[args[0]];
            assert.equal(state.busy, true); assert.match(message.mes, /<UpdateVariable>/);
            (message.variables ||= {})[message.swipe_id || 0] = { stat_data: { score: 5 } };
            message.mes += '\n<StatusPlaceHolderImpl/>';
        }
        return native;
    } };
    const timings = new LoadTimings();
    const context = vm.createContext({ state, loadTimings: timings, requestFailure, copy: structuredClone, AbortController, setTimeout, clearTimeout, streamFrame: 0,
        $: () => input, persona: () => ({ name: '用户' }), connection: () => ({ model: 'test' }), generationBody: () => ({}),
        assertIdle() { assert.ok(!state.busy); }, assertSaved() {}, synchronize() {}, status: text => statuses.push(text),
        regexText: text => native ? text.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g, '') : text, resizeInput() {}, preparePrompt: () => prepared.promise,
        list: { follow: true, update() {}, setMessages() { renders.push(state.chat.map(message => ({ text: message.mes, pending: state.generation?.reply === message }))); } },
        api: { response() { requests++; return response.promise; } },
        readEvents: response => response.events,
        generationPreload: { cancelScheduled() {} }, preloadNextGeneration: () => postGeneration.push('preload'),
        nativeScriptPlan: () => native ? [{ enabled: true }] : [], scriptSupport: () => ({ adapter: 'remote-module', supported: true }), scriptSnapshot: () => ({}), scriptIdentity: () => 'test', scriptRuntime,
        prepareRoleMvu: async (...args) => { mvuCalls.push(args); assert.equal(state.busy, true); return { changed: false }; },
        saveChat: async () => { saved.push(structuredClone(state.chat)); }, rememberChat: async () => {}, autoUpdateDatabase: async () => { postGeneration.push('database'); }, notify: text => notices.push(text),
    });
    vm.runInContext(generate, context);
    return { state, input, prepared, response, statuses, renders, notices, postGeneration, mvuCalls, helperEvents, saved, timings, requests: () => requests, run: mode => vm.runInContext(`generate(${mode === true ? 'true' : 'false'})`, context) };
}

test('send stays busy through prompt preparation and first response, then clears the placeholder', async () => {
    const f = fixture(), running = f.run(false);
    assert.equal(f.state.busy, true);
    assert.equal(f.state.generation.regenerate, false);
    assert.match(f.statuses.at(-1), /发送消息.*准备上下文/);
    assert.equal(f.requests(), 0);
    f.prepared.resolve({ messages: [] }); await tick();
    assert.match(f.statuses.at(-1), /等待回复/);
    assert.equal(f.renders.at(-1).at(-1).pending, true);
    assert.equal(f.renders.at(-1).at(-1).text, '');
    assert.equal(f.requests(), 1);
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: '测试回复' } }] }) });
    await running;
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.equal(f.state.chat.at(-1).mes, '测试回复');
    assert.equal(f.renders.at(-1).at(-1).pending, false);
    assert.deepEqual(f.postGeneration, ['database', 'preload'], 'warm resources only after saving and automatic database updates');
    assert.equal(f.mvuCalls.length, 2); assert.equal(f.mvuCalls[0][0], true); assert.equal(f.mvuCalls[0][1], undefined); assert.equal(f.mvuCalls[1][1].text, '测试回复');
});

test('stopping regeneration clears loading and restores the previous reply', async () => {
    const f = fixture(); f.state.chat.at(-1).extra.reasoning = '上次的思考';
    const running = f.run(true);
    assert.match(f.statuses.at(-1), /重新生成.*准备上下文/);
    assert.equal(f.state.chat.at(-1).mes, '原来的回复');
    f.prepared.resolve({ messages: [] }); await tick();
    assert.equal(f.state.generation.regenerate, true);
    assert.equal(f.state.generation.reply.extra.reasoning, undefined, 'old reasoning must not hide the waiting indicator');
    assert.match(f.statuses.at(-1), /重新生成.*等待回复/);
    f.state.controller.abort(); f.response.reject(new DOMException('stopped', 'AbortError'));
    await running;
    assert.equal(f.state.chat.at(-1).mes, '原来的回复');
    assert.equal(f.state.chat.at(-1).extra.reasoning, '上次的思考');
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.match(f.notices.at(-1), /生成已停止/);
    assert.deepEqual(f.postGeneration, []);
    assert.equal(f.mvuCalls.length, 1, 'initialize existing state before the request, but never apply an aborted reply');
    const modelRecords = f.timings.snapshot().filter(entry => entry.label.startsWith('模型请求至'));
    assert.equal(modelRecords.length, 3);
    assert.ok(modelRecords.every(entry => entry.status === 'cancelled'));
});

test('stream diagnostics distinguish response headers, first reasoning text and stream completion', async () => {
    const f = fixture(), tail = deferred(), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers({ 'content-type': 'text/event-stream' }), events: (async function* () {
        yield { choices: [{ delta: { reasoning_content: 'private reasoning' } }] };
        await tail.promise;
        yield { choices: [{ delta: { content: 'private reply' } }] };
    })() });
    await tick();
    const record = label => f.timings.snapshot().find(entry => entry.label === label);
    assert.equal(record('模型请求至响应头').status, 'success');
    assert.equal(record('模型请求至首段文本（含思考）').status, 'success');
    assert.equal(record('模型请求至回复接收完成').status, 'loading');
    tail.resolve(); await running;
    assert.equal(record('模型请求至回复接收完成').status, 'success');
    assert.ok(f.timings.snapshot().every(entry => entry.status !== 'loading'));
    assert.ok(!JSON.stringify(f.timings.snapshot()).includes('private'));
});

test('prompt failure clears loading without sending a request or losing the input', async () => {
    const f = fixture(), running = f.run(false);
    f.prepared.reject(new Error('上下文准备失败')); await running;
    assert.equal(f.requests(), 0);
    assert.equal(f.input.value, '测试消息');
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.equal(f.notices.at(-1), '上下文准备失败');
    assert.deepEqual(f.postGeneration, []);
});

test('native helper receives raw model text before output regex and its saved variables survive final rendering', async () => {
    const f = fixture({ native: true }), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await running;
    assert.deepEqual(f.helperEvents, ['generation_started', 'message_sent', 'message_received', 'generation_ended']);
    assert.equal(f.state.chat.at(-1).variables[0].stat_data.score, 5);
    assert.ok(!f.state.chat.at(-1).mes.includes('<UpdateVariable>'));
    assert.ok(f.state.chat.at(-1).mes.includes('<StatusPlaceHolderImpl/>'));
    assert.ok(f.saved.some(chat => chat.at(-1).mes.includes('<UpdateVariable>')), 'raw reply must exist in persistent chat before helper writes');
    assert.equal(f.saved.at(-1).at(-1).variables[0].stat_data.score, 5);
});
test('regeneration allocates exactly one new branch and retains original text and variables when the helper edits the new reply', async () => {
    const f = fixture({ native: true }); f.state.chat[0].variables = { 0: { stat_data: { score: 2 } } };
    const running = f.run(true); f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'new reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await running;
    const message = f.state.chat[0];
    assert.equal(message.swipes.length, 2); assert.equal(message.swipe_id, 1); assert.equal(message.swipes[0], '原来的回复');
    assert.equal(message.variables[0].stat_data.score, 2); assert.equal(message.variables[1].stat_data.score, 5);
    assert.equal(message.swipes[1], message.mes);
});
