const endpoint = '/api/plugins/st-new-updater/generate-background';
const directEndpoint = '/api/backends/chat-completions/generate';

function waitForPoll(signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const complete = () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', complete);
            signal.removeEventListener('abort', complete);
            if (signal.aborted) reject(signal.reason);
            else resolve();
        };
        const timer = setTimeout(complete, document.hidden ? 2000 : 350);
        document.addEventListener('visibilitychange', complete);
        signal.addEventListener('abort', complete, { once: true });
    });
}

export async function chatGenerationResponse(api, body, signal) {
    // The APK adds this menu item after connecting to the local st_new page.
    if (!document.getElementById('android-apk-update')) {
        return api.response(directEndpoint, body, { signal });
    }
    const id = crypto.randomUUID().replaceAll('-', '');
    const call = async (action, fields = {}, options) => {
        const response = await api.response(endpoint, { action, id, ...fields }, options);
        return response.json();
    };
    const cancelJob = () => { void call('cancel', {}, { signal: AbortSignal.timeout(5000) }).catch(() => {}); };
    const release = () => { void call('release', {}, { signal: AbortSignal.timeout(5000) }).catch(() => {}); };
    signal.addEventListener('abort', cancelJob, { once: true });
    let offset = 0;

    async function read() {
        let failures = 0;
        for (;;) {
            signal.throwIfAborted();
            const poll = new AbortController();
            const stop = () => poll.abort(signal.reason);
            const timer = setTimeout(() => poll.abort(new DOMException('后台读取超时。', 'TimeoutError')), 12000);
            signal.addEventListener('abort', stop, { once: true });
            try {
                const snapshot = await call('read', { offset }, { signal: poll.signal });
                if (snapshot.status || snapshot.done) return snapshot;
                failures = 0;
            } catch (error) {
                if (signal.aborted) throw signal.reason;
                const transient = error instanceof TypeError || error.name === 'TimeoutError'
                    || [502, 503, 504].includes(error.status);
                if (!transient || (!document.hidden && ++failures >= 3)) throw error;
            } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', stop);
            }
            await waitForPoll(signal);
        }
    }

    try {
        try {
            await call('start', { modelRequest: body }, { signal, fallbackStatuses: [404] });
        } catch (error) {
            if (error.status !== 404) throw error;
            signal.removeEventListener('abort', cancelJob);
            return api.response(directEndpoint, body, { signal });
        }
        let snapshot = await read();
        if (!snapshot.status) {
            release();
            throw new Error(snapshot.error || '后台模型没有返回响应。');
        }
        const { status, type } = snapshot;
        const encoder = new TextEncoder();
        let waitForData = false;
        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    while (!snapshot) {
                        if (waitForData) await waitForPoll(signal);
                        snapshot = await read();
                        waitForData = !snapshot.text;
                        if (!snapshot.text && !snapshot.done) snapshot = null;
                    }
                    const { text, done, error } = snapshot;
                    snapshot = null;
                    offset += text.length;
                    if (text) controller.enqueue(encoder.encode(text));
                    if (done && error && text) {
                        // Let the consumer process the final text before surfacing a disconnect.
                        snapshot = { text: '', done, error };
                    } else if (done) {
                        signal.removeEventListener('abort', cancelJob);
                        release();
                        if (error) controller.error(new Error(error));
                        else controller.close();
                    }
                } catch (error) {
                    signal.removeEventListener('abort', cancelJob);
                    controller.error(error);
                }
            },
            cancel() {
                signal.removeEventListener('abort', cancelJob);
                cancelJob();
            },
        }, { highWaterMark: 0 });
        const response = new Response(stream, { headers: { 'content-type': type } });
        if (status >= 400) {
            let message;
            try {
                const result = await response.json();
                message = result.message || result.error?.message || result.error;
            } catch (error) {
                if (signal.aborted) throw signal.reason;
            }
            throw new Error(typeof message === 'string' ? message : `模型请求失败（${status}）`);
        }
        return response;
    } catch (error) {
        signal.removeEventListener('abort', cancelJob);
        throw error;
    }
}
