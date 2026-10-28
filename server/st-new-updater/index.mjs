import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const info = { id: 'st-new-updater', name: 'ST New Frontend Updater', description: 'Install confirmed frontend and updater updates from SuperMIke604/st_new only.' };
const RAW = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/';
const BACKEND_FILE = 'server/st-new-updater/index.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
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
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw Error(`下载失败（${response.status}）`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 8000000) throw Error('下载文件过大'); chunks.push(chunk); }
    return Buffer.concat(chunks);
}
// No chat contents or PNG metadata are read to build the home list.
export async function listRecentCharacters(directories, io = fs) {
    const cards = (await io.readdir(directories.characters, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.png'));
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
    return async (directory, kind) => {
        const files = (await io.readdir(directory, { withFileTypes: true }))
            .filter(file => file.isFile() && (kind === 'characters' ? file.name.endsWith('.png') : path.extname(file.name).toLowerCase() === '.json'))
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
export async function init(router, { root = process.cwd(), pluginFile = fileURLToPath(import.meta.url), io = fs } = {}) {
    root = path.resolve(root); let installing = false;
    const runningHash = digest(await io.readFile(pluginFile));
    const catalog = createCatalogReader({ io, readCard: filename => readCardMetadata(filename, io) });
    // Read only the authenticated user's settings. No preset or resource scans,
    // and no cache: callers use this before writes and for persisted readback.
    router.post('/settings', async (request, response) => {
        try {
            const settings = JSON.parse(await io.readFile(path.join(request.user.directories.root, 'settings.json'), 'utf8'));
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Invalid settings');
            response.set?.('Cache-Control', 'no-store');
            response.json({ settings });
        } catch { response.status(500).json({ error: '无法读取设置，请重试。' }); }
    });
    for (const [route, kind, directory] of [['/characters', 'characters', 'characters'], ['/worlds', 'worlds', 'worlds']]) router.post(route, async (request, response) => {
        try { response.json(await catalog(request.user.directories[directory], kind)); }
        catch { response.status(500).json({ error: '无法读取资源目录，请重试。' }); }
    });
    router.post('/recent', async (request, response) => {
        try { response.json(await listRecentCharacters(request.user.directories)); }
        catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/bootstrap', async (request, response) => {
        try {
            const directories = request.user.directories;
            const settings = await fs.readFile(path.join(directories.root, 'settings.json'), 'utf8');
            const names = (await fs.readdir(directories.openAI_Settings)).filter(name => name.endsWith('.json')).sort((a, b) => a.localeCompare(b));
            const openai_settings = await Promise.all(names.map(name => fs.readFile(path.join(directories.openAI_Settings, name), 'utf8')));
            response.json({ settings, openai_settings, openai_setting_names: names.map(name => name.slice(0, -5)) });
        } catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/status', async (_request, response) => {
        try {
            const installedHash = digest(await io.readFile(pluginFile));
            response.json({ available: true, selfUpdate: true, runningHash, installedHash, restartRequired: installedHash !== runningHash });
        } catch (error) { response.status(500).json({ error: error.message }); }
    });
    router.post('/install', async (request, response) => {
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
