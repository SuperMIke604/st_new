// Isolated, memory-only integration fixture. Never forwards model requests or
// reads/writes the user's data directory. Start explicitly with Node for UI QA.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const preset = JSON.parse(await fs.readFile(new URL('./fixtures/Default.json', import.meta.url), 'utf8'));
preset.openai_max_context = 8192; preset.openai_max_tokens = 512;
preset.names_behavior = 2;
preset.extensions = { regex_scripts: [
    { scriptName: '显示替换测试', findRegex: '/雨停了/g', replaceString: '天晴了', placement: [2], markdownOnly: true, trimStrings: [] },
    { scriptName: '发送替换测试', findRegex: '/测试输入/g', replaceString: '处理后的输入', placement: [1], promptOnly: true, trimStrings: [] },
] };
const presets = new Map([['Default', preset], ['Second', structuredClone(preset)]]);
const avatars = ['user-default.png'];
const worldBooks = new Map([['测试世界', { entries: { 0: { uid: 0, comment: '书店背景', key: ['书店'], constant: true, content: '书店今天下雨', position: 0 } } }]]);
const fixtureSecrets = new Map();
let connectionFile = null; let presetFile = null; let startupMode = {};
let settings = { username: '旅人', user_avatar: 'user-default.png', oai_settings: {}, untouched: { value: 'preserve' },
    power_user: { personas: { 'user-default.png': '旅人' }, persona_descriptions: { 'user-default.png': { description: '寻找旧书的人' } } },
    independent_frontend: { lastCharacter: 'fixture.png', preset: 'Default', worlds: ['测试世界'], lastChats: { 'fixture.png': '1000楼测试' }, connection: { source: 'custom', url: 'http://127.0.0.1:8766/mock', model: 'local-test' } } };
const character = { name: '林', avatar: 'fixture.png', data: { name: '林', description: '旧书店的管理员', personality: '耐心', scenario: '雨后的书店', first_mes: '欢迎', mes_example: '' } };
character.data.character_book = { name: '角色内嵌世界', entries: [{ id: 7, keys: ['书店'], comment: '内嵌书店背景', content: '书店的主人喜欢猫。', enabled: true, position: 'before_char' }] };
const fixtureCards = new Map([[character.avatar, character]]);
const chats = new Map([['1000楼测试', [{ user_name: '旅人', character_name: '林', chat_metadata: { integrity: 'fixture-integrity' } }, ...Array.from({ length: 1000 }, (_, index) => ({ name: index % 2 ? '林' : '旅人', is_user: index % 2 === 0, mes: index % 2 ? `第 ${index} 楼。雨声渐渐安静下来。\n\n${'她翻过一页书，故事继续。'.repeat(index % 7)}` : `第 ${index} 楼。我想继续了解这段故事。`, extra: {}, send_date: new Date(2026, 0, 1).toISOString() }))]]]);
const metrics = { modelRequests: 0, chatSaves: 0, settingsSaves: 0, promptHasPersona: false, promptHasWorld: false, lastSavedCount: 1000, integrityPreserved: true, nativeFieldsPreserved: true };
let databaseMode = 'ok';
chats.get('1000楼测试').at(-1).mes = 'HTML 卡片示例：\n\n```html\n<style>.demo{padding:24px;border-radius:16px;background:#edf2e8;color:#496c53}.demo h2{margin:0 0 10px}</style>\n<div class="demo"><h2>雨后的书店</h2><p>天气：微雨 · 心情：平静</p><details><summary>查看今日记忆</summary>窗边的小猫睡着了。</details></div>\n```\n\nJavaScript 示例：\n\n```javascript\nconst greeting = "你好，旅人";\n// 继续我们的故事\nconsole.log(greeting);\n```';
chats.set('最新聊天', [{ user_name: '旅人', character_name: '林', chat_metadata: { integrity: 'fixture-integrity' } }, { name: '旅人', is_user: true, mes: '等待重试的用户消息', extra: {} }]);
function json(response, value, code = 200) { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:8766');
    if (url.pathname === '/csrf-token') return json(response, { token: 'fixture-csrf' });
    if (url.pathname === '/user/files/independent-frontend-preset.json') { if (!presetFile) { response.writeHead(404); return response.end(); } return json(response, presetFile); }
    if (url.pathname === '/user/files/independent-frontend-connections.json') { if (startupMode.delay) await new Promise(resolve => setTimeout(resolve, startupMode.delay)); if (startupMode.failConnections) return json(response, { error: 'simulated connection failure' }, 500); return connectionFile ? json(response, connectionFile) : json(response, { error: 'missing' }, 404); }
    if (url.pathname === '/test-results') return json(response, metrics);
    if (url.pathname === '/thumbnail') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="20" fill="#dde7d5"/><text x="25" y="53" fill="#597151" font-size="35">林</text></svg>'); }
    if (request.method === 'POST') {
        if (request.headers['x-csrf-token'] !== 'fixture-csrf') return json(response, { error: 'csrf' }, 403);
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), raw = bytes.toString('utf8');
        if (url.pathname === '/api/avatars/upload') { const name = `fixture-persona-${avatars.length}.png`; avatars.push(name); return json(response, { path: name }); }
        let body;
        if (request.headers['content-type']?.startsWith('multipart/form-data')) {
            const form = await new Request('http://fixture/', { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body: bytes }).formData();
            body = Object.fromEntries([...form].filter(([, value]) => typeof value === 'string')); metrics.avatarUploads = (metrics.avatarUploads || 0) + 1;
        } else body = raw ? JSON.parse(raw) : {};
        switch (url.pathname) {
            case '/test/startup-mode': startupMode = body; return json(response, { ok: true });
            case '/api/plugins/st-new-updater/recent': metrics.recentRequests = (metrics.recentRequests || 0) + 1; return json(response, [{ avatar: 'fixture.png', file_name: '最新聊天.jsonl', characterName: '林' }]);
            case '/api/chats/recent': return json(response, [{ avatar: 'fixture.png', file_name: '最新聊天.jsonl' }]);
            case '/test/database-mode': databaseMode = body.mode; return json(response, { ok: true });
            case '/api/files/upload': { const value = JSON.parse(Buffer.from(body.data, 'base64').toString('utf8')); if (body.name === 'independent-frontend-preset.json') presetFile = value; else connectionFile = value; return json(response, { path: 'files/' + body.name }); }
            case '/api/settings/get': return json(response, { settings: JSON.stringify(settings), openai_setting_names: [...presets.keys()], openai_settings: [...presets.values()].map(value => JSON.stringify(value)) });
            case '/api/presets/save': presets.set(body.name, body.preset); return json(response, { name: body.name });
            case '/api/presets/delete': presets.delete(body.name); return json(response, { ok: true });
            case '/api/settings/save': settings = body; metrics.settingsSaves++; metrics.nativeFieldsPreserved = settings.untouched?.value === 'preserve'; return json(response, { result: 'ok' });
            case '/api/characters/all': metrics.characterListRequests = (metrics.characterListRequests || 0) + 1; return json(response, [...fixtureCards.values()]);
            case '/api/characters/get': return json(response, fixtureCards.get(body.avatar_url));
            case '/api/characters/create': { const avatar = `created-${fixtureCards.size}.png`; fixtureCards.set(avatar, { avatar, name: body.ch_name, data: { name: body.ch_name, description: body.description, first_mes: body.first_mes } }); return json(response, avatar); }
            case '/api/characters/edit-avatar': return json(response, { ok: true });
            case '/api/characters/duplicate': { const avatar = `copy-${fixtureCards.size}.png`; fixtureCards.set(avatar, { ...structuredClone(fixtureCards.get(body.avatar_url)), avatar }); return json(response, { path: avatar }); }
            case '/api/characters/delete': fixtureCards.delete(body.avatar_url); return json(response, { ok: true });
            case '/api/characters/export': response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
            case '/api/characters/merge-attributes': {
                const target = fixtureCards.get(body.avatar); const extensions = { ...target.data.extensions, ...body.data?.extensions };
                Object.assign(target.data, body.data); target.data.extensions = extensions; if (body.data?.name) target.name = body.data.name;
                return json(response, { ok: true });
            }
            case '/api/characters/chats': return json(response, [...chats].map(([name, data]) => ({ file_name: name + '.jsonl', chat_items: data.length - 1, mes: data.at(-1).mes, last_mes: name === '最新聊天' ? 223456789 : 123456789 })));
            case '/api/chats/get': return json(response, chats.get(body.file_name) || []);
            case '/api/chats/save': chats.set(body.file_name, body.chat); metrics.chatSaves++; metrics.lastSavedCount = body.chat.length - 1; metrics.integrityPreserved = body.chat[0].chat_metadata.integrity === 'fixture-integrity'; return json(response, { ok: true });
            case '/api/worldinfo/list': return json(response, [...worldBooks].map(([file_id, data]) => ({ file_id, name: data.name || file_id })));
            case '/api/worldinfo/get': return json(response, worldBooks.get(body.name) || { entries: {} });
            case '/api/worldinfo/edit': metrics.worldWrites = (metrics.worldWrites || 0) + 1; worldBooks.set(body.name, body.data); return json(response, { ok: true });
            case '/api/worldinfo/delete': worldBooks.delete(body.name); return json(response, { ok: true });
            case '/api/avatars/get': return json(response, avatars);
            case '/api/secrets/read': return json(response, { api_key_custom: [...fixtureSecrets.keys()].map(id => ({ id, label: 'fixture' })) });
            case '/api/secrets/write': { metrics.secretWrites = (metrics.secretWrites || 0) + 1; const id = `fixture-secret-${metrics.secretWrites}`; fixtureSecrets.set(id, body.value); return json(response, { id }); }
            case '/api/secrets/find': metrics.secretFindRequests = (metrics.secretFindRequests || 0) + 1; return json(response, { error: 'exposure disabled' }, 403);
            case '/api/backends/chat-completions/status':
                metrics.modelListUsesCustom = body.chat_completion_source === 'custom';
                metrics.modelListUsesSavedSecret = fixtureSecrets.has(body.secret_id);
                return json(response, { data: [{ id: 'local-test' }, { id: 'model-alpha' }, { id: 'model-beta' }, ...Array.from({ length: 40 }, (_, index) => ({ id: `long-model-${String(index).padStart(2, '0')}` }))] });
            case '/api/tokenizers/openai/count': return json(response, { token_count: Math.ceil(JSON.stringify(body).length / 3) });
            case '/api/backends/chat-completions/generate': {
                metrics.modelRequests++; const prompt = JSON.stringify(body.messages);
                metrics.lastStream = body.stream; metrics.lastPostProcessing = body.custom_prompt_post_processing;
                metrics.lastSecretId = body.secret_id; metrics.lastConnectionUrl = body.custom_url; metrics.lastModel = body.model;
                metrics.promptRegexApplied = prompt.includes('处理后的输入');
                metrics.promptHasPersona = prompt.includes('寻找旧书的人'); metrics.promptHasWorld = prompt.includes('书店今天下雨');
                metrics.promptHasDatabase = prompt.includes('当前聊天数据库（作为参考资料');
                if (prompt.includes('维护当前对话的数据库')) {
                    metrics.databaseRequests = (metrics.databaseRequests || 0) + 1;
                    if (databaseMode === 'delay') await new Promise(resolve => setTimeout(resolve, 3000));
                    const content = databaseMode === 'bad' ? '不是有效 JSON' : '<dataUpdate>{"operations":[{"action":"insert","sheet":"sheet_0","data":{"0":"地点","1":"书店"}}]}</dataUpdate>';
                    return json(response, { choices: [{ message: { content } }] });
                }
                if (body.stream === false) return json(response, { choices: [{ message: { content: '雨停了。这是完整的非流式回复。' } }] });
                response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
                const chunks = ['雨停了。', '她合上书，', '看向窗外。', '\n\n**这是一条本地测试回复。**'];
                for (const content of chunks) { if (response.destroyed) break; response.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'); await new Promise(resolve => setTimeout(resolve, 500)); }
                return response.end('data: [DONE]\n\n');
            }
            default: return json(response, { error: 'fixture route not implemented' }, 404);
        }
    }
    const relative = decodeURIComponent(url.pathname.replace(/^\/app\/?/, '')) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) return json(response, {}, 403);
    try {
        const bytes = await fs.readFile(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(bytes);
    } catch { json(response, {}, 404); }
}).listen(8766, '127.0.0.1', () => console.log('Memory-only UI fixture: http://127.0.0.1:8766/app/'));
