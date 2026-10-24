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
