// Only generation content crosses the opaque iframe boundary. Connection,
// credential and routing fields remain in the application.
export const GENERATION_CONTENT_FIELDS = ['messages', 'stream', 'tools', 'tool_choice', 'parallel_tool_calls'];
export function generationContent(body) {
    return structuredClone(Object.fromEntries(GENERATION_CONTENT_FIELDS.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]])));
}
export function mergeGenerationContent(original, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !GENERATION_CONTENT_FIELDS.includes(key))) throw Error('脚本不能修改生成连接或认证字段。');
    if (!Array.isArray(value.messages) || typeof value.stream !== 'boolean' || JSON.stringify(value).length > 16000000) throw Error('脚本生成请求格式无效或过大。');
    const merged = { ...original };
    for (const key of GENERATION_CONTENT_FIELDS) { if (Object.hasOwn(value, key)) merged[key] = structuredClone(value[key]); else delete merged[key]; }
    return merged;
}

// Serialized into the script iframe. This is a single-use continuation of a
// user-started generation, never a network proxy or a new model request API.
export function generationInterceptorBridge(applicationParent, report) {
    const handlers = new Map();
    const register = (id, handler) => {
        if (typeof handler !== 'function') throw Error('生成处理器必须是函数。');
        handlers.set(id, handler); report({ type: 'generation-interceptor', id, active: true });
        return () => { if (handlers.get(id) === handler) { handlers.delete(id); report({ type: 'generation-interceptor', id, active: false }); } };
    };
    addEventListener('message', event => {
        if (event.source !== applicationParent || event.data?.channel !== 'st-new-scripts' || event.data.type !== 'generation-transport' || !event.ports?.[0]) return;
        const port = event.ports[0], abort = new AbortController();
        let continuation, used = false;
        port.onmessage = ({ data }) => {
            if (data.type === 'abort') { abort.abort(); continuation?.reject(Error('生成已取消。')); port.close(); }
            else if (data.type === 'upstream' && continuation) {
                if (data.error) continuation.reject(Error(data.error));
                else continuation.resolve(new Response(data.body, { status: data.status, statusText: data.statusText, headers: data.headers }));
                continuation = null;
            }
        };
        const next = async (url, init) => {
            if (used || abort.signal.aborted) throw Error('生成请求只能发送一次。');
            if (url !== '/api/backends/chat-completions/generate' || init?.method !== 'POST' || typeof init.body !== 'string') throw Error('生成处理器不能访问其他地址。');
            used = true;
            return new Promise((resolve, reject) => { continuation = { resolve, reject }; port.postMessage({ type: 'fetch', body: init.body }); });
        };
        const selected = event.data.ids.map(id => handlers.get(id));
        const dispatch = (index, url, init) => index === selected.length ? next(url, init) : selected[index](url, init, (nextUrl, nextInit) => dispatch(index + 1, nextUrl, nextInit));
        Promise.resolve().then(() => { if (selected.some(handler => typeof handler !== 'function')) throw Error('生成处理器已失效。'); return dispatch(0, '/api/backends/chat-completions/generate', { method: 'POST', body: JSON.stringify(event.data.body), signal: abort.signal }); }).then(response => {
            if (!(response instanceof Response) || !used) throw Error('生成处理器未返回有效的模型响应。');
            const body = response.body;
            port.postMessage({ type: 'result', body, status: response.status, statusText: response.statusText, headers: { 'content-type': response.headers.get('content-type') || 'application/json' } }, body ? [body] : []);
            port.close();
        }).catch(error => { try { port.postMessage({ type: 'error', error: error.message }); port.close(); } catch {} });
    });
    return register;
}

export function interceptGeneration(frame, ids, body, { signal, current, fetch, jobs }) {
    const channel = new MessageChannel(), port = channel.port1, abort = new AbortController();
    let cancelJob; const job = () => cancelJob?.(); jobs.add(job);
    return new Promise((resolve, reject) => {
        let sent = false, settled = false, reader, output;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); jobs.delete(job); port.close(); };
        const fail = error => {
            if (abort.signal.aborted && settled) return;
            abort.abort(); try { port.postMessage({ type: 'abort' }); } catch {}
            if (output) { try { output.error(error); } catch {} }
            void reader?.cancel(error).catch(() => {});
            cleanup(); if (!settled) { settled = true; reject(error); }
        };
        const cancel = () => fail(new DOMException('生成已取消或脚本环境已失效。', 'AbortError'));
        cancelJob = cancel;
        const timer = setTimeout(() => fail(Error('生成处理器响应超时。')), 180000);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted || !current()) { cancel(); return; }
        port.onmessage = async ({ data }) => {
            if (settled || !current()) { fail(Error('脚本环境已失效。')); return; }
            try {
                if (data.type === 'fetch') {
                    if (sent || typeof data.body !== 'string' || data.body.length > 16000000) throw Error('生成请求重复或格式无效。');
                    sent = true;
                    const request = mergeGenerationContent(body, JSON.parse(data.body));
                    const response = await fetch(request, AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]));
                    if (abort.signal.aborted || !current()) { void response.body?.cancel().catch(() => {}); throw Error('脚本环境已失效。'); }
                    const upstream = response.body;
                    port.postMessage({ type: 'upstream', body: upstream, status: response.status, statusText: response.statusText, headers: { 'content-type': response.headers.get('content-type') || 'application/json' } }, upstream ? [upstream] : []);
                } else if (data.type === 'result') {
                    if (!sent || !data.body || typeof data.body.getReader !== 'function') throw Error('生成处理器响应无效。');
                    reader = data.body.getReader();
                    const stream = new ReadableStream({
                        start(controller) { output = controller; },
                        async pull(controller) { try { if (abort.signal.aborted || !current()) throw Error('脚本环境已失效。'); const chunk = await reader.read(); if (chunk.done) { controller.close(); cleanup(); } else controller.enqueue(chunk.value); } catch (error) { fail(error); } },
                        cancel(reason) { void reader.cancel(reason).catch(() => {}); abort.abort(); cleanup(); },
                    });
                    const response = new Response(stream, { status: data.status, statusText: data.statusText, headers: data.headers });
                    settled = true; clearTimeout(timer); port.close(); resolve(response);
                } else if (data.type === 'error') throw Error(data.error || '生成处理器失败。');
            } catch (error) { fail(error); }
        };
        try { frame.contentWindow.postMessage({ channel: 'st-new-scripts', type: 'generation-transport', ids, body: generationContent(body) }, '*', [channel.port2]); }
        catch (error) { fail(error); }
    });
}
