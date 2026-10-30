import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generationContent, mergeGenerationContent, generationInterceptorBridge, interceptGeneration } from '../generation-interceptor.js';
import { ScriptRuntime } from '../script-runtime.js';
import { readEvents } from '../api.js';

export function transportFixture(handler) {
    const listeners = new Map(), reports = [], parent = {};
    const context = vm.createContext({ Map, Promise, AbortController, Response, ReadableStream, TransformStream, Request, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, parent, report: data => reports.push(data), addEventListener: (name, fn) => listeners.set(name, fn) });
    const register = vm.runInContext(`(${generationInterceptorBridge.toString()})(parent,report)`, context);
    if (handler) register('preset-test', handler);
    const frame = { contentWindow: { postMessage(data, origin, ports) {
        const copy = structuredClone({ data, ports }, { transfer: ports });
        listeners.get('message')({ source: parent, data: copy.data, ports: copy.ports });
    } } };
    const jobs = new Set();
    const run = (body, fetch, options = {}) => interceptGeneration(frame, ['preset-test'], body, { jobs, fetch, current: () => true, ...options });
    return { context, register, frame, jobs, run, reports, listeners, parent };
}
const request = () => ({ messages: [{ role: 'user', content: 'hello' }], stream: false, custom_url: 'https://private.invalid', secret_id: 'private', custom_include_body: '{"sampler":1}' });

test('generation content cannot expose or overwrite connection, credentials or backend routing', () => {
    const body = request(), exposed = generationContent(body);
    assert.equal(exposed.custom_url, undefined); assert.equal(exposed.secret_id, undefined);
    const merged = mergeGenerationContent(body, { ...exposed, tools: [{ type: 'function' }] });
    assert.equal(merged.secret_id, 'private'); assert.equal(merged.custom_include_body, body.custom_include_body);
    for (const key of ['custom_url', 'secret_id', 'chat_completion_source', 'custom_include_body', '__proto__']) assert.throws(() => mergeGenerationContent(body, { ...exposed, [key]: 'bad' }), /认证字段/);
    assert.throws(() => mergeGenerationContent(body, { ...exposed, messages: 'bad' }), /格式无效/);
});

test('isolated interceptor transforms requests and JSON responses with one upstream call', async () => {
    let calls = 0;
    const fx = transportFixture(async (url, init, next) => {
        const body = JSON.parse(init.body); assert.equal(body.secret_id, undefined);
        body.tools = [{ type: 'function', function: { name: 'transport' } }];
        const response = await next(url, { ...init, body: JSON.stringify(body) });
        const data = await response.json(); return Response.json({ choices: [{ message: { content: data.result } }] });
    });
    const response = await fx.run(request(), async body => { calls++; assert.equal(body.secret_id, 'private'); assert.equal(body.tools[0].function.name, 'transport'); return Response.json({ result: '还原正文' }); });
    assert.equal((await response.json()).choices[0].message.content, '还原正文');
    assert.equal(calls, 1); assert.equal(fx.jobs.size, 0);
});

test('streamed responses cross both boundaries without buffering the full reply', async () => {
    const fx = transportFixture((url, init, next) => next(url, init));
    let upstream;
    const response = await fx.run({ ...request(), stream: true }, async () => new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(new TextEncoder().encode('data: first\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } }));
    const reader = response.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
    upstream.enqueue(new TextEncoder().encode('data: second\n\n')); upstream.close();
    assert.match(new TextDecoder().decode((await reader.read()).value), /second/); assert.equal((await reader.read()).done, true); assert.equal(fx.jobs.size, 0);
});

test('aborted, stale, external and duplicate requests never produce another upstream call', async () => {
    for (const mode of ['abort', 'stale', 'external', 'duplicate', 'credential']) {
        let calls = 0;
        const fx = transportFixture(async (url, init, next) => {
            if (mode === 'external') return next('https://bad.invalid', init);
            if (mode === 'credential') return next(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), secret_id: 'changed' }) });
            const response = await next(url, init);
            if (mode === 'duplicate') await next(url, init);
            return response;
        });
        const controller = new AbortController(); if (mode === 'abort') controller.abort();
        await assert.rejects(fx.run(request(), async () => { calls++; return Response.json({ ok: true }); }, { signal: controller.signal, current: () => mode !== 'stale' }));
        assert.equal(calls, mode === 'duplicate' ? 1 : 0); assert.equal(fx.jobs.size, 0);
    }
});

test('disposing a running transport cancels its response stream and removes its job', async () => {
    const fx = transportFixture((url, init, next) => next(url, init));
    const response = await fx.run(request(), async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); } })));
    const reader = response.body.getReader(); await reader.read();
    for (const cancel of fx.jobs) cancel();
    await assert.rejects(reader.read(), /取消|失效/); assert.equal(fx.jobs.size, 0);
});

test('script transport registration checks source, active identity, and unregister', async () => {
    const runtime = new ScriptRuntime({ notify() {} }), sender = {};
    runtime.frame = { contentWindow: sender }; runtime.statusRows.set('preset-one', { dataset: { active: 'true' } });
    const data = { channel: 'st-new-scripts', type: 'generation-interceptor', id: 'preset-one', active: true };
    await runtime.receive({ source: {}, data }); assert.equal(runtime.generationInterceptors.size, 0);
    await runtime.receive({ source: sender, data }); assert.equal(runtime.generationInterceptors.size, 1);
    await runtime.receive({ source: sender, data: { ...data, id: 'unknown' } }); assert.equal(runtime.generationInterceptors.size, 1);
    await runtime.receive({ source: sender, data: { ...data, active: false } }); assert.equal(runtime.generationInterceptors.size, 0);
});


test('SSE completion marker cancels the remainder and releases the generation job', async () => {
    const fx = transportFixture((url, init, next) => next(url, init));
    const response = await fx.run({ ...request(), stream: true }, async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"reply"}}]}\n\ndata: [DONE]\n\n'));
    } }), { headers: { 'content-type': 'text/event-stream' } }));
    const events = []; for await (const event of readEvents(response)) events.push(event);
    assert.equal(events[0].choices[0].delta.content, 'reply'); assert.equal(fx.jobs.size, 0);
});
