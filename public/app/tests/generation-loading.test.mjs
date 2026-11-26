import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings, requestFailure } from '../load-timings.js';
import { RequestLog } from '../request-log.js';
import { sealedOpeningVariables } from '../html-opening.js';
import { sendDelaySeconds } from '../reading.js';

const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const generate = source.slice(source.indexOf('function waitForPageVisibility('), source.indexOf('\nfunction beginMessageEdit('));
const waitingPresentation = source.slice(source.indexOf('function setReplyWaiting('), source.indexOf('function synchronize('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ native = false, hideAfterReplyEvent = false, conflict = false, background = false, androidSendDelay, timeoutWhileWriting = false, intercept = body => body } = {}) {
    const prepared = deferred(), response = deferred(), statuses = [], renders = [], scrollModes = [], notices = [], postGeneration = [];
    const state = { character: { name: '角色', avatar: 'fixture.png' }, file: 'fixture', settings: {}, chat: [{ name: '角色', mes: '原来的回复', extra: {} }], preset: {}, own: {}, dirty: false };
    const input = { value: '测试消息' };
    const stopClasses = new Set(), stopAttributes = new Map();
    const stop = {
        classList: { toggle: (name, present) => present ? stopClasses.add(name) : stopClasses.delete(name) },
        setAttribute: (name, value) => stopAttributes.set(name, value),
    };
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const window = Object.assign(new EventTarget(), { stNewAndroidSendDelay: androidSendDelay });
    Object.defineProperty(document, 'hidden', { get: () => document.visibilityState === 'hidden' });
    const setVisibility = visibility => { document.visibilityState = visibility; document.dispatchEvent(new Event('visibilitychange')); };
    const storage = new Map(), backgroundCalls = [], releases = [];
    let requests = 0; const mvuCalls = [], helperEvents = [], saved = [], promptHistory = [], saveOptions = [];
    const scriptRuntime = { generate: (body, { signal, fetch }) => fetch(intercept(body), signal), helperReady: native, frame: native ? {} : null, identity: 'test', auxiliaryControllers: new Map(), refresh() {}, dispatch: async (event, args) => {
        helperEvents.push(event);
        if (native && event === 'message_received') {
            const message = state.chat[args[0]];
            assert.equal(state.busy, true); assert.match(message.mes, /<UpdateVariable>/);
            if (timeoutWhileWriting) {
                state.replyScriptEvent.writePending = true;
                throw new DOMException('超时', 'TimeoutError');
            }
            (message.variables ||= {})[message.swipe_id || 0] = { stat_data: { score: 5 } };
            message.mes += '\n<StatusPlaceHolderImpl/>';
            if (hideAfterReplyEvent) setVisibility('hidden');
        }
        return native;
    } };
    const timings = new LoadTimings();
    const context = vm.createContext({ state, document, window, requestLog: new RequestLog(), loadTimings: timings, requestFailure, copy: structuredClone, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, streamFrame: 0, sealedOpeningVariables, sendDelaySeconds,
        $: id => id === 'stop-button' ? stop : input, persona: () => ({ name: '用户' }), connection: () => ({ model: 'test' }), generationBody: () => ({ stream: true }),
        assertIdle() { assert.ok(!state.busy); }, assertSaved() {}, synchronize() {}, scriptSchema: {},
        nextPaint: () => Promise.resolve(), status: text => statuses.push(text),
        regexText: text => native ? text.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g, '') : text, resizeInput() {},
        preparePrompt: chat => { promptHistory.push(Array.from(chat, message => message.mes)); return prepared.promise; },
        list: { follow: true, update() {}, setMessages(messages, { latest } = {}) {
            if (state.generation?.reply) assert.equal(requests, 1, 'start the request before repainting the chat');
            scrollModes.push(latest);
            renders.push(context.visibleChatMessages(messages).map(message => ({ text: message.mes, pending: state.generation?.reply === message })));
        } },
        api: {
            chatBase: { avatar: state.character.avatar, file: state.file, lines: [] },
            response() { requests++; return response.promise; },
        },
        localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
        usesBackgroundGeneration: () => background,
        chatRevision: async () => 'a'.repeat(64),
        releaseBackgroundGeneration: async (_api, id) => releases.push({ id, saves: saved.length }),
        chatGenerationResponse: (api, body, signal, options) => {
            backgroundCalls.push(options);
            return api.response('/api/backends/chat-completions/generate', body, { signal });
        },
        readEvents: response => response.events,
        generationPreload: { cancelScheduled() {} }, preloadNextGeneration: () => postGeneration.push('preload'),
        nativeScriptPlan: () => native ? [{ enabled: true }] : [], scriptSupport: () => ({ adapter: 'remote-module', supported: true }), scriptSnapshot: () => ({}), scriptIdentity: () => 'test', scriptRuntime,
        prepareRoleMvu: async (...args) => { mvuCalls.push(args); assert.equal(state.busy, true); return { changed: false }; },
        saveChat: async options => {
            saveOptions.push(options);
            if (conflict) { state.chatConflict = '聊天已变化'; throw new Error(state.chatConflict); }
            saved.push(structuredClone(state.chat));
        },
        rememberChat: async () => {}, autoUpdateDatabase: async () => { postGeneration.push('database'); }, notify: text => notices.push(text),
    });
    vm.runInContext(waitingPresentation + generate, context);
    return { state, input, window, storage, backgroundCalls, releases, prepared, response, statuses, renders, scrollModes, notices, postGeneration, mvuCalls, helperEvents, saved, promptHistory, saveOptions, timings, stopClasses, stopAttributes, requestLog: context.requestLog, setVisibility, requests: () => requests, run: (mode, options) => context.generate(mode, null, options) };
}

test('composer submit immediately shows the card and waits five seconds before generation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture({ native: true });
    const running = f.run(false, { delaySend: true });
    assert.equal(f.input.value, '');
    assert.equal(f.renders.at(-1).at(-1).text, '测试消息');
    assert.equal(f.scrollModes.at(-1), true);
    assert.equal(f.state.chat.length, 1, 'the pending card does not change the saved chat or script snapshot');
    f.input.value = '下一条草稿';
    await assert.rejects(f.run(false, { delaySend: true }));
    t.mock.timers.tick(4999);
    await tick();
    assert.equal(f.timings.snapshot().find(entry => entry.label === '挂载待发送消息卡片').status, 'success');
    assert.equal(f.timings.snapshot().find(entry => entry.label === '待发送消息卡片至下一次绘制机会').status, 'success');
    assert.equal(f.timings.snapshot().find(entry => entry.label === '等待发送（5 秒）').status, 'loading');
    assert.equal(f.state.busy, true);
    assert.equal(f.stopAttributes.get('aria-label'), '正在准备发送，停止生成');
    assert.deepEqual(f.helperEvents, []);
    assert.deepEqual(f.saveOptions, []);
    assert.deepEqual(f.promptHistory, []);
    assert.equal(f.requests(), 0);
    t.mock.timers.tick(1);
    f.prepared.resolve({ messages: [] });
    await tick();
    assert.equal(f.input.value, '下一条草稿');
    assert.deepEqual(f.helperEvents, ['generation_started', 'message_sent']);
    assert.equal(f.requests(), 1);
    assert.equal(f.scrollModes.at(-1), false, 'request start preserves the scroll position after the preview');
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: '模拟回复<UpdateVariable></UpdateVariable>' } }] }) });
    await running;
    assert.equal(f.state.chat.filter(message => message.is_user).length, 1);
    assert.equal(f.scrollModes.at(-1), 'top');
    assert.equal(f.requests(), 1);
});

test('composer honors custom delay and zero skips the timer', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const sendDelay of [2, 0]) {
        const f = fixture();
        f.state.own.reading = { sendDelay };
        f.prepared.resolve({ messages: [] });
        const running = f.run(false, { delaySend: true });
        assert.equal(f.renders.at(-1).at(-1).text, '测试消息');
        if (sendDelay) {
            t.mock.timers.tick(1999);
            await tick();
            assert.equal(f.requests(), 0);
            t.mock.timers.tick(1);
        }
        await tick();
        assert.equal(f.requests(), 1);
        f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: '模拟回复' } }] }) });
        await running;
    }
});

test('stopping or leaving during the delay keeps the user card and cancels model generation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const pageHidden of [false, true]) {
        let released = 0;
        let ready;
        const f = fixture({ native: true, androidSendDelay: (_delay, callback) => {
            ready = callback;
            return () => { released++; };
        } });
        const message = '保留这条消息';
        f.input.value = message;
        const running = f.run(false, { delaySend: true });
        if (pageHidden) f.window.dispatchEvent(new Event('pagehide'));
        else f.state.controller.abort(new DOMException('user-stop', 'AbortError'));
        await running;
        ready();
        t.mock.timers.tick(5000);
        assert.equal(released, 1);
        assert.equal(f.state.busy, false);
        assert.equal(f.input.value, '');
        assert.deepEqual(f.notices, pageHidden ? [] : ['发送已取消']);
        assert.deepEqual(f.helperEvents, []);
        assert.equal(f.saveOptions.length, 1);
        assert.equal(f.saved[0].at(-1).mes, message);
        assert.equal(f.state.chat.length, 2);
        assert.equal(f.renders.at(-1).at(-1).text, message);
        assert.notEqual(f.scrollModes.at(-1), 'top');
        assert.equal(f.requests(), 0);
    }
});

test('APK countdown can start one model request while the page remains hidden', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let ready;
    let active = false;
    const f = fixture({ androidSendDelay: (delay, callback) => {
        assert.equal(delay, 5000);
        ready = callback;
        active = true;
        return () => { active = false; };
    } });
    const running = f.run(false, { delaySend: true });
    f.setVisibility('hidden');
    f.prepared.resolve({ messages: [] });
    await tick();
    assert.equal(f.requests(), 0);
    ready();
    await tick();
    assert.equal(f.requests(), 1);
    assert.equal(active, true);
    f.backgroundCalls[0].onStarted();
    assert.equal(active, false);
    t.mock.timers.tick(5000);
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: '模拟回复' } }] }) });
    await running;
    assert.equal(f.requests(), 1);
});

test('send stays busy through prompt preparation and first response, then clears the placeholder', async () => {
    const finalMessages = [{ role: 'user', content: '脚本改写后的消息' }];
    const f = fixture({ intercept: body => ({ ...body, messages: finalMessages }) }), running = f.run(false);
    assert.equal(f.state.busy, true);
    assert.equal(f.state.generation.regenerate, false);
    assert.match(f.statuses.at(-1), /发送消息.*准备上下文/);
    assert.equal(f.requests(), 0);
    assert.equal(f.stopClasses.has('is-waiting'), true);
    assert.equal(f.stopClasses.has('send-button'), true);
    assert.equal(f.stopAttributes.get('aria-label'), '正在准备发送，停止生成');
    f.prepared.resolve({ messages: [] }); await tick();
    assert.match(f.statuses.at(-1), /等待回复/);
    assert.equal(f.renders.at(-1).at(-1).pending, false);
    assert.equal(f.renders.at(-1).at(-1).text, '测试消息');
    assert.equal(f.requests(), 1);
    assert.equal(f.stopClasses.has('is-waiting'), true);
    assert.equal(f.stopClasses.has('send-button'), true);
    assert.equal(f.stopAttributes.get('aria-label'), '正在等待回复，停止生成');
    assert.deepEqual(f.requestLog.entries[0].messages, finalMessages);
    assert.equal(f.requestLog.entries[0].status, 'pending');
    assert.deepEqual(f.promptHistory, [['原来的回复', '测试消息']]);
    assert.equal(f.saveOptions[0].incremental, true);
    const responseBody = deferred();
    f.response.resolve({ headers: new Headers(), json: () => responseBody.promise });
    await tick();
    assert.equal(f.stopClasses.has('is-waiting'), true, 'headers alone do not reveal a reply');
    responseBody.resolve({ choices: [{ message: { content: '测试回复' } }] });
    await running;
    assert.equal(f.stopClasses.has('is-waiting'), false);
    assert.equal(f.stopClasses.has('send-button'), false);
    assert.equal(f.stopClasses.has('icon-button'), true);
    assert.equal(f.stopAttributes.get('aria-label'), '停止生成');
    assert.deepEqual(f.timings.snapshot().find(entry => entry.label === '模型请求至响应头').metrics,
        { requestedStream: 1, streamResponse: 0 });
    const phaseMetrics = f.timings.snapshot().find(entry => entry.label === '发送消息').metrics;
    assert.ok(phaseMetrics.preSendMs >= 0 && phaseMetrics.postReplyMs >= 0);
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.equal(f.state.chat.at(-1).mes, '测试回复');
    assert.equal(f.requestLog.entries[0].status, 'success');
    assert.equal(f.requestLog.entries[0].reply, '测试回复');
    assert.equal(f.renders.at(-1).at(-1).pending, false);
    assert.deepEqual(f.postGeneration, ['database', 'preload'], 'warm resources only after saving and automatic database updates');
    assert.equal(f.mvuCalls.length, 2); assert.equal(f.mvuCalls[0][0], true); assert.equal(f.mvuCalls[0][1], undefined); assert.equal(f.mvuCalls[1][1].text, '测试回复');
});

test('a pre-send conflict restores the draft and prevents a request or overwrite', async () => {
    const f = fixture({ native: true, conflict: true });
    await f.run(false);
    assert.equal(f.input.value, '测试消息');
    assert.equal(f.state.chat.length, 1);
    assert.equal(f.requests(), 0);
    assert.equal(f.saveOptions.length, 1);
    await assert.rejects(f.run(false), /聊天已变化/);
});

test('stopping regeneration clears loading and restores the previous reply', async () => {
    const f = fixture(); f.state.chat.at(-1).extra.reasoning = '上次的思考';
    const running = f.run(true);
    assert.match(f.statuses.at(-1), /重新生成.*准备上下文/);
    assert.equal(f.state.chat.at(-1).mes, '原来的回复');
    assert.equal(f.renders.at(-1).length, 0);
    f.prepared.resolve({ messages: [] }); await tick();
    assert.equal(f.state.generation.regenerate, true);
    assert.equal(f.state.generation.reply.extra.reasoning, undefined, 'old reasoning must not hide the waiting indicator');
    assert.match(f.statuses.at(-1), /重新生成.*等待回复/);
    assert.equal(f.renders.at(-1).length, 0);
    assert.equal(f.stopClasses.has('is-waiting'), true);
    f.state.controller.abort(); f.response.reject(new DOMException('stopped', 'AbortError'));
    await running;
    assert.equal(f.state.chat.at(-1).mes, '原来的回复');
    assert.equal(f.renders.at(-1).at(-1).text, '原来的回复');
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
    const f = fixture(), firstText = deferred(), tail = deferred(), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers({ 'content-type': 'text/event-stream' }), events: (async function* () {
        yield { choices: [{ delta: { role: 'assistant' } }] };
        await firstText.promise;
        yield { choices: [{ delta: { reasoning_content: 'private reasoning' } }] };
        await tail.promise;
        yield { choices: [{ delta: { content: 'private reply' } }] };
    })() });
    await tick();
    assert.equal(f.stopClasses.has('is-waiting'), true);
    assert.equal(f.renders.at(-1).at(-1).text, '测试消息');
    firstText.resolve();
    await tick();
    assert.equal(f.stopClasses.has('is-waiting'), false);
    assert.equal(f.renders.at(-1).at(-1).pending, true);
    const record = label => f.timings.snapshot().find(entry => entry.label === label);
    assert.equal(record('模型请求至响应头').status, 'success');
    assert.deepEqual(record('模型请求至响应头').metrics, { requestedStream: 1, streamResponse: 1 });
    assert.equal(record('模型请求至首段文本（含思考）').status, 'success');
    assert.equal(record('模型请求至回复接收完成').status, 'loading');
    tail.resolve(); await running;
    assert.equal(f.scrollModes.at(-1), 'top');
    assert.equal(record('模型请求至回复接收完成').status, 'success');
    assert.ok(f.timings.snapshot().every(entry => entry.status !== 'loading'));
    assert.ok(!JSON.stringify(f.timings.snapshot()).includes('private'));
});

test('prompt failure clears loading without sending a request or losing the input', async () => {
    const f = fixture(), running = f.run(false);
    assert.equal(f.stopClasses.has('is-waiting'), true);
    f.prepared.reject(new Error('上下文准备失败')); await running;
    assert.equal(f.requests(), 0);
    assert.equal(f.stopClasses.has('is-waiting'), false);
    assert.equal(f.input.value, '测试消息');
    assert.equal(f.state.busy, false); assert.equal(f.state.generation, null);
    assert.equal(f.notices.at(-1), '上下文准备失败');
    assert.deepEqual(f.postGeneration, []);
});

test('regeneration restores the hidden reply if preparation fails before creating a replacement', async () => {
    const f = fixture(), running = f.run(true);
    assert.equal(f.renders.at(-1).length, 0);
    f.prepared.reject(new Error('准备失败'));
    await running;
    assert.equal(f.requests(), 0);
    assert.equal(f.renders.at(-1).at(-1).text, '原来的回复');
    assert.equal(f.stopClasses.has('is-waiting'), false);
});

test('a model error received while hidden is shown on return and does not resend', async () => {
    const f = fixture(), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.setVisibility('hidden');
    f.response.reject(new Error('模型服务暂不可用')); await running;
    assert.deepEqual(f.notices, []);
    assert.equal(f.state.busy, false);
    assert.match(f.statuses.at(-1), /模型服务暂不可用/);
    f.setVisibility('visible'); await tick();
    f.setVisibility('hidden'); f.setVisibility('visible'); await tick();
    assert.deepEqual(f.notices, ['模型服务暂不可用']);
    assert.equal(f.requests(), 1);
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
    assert.deepEqual(f.saveOptions.map(options => options.incremental), [true, true, true]);
});

test('sending the sealed opening saves its MVU seed on the first user message', async () => {
    const f = fixture({ native: true });
    const data = { stat_data: { _开局已创建: true }, schema: { type: 'object' }, _赤孽开局命牒: f.input.value };
    f.state.chat[0].variables = { 0: data };
    const running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await running;
    const user = f.saved[0].at(-1);
    assert.equal(user.is_user, true);
    assert.equal(user.mes, data._赤孽开局命牒);
    assert.deepEqual(user.variables[0], data);
});

test('a reply callback timeout does not overwrite an unconfirmed script write', async () => {
    const f = fixture({ native: true, timeoutWhileWriting: true }), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await running;
    assert.equal(f.saved.length, 2, 'only the user message and raw reply were saved');
    assert.match(f.state.chatConflict, /无法确认/);
    assert.equal(f.state.replyScriptEvent, null);
    assert.deepEqual(f.postGeneration, []);
    assert.equal(f.timings.snapshot().find(entry => entry.label === '助手事件 message_received').reason, 'timeout');
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

test('a hidden page saves the raw non-streaming reply before waiting to dispatch scripts', async () => {
    const f = fixture({ native: true });
    f.state.chat[0].variables = { 0: { stat_data: { score: 2 } } };
    const running = f.run(true);
    f.prepared.resolve({ messages: [] }); await tick();
    f.setVisibility('hidden');
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'new reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await tick();
    const raw = f.saved.at(-1).at(-1);
    assert.equal(raw.swipe_id, 1);
    assert.equal(raw.swipes[1], 'new reply<UpdateVariable>commands</UpdateVariable>');
    assert.equal(f.state.busy, true);
    assert.match(f.statuses.at(-1), /等待页面恢复可见/);
    assert.deepEqual(f.helperEvents, ['generation_started']);
    assert.equal(f.timings.snapshot().find(entry => entry.label === '助手等待页面恢复可见').status, 'loading');
    assert.ok(!f.timings.snapshot().some(entry => entry.label === '助手事件 message_received'));
    f.setVisibility('hidden'); await tick();
    assert.deepEqual(f.helperEvents, ['generation_started']);
    f.setVisibility('visible'); await running;
    f.setVisibility('hidden'); f.setVisibility('visible'); await tick();
    assert.deepEqual(f.helperEvents, ['generation_started', 'message_received', 'generation_ended']);
    assert.equal(f.timings.snapshot().find(entry => entry.label === '助手等待页面恢复可见').status, 'success');
    assert.deepEqual(f.notices, []);
    assert.equal(f.state.busy, false);
    const saved = f.saved.at(-1).at(-1);
    assert.equal(saved.swipes[0], '原来的回复');
    assert.equal(saved.variables[0].stat_data.score, 2);
    assert.equal(saved.variables[1].stat_data.score, 5);
});

test('hiding the page again before generation_ended defers that event until visible', async () => {
    const f = fixture({ native: true, hideAfterReplyEvent: true }), running = f.run(false);
    f.prepared.resolve({ messages: [] }); await tick();
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'reply<UpdateVariable>commands</UpdateVariable>' } }] }) });
    await tick();
    assert.equal(f.saved.at(-1).at(-1).variables[0].stat_data.score, 5);
    assert.equal(f.state.busy, true);
    assert.deepEqual(f.helperEvents, ['generation_started', 'message_sent', 'message_received']);
    f.setVisibility('visible'); await running;
    assert.equal(f.helperEvents.at(-1), 'generation_ended');
    assert.equal(f.state.busy, false);
});


test('reopening an APK resumes the existing task and acknowledges only a saved reply', async () => {
    const f = fixture({ background: true });
    f.state.chat.push({ is_user: true, mes: '已保存的用户消息' });
    f.input.value = '';
    const key = 'st-new-background-generation:default';
    const job = { id: '1'.repeat(32), avatar: 'fixture.png', file: 'fixture', base: 'a'.repeat(64), regenerate: false };
    f.storage.set(key, JSON.stringify(job));
    const running = f.run(false);
    await tick();
    assert.match(f.statuses.at(-1), /正在恢复后台回复/);
    assert.equal(f.backgroundCalls[0].id, job.id);
    assert.equal(f.backgroundCalls[0].resume, true);
    assert.equal(f.promptHistory.length, 0);
    assert.equal(f.storage.has(key), true);
    assert.equal(f.releases.length, 0);
    f.response.resolve({ headers: new Headers(), json: async () => ({ choices: [{ message: { content: '恢复的回复' } }] }) });
    await running;
    assert.equal(f.saved[0].at(-1).mes, '恢复的回复');
    assert.equal(f.saved[0].length, 3);
    assert.deepEqual(f.releases, [{ id: job.id, saves: 1 }]);
    assert.equal(f.storage.has(key), false);
    assert.equal(f.state.busy, false);
});

test('APK recovery refuses to save a reply into a changed chat', async () => {
    const f = fixture({ background: true });
    f.storage.set('st-new-background-generation:default', JSON.stringify({
        id: '2'.repeat(32), avatar: 'fixture.png', file: 'fixture', base: 'b'.repeat(64),
    }));
    await f.run(false);
    assert.equal(f.requests(), 0);
    assert.equal(f.saved.length, 0);
    assert.match(f.notices[0], /聊天记录已变动/);
    assert.equal(f.state.busy, false);
});
