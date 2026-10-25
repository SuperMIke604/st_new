import { scriptSupport } from './scripts.js';
import { scriptBridge } from './script-bridge.js';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function scriptDocument(scripts, snapshot, jquery) {
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";
    const tag = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    const runnable = scripts.filter(script => scriptSupport(script).supported);
    const runs = runnable.map((script, index) => {
        const id = `${script.scope || 'script'}-${script.id || index}`;
        return tag(`(async()=>{const getScriptId=()=>${json(id)};const getButtonEvent=name=>${json(id)}+':'+name;const appendInexistentScriptButtons=buttons=>window.__scriptButtons(${json(id)},buttons);try{\n${script.content || ''}\nparent.postMessage({channel:'st-new-scripts',type:'executed',id:${json(id)}},'*');}catch(error){parent.postMessage({channel:'st-new-scripts',type:'notice',text:${json(script.name || '脚本')}+': '+error.message,error:true},'*');}})();`);
    });
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;font:14px system-ui;background:#f5f0e7}#script-actions{position:fixed;bottom:8px;left:8px;z-index:10000;display:flex;gap:5px;flex-wrap:wrap}#script-actions button{padding:7px;border:1px solid #bba78e;background:#fff7e8;border-radius:8px}</style><div id="script-actions"></div>${tag(`(${scriptBridge.toString()})(${json(snapshot)});`)}${tag(jquery)}${runs.join('')}`;
}
export class ScriptRuntime {
    constructor({ notify, applyVariables }) { this.notify = notify; this.applyVariables = applyVariables; this.dialog = null; this.frame = null; this.identity = ''; this.loading = null; this.epoch = 0; this.jquery = null; this.listener = event => void this.receive(event); }
    dispose() { this.epoch++; window.removeEventListener('message', this.listener); this.dialog?.remove(); this.dialog = null; this.frame = null; this.identity = ''; }
    refresh(snapshot, identity) {
        if (!this.frame) return;
        if (identity !== this.identity) { this.dispose(); return; }
        this.frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'snapshot', snapshot }, '*');
    }
    async show({ scripts, snapshot, identity }) {
        if (this.frame && this.identity === identity) { if (!this.dialog.open) this.dialog.showModal(); this.refresh(snapshot, identity); return; }
        this.dispose(); this.identity = identity; const epoch = this.epoch;
        if (!this.jquery) {
            const response = await fetch('./vendor/jquery.min.js'); if (!response.ok) throw Error('脚本运行库读取失败'); this.jquery = await response.text();
        }
        if (epoch !== this.epoch) return;
        const dialog = document.createElement('dialog'); dialog.className = 'script-runtime-dialog';
        const header = document.createElement('header'); header.className = 'panel-header';
        const title = document.createElement('h1'); title.textContent = '脚本面板';
        const close = document.createElement('button'); close.textContent = '关闭'; close.type = 'button'; close.className = 'button'; close.onclick = () => dialog.close(); header.append(title, close);
        const note = document.createElement('p'); note.className = 'note script-runtime-note'; note.textContent = '兼容运行：可读取已有 MVU 快照；MVU 自动更新、外部模块、世界书读写、头像库暂未支持。';
        const frame = document.createElement('iframe'); frame.className = 'script-runtime-frame'; frame.title = '脚本运行界面'; frame.setAttribute('sandbox', 'allow-scripts allow-forms'); frame.referrerPolicy = 'no-referrer';
        this.dialog = dialog; this.frame = frame; this.identity = identity;
        window.addEventListener('message', this.listener); dialog.append(header, note, frame); document.body.append(dialog); dialog.showModal();
        frame.srcdoc = scriptDocument(scripts, snapshot, this.jquery);
    }
    async receive(event) {
        if (!this.frame || event.source !== this.frame.contentWindow || event.data?.channel !== 'st-new-scripts') return;
        const data = event.data;
        if (data.type === 'notice') {
            let text = String(data.text || '').slice(0, 1000);
            if (/Blocked a frame|cross-origin|SecurityError/i.test(text)) text = '此脚本需要访问酒馆原生页面，当前隔离环境暂不支持。';
            this.notify(text, !!data.error); return;
        }
        if (data.type !== 'request' || data.action !== 'variables' || !Number.isSafeInteger(data.id)) return;
        const frame = this.frame, identity = this.identity;
        try {
            await this.applyVariables(data.payload, identity);
            if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, value: true }, '*');
        } catch (error) { if (this.frame === frame) frame.contentWindow?.postMessage({ channel: 'st-new-scripts', type: 'response', id: data.id, error: error.message }, '*'); }
    }
}
