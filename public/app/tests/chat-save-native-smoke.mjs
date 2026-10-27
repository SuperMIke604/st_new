// Run only against the explicitly authorized backup acceptance host.
// Creates/deletes one uniquely named synthetic chat. Native backup policy stays.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TavernAPI } from '../api.js';
import { loadTimings } from '../load-timings.js';
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
if (!['127.0.0.1', 'localhost'].includes(origin.hostname)) throw Error('Acceptance smoke test requires a local backup host');
const avatar = process.argv[3] || 'default_Seraphina.png', file = 'codex-save-transport-' + randomUUID();
const originalFetch = globalThis.fetch, cookies = new Map();
globalThis.fetch = async (url, options = {}) => {
    const response = await originalFetch(new URL(url, origin), { ...options, headers: { ...options.headers, ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}) } });
    for (const item of response.headers.getSetCookie()) { const pair = item.split(';')[0], separator = pair.indexOf('='); cookies.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    return response;
};
const api = new TavernAPI(); let attempted = false;
try {
    await api.connect();
    const header = { chat_metadata: { integrity: randomUUID(), smoke: true, unknown: { preserved: true } } };
    const messages = [{ name: 'Test', is_user: false, mes: '中文无损传输🙂'.repeat(40000), swipe_id: 1, swipes: ['old', 'current'], swipe_info: [{ extra: { unknown: 1 } }], variables: { 1: { score: 2 } } }];
    attempted = true; await api.saveChat(avatar, file, header, messages);
    const read = () => api.post('/api/chats/get', { avatar_url: avatar, file_name: file });
    assert.deepEqual(await read(), [header, ...messages]);
    await assert.rejects(api.saveChat(avatar, file, { ...header, chat_metadata: { ...header.chat_metadata, integrity: randomUUID() } }, messages), error => error.status === 400);
    assert.deepEqual(await read(), [header, ...messages]);
    const metrics = loadTimings.snapshot().find(entry => entry.label === '准备聊天保存传输').metrics;
    assert.equal(metrics.gzip, 1);
    console.log(JSON.stringify({ nativeSave: true, roundTrip: true, integrityConflictRejected: true, ...metrics }));
} finally {
    if (attempted) { const result = await api.post('/api/chats/delete', { avatar_url: avatar, chatfile: file + '.jsonl' }); assert.equal(result.ok, true); console.log('Temporary acceptance chat deleted; native backup policy unchanged.'); }
    globalThis.fetch = originalFetch;
}
