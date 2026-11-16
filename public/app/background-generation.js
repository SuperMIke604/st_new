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

export const usesBackgroundGeneration = () => !!document.getElementById('android-apk-update');

export async function findBackgroundGeneration(api) {
    try {
        const result = await api.post(endpoint, { action: 'pending' }, {
            signal: AbortSignal.timeout(5000), fallbackStatuses: [400, 404],
        });
        return result.job;
    } catch (error) {
        if (![400, 404].includes(error.status)) throw error;
        return null;
    }
}

export async function releaseBackgroundGeneration(api, id) {
    await api.post(endpoint, { action: 'release', id }, { signal: AbortSignal.timeout(5000) });
}

export async function chatGenerationResponse(api, body, signal, { id, resume = false, recovery, onFallback } = {}) {
    // The APK adds this menu item after connecting to the local st_new page.
    if (!resume && !usesBackgroundGeneration()) {
        return api.response(directEndpoint, body, { signal });
    }
    const recoverable = !!id;
    id ||= crypto.randomUUID().replaceAll('-', '');
    const call = async (action, fields = {}, options) => {
        const response = await api.response(endpoint, { action, id, ...fields }, options);
        return response.json();
    };
    const callWithTimeout = async (action, fields, timeout, options) => {
        signal.throwIfAborted();
        const request = new AbortController();
        const stop = () => request.abort(signal.reason);
        const timer = setTimeout(() => request.abort(new DOMException('后台请求超时。', 'TimeoutError')), timeout);
        signal.addEventListener('abort', stop, { once: true });
        try {
            return await call(action, fields, { ...options, signal: request.signal });
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', stop);
        }
    };
    const cancelJob = () => { void call('cancel', {}, { signal: AbortSignal.timeout(5000) }).catch(() => {}); };
    const release = () => {
        if (!recoverable) void call('release', {}, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    };
    signal.addEventListener('abort', cancelJob, { once: true });
    let offset = 0;

    async function read() {
        let failures = 0;
        for (;;) {
            try {
                const snapshot = await callWithTimeout('read', { offset }, 12000);
                if (snapshot.status || snapshot.done) return snapshot;
                failures = 0;
            } catch (error) {
                if (signal.aborted) throw signal.reason;
                const transient = error instanceof TypeError || error.name === 'TimeoutError'
                    || [502, 503, 504].includes(error.status);
                if (!transient) throw error;
                if (!document.hidden && ++failures >= 3) {
                    if (recoverable) error.resumeBackground = true;
                    throw error;
                }
            }
            await waitForPoll(signal);
        }
    }

    try {
        if (!resume) {
            try {
                await callWithTimeout('start', { modelRequest: body, recovery }, 15000, { fallbackStatuses: [404] });
            } catch (error) {
                if (error.status !== 404) {
                    if (recoverable && (error.name === 'TimeoutError' || error instanceof TypeError || [502, 503, 504].includes(error.status))) {
                        // The POST may have reached Termux even when its acknowledgment was lost.
                        error.resumeBackground = true;
                    }
                    throw error;
                }
                signal.removeEventListener('abort', cancelJob);
                onFallback?.();
                return api.response(directEndpoint, body, { signal });
            }
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
                if (!recoverable) cancelJob();
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
