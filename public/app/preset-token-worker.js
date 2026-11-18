import { chatRevision } from './chat-delta.js';
import { PresetTokenPreview } from './preset-tokens.js';

let preview, nextRequest = 0;
const requests = new Map();

function request(type, data, signal) {
    signal.throwIfAborted();
    const id = ++nextRequest;
    return new Promise((resolve, reject) => {
        const abort = () => {
            requests.delete(id);
            self.postMessage({ type: 'abort', id });
            reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        requests.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) });
        self.postMessage({ type, id, ...data });
    });
}

self.onmessage = async ({ data }) => {
    const { type, id } = data;
    if (type === 'start') {
        preview = new PresetTokenPreview({
            ...data.options,
            loadBooks: signal => request('books', {}, signal),
            api: { async post(path, _messages, { signal, serializedBody: body }) {
                // Compute the cache key and serialize the payload off the UI thread.
                const digest = await chatRevision([path, body]).catch(() => undefined);
                return request('tokenize', { path, body, digest }, signal);
            } },
        });
        preview.start();
    } else if (type === 'invalidate') {
        preview.preset = data.preset;
        preview.invalidatePromptCounts();
    } else if (type === 'response') {
        const pending = requests.get(id);
        if (!pending) return;
        requests.delete(id);
        pending.cleanup();
        if (data.error) pending.reject(data.error);
        else pending.resolve(data.result);
    } else if (type === 'count') {
        try {
            const result = await preview.count(data.prompt);
            self.postMessage({ type: 'counted', id, result });
        } catch (error) {
            self.postMessage({ type: 'counted', id, error });
        }
    }
};
