import { scriptSupport } from './scripts.js';
import { scriptBridge } from './script-bridge.js';
import { roleScriptContent } from './role-script-adapters.js';
import { scriptModuleUrls, loadScriptModules, loadMvuLibraries, requireMvuHost } from './script-modules.js';
import { scriptHelper, helperStartup, SCRIPT_API_NAMES } from './script-helper.js';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function scriptClip(rects, width, height) {
    if (!Array.isArray(rects) || rects.length > 64) return 'path("M0 0Z")';
    const paths = rects.flatMap(rect => {
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return [];
        const [x, y, w, h] = rect, left = Math.max(0, x), top = Math.max(0, y), right = Math.min(width, x + w), bottom = Math.min(height, y + h);
        if (w <= 0 || h <= 0 || right <= left || bottom <= top) return [];
        return [`M${left} ${top}H${right}V${bottom}H${left}Z`];
    });
    return `path("${paths.join(' ') || 'M0 0Z'}")`;
}
export function scriptDocument(scripts, snapshot, jquery) {
    const remoteScript = scripts.find(script => script.enabled !== false && scriptModuleUrls(script.content));
    const remote = !!remoteScript;
    const defaultScript = remoteScript || scripts.find(script => script.enabled !== false && scriptSupport(script).supported);
    const remoteId = defaultScript ? `${defaultScript.scope || 'script'}-${defaultScript.id || scripts.indexOf(defaultScript)}` : '';
    // The requested bundle imports its npm dependencies from this same CDN.
    // Module fetching uses script-src; no arbitrary fetch/model endpoints are opened.
    const policy = `default-src 'none'; script-src 'unsafe-inline'${remote ? ' https://testingcf.jsdelivr.net' : ''}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'`;
    const tag = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    const runs = scripts.flatMap((script, index) => {
        const support = scriptSupport(script);
        if (script.enabled === false || !support.supported) return [];
        const id = `${script.scope || 'script'}-${script.id || index}`;
        const urls = support.adapter === 'remote-module' ? scriptModuleUrls(script.content) : null;
        const content = urls ? `(${requireMvuHost.toString()})(); await (${loadScriptModules.toString()})(['MVU公共运行库'],()=>(${loadMvuLibraries.toString()})()); await (${loadScriptModules.toString()})(${json(urls)}); await window.__helperWaitForStartup(); window.__scriptReport({type:'helper-ready',id:${json(id)}});` : roleScriptContent(script, support.adapter);
        const bindings = SCRIPT_API_NAMES.join(',');
        return [tag(`(async()=>{const {${bindings}}=window.__scriptScope(${json(id)},${json(script.button?.buttons || [])});try{\n${content}\nwindow.__scriptReport({type:'executed',id:${json(id)}});}catch(error){window.__scriptReport({type:'failed',id:${json(id)},text:${json(script.name || '脚本')}+': '+error.message,error:true});}})();`)];
    });
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;font:14px system-ui;background:#f5f0e7}#script-empty{margin:20px;padding:16px;border:1px solid #c9bcaa;border-radius:12px;line-height:1.8;color:#66594c}#script-actions{position:fixed;bottom:8px;left:8px;z-index:10000;display:flex;gap:5px;flex-wrap:wrap}#script-actions button{padding:7px;border:1px solid #bba78e;background:#fff7e8;border-radius:8px}</style><div id="script-empty" role="status">正在启动角色卡脚本…</div><div id="script-actions"></div>${tag(`(${scriptBridge.toString()})(${json(snapshot)},${json({ externalMvu: remote, scriptId: remoteId, scriptButtons: defaultScript?.button?.buttons || [] })},${scriptHelper.toString()});`)}${tag(jquery)}${remote ? tag(`(${helperStartup.toString()})();`) : ''}${runs.join('')}`;
}
export class ScriptRuntime {
    constructor({ notify, applyVariables, worldbook, roleAction, helperAction, onRetry }) { Object.assign(this, { notify, applyVariables, worldbook, roleAction, helperAction, onRetry }); this.dialog = null; this.frame = null; this.identity = ''; this.epoch = 0; this.jquery = null; this.statusRows = new Map(); this.buttons = new Map(); this.helperReady = false; this.helperError = ''; this.helperWaiters = new Set(); this.pendingEvents = new Map(); this.eventSequence = 0; this.processing = false; this.listener = event => void this.receive(event); }
    dispose() { for (const waiter of this.helperWaiters) waiter.reject(Error('脚本环境已关闭。')); this.helperWaiters.clear(); this.helperError = ''; for (const pending of this.pendingEvents.values()) { clearTimeout(pending.timer); pending.reject(Error('脚本环境已关闭。')); } this.pendingEvents.clear(); this.helperReady = false; this.processing = false; this.epoch++; clearTimeout(this.readyTimer); window.removeEventListener('message', this.listener); this.dialog?.remove(); this.frame?.remove(); this.actions?.replaceChildren(); if (this.actions) this.actions.hidden = true; document.getElementById('quick-replies-toggle')?.setAttribute('aria-expanded', 'false'); this.dialog = null; this.frame = null; this.identity = ''; this.statusRows.clear(); this.buttons.clear(); }
    refresh(snapshot, identity) {
        if (!this.frame) return;
        if (identity !== this.identity) { this.dispose(); return; }
        this.frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'snapshot', snapshot }, '*');
    }
    async dispatch(event, args, snapshot, identity) {
        if (!this.frame || identity !== this.identity) return false;
        if (![...this.statusRows.values()].some(row => row.dataset?.active === 'true')) return false;
        if (this.processing) throw Error('角色脚本正在处理上一项操作，请稍候。');
        const epoch = this.epoch;
        this.processing = true;
        try {
            if (!this.helperReady) await new Promise((resolve, reject) => {
                if (this.helperError) { reject(Error(this.helperError)); return; }
                const timer = setTimeout(() => { this.helperWaiters.delete(waiter); if (epoch === this.epoch) this.dispose(); reject(Error('原始 MVU 初始化未完成，脚本环境已停止，请重新启动。')); }, 45000);
                const waiter = { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } };
                this.helperWaiters.add(waiter);
            });
            if (!this.frame || identity !== this.identity) throw Error('脚本环境或聊天已切换。');
            const id = ++this.eventSequence;
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => { this.pendingEvents.delete(id); if (epoch === this.epoch) this.dispose(); reject(Error('角色脚本事件处理超时，脚本环境已停止。')); }, 30000);
                this.pendingEvents.set(id, { resolve, reject, timer });
                this.frame.contentWindow.postMessage({ channel: 'st-new-scripts', type: 'helper-event', id, event, args, snapshot }, '*');
            });
            return true;
        } finally { if (epoch === this.epoch) this.processing = false; }
    }
    async show({ scripts, snapshot, identity, preparation = '', diagnostics = true, actions }) {
        if (this.frame && this.identity === identity) { if (diagnostics && !this.dialog.open) this.dialog.showModal(); this.refresh(snapshot, identity); return; }
        this.dispose(); this.identity = identity; const epoch = this.epoch;
        if (!this.jquery) {
            const response = await fetch('./vendor/jquery.min.js', { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw Error('脚本运行库读取失败'); this.jquery = await response.text();
            if (!this.jquery.includes('jQuery v')) { this.jquery = null; throw Error('脚本运行库内容异常，请检查更新后重试。'); }
        }
        if (epoch !== this.epoch) return;
        const dialog = document.createElement('dialog'); dialog.className = 'script-runtime-dialog';
        const header = document.createElement('header'); header.className = 'panel-header';
        const title = document.createElement('h1'); title.textContent = '脚本面板';
        const close = document.createElement('button'); close.textContent = '关闭'; close.type = 'button'; close.className = 'button'; close.onclick = () => dialog.close();
        const retry = document.createElement('button'); retry.textContent = '重新启动'; retry.type = 'button'; retry.className = 'button'; retry.onclick = () => { this.dispose(); void Promise.resolve(this.onRetry?.()).catch(error => this.notify(error.message, true)); }; header.append(title, retry, close);
        if (scripts.some(script => script.enabled !== false && scriptSupport(script).adapter === 'remote-module')) {
            const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'button'; settings.textContent = '脚本设置';
            settings.onclick = () => { if (!this.helperReady) { this.notify('原始脚本尚未完成初始化，请查看脚本状态。', true); return; } dialog.close(); this.frame?.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'helper-settings' }, '*'); };
            header.append(settings);
        }
        const note = document.createElement('p'); note.className = 'note script-runtime-note'; note.textContent = preparation || '运行已启用的全局和角色脚本，统一提供原生助手接口。'; this.note = note;
        const statuses = document.createElement('details'); statuses.className = 'script-runtime-status';
        const summary = document.createElement('summary'); summary.textContent = `${snapshot.characterName || '当前角色'} · 脚本状态（${scripts.length}）`; statuses.append(summary);
        scripts.forEach((script, index) => {
            const support = scriptSupport(script), row = document.createElement('p'), name = document.createElement('strong'), detail = document.createElement('span');
            name.textContent = script.name || '未命名脚本'; detail.dataset.adapter = support.adapter || ''; detail.dataset.active = String(script.enabled !== false && support.supported); detail.textContent = script.enabled === false ? '已停用' : support.supported ? `待启动 · ${support.reason}` : support.reason; row.append(name, detail); statuses.append(row);
            this.statusRows.set(`${script.scope || 'script'}-${script.id || index}`, detail);
        });
        statuses.open = !scripts.some(script => script.enabled !== false && scriptSupport(script).supported);
        const frame = document.createElement('iframe'); frame.className = 'script-page-frame'; frame.title = '角色卡小手机与脚本'; frame.style.clipPath = scriptClip([]); frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads'); frame.referrerPolicy = 'no-referrer';
        this.actions = actions; actions?.replaceChildren();
        this.dialog = dialog; this.frame = frame; this.identity = identity;
        window.addEventListener('message', this.listener); dialog.append(header, note, statuses); document.body.append(dialog, frame); if (diagnostics) dialog.showModal();
        frame.srcdoc = scriptDocument(scripts, { ...snapshot, pageDisplay: true }, this.jquery);
        this.readyTimer = setTimeout(() => { if (this.frame === frame) { note.textContent = '未收到脚本启动确认。请查看脚本状态，或点击“重新启动”。'; statuses.open = true; } }, 8000);
    }
    async receive(event) {
        if (!this.frame || event.source !== this.frame.contentWindow || event.data?.channel !== 'st-new-scripts') return;
        const data = event.data;
        if (data.type === 'layout') { this.frame.style.clipPath = scriptClip(data.rects, this.frame.clientWidth, this.frame.clientHeight); return; }
        if (data.type === 'ready') { clearTimeout(this.readyTimer); if (![...this.statusRows.values()].some(row => row.dataset?.adapter === 'remote-module' && row.dataset?.active === 'true')) { this.helperReady = true; for (const waiter of this.helperWaiters) waiter.resolve(); this.helperWaiters.clear(); } return; }
        if (data.type === 'helper-ready' && this.statusRows.get(data.id)?.dataset.adapter === 'remote-module' && this.statusRows.get(data.id)?.dataset.active === 'true') { this.helperReady = true; for (const waiter of this.helperWaiters) waiter.resolve(); this.helperWaiters.clear(); return; }
        if (data.type === 'helper-event-result') {
            const pending = this.pendingEvents.get(data.id); if (!pending) return;
            clearTimeout(pending.timer); this.pendingEvents.delete(data.id);
            if (data.error) pending.reject(Error(data.error)); else pending.resolve();
            return;
        }
        if (data.type === 'buttons') {
            if (!this.statusRows.has(data.id) || !Array.isArray(data.buttons) || data.buttons.length > 100 || !this.actions) return;
            this.actions.querySelector('.quick-replies-empty')?.remove();
            if (data.replace) for (const [key, button] of this.buttons) if (key.startsWith(data.id + ':')) { button.remove(); this.buttons.delete(key); }
            for (const item of data.buttons) {
                if (!item?.visible || typeof item.name !== 'string' || item.name.length > 100) continue;
                const key = data.id + ':' + item.name; if (this.buttons.has(key)) continue;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = item.name;
                button.onclick = () => { this.actions.hidden = true; document.getElementById('quick-replies-toggle')?.setAttribute('aria-expanded', 'false'); this.frame?.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'button', event: key }, '*'); }; this.buttons.set(key, button); this.actions.append(button);
            }
            return;
        }
        if (data.type === 'executed') { const row = this.statusRows.get(data.id); if (row && row.dataset?.state !== 'failed') row.textContent = row.dataset?.adapter === 'remote-module' ? '原始 MVU 已完成初始化；具体功能由脚本提供' : row.dataset?.adapter === 'mvu' ? '内置 MVU 兼容已就绪' : row.dataset?.adapter === 'mvu-schema' ? '本地 Zod 校验已接入' : '已执行'; return; }
        if (data.type === 'notice' || data.type === 'failed') {
            let text = String(data.text || '').slice(0, 1000);
            if (/Blocked a frame|cross-origin|SecurityError/i.test(text)) text = '此脚本需要访问酒馆原生页面，当前隔离环境暂不支持。';
            const row = this.statusRows.get(data.id); if (row) { row.textContent = text; if (data.error && row.dataset) row.dataset.state = 'failed'; }
            if (data.type === 'failed' && row?.dataset) { row.dataset.active = 'false'; if (row.dataset.adapter === 'remote-module') { this.helperReady = false; this.helperError = text; for (const waiter of this.helperWaiters) waiter.reject(Error(text)); this.helperWaiters.clear(); } }
            if (data.error && this.note) this.note.textContent = text;
            this.notify(text, data.error ? true : ['info', 'success', 'warning'].includes(data.kind) ? data.kind : 'info'); return;
        }
        if (data.type !== 'request' || !['variables', 'read-worldbook', 'toggle-worldbook', 'role-action', 'helper'].includes(data.action) || !Number.isSafeInteger(data.id)) return;
        const frame = this.frame, identity = this.identity;
        try {
            let value;
            if (data.action === 'helper') {
                const permission = this.statusRows.get(data.payload?.scriptId)?.dataset;
                if (permission?.active !== 'true' || !this.helperAction) throw Error('此脚本未运行或已失效，没有宿主接口权限。');
                value = await this.helperAction(data.payload.operation, { ...data.payload.payload, scriptId: data.payload.scriptId }, identity);
            } else if (data.action === 'role-action') {
                const permission = this.statusRows.get(data.payload?.scriptId)?.dataset, action = data.payload?.action;
                if (permission?.active !== 'true' || !['avatars', 'create-messages', 'slash', 'replace-worldbook'].includes(action) || !this.roleAction) throw Error('此脚本未运行或接口未接入，没有对应接口权限。');
                value = await this.roleAction(action, data.payload.payload, identity);
            } else value = data.action === 'variables' ? await this.applyVariables(data.payload, identity) : this.worldbook ? await this.worldbook(data.action, data.payload, identity) : (() => { throw Error('世界书接口未接入。'); })();
            if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, value: value ?? true }, '*');
        } catch (error) { if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, error: error.message }, '*'); }
    }
}
