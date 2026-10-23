import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const info = { id: 'st-new-updater', name: 'ST New Frontend Updater', description: 'Install confirmed frontend updates from SuperMIke604/st_new only.' };
const RAW = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/';
export function validateManifest(value) {
    if (value?.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.revision) || !value.files || typeof value.files !== 'object') throw Error('版本清单无效');
    const entries = Object.entries(value.files);
    if (!entries.length || entries.length > 100) throw Error('文件数量无效');
    for (const [name, hash] of entries) {
        if (!/^public\/app\/(?:vendor\/)?[A-Za-z0-9_.-]+$/.test(name) || name.includes('..') || !/^[a-f0-9]{64}$/.test(hash)) throw Error('文件路径或校验值无效');
    }
    for (const name of ['index.html', 'main.js', 'version.js', 'style.css']) if (!value.files['public/app/' + name]) throw Error('缺少运行文件');
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
export async function init(router) {
    const publicDir = path.resolve('public'); const target = path.join(publicDir, 'app'); let installing = false;
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
    router.post('/status', (_request, response) => response.json({ available: true }));
    router.post('/install', async (request, response) => {
        if (installing) return response.status(409).json({ error: '正在安装更新' });
        installing = true; let stage, backup, moved = false;
        try {
            const manifest = JSON.parse((await download(RAW + 'version.json?t=' + Date.now())).toString('utf8'));
            const entries = validateManifest(manifest);
            if (manifest.revision !== request.body?.revision) throw Error('远端版本已变化，请重新检查更新');
            stage = path.join(publicDir, '.st-new-stage-' + randomUUID());
            backup = path.join(publicDir, '.st-new-backup-' + randomUUID());
            await fs.mkdir(stage); let total = 0;
            for (const [name, hash] of entries) {
                const bytes = await download(RAW + name + '?revision=' + manifest.revision);
                total += bytes.length; if (total > 24000000) throw Error('更新内容过大');
                if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('文件校验失败，请稍后重新检查');
                const destination = path.join(stage, name.slice('public/app/'.length));
                await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
            }
            await fs.rename(target, backup); moved = true;
            try { await fs.rename(stage, target); stage = null; } catch (error) { moved = false; await fs.rename(backup, target); throw error; }
            response.json({ ok: true, revision: manifest.revision });
        } catch (error) { response.status(500).json({ error: error.message }); }
        finally {
            if (stage) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
            if (moved) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
            installing = false;
        }
    });
}
