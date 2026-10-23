import { DEFAULT_SETTINGS } from './database-defaults.js';
import { referenceUpdate, referenceTableText, referenceSheetText, extractDataFromMessage } from './database-reference.js';
// Native chat-scoped table model; compatible with the original chatSheets format.
export const defaultFillPrompt = '维护当前对话的数据库。只根据对话中明确发生的事实更新，不编造。保留表头。仅输出 <dataUpdate>{"operations":[{"action":"insert|update|delete","sheet":"sheet_0","row":0,"data":{"0":"第一列内容"}}]}</dataUpdate>。sheet 可为表键或表名；row 为从 0 开始的数据行索引，不包含表头；data 的列索引也从 0 开始。insert 不指定 row 表示追加。没有变化时输出空 operations。\n\n当前表格：\n$0\n\n待整理对话：\n$1\n\n参考资料：\n$4';
export function defaultDatabase() {
    return { mate: { type: 'chatSheets' }, sheet_0: { name: '当前状态', content: [[null, '项目', '内容']] }, sheet_1: { name: '人物', content: [[null, '姓名', '关系', '近况']] }, sheet_2: { name: '事件', content: [[null, '时间', '事件', '结果']] } };
}
export function sheets(database) { return Object.entries(database).filter(([key]) => /^sheet_[\w-]+$/.test(key)); }
export function validateDatabase(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据库需要为 chatSheets 对象。');
    const result = structuredClone(value); result.mate ||= { type: 'chatSheets' };
    if (result.mate.type !== 'chatSheets') throw new Error('数据库格式需为 mate.type = chatSheets。');
    const tables = sheets(result);
    for (const [key, table] of tables) {
        if (!table || typeof table !== 'object' || !Array.isArray(table.content) || !Array.isArray(table.content[0]) || table.content[0].length < 2) throw new Error(`表格 ${key} 缺少有效表头。`);
        for (const row of table.content) {
            if (!Array.isArray(row) || row.length !== table.content[0].length) throw new Error(`表格「${table.name || key}」的列数不一致。`);
            if (row.some(cell => cell != null && !['string', 'number', 'boolean'].includes(typeof cell))) throw new Error('单元格仅支持文字、数字或布尔值。');
        }
    }
    return result;
}
export function parseDatabase(text) { return validateDatabase(typeof text === 'string' ? JSON.parse(text.replace(/^\uFEFF/, '')) : text); }
export function databaseSettings(value = {}) {
    let source = value || {}; if (!Object.keys(source).length) source=structuredClone(DEFAULT_SETTINGS);
    if (source.charCardPrompts && !source.presets) {
        source = { ...source, presets: source.charCardPrompts.map((preset,index)=>({id:`reference-${index}`,name:preset.name,messages:(preset.prompt||[]).map(message=>({role:String(message.role).toLowerCase(),content:message.content||''})),template:(preset.overviewTemplate||source.overviewTemplate)?parseDatabase(preset.overviewTemplate||source.overviewTemplate):{mate:{type:'chatSheets'}}})), activePreset:`reference-${source.currentPromptIndex||0}`, auto:!!source.autoUpdateEnabled, inject:!!source.enableWorldbookGeneration, maxTokens:source.apiConfig?.max_tokens||120000,temperature:source.apiConfig?.temperature??.9 };
    }
    const presets = Array.isArray(source.presets) && source.presets.length ? source.presets.map((preset, index) => ({ ...preset, id: String(preset.id || `preset-${index}`), name: String(preset.name || `预设 ${index + 1}`), messages: Array.isArray(preset.messages) ? preset.messages : [{ role: 'system', content: defaultFillPrompt }], template: validateDatabase(preset.template || defaultDatabase()) })) : [{ id: 'default', name: '默认填表', messages: [{ role: 'system', content: defaultFillPrompt }], template: defaultDatabase() }];
    for (const preset of presets) if (!preset.messages.length || preset.messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) throw new Error('填表预设消息角色或内容无效。');
    const settings = { ...structuredClone(DEFAULT_SETTINGS), version: 1, inject: true, auto: false, frequency: 1, batch: 20, maxTokens: 4096, temperature: .3, profileId: '', includeWorlds: false, template: defaultDatabase(), ...structuredClone(source), presets };
    settings.activePreset = presets.some(preset => preset.id === settings.activePreset) ? settings.activePreset : presets[0].id;
    settings.template = validateDatabase(source.template || settings.presets.find(preset => preset.id === settings.activePreset).template || defaultDatabase());
    settings.presets.find(preset => preset.id === settings.activePreset).template = structuredClone(settings.template);
    for (const [key, min, max] of [['frequency', 1, 100], ['batch', 1, 500], ['maxTokens', 1, 2000000], ['temperature', 0, 2]]) {
        const number = Number(settings[key]); if (!Number.isFinite(number) || number < min || number > max || (key !== 'temperature' && !Number.isInteger(number))) throw new Error(`数据库设置 ${key} 超出范围。`); settings[key] = number;
    }
    if(source.profileId && !source.apiMode){settings.apiMode='tavern';settings.tavernProfile=source.profileId;}
    settings.autoUpdateEnabled = settings.auto;
    settings.enableWorldbookGeneration = settings.inject;
    settings.charCardPrompts = settings.presets.map(preset=>({name:preset.name,prompt:preset.messages,overviewTemplate:JSON.stringify(preset.template)}));
    settings.currentPromptIndex = settings.presets.findIndex(preset=>preset.id===settings.activePreset);
    settings.apiConfig = {...settings.apiConfig,max_tokens:settings.maxTokens,temperature:settings.temperature};
    return settings;
}
export function migrateLegacySettings(value) {
 if(!value || typeof value!=='object')throw new Error('未找到参考项目配置');
 const source=structuredClone(value);
 if(!source.charCardPrompts && source.charCardPrompt)source.charCardPrompts=[{name:'默认预设',prompt:source.charCardPrompt,overviewTemplate:source.overviewTemplate||''}];
 if(!source.charCardPrompts)throw new Error('配置缺少 AI 指令预设');
 return databaseSettings(source);
}
const hashCache = new WeakMap();
export function sourceHash(chat, end = chat.length - 1) {
    let hash = 2166136261;
    for (let index = 0; index <= end; index++) {
        const message = chat[index]; const text = `${message.is_user ? 'u' : 'a'}:${message.name || ''}:${message.mes || ''}`;
        let cached = hashCache.get(message);
        if (cached?.text !== text) { let value = 2166136261; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619); cached = { text, value }; hashCache.set(message, cached); }
        hash = Math.imul(hash ^ cached.value ^ index, 16777619);
    }
    return (hash >>> 0).toString(16);
}
export function databaseForChat(chat, header, template = defaultDatabase()) {
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index], meta = message.extra?.independentDatabase;
        const extracted = extractDataFromMessage(message,{requireMate:true});
        if (!message.is_user && extracted) return { data: validateDatabase(extracted), index, legacy: !meta, updatedAt: meta?.updatedAt };
    }
    const seed = header?.chat_metadata?.independentDatabase?.seed;
    return { data: validateDatabase(seed || template), index: -1, legacy: false };
}
export function storeDatabase(chat, header, data, index = chat.findLastIndex(message => !message.is_user), metadata = {}) {
    const value = validateDatabase(data);
    if (!Number.isInteger(index) || index < -1 || (index >= 0 && (!chat[index] || chat[index].is_user))) throw new Error('数据库快照需要关联角色回复。');
    header.chat_metadata ||= {};
    const history = (header.chat_metadata.independentDatabase ||= {}).history ||= [];
    const previous = index >= 0 ? chat[index]?.TavernDB_ACU_Data : header.chat_metadata.independentDatabase.seed;
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
        history.push({ data: structuredClone(previous), index, updatedAt: new Date().toISOString() });
        while (history.length > 8 || (history.length && JSON.stringify(history).length > 2000000)) history.shift();
    }
    if (index >= 0) {
        chat[index].TavernDB_ACU_Data = value;
        (chat[index].extra ||= {}).independentDatabase = { ...metadata, sourceHash: sourceHash(chat, index), updatedAt: new Date().toISOString() };
        invalidateDatabases(chat, index + 1);
    } else {
        header.chat_metadata ||= {}; (header.chat_metadata.independentDatabase ||= {}).seed = value;
    }
    return value;
}
export function invalidateDatabases(chat, start) {
    for (let index = start; index < chat.length; index++) if (chat[index].TavernDB_ACU_Data) ((chat[index].extra ||= {}).independentDatabase ||= {}).stale = true;
}
export function databaseText(database, includeEmpty = false) {
    return sheets(database).filter(([, table]) => includeEmpty || table.content.length > 1).map(([key, table]) => {
        const lines = table.content.map((row, index) => `${index === 0 ? '列' : index - 1}: ${row.slice(1).map(cell => String(cell ?? '').replace(/\n/g, ' / ')).join(' | ')}`);
        return `[${key}] ${table.name || key}\n${lines.join('\n')}`;
    }).join('\n\n');
}
export function parseUpdate(text, current) {
    const result = referenceUpdate(text, current);
    if (!result.changed) throw new Error(result.feedback.filter(item=>item.type==='error').map(item=>item.reason||item.message).join('；') || 'AI 响应未产生有效的 dataUpdate 更新');
    return result.data;
}
export function applyOperations(current, operations) {
    if (!Array.isArray(operations) || operations.length > 500) throw new Error('填表操作必须是最多 500 项的数组。');
    const result = validateDatabase(current), tables = sheets(result);
    for (const operation of operations) {
        if (!operation || !['insert', 'update', 'delete'].includes(operation.action)) throw new Error('存在不支持的填表操作，数据库未修改。');
        const pair = typeof operation.sheet === 'number' ? tables[operation.sheet] : tables.find(([key, table]) => key === operation.sheet || table.name === operation.sheet);
        if (!pair) throw new Error(`找不到目标表 ${operation.sheet}。`);
        const table = pair[1], count = table.content.length - 1, columns = table.content[0].length - 1;
        let row = operation.row;
        if (operation.action === 'insert' && row == null) row = count;
        if (!Number.isInteger(row) || row < 0 || row > count || (operation.action !== 'insert' && row === count)) throw new Error('填表行索引越界，数据库未修改。');
        if (operation.action === 'delete') { table.content.splice(row + 1, 1); continue; }
        const data = operation.data; if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('填表 data 需要为列索引对象。');
        const target = operation.action === 'insert' ? Array(columns + 1).fill('') : table.content[row + 1]; target[0] = null;
        for (const [column, value] of Object.entries(data)) {
            if (!/^\d+$/.test(column) || Number(column) >= columns || (value != null && !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('填表列索引或单元格内容无效。');
            target[Number(column) + 1] = value;
        }
        if (operation.action === 'insert') table.content.splice(row + 1, 0, target);
    }
    return validateDatabase(result);
}
export function fillMessages(settings, database, chat, from, to, worldText = '') {
    const preset = settings.presets.find(item => item.id === settings.activePreset);
    const messagesText = '当前最新对话内容:\n' + (chat.slice(from,to+1).map(message=>{
        let content=message.mes||message.message||'';
        if(settings.removeTags)for(const tag of settings.removeTags.split('|').map(tag=>tag.trim()).filter(Boolean))content=content.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>|<${tag}\\/>`,'gi'),'');
        if(message.is_user && settings.userMessageTags)for(const tag of settings.userMessageTags.split('|').map(tag=>tag.trim()).filter(Boolean))content=`<${tag}>${content}</${tag}>`;
        return `${message.is_user?(settings.userName||'用户'):(message.name||'角色')}: ${content}`;
    }).join('\n') || '(无最新对话内容)');
    const replacements = { '$0': referenceDatabaseText(database,settings) || '(当前还没有表格数据)', '$1': messagesText, '$4': worldText };
    return preset.messages.map(message => ({ role: message.role, content: message.content.replace(/\$[014]/g, token => replacements[token]) }));
}

export function sheetText(database, key, summaryLimit = 10) {
 const table=database[key]; if(!table?.name || !Array.isArray(table.content) || table.content.length<2)return '';
 const rows=table.content.slice(1);const start=0;
 return referenceSheetText(table.name,table.content[0].slice(1),rows.slice(start),start);
}
export function referenceDatabaseText(database, settings = {}) {return referenceTableText(database,{...settings,summaryTableMaxEntries:Infinity}).text;}
