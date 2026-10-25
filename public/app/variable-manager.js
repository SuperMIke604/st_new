const blocked = new Set(['__proto__', 'prototype', 'constructor']);
const clone = value => structuredClone(value);
export function validateVariables(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('变量表需要是 JSON 对象。');
    const visit = (item, depth = 0) => {
        if (depth > 80) throw Error('变量层级过深。');
        if (typeof item === 'number' && !Number.isFinite(item)) throw Error('数字必须是有限数值。');
        if (item && typeof item === 'object') for (const key of Object.keys(item)) {
            if (blocked.has(key)) throw Error('变量包含不允许的字段名称。');
            visit(item[key], depth + 1);
        }
    };
    visit(value);
    if (JSON.stringify(value).length > 1000000) throw Error('变量表不能超过 1MB。');
    return clone(value);
}
export const variableType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export function parseVariableValue(text, type) {
    if (type === 'string') return text;
    if (type === 'null') return null;
    if (type === 'boolean') { if (!['true','false'].includes(text)) throw Error('开关值请选择是或否。'); return text === 'true'; }
    if (type === 'number') { if (!text.trim() || !Number.isFinite(Number(text))) throw Error('请输入有效数字。'); return Number(text); }
    let value;
    try { value = JSON.parse(text); } catch { throw Error('JSON 格式无效，请检查括号、引号和逗号。'); }
    if (variableType(value) !== type) throw Error(type === 'array' ? '请输入 JSON 数组。' : '请输入 JSON 对象。');
    validateVariables({ value }); return value;
}
export function variableRows(value) {
    const result = [];
    const walk = (item, path) => {
        const keys = item && typeof item === 'object' ? Object.keys(item) : [];
        if (keys.length) for (const key of keys) walk(item[key], [...path,key]);
        else if (path.length) result.push({ path, value: item });
    };
    walk(value, []); return result;
}
export function setVariable(value, path, next) {
    const result = validateVariables(value);
    if (!path.length || path.some(key => blocked.has(key))) throw Error('变量路径无效。');
    let parent = result;
    for (const key of path.slice(0,-1)) { if (!parent || !Object.hasOwn(parent,key)) throw Error('变量路径已变化，请重新读取。'); parent = parent[key]; }
    if (!parent || !Object.hasOwn(parent,path.at(-1))) throw Error('变量路径已变化，请重新读取。');
    parent[path.at(-1)] = next; return validateVariables(result);
}
export function defaultVariableMessage(chat) {
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_system && Object.keys(chat[i].variables?.[chat[i].swipe_id || 0] || {}).length) return i;
    return Math.max(0,chat.findLastIndex(message => !message.is_system));
}
export function chatVariableValue(header, chat, scope, index) {
    return clone(scope === 'chat' ? header?.chat_metadata?.variables || {} : chat[index]?.variables?.[chat[index]?.swipe_id || 0] || {});
}
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function patchChatVariables(records, { scope, messageId, swipeId, base, value, messageText }) {
    value = validateVariables(value);
    const next = clone(records);
    if (!next[0] || Object.hasOwn(next[0], 'mes')) throw Error('聊天文件缺少头信息，请重新打开聊天。');
    const header = next[0], chat = next.slice(1);
    if (!['chat','message'].includes(scope)) throw Error('变量范围无效。');
    if (scope === 'message') {
        const message = chat[messageId];
        if (!message || (message.swipe_id || 0) !== swipeId || message.mes !== messageText) throw Error('消息或回复分支已变化，请重新读取变量。');
    }
    const current = chatVariableValue(header,chat,scope,messageId);
    if (!equal(current,base) && !equal(current,value)) throw Error('变量已被其他页面或脚本修改，请重新读取后再保存。');
    if (scope === 'chat') { (header.chat_metadata ||= {}).variables = value; }
    else { const message = chat[messageId]; (message.variables ||= {})[swipeId] = value; }
    return next;
}

// Draft-only UI: opening, searching and applying a value do not persist data.
export function renderVariableManager(body, { el, action, messages, initialMessage, read, save, dirty, notify }) {
    let scope = 'message', messageId = initialMessage, base, draft, query = '', page = 0, editing = null, pending = false;
    const label = (parent,name,input) => { const wrap=el('label','field'); wrap.append(el('span','',name),input); parent.append(wrap); return input; };
    const select = (parent,name,options) => { const input=el('select'); input.setAttribute('aria-label',name); for(const [value,text] of options){const option=el('option','',text);option.value=value;input.append(option);}return label(parent,name,input); };
    const toolbar=el('div','variable-toolbar'); body.append(toolbar);
    const scopeInput=select(toolbar,'变量范围',[['message','消息变量（角色状态）'],['chat','聊天变量'],['global','全局变量']]);
    const messageInput=select(toolbar,'消息楼层',messages.map((m,i)=>[String(i),`#${i} · ${m.is_user?'用户':'AI'}${m.is_system?' · 隐藏':''}`])); messageInput.value=String(messageId);
    body.append(el('p','note','修改仅在点击“保存”后生效。消息变量对应所选楼层的当前回复分支；全局变量会影响其他聊天。'));
    const search=el('input','variable-search');search.type='search';search.placeholder='搜索变量名称或内容…';search.setAttribute('aria-label','搜索变量');body.append(search);
    const list=el('div','variable-list'), editor=el('div','variable-editor'), pager=el('div','variable-pager');body.append(list,editor,pager);
    const advanced=el('details','advanced'),summary=el('summary','','JSON 编辑');advanced.append(summary);
    const raw=el('textarea','variable-json');raw.rows=12;raw.spellcheck=false;raw.setAttribute('aria-label','变量 JSON');advanced.append(raw);body.append(advanced);
    let rawChanged=false, editChanged=false;
    const changed=()=>rawChanged||editChanged||!equal(base,draft);
    const sync=()=>dirty(changed());
    const updateRaw=()=>{raw.value=JSON.stringify(draft,null,2);rawChanged=false;};
    const parseRaw=()=>{if(!rawChanged)return;let value;try{value=JSON.parse(raw.value);}catch{throw Error('变量 JSON 格式无效。');}draft=validateVariables(value);rawChanged=false;};
    const applyEditor=()=>{if(!editing)return;draft=setVariable(draft,editing.path,parseVariableValue(editing.value.value,editing.type.value));editing=null;editChanged=false;editor.replaceChildren();updateRaw();sync();};
    const edit=entry=>{
        if(pending)return;parseRaw();
        if(editChanged&&!confirm('放弃当前变量尚未应用的修改？'))return;
        let current=draft;for(const key of entry.path){if(!current||!Object.hasOwn(current,key))throw Error('变量路径已变化，请应用 JSON 后重试。');current=current[key];}
        const row={...entry,value:current};
        editing=null;editChanged=false;editor.replaceChildren();
        editor.append(el('h3','',row.path.join(' / ')));
        const type=select(editor,'值类型',[['string','文本'],['number','数字'],['boolean','开关'],['null','空值'],['object','对象'],['array','数组']]);type.value=variableType(row.value);
        const value=el('textarea');value.rows=3;value.setAttribute('aria-label','变量值');value.value=typeof row.value==='string'?row.value:JSON.stringify(row.value,null,2);label(editor,'变量值',value);
        const hint=el('p','note','开关填写 true 或 false；对象和数组使用 JSON 格式。');editor.append(hint);
        editing={path:row.path,type,value};
        for(const input of [type,value])input.addEventListener('input',()=>{editChanged=true;sync();});
        const buttons=el('div','inline-edit-buttons');buttons.append(action('应用',()=>{applyEditor();render();}),action('取消',()=>{editing=null;editChanged=false;editor.replaceChildren();sync();}));editor.append(buttons);value.focus();
    };
    const render=()=>{
        list.replaceChildren();pager.replaceChildren();
        const rows=variableRows(draft).filter(row=>!query||[row.path.join(' / '),JSON.stringify(row.value)].join(' ').toLowerCase().includes(query));
        const total=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,total-1);
        if(!rows.length)list.append(el('p','note',Object.keys(draft).length?'没有匹配的变量。':'当前范围还没有变量，可展开“JSON 编辑”添加。'));
        for(const row of rows.slice(page*50,(page+1)*50)){
            const item=el('div','variable-row'),name=el('div','variable-path',row.path.join(' / '));name.title=row.path.join(' / ');
            const text=typeof row.value==='string'?row.value:JSON.stringify(row.value);
            const button=action(text||'（空文本）',()=>edit(row));button.title='编辑变量值';button.setAttribute('aria-label',`编辑变量 ${row.path.join(' / ')}`);item.append(name,button);list.append(item);
        }
        const prev=action('上一页',()=>{page--;render();}),next=action('下一页',()=>{page++;render();});prev.disabled=page===0;next.disabled=page===total-1;
        pager.append(prev,el('small','',`${page+1} / ${total} · ${rows.length} 项`),next);
    };
    const load=()=>{base=validateVariables(read(scope,messageId));draft=clone(base);editing=null;editChanged=false;editor.replaceChildren();messageInput.closest('label').hidden=scope!=='message';updateRaw();render();sync();};
    const switchScope=()=>{
        if(pending||changed()&&!confirm('放弃未保存的变量修改并切换？')){scopeInput.value=scope;messageInput.value=String(messageId);return;}
        scope=scopeInput.value;messageId=Number(messageInput.value);page=0;load();
    };
    scopeInput.addEventListener('change',switchScope);messageInput.addEventListener('change',switchScope);
    search.addEventListener('input',()=>{query=search.value.toLowerCase();page=0;render();});raw.addEventListener('input',()=>{rawChanged=true;editing=null;editChanged=false;editor.replaceChildren();sync();});
    advanced.append(action('应用 JSON',()=>{parseRaw();updateRaw();render();sync();}));
    const footer=el('div','editor-footer'),saveButton=action('保存',async()=>{
        if(pending)return;parseRaw();applyEditor();const value=validateVariables(draft);
        pending=true;const controls=Array.from(body.querySelectorAll('input,textarea,select,button')).map(input=>[input,input.disabled]);for(const [input] of controls)input.disabled=true;
        try{const saved=await save({scope,messageId,base:clone(base),value});base=validateVariables(saved||value);draft=clone(base);updateRaw();render();dirty(false);notify('变量已保存');}
        finally{pending=false;for(const [input,disabled] of controls)input.disabled=disabled;}
    },null,'primary');
    footer.append(saveButton,action('撤销修改',()=>{if(pending)return;load();}));body.append(footer);load();
}
