import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { chatGenerationResponse, findBackgroundGeneration, releaseBackgroundGeneration } from '../../public/app/background-generation.js';
import { readEvents } from '../../public/app/api.js';
import { registerBackgroundGeneration } from './index.mjs';

test('completed jobs survive time in the background and only yield capacity to new jobs', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let dispatch;
    registerBackgroundGeneration({ post: (_path, handler) => { dispatch = handler; } }, {
        requestModel: async (_url, { body }) => {
            if (JSON.parse(body).wait) return new Promise(() => {});
            return new Response('fixture reply');
        },
    });
    const id = number => number.toString(16).padStart(32, '0');
    const call = (action, number, fields = {}) => {
        let status = 200;
        return dispatch({
            body: { action, id: id(number), ...fields },
            socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 8000 },
            user: { directories: { root: `fixture-${number}` } },
            headers: {},
        }, {
            set() {},
            status(code) { status = code; return this; },
            json(body) { return { status, body }; },
        });
    };
    const start = (number, modelRequest, recovery) => {
        assert.equal(call('start', number, { modelRequest, recovery }).status, 200);
    };
    const read = number => call('read', number, { offset: 0 });
    start(0, { wait: true });
    start(1, {}, { avatar: 'fixture.png', file: 'fixture', base: 'b'.repeat(64) });
    start(2, {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(read(1).body.done, true);
    t.mock.timers.tick(24 * 60 * 60_000);
    assert.equal(read(1).body.text, 'fixture reply');

    for (let number = 3; number < 64; number++) start(number, { wait: true });
    start(64, { wait: true });
    assert.equal(read(2).status, 410);
    assert.equal(read(1).body.text, 'fixture reply');
    start(65, { wait: true });
    assert.equal(read(1).status, 410);
    assert.equal(read(0).body.done, false);
    assert.equal(call('start', 66, { modelRequest: { wait: true } }).status, 429);
});

test('APK generation reads completed results after suspension and relays model failures', { timeout: 15000 }, async t => {
    let dispatch, generationCount = 0;
    let closeUpstream;
    const upstreamClosed = new Promise(resolve => { closeUpstream = resolve; });
    const server = createServer(async (request, response) => {
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = JSON.parse(text);
        if (request.url === '/api/backends/chat-completions/generate') {
            generationCount++;
            assert.equal(request.headers['x-csrf-token'], 'fixture-token');
            assert.equal(request.headers.authorization, 'Basic fixture');
            assert.equal(request.headers.cookie, 'session=fixture');
            if (body.fail) {
                response.writeHead(429, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: { message: 'fixture model error' } }));
                return;
            }
            if (body.wait) {
                response.once('close', closeUpstream);
                response.writeHead(200, { 'content-type': 'application/json' });
                response.flushHeaders();
                return;
            }
            if (body.stream === false) {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.flushHeaders();
                await new Promise(resolve => setTimeout(resolve, 700));
                response.end(JSON.stringify({ error: { message: 'fixture non-streaming summary error' } }));
                return;
            }
            response.writeHead(200);
            response.write('da');
            await new Promise(resolve => setTimeout(resolve, 10));
            response.write('ta: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
            const reply = Buffer.from('data: {"choices":[{"delta":{"content":"完成🎉"}}]}\n\ndata: [DONE]\n\n');
            const split = reply.indexOf(Buffer.from('🎉')) + 2;
            response.write(reply.subarray(0, split));
            await new Promise(resolve => setTimeout(resolve, 10));
            response.end(reply.subarray(split));
            return;
        }
        request.user = { directories: { root: request.headers['fixture-user'] || 'user' } };
        request.body = body;
        response.set = (key, value) => response.setHeader(key, value);
        response.status = code => { response.statusCode = code; return response; };
        response.json = value => response.end(JSON.stringify(value));
        dispatch(request, response);
    });
    registerBackgroundGeneration({ post: (_path, handler) => { dispatch = handler; } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.close(); server.closeAllConnections(); });

    const document = Object.assign(new EventTarget(), { hidden: true, getElementById: () => ({}) });
    const oldDocument = globalThis.document;
    globalThis.document = document;
    t.after(() => { globalThis.document = oldDocument; });

    let jobId;
    let startAcknowledged = false;
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = {
        async post(...args) { return (await this.response(...args)).json(); },
        async response(path, body, { signal } = {}) {
            if (body.action === 'start') jobId = body.id;
            if (body.action === 'read') assert.equal(startAcknowledged, true);
            const response = await fetch(origin + path, {
                method: 'POST', body: JSON.stringify(body), signal,
                headers: { 'x-csrf-token': 'fixture-token', authorization: 'Basic fixture', cookie: 'session=fixture' },
            });
            if (!response.ok) throw Object.assign(new Error('HTTP error'), { status: response.status });
            return response;
        },
    };

    const id = 'a'.repeat(32);
    const recovery = { id, avatar: 'fixture.png', file: 'fixture', base: 'b'.repeat(64), regenerate: false, started: '' };
    // Drop the first page before it consumes the stream or persists the job ID.
    await chatGenerationResponse(api, { stream: true }, new AbortController().signal, {
        id, recovery, onStarted: () => { startAcknowledged = true; },
    });
    assert.deepEqual(await findBackgroundGeneration(api), recovery);
    await new Promise(resolve => setTimeout(resolve, 30));
    const forbidden = await fetch(origin + '/api/plugins/st-new-updater/generate-background', {
        method: 'POST', headers: { 'fixture-user': 'another-user' },
        body: JSON.stringify({ action: 'read', id: jobId, offset: 0 }),
    });
    assert.equal(forbidden.status, 404);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const readReply = async () => {
        const response = await chatGenerationResponse(api, null, new AbortController().signal, { id, resume: true });
        let text = '';
        for await (const event of readEvents(response)) text += event.choices[0].delta.content;
        return text;
    };
    assert.equal(await readReply(), '开始完成🎉');
    // The second page received the reply but closed before its save acknowledgment.
    assert.equal(await readReply(), '开始完成🎉');
    await releaseBackgroundGeneration(api, id);
    assert.equal(await findBackgroundGeneration(api), null);
    await assert.rejects(readReply, { status: 410 });
    assert.equal(generationCount, 1);
    await assert.rejects(chatGenerationResponse(api, { fail: true, stream: false }, new AbortController().signal), {
        message: 'fixture model error', status: 429,
    });
    assert.equal(generationCount, 2);
    document.hidden = true;
    const summary = await chatGenerationResponse(api, { stream: false }, new AbortController().signal);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(await summary.json(), { error: { message: 'fixture non-streaming summary error' } });
    assert.equal(generationCount, 3);

    const stop = new AbortController();
    const waiting = await chatGenerationResponse(api, { wait: true, stream: false }, stop.signal);
    const content = waiting.text();
    stop.abort();
    await assert.rejects(content, { name: 'AbortError' });
    await upstreamClosed;
    assert.equal(generationCount, 4);
});
