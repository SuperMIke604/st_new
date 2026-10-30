import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildPrompt, expand, activateWorlds, fitPrompt, generationBody, CompatibilityError } from '../engine.js';
import { readEvents, TavernAPI } from '../api.js';

const defaultPreset = JSON.parse(await fs.readFile(new URL('./fixtures/Default.json', import.meta.url), 'utf8'));
function input() {
    return { character: { name: '林', data: { description: '图书管理员', personality: '安静', scenario: '旧书店', first_mes: '欢迎', mes_example: '' } }, persona: { name: '旅人', description: '寻找一本旧书' },
        preset: structuredClone(defaultPreset), chat: [{ name: '林', is_user: false, mes: '你好' }, { name: '旅人', is_user: true, mes: '我想找一本书' }], settings: {}, books: [] };
}

test('OpenAI and custom sources omit provider-specific samplers without modifying presets', () => {
    for (const source of ['openai', 'custom']) {
        const preset = { top_k: 50, top_a: .2, min_p: .05, repetition_penalty: 1.12 };
        const before = structuredClone(preset);
        const body = generationBody({ source, url: 'https://relay.example/v1', model: 'test' }, preset, []);
        for (const key of ['top_k', 'top_a', 'min_p', 'repetition_penalty', 'custom_include_body']) assert.equal(Object.hasOwn(body, key), false, key);
        assert.deepEqual(preset, before);
    }
});

test('inactive Claude prefill fields do not block OpenAI-compatible prompts or enter messages', () => {
    const args = input(); args.preset.assistant_prefill = 'CLAUDE-ONLY {{unknown_macro}}'; args.preset.assistant_impersonation = 'IMPERSONATION-ONLY';
    const before = JSON.stringify(args.preset);
    const output = buildPrompt(args);
    assert.ok(!JSON.stringify(output.messages).includes('CLAUDE-ONLY'));
    assert.equal(JSON.stringify(args.preset), before);
});

test('automatic description markers honor user and assistant roles', () => {
    const args = input();
    args.preset.prompts.find(p => p.identifier === 'charDescription').role = 'user';
    args.preset.prompts.find(p => p.identifier === 'personaDescription').role = 'assistant';
    const output = buildPrompt(args).messages;
    assert.equal(output.find(m => m.content === '图书管理员').role, 'user');
    assert.equal(output.find(m => m.content === '寻找一本旧书').role, 'assistant');
});

test('history and example markers preserve speakers by default, with explicit role overrides', () => {
    const args = input(); args.character.data.mes_example = '{{user}}: example-user\n{{char}}: example-assistant';
    const history = args.preset.prompts.find(p => p.identifier === 'chatHistory');
    const examples = args.preset.prompts.find(p => p.identifier === 'dialogueExamples');
    assert.equal(buildPrompt(args).messages.at(-1).role, 'user');
    history.role = 'assistant'; history.independent_role_override = true;
    examples.role = 'user'; examples.independent_role_override = true;
    const output = buildPrompt(args).messages;
    assert.equal(output.find(m => m.content === '我想找一本书').role, 'assistant');
    assert.equal(output.find(m => m.content === 'example-assistant').role, 'user');
    delete history.independent_role_override;
    assert.equal(buildPrompt(args).messages.at(-1).role, 'user');
});
test('native default preset: prompt order, character, persona and latest message are preserved', () => {
    const args = input(); const before = JSON.stringify(args);
    const output = buildPrompt(args);
    assert.equal(output.messages[0].role, 'system');
    assert.match(output.messages[0].content, /林.*旅人/);
    assert.ok(output.messages.some(m => m.content === '寻找一本旧书'));
    assert.ok(output.messages.some(m => m.content === '图书管理员'));
    assert.equal(output.messages.at(-1).content, '我想找一本书');
    assert.equal(JSON.stringify(args), before);
});

test('all four native names behaviors work in history and examples without mutating chat', () => {
    for (const mode of [-1, 0, 1, 2]) {
        const args = input(); args.preset.names_behavior = mode;
        args.character.data.mes_example = '{{user}}: example';
        const before = JSON.stringify(args.chat);
        const output = buildPrompt(args).messages;
        const last = output.at(-1);
        assert.equal(last.content, mode === 2 ? '旅人: 我想找一本书' : '我想找一本书');
        assert.equal(last.name, mode === 1 ? '__' : undefined);
        const example = output.find(m => m.content.endsWith('example'));
        assert.equal(example.content, mode === 2 ? '旅人: example' : 'example');
        assert.equal(example.name, mode === 1 ? '__' : undefined);
        assert.doesNotThrow(() => generationBody({ source: 'custom', url: 'https://example.com/v1', model: 'test' }, args.preset, output));
        assert.equal(JSON.stringify(args.chat), before);
    }
});
test('disabled prompts never enter the request; post-history prompt follows conversation', () => {
    const args = input();
    args.preset.prompts.push({ identifier: 'private', content: 'must not send' });
    args.preset.prompt_order.find(p => p.character_id === 100001).order.push({ identifier: 'private', enabled: false });
    args.preset.prompts.find(p => p.identifier === 'jailbreak').content = '最后的指令';
    const output = buildPrompt(args).messages;
    assert.equal(output.at(-1).content, '最后的指令');
    assert.ok(!output.some(m => m.content === 'must not send'));
});
test('character override honors original and forbid_overrides', () => {
    const args = input(); args.character.data.system_prompt = '角色覆盖：{{original}}';
    assert.match(buildPrompt(args).messages[0].content, /^角色覆盖/);
    args.preset.prompts[0].forbid_overrides = true;
    assert.ok(!buildPrompt(args).messages[0].content.includes('角色覆盖'));
});
test('unregistered macro names remain literal like native substitution', () => {
    assert.equal(expand('{{getvar::secret}}', {}), '');
    assert.equal(expand('{{unsupported_macro}}', {}), '{{unsupported_macro}}');
    assert.equal(expand('{{char}} / {{user}}', { char: '林', user: '旅人' }), '林 / 旅人');
});
test('world activation supports keyword, selective logic, Chinese and recursion', () => {
    const books = [{ entries: {
        a: { key: ['旧书'], content: '这本书来自北塔', position: 0 },
        b: { key: ['北塔'], content: '塔门已锁', position: 1 },
        c: { key: ['书'], selective: true, keysecondary: ['不存在'], content: '不会出现' },
        d: { constant: true, disable: true, content: '停用' },
    } }];
    const entries = activateWorlds(books, [{ mes: '旧书' }], { world_info_settings: { world_info_recursive: true, world_info_match_whole_words: true } });
    assert.deepEqual(entries.map(e => e.content), ['塔门已锁', '这本书来自北塔']);
});
test('world regex validates and unsupported activation conditions block clearly', () => {
    assert.throws(() => activateWorlds([{ entries: { a: { constant: true, content: 'x', sticky: 3 } } }], []), /sticky/);
    assert.throws(() => activateWorlds([{ entries: { a: { key: ['/[bad/'], content: 'x' } } }], [{ mes: 'bad' }]), /正则无效/);
});
test('depth injection and dialogue examples use the correct roles', () => {
    const args = input(); args.character.data.mes_example = '<START>\n{{user}}:你好\n{{char}}:欢迎';
    args.books = [{ entries: { a: { constant: true, content: '深度提示', position: 4, depth: 1 } } }];
    const output = buildPrompt(args).messages;
    assert.equal(output.at(-2).content, '深度提示');
    assert.ok(output.some(m => m.role === 'assistant' && m.content === '欢迎'));
});
test('depth is relative to history even with post-history instructions', () => {
    const args = input();
    args.preset.prompts.find(p => p.identifier === 'jailbreak').content = '历史后提示';
    args.books = [{ entries: { a: { constant: true, content: '深度一', position: 4, depth: 1 } } }];
    const messages = buildPrompt(args).messages;
    assert.equal(messages.at(-1).content, '历史后提示');
    assert.equal(messages.at(-2).content, '我想找一本书');
    assert.equal(messages.at(-3).content, '深度一');
});
test('world budget respects native percentage and cap', async () => {
    const args = input(); args.preset.openai_max_context = 1000; args.preset.openai_max_tokens = 100;
    args.settings = { world_info_settings: { world_info_budget: 25, world_info_budget_cap: 50 } };
    args.books = [{ entries: { a: { constant: true, content: '应保留', order: 100 }, b: { constant: true, content: '应裁剪', order: 50 } } }];
    const result = await fitPrompt(args, messages => Promise.resolve(messages.length === 1 ? messages[0].content.includes('\n') ? 80 : 40 : 100));
    assert.equal(result.activated.length, 1); assert.equal(result.activated[0].content, '应保留');
});
test('token fitting drops oldest history but keeps latest; original chat unchanged', async () => {
    const args = input(); args.preset.openai_max_context = 800; args.preset.openai_max_tokens = 100;
    args.chat = Array.from({ length: 1000 }, (_, index) => ({ is_user: index % 2 === 0, mes: '消息' + index }));
    const output = await fitPrompt(args, messages => Promise.resolve(messages.length * 30));
    assert.ok(output.trimmed > 970); assert.ok(output.tokens <= output.budget);
    assert.equal(output.messages.at(-1).content, '消息999'); assert.equal(args.chat.length, 1000);
});
test('too-large fixed prompt is blocked and media is not silently discarded', async () => {
    const args = input(); args.preset.openai_max_context = 800; args.preset.openai_max_tokens = 100;
    await assert.rejects(() => fitPrompt(args, () => Promise.resolve(2000)), /超过上下文/);
    args.chat[0].extra = { media: [{ url: 'image.png' }] };
    assert.throws(() => buildPrompt(args), /媒体或附件/);
});
test('request builder validates provider and forwards a secret ID rather than keys', () => {
    const config = { source: 'custom', url: 'http://localhost:1234/v1', model: 'test', secretId: 'key-id' };
    const body = generationBody(config, {}, [{ role: 'user', content: 'hello' }]);
    assert.equal(body.secret_id, 'key-id'); assert.equal(body.stream, true);
    assert.ok(!Object.hasOwn(body, 'api_key')); assert.equal(config.model, 'test');
    assert.throws(() => generationBody({ ...config, url: 'javascript:alert(1)' }, {}, []), /http/);
    assert.throws(() => generationBody({ ...config, source: 'claude' }, {}, []), CompatibilityError);
});
test('SSE parser handles UTF-8 fragmented at every byte, CRLF and DONE', async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\n\n');
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    const events = [];
    for await (const event of readEvents(new Response(stream))) events.push(event);
    assert.equal(events.length, 1); assert.equal(events[0].choices[0].delta.content, '你好');
});
test('SSE parser flushes last event and rejects malformed data', async () => {
    const values = [];
    for await (const event of readEvents(new Response('data: {"ok":true}'))) values.push(event);
    assert.deepEqual(values, [{ ok: true }]);
    await assert.rejects(async () => { for await (const event of readEvents(new Response('data: broken\n\n'))) void event; }, /无法解析/);
});
test('settings writes read fresh snapshots and preserve unknown native fields', async () => {
    const originalFetch = globalThis.fetch;
    let saved = { power_user: { unrelated: 'preserve' }, custom: 1, independent_frontend: {} };
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/get') || url.endsWith('/settings')) return Response.json({ settings: JSON.stringify(saved) });
        saved = JSON.parse(options.body); return Response.json({ result: 'ok' });
    };
    try {
        const api = new TavernAPI();
        await Promise.all([
            api.patchSettings(settings => { settings.independent_frontend.preset = 'A'; }),
            api.patchSettings(settings => { settings.independent_frontend.persona = 'B'; }),
        ]);
        assert.deepEqual(saved.independent_frontend, { preset: 'A', persona: 'B' });
        assert.equal(saved.power_user.unrelated, 'preserve'); assert.equal(saved.custom, 1);
    } finally { globalThis.fetch = originalFetch; }
});


test('context fitting without world entries needs only one exact token count', async () => {
    const args = input(); let calls = 0;
    const output = await fitPrompt(args, async () => { calls++; return 100; });
    assert.equal(calls, 1);
    assert.equal(output.tokens, 100);
    assert.deepEqual(output.messages, buildPrompt(args).messages);
});
