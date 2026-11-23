import fs from 'node:fs/promises';
import { closeSync, constants, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request as requestHttp } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
export const info = { id: 'st-new-updater', name: 'ST New Frontend Updater', description: 'Install confirmed frontend and updater updates from SuperMIke604/st_new only.' };
const RAW = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/';
const CONTENTS = 'https://api.github.com/repos/SuperMIke604/st_new/contents/';
const retryableDownloadStatuses = new Set([429, 500, 502, 503, 504]);
const BACKEND_FILE = 'server/st-new-updater/index.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revisionPattern = /^[a-f0-9]{64}$/;
const displayHandle = owner => `st-display-${digest(owner).slice(0, 32)}`;
const displayOwner = profile => profile?.stNewDisplay?.owner;
const isDisplayProfile = profile => typeof displayOwner(profile) === 'string' && profile.handle === displayHandle(displayOwner(profile));
const isDisplayCard = name => /^st-display-[a-f0-9]{64}\.png$/.test(name);
const displayAvatar = name => `st-display-${digest(name)}.png`;
const derivePassword = promisify(scrypt);
const sharedSettings = {
    regex: [['extension_settings', 'regex']],
    scripts: [['extension_settings', 'tavern_helper', 'script', 'scripts'], ['extension_settings', 'TavernHelper', 'scriptsRepository']],
    connection: [['oai_settings']],
    preset: [['extension_settings', 'independent_frontend', 'preset'], ['independent_frontend', 'preset']],
};
const sharedFiles = new Set(['independent-frontend-connections.json', 'independent-frontend-preset.json']);
const sharedSecretKeys = new Set(['api_key_custom', 'api_key_openai']);
const plainFilename = value => typeof value === 'string' && value.length > 0
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(value) && !/[. ]$/.test(value)
    && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);
const safeField = key => !['__proto__', 'prototype', 'constructor'].includes(key);
const conflict = '聊天已在别处变化，请重新打开聊天后再发送。';

function applyChatDelta(directory, body, confirmed) {
    const started = performance.now();
    let phase = started;
    const timings = {};
    const mark = name => {
        const now = performance.now();
        timings[name] = now - phase;
        phase = now;
    };
    const success = revision => ({ ok: true, revision, timings: { ...timings, deltaServerMs: performance.now() - started } });
    const { avatar_url: avatar, file_name: file, base, result, patches, append } = body ?? {};
    if (!plainFilename(avatar) || !avatar.endsWith('.png') || !plainFilename(avatar.slice(0, -4))
        || avatar.slice(0, -4).includes('.png') || !plainFilename(file) || Buffer.byteLength(file + '.jsonl') > 255)
        return { status: 422, error: 'delta-unsupported' };
    if (typeof base !== 'string' || !revisionPattern.test(base) || typeof result !== 'string' || !revisionPattern.test(result)
        || !Array.isArray(patches) || patches.length > 500 || !Array.isArray(append) || append.length > 20
        || !append.every(message => record(message) && typeof message.mes === 'string')
        || Buffer.byteLength(JSON.stringify(body)) > 4000000) return { status: 400, error: '无效的聊天增量。' };
    const root = realpathSync(directory);
    const folder = path.join(root, avatar.slice(0, -4));
    const target = path.join(folder, file + '.jsonl');
    let original, stamp;
    try {
        if (!lstatSync(folder).isDirectory()) return { status: 422, error: 'delta-unsupported' };
        stamp = lstatSync(target, { bigint: true });
        if (!stamp.isFile() || stamp.size > 64n * 1024n * 1024n) return { status: 422, error: 'delta-unsupported' };
        original = readFileSync(target);
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 409, error: conflict };
        throw error;
    }
    mark('deltaReadMs');
    let current, lines;
    const separator = Buffer.from('\n');
    try {
        // Reuse validation only for byte-identical content written and verified
        // by this plugin. Native edits still take the canonical JSONL path.
        if (confirmed.target === target && digest(original) === confirmed.revision) {
            current = confirmed.revision;
            timings.deltaConfirmed = 1;
        } else {
            const records = original.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
            if (!record(records[0]) || Object.hasOwn(records[0], 'mes') || !records.every(record)) return { status: 409, error: conflict };
            lines = records.map(item => Buffer.from(JSON.stringify(item)));
            const hash = createHash('sha256');
            for (const [index, line] of lines.entries()) {
                if (index) hash.update(separator);
                hash.update(line);
            }
            current = hash.digest('hex');
            timings.deltaConfirmed = 0;
        }
    } catch (error) {
        if (error instanceof SyntaxError) return { status: 409, error: conflict };
        throw error;
    }
    mark('deltaBaseMs');
    if (current === result) return success(result);
    if (current !== base) return { status: 409, error: conflict };
    if (!lines) {
        // Confirmed files are canonical UTF-8 JSONL. Slice the bytes without
        // decoding history, and decode only records that receive a patch.
        lines = [];
        let start = 0, end;
        while ((end = original.indexOf(10, start)) !== -1) {
            lines.push(original.subarray(start, end));
            start = end + 1;
        }
        lines.push(original.subarray(start));
    }
    const seen = new Set();
    for (const patch of patches) {
        const { index, fields, remove } = patch ?? {};
        if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length || seen.has(index)
            || !record(fields) || !Array.isArray(remove) || !Object.keys(fields).every(safeField)
            || !remove.every(key => typeof key === 'string' && safeField(key))) return { status: 400, error: '无效的聊天字段。' };
        seen.add(index);
        const previous = JSON.parse(lines[index].toString('utf8'));
        const integrity = index === 0 ? previous.chat_metadata?.integrity : undefined;
        for (const key of remove) delete previous[key];
        const next = { ...previous, ...fields };
        if (index === 0 && (Object.hasOwn(next, 'mes') || next.chat_metadata?.integrity !== integrity)) return { status: 409, error: conflict };
        lines[index] = Buffer.from(JSON.stringify(next));
    }
    for (const message of append) lines.push(Buffer.from(JSON.stringify(message)));
    const chunks = [];
    for (const [index, line] of lines.entries()) {
        if (index) chunks.push(separator);
        chunks.push(line);
    }
    const updated = Buffer.concat(chunks);
    if (digest(updated) !== result) return { status: 409, error: conflict };
    mark('deltaPatchMs');
    // Keep validation and atomic replacement in one turn of the host event loop.
    // The temporary file is adjacent so rename cannot cross volumes.
    const temp = path.join(folder, '.st-new-chat-' + randomUUID() + '.tmp');
    try {
        const fd = openSync(temp, 'wx', Number(stamp.mode & 0o777n));
        try { writeFileSync(fd, updated); fsyncSync(fd); }
        finally { closeSync(fd); }
        const latest = lstatSync(target, { bigint: true });
        if (latest.ino !== stamp.ino || latest.size !== stamp.size || latest.mtimeNs !== stamp.mtimeNs || latest.ctimeNs !== stamp.ctimeNs)
            return { status: 409, error: conflict };
        renameSync(temp, target);
        mark('deltaWriteMs');
        if (digest(readFileSync(target)) !== result) return { status: 409, error: conflict };
        mark('deltaVerifyMs');
        confirmed.target = target;
        confirmed.revision = result;
        return success(result);
    } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
export function validateManifest(value) {
    if (value?.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.revision) || !value.files || typeof value.files !== 'object') throw Error('版本清单无效');
    const entries = Object.entries(value.files);
    if (!entries.length || entries.length > 100) throw Error('文件数量无效');
    for (const [name, hash] of entries) {
        if (!/^public\/app\/(?:vendor\/)?[A-Za-z0-9_.-]+$/.test(name) || name.includes('..') || !/^[a-f0-9]{64}$/.test(hash)) throw Error('文件路径或校验值无效');
    }
    for (const name of ['index.html', 'main.js', 'version.js', 'style.css']) if (!value.files['public/app/' + name]) throw Error('缺少运行文件');
    if (value.backend && (value.backend.file !== BACKEND_FILE || !/^[a-f0-9]{64}$/.test(value.backend.sha256))) throw Error('后端更新路径或校验值无效');
    return entries;
}
async function download(url) {
    const retry = new URL(url);
    const file = retry.pathname.slice(new URL(RAW).pathname.length);
    retry.searchParams.set('retry', randomUUID());
    const sources = [
        { url },
        { url: retry.href },
        { url: CONTENTS + file + '?ref=main', headers: { Accept: 'application/vnd.github.raw+json' } },
    ];
    const failures = [];
    for (const [index, source] of sources.entries()) {
        let response;
        try {
            response = await fetch(source.url, {
                signal: AbortSignal.timeout(30000), redirect: 'error', headers: source.headers,
            });
        } catch (error) {
            failures.push(error.name === 'TimeoutError' ? '请求超时' : '网络错误');
        }
        if (response?.ok) {
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > 8000000) throw Error(`下载文件过大：${file}`);
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        }
        if (response) {
            failures.push(`HTTP ${response.status}`);
            await response.body?.cancel().catch(() => {});
            if (index === 0 && !retryableDownloadStatuses.has(response.status)) break;
        }
        if (index === 0) await delay(300);
    }
    throw Error(`下载失败：${file}（${failures.join('、')}）`);
}
// No chat contents or PNG metadata are read to build the home list.
export async function listRecentCharacters(directories, io = fs, include = () => true) {
    const cards = (await io.readdir(directories.characters, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.png') && include(entry.name));
    const recent = [];
    for (const card of cards) {
        const folder = path.join(directories.chats, card.name.slice(0, -4));
        let files; try { files = await io.readdir(folder, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        let newest = null;
        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
            try { const stat = await io.stat(path.join(folder, file.name)); if (!newest || stat.mtimeMs > newest.last_mes) newest = { avatar: card.name, file_name: file.name, last_mes: stat.mtimeMs, characterName: card.name.slice(0, -4) }; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (newest) recent.push(newest);
    }
    return recent.sort((a, b) => b.last_mes - a.last_mes).slice(0, 6);
}
// Cache projections only, never full character bodies. Every listing checks
// directory membership and file stamps; edits from other clients are visible.
const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
function pngCrc(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = pngCrcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}
export async function readCardMetadata(filename, io = fs) {
    const file = await io.open(filename, 'r');
    try {
        const { size } = await file.stat(), signature = Buffer.alloc(8);
        if ((await file.read(signature, 0, 8, 0)).bytesRead !== 8 || signature.toString('hex') !== '89504e470d0a1a0a') throw new SyntaxError('Invalid PNG');
        let offset = 8, ended = false, v2, v3;
        while (offset + 12 <= size) {
            const header = Buffer.alloc(8);
            if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) throw new SyntaxError('Truncated PNG');
            const length = header.readUInt32BE(0), type = header.toString('ascii', 4, 8);
            if (offset + length + 12 > size) throw new SyntaxError('Truncated PNG chunk');
            if (offset === 8 && type !== 'IHDR') throw new SyntaxError('Missing PNG header');
            if (type === 'IHDR' || type === 'tEXt' || type === 'IEND') {
                const chunk = Buffer.alloc(length + 12); header.copy(chunk);
                let read = 0;
                while (read < length + 4) {
                    const result = await file.read(chunk, 8 + read, length + 4 - read, offset + 8 + read);
                    if (!result.bytesRead) throw new SyntaxError('Truncated PNG metadata');
                    read += result.bytesRead;
                }
                if (type !== 'IEND' && pngCrc(chunk.subarray(4, length + 8)) !== chunk.readUInt32BE(length + 8)) throw new SyntaxError('Invalid PNG metadata CRC');
                if (type === 'tEXt') {
                    const data = chunk.subarray(8, length + 8), separator = data.indexOf(0);
                    if (separator < 0 || data.indexOf(0, separator + 1) >= 0) throw new SyntaxError('Invalid PNG text');
                    const keyword = data.toString('latin1', 0, separator).toLowerCase();
                    if (keyword === 'chara' && v2 === undefined) v2 = data.subarray(separator + 1).toString('latin1');
                    if (keyword === 'ccv3' && v3 === undefined) v3 = data.subarray(separator + 1).toString('latin1');
                }
            }
            offset += length + 12;
            if (type === 'IEND') { ended = true; break; }
        }
        if (!ended) throw new SyntaxError('Missing PNG end');
        // Match native tEXt decoding and V3-over-V2 precedence, using Buffer
        // conversion rather than concatenating millions of single characters.
        if (v3 === undefined && v2 === undefined) throw new SyntaxError('Missing character metadata');
        return Buffer.from(v3 ?? v2, 'base64').toString('utf8');
    } finally { await file.close(); }
}
export function createCatalogReader({ io = fs, readCard, maxEntries = 2048, maxChars = 8000000 } = {}) {
    const cache = new Map(); let chars = 0;
    const remove = key => { const old = cache.get(key); if (old) chars -= old.size; cache.delete(key); };
    return async (directory, kind, include = () => true) => {
        const files = (await io.readdir(directory, { withFileTypes: true }))
            .filter(file => file.isFile() && include(file.name) && (kind === 'characters' ? file.name.endsWith('.png') : path.extname(file.name).toLowerCase() === '.json'))
            .sort((a, b) => a.name.localeCompare(b.name));
        const results = new Array(files.length); let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
            while (cursor < files.length) {
                const index = cursor++, file = files[index], filename = path.join(directory, file.name);
                try {
                    const stat = await io.stat(filename), stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
                    const key = kind + ':' + filename, hit = cache.get(key);
                    let value;
                    if (hit?.stamp === stamp) { value = hit.value; cache.delete(key); cache.set(key, hit); }
                    else {
                        if (kind === 'characters') {
                            const card = JSON.parse(await readCard(filename));
                            if (!card || typeof card !== 'object') continue;
                            const name = card.data?.name || card.name;
                            if (typeof name !== 'string' || !name) continue;
                            value = { avatar: file.name, name, date_added: stat.ctimeMs, create_date: card.create_date || new Date(Math.round(stat.ctimeMs)).toISOString() };
                        } else {
                            const text = await io.readFile(filename, 'utf8');
                            let book; try { book = JSON.parse(text); } catch { book = {}; }
                            const id = path.parse(file.name).name;
                            value = { file_id: id, name: book?.name || id, extensions: book?.extensions && typeof book.extensions === 'object' ? book.extensions : {} };
                        }
                        remove(key);
                        const size = JSON.stringify(value).length;
                        if (size <= Math.min(262144, maxChars)) { cache.set(key, { stamp, value, size }); chars += size; }
                        while (cache.size > maxEntries || chars > maxChars) remove(cache.keys().next().value);
                    }
                    results[index] = value;
                } catch (error) {
                    // Match native lists: skip removed or malformed files, but
                    // do not turn an unavailable parser into an empty library.
                    if (!['ENOENT', 'EISDIR'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
                }
            }
        }));
        return results.filter(Boolean);
    };
}
export async function installUpdate({ root, pluginFile, manifest, downloadFile = download, io = fs }) {
    const entries = validateManifest(manifest), id = randomUUID();
    const publicDir = path.join(root, 'public'), target = path.join(publicDir, 'app');
    const stage = path.join(publicDir, '.st-new-stage-' + id), backup = path.join(publicDir, '.st-new-backup-' + id);
    const pluginStage = pluginFile + '.stage-' + id, pluginBackup = pluginFile + '.backup-' + id;
    let moved = false, installed = false, pluginMoved = false, pluginInstalled = false, success = false, backendUpdated = false;
    try {
        await io.mkdir(stage); let total = 0;
        const checked = async (name, hash) => {
            const bytes = await downloadFile(RAW + name + '?revision=' + manifest.revision);
            total += bytes.length; if (total > 24000000) throw Error('更新内容过大');
            if (digest(bytes) !== hash) throw Error('文件校验失败，请稍后重新检查');
            return bytes;
        };
        for (const [name, hash] of entries) {
            const bytes = await checked(name, hash), destination = path.join(stage, name.slice('public/app/'.length));
            await io.mkdir(path.dirname(destination), { recursive: true }); await io.writeFile(destination, bytes);
        }
        if (manifest.backend) {
            const bytes = await checked(BACKEND_FILE, manifest.backend.sha256);
            if (digest(await io.readFile(pluginFile)) !== manifest.backend.sha256) {
                await io.writeFile(pluginStage, bytes); backendUpdated = true;
            }
        }
        // Verify all downloads before replacing either installed component.
        await io.rename(target, backup); moved = true;
        await io.rename(stage, target); installed = true;
        if (backendUpdated) {
            await io.rename(pluginFile, pluginBackup); pluginMoved = true;
            await io.rename(pluginStage, pluginFile); pluginInstalled = true;
        }
        success = true; return { backendUpdated };
    } catch (error) {
        const failures = [];
        if (pluginMoved) try { if (pluginInstalled) await io.rm(pluginFile); await io.rename(pluginBackup, pluginFile); } catch { failures.push('后端'); }
        if (moved) try { if (installed) await io.rm(target, { recursive: true, force: true }); await io.rename(backup, target); } catch { failures.push('前端'); }
        if (failures.length) throw Error(`${error.message}；${failures.join('、')}恢复失败，备份已保留，请检查安装目录。`);
        throw error;
    } finally {
        await io.rm(stage, { recursive: true, force: true }).catch(() => {});
        await io.rm(pluginStage, { force: true }).catch(() => {});
        if (success) {
            await io.rm(backup, { recursive: true, force: true }).catch(() => {});
            await io.rm(pluginBackup, { force: true }).catch(() => {});
        }
    }
}
const loopbackAddresses = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);
const jobIdPattern = /^[a-f0-9]{32}$/;

// The target is a fixed HTTP loopback URL. Use an HTTP request with no socket
// deadline so the fetch client's own header and body timers cannot stop a model.
function requestLocalModel(url, { method, headers, body, signal }) {
    return new Promise((resolve, reject) => {
        const request = requestHttp(url, { method, headers, signal, agent: false, timeout: 0 }, response => {
            // Keep the response cancellable after the outgoing request has finished.
            const stop = () => response.destroy(signal.reason);
            signal.addEventListener('abort', stop, { once: true });
            response.once('close', () => signal.removeEventListener('abort', stop));
            const status = response.statusCode;
            if (status >= 300 && status < 400) {
                response.destroy();
                reject(new Error('后台模型请求发生重定向。'));
                return;
            }
            resolve({
                status,
                ok: status >= 200 && status < 300,
                headers: { get: key => response.headers[key] },
                body: response,
            });
        });
        request.once('error', reject);
        request.end(body);
    });
}

export function registerBackgroundGeneration(router, { requestModel = requestLocalModel } = {}) {
    const jobs = new Map();
    const maxReplyChars = 4 * 1024 * 1024;

    async function generate(job, url, headers, requestBody) {
        let status = 0;
        try {
            const response = await requestModel(url, {
                method: 'POST', headers, body: JSON.stringify(requestBody),
                signal: job.controller.signal, redirect: 'error',
            });
            status = response.status;
            const declaredType = response.headers.get('content-type') || '';
            // SillyTavern's stream forwarder can pipe SSE without copying Content-Type.
            if (!requestBody.stream || declaredType.includes('text/event-stream') || !response.ok) {
                job.type = declaredType || 'application/json';
                job.status = status;
            }
            const decoder = new TextDecoder();
            for await (const chunk of response.body || []) {
                job.text += decoder.decode(chunk, { stream: true });
                if (!job.status) {
                    const prefix = job.text.trimStart();
                    const sse = /^(?::|(?:data|event|id|retry):)/.test(prefix);
                    if (sse || prefix.length >= 6 || prefix.startsWith('{') || prefix.startsWith('[')) {
                        job.type = sse ? 'text/event-stream' : declaredType || 'application/json';
                        job.status = status;
                    }
                }
                if (job.text.length > maxReplyChars) {
                    job.text = job.text.slice(0, maxReplyChars);
                    throw Error('后台回复超过可保留的大小。');
                }
            }
            job.text += decoder.decode();
        } catch (error) {
            job.error = job.controller.signal.aborted
                ? '后台生成已停止。'
                : error.message === '后台回复超过可保留的大小。' ? error.message : '后台模型连接中断，已保留收到的内容。';
        } finally {
            if (!job.status && status) {
                job.status = status;
                job.type = 'application/json';
            }
            job.done = true;
        }
    }

    router.post('/generate-background', (request, response) => {
        const socket = request.socket;
        if (!socket || socket.encrypted || !loopbackAddresses.has(socket.remoteAddress) || !loopbackAddresses.has(socket.localAddress)) {
            return response.status(404).json({ error: '后台生成仅用于手机本机的 HTTP 酒馆服务。' });
        }
        response.set('Cache-Control', 'no-store');
        const owner = request.user?.directories?.root;
        const { action, id, offset, modelRequest, recovery } = request.body || {};
        if (!owner) return response.status(400).json({ error: '无效的后台请求。' });
        if (action === 'pending') {
            const job = [...jobs.values()].reverse().find(entry => entry.owner === owner && entry.recovery);
            return response.json({ job: job?.recovery ?? null });
        }
        if (typeof id !== 'string' || !jobIdPattern.test(id)) return response.status(400).json({ error: '无效的后台请求。' });
        const job = jobs.get(id);
        if (job && job.owner !== owner) return response.status(404).json({ error: '后台请求不存在。' });

        if (action === 'start') {
            if (job) return response.json({ id });
            if (!record(modelRequest)) return response.status(400).json({ error: '无效的模型请求。' });
            if ([...jobs.values()].filter(entry => entry.owner === owner && !entry.done).length >= 4) {
                return response.status(429).json({ error: '后台生成任务过多，请等待进行中的请求结束。' });
            }
            if (jobs.size >= 64) {
                const completed = [...jobs.values()].filter(entry => entry.done);
                const reclaim = completed.find(entry => !entry.recovery) ?? completed[0];
                if (!reclaim) return response.status(429).json({ error: '后台生成任务过多，请等待进行中的请求结束。' });
                jobs.delete(reclaim.id);
            }
            const localHost = socket.localAddress === '::1' ? '[::1]' : '127.0.0.1';
            const url = `http://${localHost}:${socket.localPort}/api/backends/chat-completions/generate`;
            const headers = { 'Content-Type': 'application/json', Connection: 'close' };
            for (const key of ['cookie', 'authorization', 'x-csrf-token']) {
                if (typeof request.headers[key] === 'string') headers[key] = request.headers[key];
            }
            const next = { id, owner, controller: new AbortController(), status: 0, type: '', text: '', done: false, error: '' };
            if (record(recovery) && typeof recovery.avatar === 'string' && recovery.avatar.length <= 512
                && typeof recovery.file === 'string' && recovery.file.length <= 512
                && typeof recovery.base === 'string' && /^[a-f0-9]{64}$/.test(recovery.base)) {
                next.recovery = {
                    id, avatar: recovery.avatar, file: recovery.file, base: recovery.base,
                    regenerate: recovery.regenerate === true,
                    started: typeof recovery.started === 'string' ? recovery.started.slice(0, 32) : '',
                };
            }
            jobs.set(id, next);
            void generate(next, url, headers, modelRequest);
            return response.json({ id });
        }
        if (!job) return response.status(410).json({ error: '后台生成结果已被清理，或 Termux 中的酒馆已重启。' });
        if (action === 'cancel') {
            job.recovery = null;
            job.controller.abort();
            return response.json({ ok: true });
        }
        if (action === 'release') {
            jobs.delete(id);
            if (!job.done) job.controller.abort();
            return response.json({ ok: true });
        }
        if (action !== 'read' || !Number.isSafeInteger(offset) || offset < 0 || offset > job.text.length) {
            return response.status(400).json({ error: '无效的后台读取位置。' });
        }
        // Slice on complete Unicode characters so chunks can be encoded separately by the client.
        let end = Math.min(offset + 64 * 1024, job.text.length);
        const last = job.text.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff && end < job.text.length) end++;
        return response.json({
            status: job.status, type: job.type, text: job.text.slice(offset, end),
            done: job.done && end === job.text.length, error: job.done && end === job.text.length ? job.error : '',
        });
    });
}

function copySettingPaths(target, source, paths = Object.values(sharedSettings).flat()) {
    for (const keys of paths) {
        const value = keys.reduce((parent, key) => parent?.[key], source);
        let parent = target;
        for (const key of keys.slice(0, -1)) {
            if (!record(parent[key])) {
                if (value === undefined) { parent = null; break; }
                parent[key] = {};
            }
            parent = parent[key];
        }
        if (!parent) continue;
        if (value === undefined) delete parent[keys.at(-1)];
        else parent[keys.at(-1)] = value;
    }
    return target;
}

const settingsPath = directories => path.join(directories.root, 'settings.json');
const readSettingsFile = directories => JSON.parse(readFileSync(settingsPath(directories), 'utf8'));

function filesIn(directory) {
    try { return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function displayCards(directories, owner) {
    const published = new Set(filesIn(directories.characters).filter(isDisplayCard));
    if (!published.size) return new Map();
    return new Map(filesIn(owner.characters).filter(name => plainFilename(name.slice(0, -4)) && name.endsWith('.png'))
        .map(name => [displayAvatar(name), name]).filter(([alias]) => published.has(alias)));
}

async function linkedDisplayWorlds(directories, owner) {
    const names = new Set();
    for (const avatar of displayCards(directories, owner).values()) {
        const source = path.join(owner.characters, avatar);
        try {
            const card = JSON.parse(await readCardMetadata(source));
            const name = (card.data || card).extensions?.world;
            if (plainFilename(name)) names.add(name);
        } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
    }
    return names;
}

export function mergeDisplayChats(directories, owner, alias, avatar) {
    const source = path.join(directories.chats, alias.slice(0, -4));
    const target = path.join(owner.chats, avatar.replace('.png', ''));
    const files = filesIn(source).filter(name => name.endsWith('.jsonl'));
    if (!files.length) return;
    if (!lstatSync(source).isDirectory()) throw Error('Invalid display chat folder');
    mkdirSync(target, { recursive: true });
    if (!lstatSync(target).isDirectory()) throw Error('Invalid original chat folder');
    const archive = path.join(directories.root, 'display-chat-migration', alias.slice(0, -4));
    mkdirSync(archive, { recursive: true });
    for (const name of files) {
        const pending = path.join(source, name);
        const original = path.join(target, name);
        try { copyFileSync(pending, original, constants.COPYFILE_EXCL); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const display = readFileSync(pending);
            if (!readFileSync(original).equals(display)) {
                const alternate = path.join(target, `展示版-${digest(name + ':' + digest(display)).slice(0, 24)}.jsonl`);
                try { copyFileSync(pending, alternate, constants.COPYFILE_EXCL); }
                catch (duplicate) { if (duplicate.code !== 'EEXIST' || !readFileSync(alternate).equals(display)) throw duplicate; }
            }
        }
        renameSync(pending, path.join(archive, `${randomUUID()}-${name.slice(-150)}`));
    }
}

export function registerSharedDisplayConfig(router, { getDirectories, writeSettings }) {
    // The host mounts its user files router at / before the native API routers.
    router.use(async (request, response, next) => {
        if (!isDisplayProfile(request.user?.profile)) return next();
        const route = request.path;
        const directories = request.user.directories;
        const owner = getDirectories(displayOwner(request.user.profile));
        const body = request.body;
        const post = request.method === 'POST';
        const useDirectories = overrides => { request.user.directories = { ...directories, ...overrides }; };
        try {
            const isChat = route === '/api/characters/chats' || /^\/api\/chats\/(?:get|save|rename|delete|export|search)$/.test(route);
            const isCard = route === '/api/characters/get' || route === '/api/characters/merge-attributes';
            const field = route === '/api/characters/merge-attributes' ? 'avatar' : 'avatar_url';
            if (post && (isChat || isCard) && isDisplayCard(body?.[field])) {
                const alias = body[field];
                const avatar = displayCards(directories, owner).get(alias);
                if (!avatar) return response.status(404).json({ error: '此角色已撤下展示。' });
                body[field] = avatar;
                if (isChat) {
                    mergeDisplayChats(directories, owner, alias, avatar);
                    useDirectories({ chats: owner.chats });
                    body.is_group = false;
                    delete body.force;
                } else {
                    useDirectories({ characters: owner.characters, chats: owner.chats });
                    if (route === '/api/characters/get') {
                        const json = response.json.bind(response);
                        response.json = card => json(record(card) ? { ...card, avatar: alias } : card);
                    }
                }
            } else if (post && /^\/api\/worldinfo\/(?:get|edit|delete)$/.test(route) && plainFilename(body?.name)) {
                if ((await linkedDisplayWorlds(directories, owner)).has(body.name)) useDirectories({ worlds: owner.worlds });
            } else if (post && route === '/api/settings/get') {
                useDirectories({ openAI_Settings: owner.openAI_Settings });
                const json = response.json.bind(response);
                response.json = bundle => json(typeof bundle?.settings === 'string' ? {
                    ...bundle, settings: JSON.stringify(copySettingPaths(JSON.parse(bundle.settings), readSettingsFile(owner))),
                } : bundle);
            } else if (post && route === '/api/settings/save' && record(body)) {
                const scope = request.get('X-ST-New-Shared-Setting');
                if (scope === 'regex' || scope === 'scripts') {
                    const current = copySettingPaths(readSettingsFile(owner), body, sharedSettings[scope]);
                    writeSettings(settingsPath(owner), JSON.stringify(current, null, 4), 'utf8');
                }
                copySettingPaths(body, readSettingsFile(directories));
            } else if (post && /^\/api\/presets\/(?:save|delete|restore)$/.test(route) && body?.apiId === 'openai') {
                useDirectories({ openAI_Settings: owner.openAI_Settings });
            } else if (post && route === '/api/files/upload' && sharedFiles.has(body?.name)) {
                useDirectories({ root: owner.root, files: owner.files });
            } else if (['GET', 'HEAD'].includes(request.method) && [...sharedFiles].some(name => route === `/user/files/${name}`)) {
                useDirectories({ files: owner.files });
            } else if (post && route === '/api/secrets/read') {
                useDirectories({ root: owner.root });
                const send = response.send.bind(response);
                response.send = value => send(record(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => sharedSecretKeys.has(key))) : value);
            } else if (post && route === '/api/secrets/write' && sharedSecretKeys.has(body?.key)) {
                useDirectories({ root: owner.root });
            } else if (post && /^\/api\/backends\/chat-completions\/(?:generate|status)$/.test(route) && ['custom', 'openai'].includes(body?.chat_completion_source)) {
                if (body.chat_completion_source === 'custom') {
                    const file = path.join(owner.files, 'independent-frontend-connections.json');
                    const normalize = url => typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
                    let profiles = [];
                    try { profiles = JSON.parse(readFileSync(file, 'utf8')).profiles; }
                    catch (error) { if (error.code !== 'ENOENT') throw error; }
                    if (!Array.isArray(profiles) || !profiles.some(profile => profile?.source === 'custom' && normalize(profile.url) === normalize(body.custom_url) && (profile.secretId || '') === (body.secret_id || ''))) return next();
                } else if (body.reverse_proxy) return next();
                useDirectories({ root: owner.root });
            }
        } catch {
            return response.status(500).json({ error: '读取或保存共享配置失败，请重试。' });
        }
        return next();
    });
    router.stack.unshift(router.stack.pop());
}

async function loadDisplayHost(root) {
    const fromHost = file => import(pathToFileURL(path.join(root, 'src', file)).href);
    const [users, config, http, endpoints, content] = await Promise.all([
        fromHost('users.js'), fromHost('util.js'), fromHost('express-common.js'),
        fromHost('endpoints/users-public.js'), fromHost('endpoints/content-manager.js'),
    ]);
    if (!config.getConfigValue('enableUserAccounts', false, 'boolean')) return null;
    const require = createRequire(path.join(root, 'package.json'));
    const storage = require('node-persist');
    registerSharedDisplayConfig(users.router, { getDirectories: users.getUserDirectories, writeSettings: require('write-file-atomic').sync });
    const { RateLimiterMemory, RateLimiterRes } = require('rate-limiter-flexible');
    const getProfile = handle => storage.getItem(users.toKey(handle));
    const saveProfile = profile => storage.setItem(users.toKey(profile.handle), profile);
    const points = config.getConfigValue('rateLimiting.accountsLoginMaxAttempts', 5, 'number');
    const preferReportedIp = config.getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
    const limiter = new RateLimiterMemory({ points: points > 0 ? points : Number.MAX_SAFE_INTEGER, duration: 60 });
    registerAccountLogin(endpoints.router, {
        getProfile, accountVersion: users.getAccountVersion,
        async consume(request, response) {
            const ip = http.getIpAddress(request, preferReportedIp);
            try { await limiter.consume(ip); }
            catch (error) {
                if (!(error instanceof RateLimiterRes)) throw error;
                http.retryAfter(response, error).sendStatus(429);
                return null;
            }
            return () => limiter.delete(ip);
        },
    });
    return {
        getProfile, saveProfile, getDirectories: users.getUserDirectories,
        createSalt: users.getPasswordSalt,
        async initialize(handle) {
            const directories = users.getUserDirectories(handle);
            await Promise.all(Object.values(directories).map(directory => fs.mkdir(directory, { recursive: true })));
            await content.checkForNewContent([directories], [content.CONTENT_TYPES.SETTINGS]);
            await fs.access(path.join(directories.root, 'settings.json'));
        },
    };
}

async function hashPassword(password, salt) {
    return (await derivePassword(password.normalize(), salt, 64)).toString('base64');
}

async function passwordMatches(password, record) {
    if (typeof record?.password !== 'string' || !record.password || typeof record.salt !== 'string') return false;
    const actual = Buffer.from(await hashPassword(password, record.salt), 'base64');
    const expected = Buffer.from(record.password, 'base64');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function findDisplayProfile(getProfile, owner) {
    const candidate = await getProfile(displayHandle(owner));
    return isDisplayProfile(candidate) && displayOwner(candidate) === owner && !candidate.admin ? candidate : null;
}

export function registerAccountLogin(router, { getProfile, accountVersion, consume }) {
    router.post('/st-new-login', async (request, response) => {
        response.set('X-ST-New-Login', '1');
        response.set('Cache-Control', 'no-store');
        try {
            const clearLimit = await consume(request, response);
            if (!clearLimit) return;
            const { handle, password } = request.body ?? {};
            if (typeof handle !== 'string' || !handle || typeof password !== 'string' || !password || !request.session) return response.sendStatus(403);
            const original = await getProfile(handle);
            if (!original?.enabled || !original.password || isDisplayProfile(original)) return response.sendStatus(403);

            let profile = original;
            if (!await passwordMatches(password, original)) {
                profile = await findDisplayProfile(getProfile, handle);
                if (!profile?.enabled || !await passwordMatches(password, profile.stNewDisplay)) return response.sendStatus(403);
            }
            // Re-read after hashing so a concurrent password rotation cannot issue an old session.
            const current = await getProfile(profile.handle);
            if (!current?.enabled || accountVersion(current) !== accountVersion(profile)) return response.sendStatus(403);
            const currentOwner = await getProfile(handle);
            if (!currentOwner?.enabled || accountVersion(currentOwner) !== accountVersion(original)) return response.sendStatus(403);
            await clearLimit();
            request.session = { handle: profile.handle, version: accountVersion(profile) };
            return response.json({ handle });
        } catch {
            return response.sendStatus(500);
        }
    });
}

function originalSession(request) {
    const profile = request.user?.profile;
    return profile?.handle && request.session?.handle === profile.handle && profile.password && !isDisplayProfile(profile) ? profile : null;
}

function registerDisplayCards(router, { io, displayHost }) {
    const pending = new Map();
    const passwordChanges = new Set();
    router.post('/display-password', async (request, response) => {
        const owner = originalSession(request);
        if (!owner) return response.status(403).json({ error: '请在原版中设置展示密码。' });
        if (!displayHost) return response.status(503).json({ error: '展示版登录功能不可用，请检查插件是否已重新启动。' });
        const { password } = request.body ?? {};
        if (typeof password !== 'string' || !password.trim()) return response.status(400).json({ error: '请输入展示密码。' });
        if (passwordChanges.has(owner.handle)) return response.status(409).json({ error: '正在保存展示密码。' });
        passwordChanges.add(owner.handle);
        try {
            if (await passwordMatches(password, owner)) return response.status(400).json({ error: '展示密码必须与原版密码不同。' });
            const { getProfile, saveProfile, createSalt, initialize } = displayHost;
            const handle = displayHandle(owner.handle);
            const existing = await getProfile(handle);
            if (existing && (!isDisplayProfile(existing) || displayOwner(existing) !== owner.handle)) {
                return response.status(409).json({ error: '展示版数据当前不可用。' });
            }
            const salt = createSalt();
            const alternateSalt = createSalt();
            const [storagePassword, alternatePassword] = await Promise.all([
                hashPassword(randomBytes(32).toString('hex'), salt), hashPassword(password, alternateSalt),
            ]);
            await initialize(handle);
            await saveProfile({
                handle, name: owner.name || owner.handle, created: existing?.created ?? Date.now(), admin: false, enabled: true,
                password: storagePassword, salt, stNewDisplay: { owner: owner.handle, password: alternatePassword, salt: alternateSalt },
            });
            return response.json({ configured: true });
        } catch {
            return response.status(500).json({ error: '展示密码保存失败，请重试。' });
        } finally {
            passwordChanges.delete(owner.handle);
        }
    });
    router.post('/display-card', async (request, response) => {
        const owner = originalSession(request);
        if (!owner) {
            return response.status(403).json({ error: '请在原版中管理展示角色。' });
        }
        const { avatar, enabled } = request.body ?? {};
        if (!plainFilename(avatar) || !avatar.endsWith('.png') || (enabled !== undefined && typeof enabled !== 'boolean')) {
            return response.status(400).json({ error: '无效的角色卡或展示状态。' });
        }
        const name = displayAvatar(avatar);
        const key = `${owner.handle}/${name}`;
        const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
            if (!displayHost) return { available: false, enabled: false };
            const { getProfile, getDirectories } = displayHost;
            const backingProfile = await findDisplayProfile(getProfile, owner.handle);
            if (!backingProfile) return enabled === true ? null : { available: false, enabled: false };
            const available = Boolean(backingProfile.enabled);
            const directory = getDirectories(backingProfile.handle).characters;
            const destination = path.join(directory, name);
            if (enabled === false) {
                await io.unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
                return { available, enabled: false };
            }
            if (enabled === true && !available) return null;
            if (enabled === undefined) {
                const stat = await io.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
                return { available, enabled: Boolean(stat?.isFile()) };
            }
            const source = path.join(request.user.directories.characters, avatar);
            const stat = await io.lstat(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
            if (!stat?.isFile()) return { missing: true };
            const temporary = path.join(directory, `.${randomUUID()}.tmp`);
            try {
                await io.copyFile(source, temporary);
                const card = JSON.parse(await readCardMetadata(temporary, io));
                if (!(card?.data?.name || card?.name)) throw Error('Invalid card');
                await io.rename(temporary, destination);
            } finally {
                await io.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
            return { available, enabled: true };
        });
        pending.set(key, task);
        try {
            const result = await task;
            if (!result) return response.status(409).json({ error: '请先在原版中设置展示密码。' });
            if (result.missing) return response.status(404).json({ error: '原版角色卡已不存在。' });
            response.set?.('Cache-Control', 'no-store');
            return response.json(result);
        } catch {
            return response.status(500).json({ error: '无法读取或保存展示状态，请重试。' });
        } finally {
            if (pending.get(key) === task) pending.delete(key);
        }
    });
}

export async function init(router, { root = process.cwd(), pluginFile = fileURLToPath(import.meta.url), io = fs, displayHost } = {}) {
    root = path.resolve(root); let installing = false;
    const runningHash = digest(await io.readFile(pluginFile));
    const catalog = createCatalogReader({ io, readCard: filename => readCardMetadata(filename, io) });
    const confirmedChat = {};
    const inDisplay = request => isDisplayProfile(request.user?.profile);
    if (displayHost === undefined && globalThis.DATA_ROOT) {
        try { displayHost = await loadDisplayHost(root); }
        catch { console.warn('ST New: account login integration unavailable.'); }
    }
    registerDisplayCards(router, { io, displayHost });
    const sharedDirectories = request => inDisplay(request) ? displayHost?.getDirectories(displayOwner(request.user.profile)) : null;
    const readViewSettings = async request => {
        const settings = JSON.parse(await io.readFile(settingsPath(request.user.directories), 'utf8'));
        if (!record(settings)) throw Error('Invalid settings');
        const shared = sharedDirectories(request);
        return shared ? copySettingPaths(settings, JSON.parse(await io.readFile(settingsPath(shared), 'utf8'))) : settings;
    };
    registerBackgroundGeneration(router);
    router.post('/chat-delta', (request, response) => {
        try {
            const directories = request.user.directories;
            const shared = sharedDirectories(request);
            let body = request.body;
            if (shared && isDisplayCard(body?.avatar_url)) {
                const avatar = displayCards(directories, shared).get(body.avatar_url);
                if (!avatar) return response.status(404).json({ error: '此角色已撤下展示。' });
                mergeDisplayChats(directories, shared, body.avatar_url, avatar);
                body = { ...body, avatar_url: avatar };
            }
            const { timings, ...result } = applyChatDelta(shared && isDisplayCard(request.body?.avatar_url) ? shared.chats : directories.chats, body, confirmedChat);
            if (result.status) return response.status(result.status).json({ error: result.error });
            response.set?.('Server-Timing', Object.entries(timings).map(([key, value]) => `${key};dur=${value.toFixed(2)}`).join(', '));
            return response.json(result);
        } catch { return response.status(500).json({ error: '聊天增量保存失败，请重试。' }); }
    });
    // No preset scans or cache: callers use this before writes and for readback.
    router.post('/settings', async (request, response) => {
        try {
            const settings = await readViewSettings(request);
            response.set?.('Cache-Control', 'no-store');
            response.json({ settings });
        } catch { response.status(500).json({ error: '无法读取设置，请重试。' }); }
    });
    for (const [route, kind, directory] of [['/characters', 'characters', 'characters'], ['/worlds', 'worlds', 'worlds']]) router.post(route, async (request, response) => {
        const include = kind === 'characters' && inDisplay(request) ? isDisplayCard : undefined;
        try {
            const directories = request.user.directories;
            const shared = sharedDirectories(request);
            if (shared && kind === 'characters') {
                const cards = displayCards(directories, shared);
                const aliases = new Map([...cards].map(([alias, avatar]) => [avatar, alias]));
                const items = await catalog(shared.characters, kind, name => aliases.has(name));
                return response.json(items.map(card => ({ ...card, avatar: aliases.get(card.avatar) })));
            }
            const local = await catalog(directories[directory], kind, include);
            if (!shared || kind !== 'worlds') return response.json(local);
            const names = await linkedDisplayWorlds(directories, shared);
            const books = await catalog(shared.worlds, kind, filename => names.has(path.parse(filename).name));
            return response.json([...local.filter(book => !names.has(book.file_id)), ...books]);
        }
        catch { response.status(500).json({ error: '无法读取资源目录，请重试。' }); }
    });
    router.post('/recent', async (request, response) => {
        try {
            const directories = request.user.directories;
            const display = inDisplay(request);
            const shared = sharedDirectories(request);
            if (shared) {
                const aliases = new Map([...displayCards(directories, shared)].map(([alias, avatar]) => [avatar, alias]));
                for (const [avatar, alias] of aliases) mergeDisplayChats(directories, shared, alias, avatar);
                const recent = await listRecentCharacters(shared, io, name => aliases.has(name));
                const avatars = new Set(recent.map(item => item.avatar));
                const names = new Map((await catalog(shared.characters, 'characters', name => avatars.has(name))).map(card => [card.avatar, card.name]));
                return response.json(recent.map(item => ({ ...item, avatar: aliases.get(item.avatar), characterName: names.get(item.avatar) || item.characterName })));
            }
            const recent = await listRecentCharacters(directories, io, display ? isDisplayCard : undefined);
            if (display && recent.length) {
                const recentAvatars = new Set(recent.map(item => item.avatar));
                const names = new Map((await catalog(directories.characters, 'characters', name => recentAvatars.has(name)))
                    .map(card => [card.avatar, card.name]));
                return response.json(recent.filter(item => names.has(item.avatar)).map(item => ({ ...item, characterName: names.get(item.avatar) })));
            }
            return response.json(recent);
        }
        catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/bootstrap', async (request, response) => {
        try {
            const presetDirectory = (sharedDirectories(request) ?? request.user.directories).openAI_Settings;
            const settings = JSON.stringify(await readViewSettings(request));
            const names = (await fs.readdir(presetDirectory)).filter(name => name.endsWith('.json')).sort((a, b) => a.localeCompare(b));
            const openai_settings = await Promise.all(names.map(name => fs.readFile(path.join(presetDirectory, name), 'utf8')));
            const account = inDisplay(request) ? displayOwner(request.user.profile) : request.session?.handle || '';
            const displayTavern = inDisplay(request) ? 'display' : displayHost && originalSession(request) ? 'owner' : null;
            const needsPrimaryPassword = Boolean(displayHost && !displayTavern && account && account === request.user.profile?.handle && !request.user.profile.password);
            response.json({ settings, openai_settings, openai_setting_names: names.map(name => name.slice(0, -5)), account, displayTavern, needsPrimaryPassword });
        } catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/status', async (_request, response) => {
        try {
            const installedHash = digest(await io.readFile(pluginFile));
            response.json({ available: true, selfUpdate: true, runningHash, installedHash, restartRequired: installedHash !== runningHash });
        } catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/install', async (request, response) => {
        if (inDisplay(request)) return response.status(403).json({ error: '请在原版中安装前端更新。' });
        if (installing) return response.status(409).json({ error: '正在安装更新' });
        installing = true;
        try {
            const manifest = JSON.parse((await download(RAW + 'version.json?t=' + Date.now())).toString('utf8'));
            validateManifest(manifest);
            if (manifest.revision !== request.body?.revision) throw Error('远端版本已变化，请重新检查更新');
            const result = await installUpdate({ root, pluginFile, manifest, io });
            const restartRequired = digest(await io.readFile(pluginFile)) !== runningHash;
            response.json({ ok: true, revision: manifest.revision, ...result, restartRequired });
        } catch (error) { response.status(500).json({ error: error.message }); }
        finally {
            installing = false;
        }
    });
}
