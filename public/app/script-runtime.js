import { scriptSupport } from './scripts.js';
import { scriptBridge } from './script-bridge.js';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function scriptDocument(scripts, snapshot, jquery) {
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";
    const tag = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    const runs = scripts.flatMap((script, index) => {
        const support = scriptSupport(script);
        if (script.scope === 'global' || script.enabled === false || !support.supported) return [];
        const id = `${script.scope || 'script'}-${script.id || index}`;
        const content = support.adapter === 'mvu' ? '' : script.content || '';
        return [tag(`(async()=>{const getScriptId=()=>${json(id)};const getButtonEvent=name=>${json(id)}+':'+name;const appendInexistentScriptButtons=buttons=>window.__scriptButtons(${json(id)},buttons);try{\n${content}\nparent.postMessage({channel:'st-new-scripts',type:'executed',id:${json(id)}},'*');}catch(error){parent.postMessage({channel:'st-new-scripts',type:'failed',id:${json(id)},text:${json(script.name || '脚本')}+': '+error.message,error:true},'*');}})();`)];
    });
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;font:14px system-ui;background:#f5f0e7}#script-empty{margin:20px;padding:16px;border:1px solid #c9bcaa;border-radius:12px;line-height:1.8;color:#66594c}#script-actions{position:fixed;bottom:8px;left:8px;z-index:10000;display:flex;gap:5px;flex-wrap:wrap}#script-actions button{padding:7px;border:1px solid #bba78e;background:#fff7e8;border-radius:8px}</style><div id="script-empty" role="status">正在启动角色卡脚本…</div><div id="script-actions"></div>${tag(`(${scriptBridge.toString()})(${json(snapshot)});`)}${tag(jquery)}${runs.join('')}`;
}
export class ScriptRuntime {
    constructor({ notify, applyVariables, worldbook, onRetry }) { Object.assign(this, { notify, applyVariables, worldbook, onRetry }); this.dialog = null; this.frame = null; this.identity = ''; this.epoch = 0; this.jquery = null; this.statusRows = new Map(); this.buttons = new Map(); this.listener = event => void this.receive(event); }
    dispose() { this.epoch++; clearTimeout(this.readyTimer); window.removeEventListener('message', this.listener); this.dialog?.remove(); this.dialog = null; this.frame = null; this.identity = ''; this.statusRows.clear(); this.buttons.clear(); }
    refresh(snapshot, identity) {
        if (!this.frame) return;
        if (identity !== this.identity) { this.dispose(); return; }
        this.frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'snapshot', snapshot }, '*');
    }
    async show({ scripts, snapshot, identity, preparation = '' }) {
        if (this.frame && this.identity === identity) { if (!this.dialog.open) this.dialog.showModal(); this.refresh(snapshot, identity); return; }
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
        const note = document.createElement('p'); note.className = 'note script-runtime-note'; note.textContent = preparation || '仅运行当前角色卡脚本，全局脚本不参与适配。'; this.note = note;
        const statuses = document.createElement('details'); statuses.className = 'script-runtime-status';
        const summary = document.createElement('summary'); summary.textContent = `${snapshot.characterName || '当前角色'} · 脚本状态（${scripts.length}）`; statuses.append(summary);
        scripts.forEach((script, index) => {
            const support = scriptSupport(script), row = document.createElement('p'), name = document.createElement('strong'), detail = document.createElement('span');
            name.textContent = script.name || '未命名脚本'; detail.dataset.adapter = support.adapter || ''; detail.textContent = script.enabled === false ? '已停用' : support.supported ? `待启动 · ${support.reason}` : support.reason; row.append(name, detail); statuses.append(row);
            this.statusRows.set(`${script.scope || 'script'}-${script.id || index}`, detail);
        });
        statuses.open = !scripts.some(script => script.enabled !== false && scriptSupport(script).supported);
        const frame = document.createElement('iframe'); frame.className = 'script-runtime-frame'; frame.title = '脚本运行界面'; frame.setAttribute('sandbox', 'allow-scripts allow-forms'); frame.referrerPolicy = 'no-referrer';
        const actions = document.createElement('div'); actions.className = 'script-runtime-actions'; actions.hidden = true; this.actions = actions;
        this.dialog = dialog; this.frame = frame; this.identity = identity;
        window.addEventListener('message', this.listener); dialog.append(header, note, statuses, frame, actions); document.body.append(dialog); dialog.showModal();
        frame.srcdoc = scriptDocument(scripts, snapshot, this.jquery);
        this.readyTimer = setTimeout(() => { if (this.frame === frame) { note.textContent = '未收到脚本启动确认。请查看脚本状态，或点击“重新启动”。'; statuses.open = true; } }, 8000);
    }
    async receive(event) {
        if (!this.frame || event.source !== this.frame.contentWindow || event.data?.channel !== 'st-new-scripts') return;
        const data = event.data;
        if (data.type === 'ready') { clearTimeout(this.readyTimer); return; }
        if (data.type === 'buttons') {
            if (!this.statusRows.has(data.id) || !Array.isArray(data.buttons) || data.buttons.length > 100 || !this.actions) return;
            for (const item of data.buttons) {
                if (!item?.visible || typeof item.name !== 'string' || item.name.length > 100) continue;
                const key = data.id + ':' + item.name; if (this.buttons.has(key)) continue;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = item.name;
                button.onclick = () => this.frame?.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'button', event: key }, '*'); this.buttons.set(key, button); this.actions.append(button);
            }
            this.actions.hidden = this.buttons.size === 0; return;
        }
        if (data.type === 'executed') { const row = this.statusRows.get(data.id); if (row) row.textContent = row.dataset?.adapter === 'mvu' ? '内置 MVU 兼容已就绪' : '已执行'; return; }
        if (data.type === 'notice' || data.type === 'failed') {
            let text = String(data.text || '').slice(0, 1000);
            if (/Blocked a frame|cross-origin|SecurityError/i.test(text)) text = '此脚本需要访问酒馆原生页面，当前隔离环境暂不支持。';
            const row = this.statusRows.get(data.id); if (row) row.textContent = text;
            if (data.error && this.note) this.note.textContent = text;
            this.notify(text, !!data.error); return;
        }
        if (data.type !== 'request' || !['variables', 'read-worldbook', 'toggle-worldbook'].includes(data.action) || !Number.isSafeInteger(data.id)) return;
        const frame = this.frame, identity = this.identity;
        try {
            const value = data.action === 'variables' ? await this.applyVariables(data.payload, identity) : this.worldbook ? await this.worldbook(data.action, data.payload, identity) : (() => { throw Error('世界书接口未接入。'); })();
            if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, value: value ?? true }, '*');
        } catch (error) { if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, error: error.message }, '*'); }
    }
}
