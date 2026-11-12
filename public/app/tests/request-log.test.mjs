import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestLog, REQUEST_LOG_LIMIT, groupAdjacentMessages } from '../request-log.js';
import { TavernAPI } from '../api.js';

test('groups adjacent messages by role and speaker while preserving request order', () => {
    const messages = [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'question' },
        { role: 'system', content: 'later' },
        { role: 'assistant', name: 'Lin', content: 'answer' },
        { role: 'assistant', name: 'Yu', content: 'another answer' },
    ];
    const groups = groupAdjacentMessages(messages);
    assert.deepEqual(groups.map(group => group.messages.length), [2, 1, 1, 1, 1]);
    assert.deepEqual(groups.flatMap(group => group.messages), messages);
});

test('captures ordered prompt snapshots and partial responses without retaining connection credentials', () => {
    const log = new RequestLog();
    const controller = new AbortController();
    const body = {
        messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'input' }],
        model: 'fixture', stream: true, secret_id: 'secret', custom_url: 'private',
    };
    const finish = log.start('chat', body, controller.signal);
    body.messages[1].content = 'changed';
    controller.abort();
    finish(null, 'partial', 'reasoning');
    const [entry] = log.entries;
    assert.deepEqual(entry.messages.map(message => message.content), ['rules', 'input']);
    assert.equal(entry.status, 'cancelled');
    assert.equal(entry.reply, 'partial');
    assert.equal(entry.reasoning, 'reasoning');
    assert.doesNotMatch(JSON.stringify(entry), /secret|private/);
    assert.equal(log.start('chat', body, controller.signal), undefined);
});

test('evicted and cleared requests stay removed when their responses arrive', () => {
    const log = new RequestLog();
    const first = log.start('script', { messages: [], model: 'first' });
    for (let index = 0; index < REQUEST_LOG_LIMIT; index++) {
        log.start('database', { messages: [], model: String(index) });
    }
    first(null, 'late');
    assert.equal(log.entries.length, REQUEST_LOG_LIMIT);
    assert.equal(log.entries[0].model, String(REQUEST_LOG_LIMIT - 1));
    assert.equal(log.entries.at(-1).model, '0');
    const pending = log.start('script', { messages: [] });
    log.clear();
    pending(null, 'late');
    assert.deepEqual(log.entries, []);
});

test('only the capture preference survives a new log instance', () => {
    const settings = new Map();
    const storage = () => ({ getItem: key => settings.get(key), setItem: (key, value) => settings.set(key, value) });
    const log = new RequestLog(storage);
    log.start('chat', { messages: [{ role: 'user', content: 'private text' }] });
    log.setEnabled(false);
    assert.equal(log.start('script', { messages: [] }), undefined);
    const reloaded = new RequestLog(storage);
    assert.equal(reloaded.enabled, false);
    assert.deepEqual(reloaded.entries, []);
    assert.deepEqual([...settings.values()], ['false']);
});

test('uses SillyTavern post-processed messages without delaying or changing the live request', async () => {
    const log = new RequestLog(), api = new TavernAPI();
    const messages = [{ role: 'user', name: '旅人', content: '正则改写' }, { role: 'user', content: '脚本追加' }];
    const processed = [{ role: 'user', content: '旅人: 正则改写\n\n脚本追加' }];
    const body = { messages, custom_prompt_post_processing: 'merge', char_name: '角色', secret_id: 'private' };
    let respond;
    api.response = (path, data) => {
        assert.equal(path, '/api/backends/chat-completions/process');
        assert.deepEqual(data, { messages, type: 'merge', char_name: '角色', user_name: undefined, group_names: undefined });
        return new Promise(resolve => { respond = resolve; });
    };
    const finish = log.start('chat', body, undefined, api);
    finish(null, 'reply');
    assert.equal(log.entries[0].status, 'success');
    assert.equal(log.entries[0].processing, 'pending');
    await Promise.resolve();
    const updated = new Promise(resolve => log.addEventListener('change', resolve, { once: true }));
    respond(Response.json({ messages: processed }));
    await updated;
    assert.equal(log.entries[0].processing, 'done');
    assert.deepEqual(log.entries[0].messages, processed);
    assert.equal(log.entries[0].reply, 'reply');
    assert.equal(body.messages[0].name, '旅人');
    assert.equal(body.messages.length, 2);
});

test('keeps the submitted snapshot when the host cannot return post-processed messages', async () => {
    const log = new RequestLog();
    const messages = [{ role: 'user', content: 'submitted' }];
    log.start('chat', { messages, custom_prompt_post_processing: 'merge' }, undefined, {
        async processPrompt() { throw Error('missing route'); },
    });
    await new Promise(resolve => log.addEventListener('change', resolve, { once: true }));
    assert.equal(log.entries[0].processing, 'unavailable');
    assert.deepEqual(log.entries[0].messages, messages);
});
