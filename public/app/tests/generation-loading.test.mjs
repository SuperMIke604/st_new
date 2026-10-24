import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings } from '../load-timings.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const generate = source.slice(source.indexOf('async function generate('), source.indexOf('\nfunction messageActions('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const prepared = deferred(), response = deferred(), statuses = [], renders = [], notices = [];
    const state = { character: { name: '角色' }, chat: [{ name: '角色', mes: '原来的回复', extra: {} }], preset: {}, own: {}, dirty: false };
    const input = { value: '测试消息' };
    let requests = 0;
    const context = vm.createContext({ state, loadTimings: new LoadTimings(), copy: structuredClone, AbortController, setTimeout, clearTimeout, streamFrame: 0,
        $: () => input, persona: () => ({ name: '用户' }), connection: () => ({ model: 'test' }), generationBody: () => ({}),
        assertIdle() { assert.ok(!state.busy); }, assertSaved() {}, synchronize() {}, status: text => statuses.push(text),
        regexText: text => text, resizeInput() {}, preparePrompt: () => prepared.promise,
        list: { follow: true, update() {}, setMessages() { renders.push(state.chat.map(message => ({ text: message.mes, pending: state.generation?.reply === message }))); } },
        api: { response() { requests++; return response.promise; } },
        saveChat: async () => {}, rememberChat: async () => {}, autoUpdateDatabase: async () => {}, notify: text => notices.push(text),
    });
    vm.runInContext(generate, context);
    return { state, input, prepared, response, statuses, renders, notices, requests: () => requests, run: mode => vm.runInContext(`generate(${mode === true ? 'true' : 'false'})`, context) };
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
});

test('prompt failure clears loading without sending a request or losing the input', async () => {
    const f = fixture(), running = f.run(false);
    f.prepared.reject(new Error('上下文准备失败')); await running;
    assert.equal(f.requests(), 0);
    assert.equal(f.input.value, '测试消息');
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.equal(f.notices.at(-1), '上下文准备失败');
});
