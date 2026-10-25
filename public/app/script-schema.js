export function schemaCode(content) {
    return content.replace(/^\s*import\s*\{\s*registerMvuSchema\s*\}\s*from\s*['"]https:\/\/[^'"]+\/mvu_zod\.js['"]\s*;?\s*/m, '').replace(/\bexport\s+const\s+Schema\b/, 'const Schema');
}
export function schemaDocument(content, library) {
    const tag = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
    return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'">' + tag(library) + tag(`
const _={uniq:values=>[...new Set(values)]}; const $=callback=>callback(); let schema;
const post=data=>parent.postMessage({channel:'st-new-schema',...data},'*');
const registerMvuSchema=value=>{schema=value;};
try { ${schemaCode(content)}
if(!schema?.safeParseAsync) throw Error('变量结构未注册'); post({type:'ready'});
} catch(error) {post({type:'failed',error:error.message});}
addEventListener('message',async event=>{
if(event.source!==parent||event.data?.channel!=='st-new-schema'||event.data.type!=='validate')return;
const {id,value}=event.data;
try{const result=await schema.safeParseAsync(value); if(!result.success)throw Error(result.error.issues.slice(0,5).map(issue=>issue.path.join('.')+': '+issue.message).join('；'));post({type:'result',id,value:result.data});}
catch(error){post({type:'result',id,error:error.message});}
});`);
}
export class ScriptSchema {
    constructor() { this.sequence = 0; this.pending = new Map(); this.listener = event => this.receive(event); }
    dispose() { this.epoch = (this.epoch || 0) + 1; window.removeEventListener('message', this.listener); this.frame?.remove(); this.frame = null; this.key = ''; this.identity = ''; for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(Error('变量校验环境已切换。')); } this.pending.clear(); }
    receive(event) {
        if (event.source !== this.frame?.contentWindow || event.data?.channel !== 'st-new-schema') return;
        const data = event.data, id = data.type === 'ready' || data.type === 'failed' ? 'ready' : data.id, task = this.pending.get(id);
        if (!task) return; clearTimeout(task.timer); this.pending.delete(id); data.error ? task.reject(Error(`变量结构校验失败：${data.error}`)) : task.resolve(data.value);
    }
    wait(id) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('变量结构校验超时。')); }, 15000); this.pending.set(id, { resolve, reject, timer }); }); }
    async validate(script, value, identity) {
        const key = identity + '\n' + script.content;
        if (this.key !== key) {
            this.dispose(); this.key = key; this.identity = identity; const epoch = this.epoch;
            this.loading = (async () => {
                const response = await fetch('./vendor/zod.min.js', { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw Error('变量校验库加载失败。');
                const library = await response.text(); if (epoch !== this.epoch) throw Error('变量校验环境已切换。');
                const frame = document.createElement('iframe'); frame.hidden = true; frame.title = '角色变量结构校验'; frame.setAttribute('sandbox', 'allow-scripts'); this.frame = frame;
                const ready = this.wait('ready'); window.addEventListener('message', this.listener); document.body.append(frame); frame.srcdoc = schemaDocument(script.content, library); await ready;
            })();
        }
        await this.loading; if (this.key !== key || !this.frame) throw Error('变量校验环境已切换。');
        const id = ++this.sequence, result = this.wait(id); this.frame.contentWindow.postMessage({ channel: 'st-new-schema', type: 'validate', id, value }, '*'); return result;
    }
}
