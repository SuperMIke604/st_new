// A bounded command subset shared by ordinary scripts and message HTML.
// Parse the complete batch before performing any operation.
export function parseScriptCommands(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 1000000) throw Error('脚本指令为空或过大。');
    const parts = []; let text = '', quote = '', escape = false;
    for (const char of source) {
        if (escape) { text += '\\' + char; escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"' || char === "'") { if (!quote && text.endsWith('=')) quote = char; else if (quote === char) quote = ''; }
        if (char === '|' && !quote) { if (text.trim()) parts.push(text.trim()); text = ''; } else text += char;
    }
    if (escape) text += '\\';
    if (text.trim()) parts.push(text.trim());
    if (!parts.length || parts.length > 300) throw Error('脚本指令批次无效。');
    const unescape = value => value.replace(/\\([\\|{}])/g, '$1');
    const commands = parts.map(part => {
        const match = /^\/(getentryfield|setentryfield)\s+([\s\S]*)$/.exec(part);
        if (match) {
            let rest = match[2], args = {};
            for (;;) {
                const arg = /^(file|uid|field)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)\s*/.exec(rest);
                if (!arg) break;
                if (Object.hasOwn(args, arg[1])) throw Error('重复的世界书参数。');
                args[arg[1]] = unescape(/^['"]/.test(arg[2]) ? arg[2].slice(1, -1) : arg[2]); rest = rest.slice(arg[0].length);
            }
            const uid = Number(args.uid ?? (match[1] === 'getentryfield' ? rest : NaN));
            if (!args.file || !Number.isSafeInteger(uid) || uid < 0 || !['disable', 'constant', 'order', 'key', 'comment', 'content'].includes(args.field)) throw Error('世界书字段指令参数无效。');
            let value = unescape(rest);
            if (match[1] === 'setentryfield') {
                if (['disable', 'constant'].includes(args.field)) { if (!['true', 'false'].includes(value)) throw Error('世界书布尔字段无效。'); value = value === 'true'; }
                if (args.field === 'order') { value = Number(value); if (!Number.isSafeInteger(value) || Math.abs(value) > 1000000) throw Error('世界书排序无效。'); }
                if (args.field === 'key') { try { const parsed = JSON.parse(value); value = Array.isArray(parsed) ? parsed : [value]; } catch { value = value.split(',').map(key => key.trim()).filter(Boolean); } }
            }
            return { type: match[1], name: args.file, uid, field: args.field, value };
        }
        const send = /^\/send\s+([\s\S]+)$/.exec(part);
        if (send) return { type: 'send', text: unescape(send[1]) };
        const variable = /^\/(getvar|setvar)\s+type=chat\s+(?:key=)?([\p{L}\p{N}_-]{1,200})(?:\s+([\s\S]*))?$/u.exec(part);
        if (variable) {
            if (['__proto__', 'prototype', 'constructor'].includes(variable[2]) || variable[1] === 'getvar' && variable[3] !== undefined) throw Error('聊天变量指令无效。');
            return { type: variable[1], key: variable[2], value: unescape(variable[3] || '') };
        }
        const sendas = /^\/sendas\s+name=("[^"]*"|\S+)\s+([\s\S]+)$/.exec(part);
        if (sendas) return { type: 'sendas', name: unescape(sendas[1].replace(/^"|"$/g, '')), text: unescape(sendas[2]) };
        if (/^\/trigger(?:\s+await=true)?$/.test(part)) return { type: 'trigger' };
        const echo = /^\/echo(?:\s+severity=(info|success|warning|error))?\s+([\s\S]+)$/.exec(part);
        if (echo) return { type: 'echo', kind: echo[1] || 'info', text: unescape(echo[2]) };
        throw Error('此斜杠指令尚未接入。');
    });
    const world = commands.filter(command => command.type.endsWith('entryfield'));
    if (world.length && (world.length !== commands.length || new Set(world.map(command => command.name)).size !== 1)) throw Error('世界书指令必须单独操作同一本世界书。');
    if (!world.length) {
        const effects = commands.filter(command => command.type !== 'echo');
        if (commands.length === 1 && ['getvar', 'setvar'].includes(effects[0]?.type)) return commands;
        if (!effects.length || effects.length === 1 && effects[0].type === 'sendas' || effects.length === 2 && effects[0].type === 'send' && effects[1].type === 'trigger') return commands;
        throw Error('暂只支持发送一条用户指令后生成，或添加一条角色显示消息。');
    }
    return commands;
}
export function patchScriptWorldFields(book, commands) {
    const next = structuredClone(book);
    for (const command of commands) {
        const key = Object.keys(next.entries || {}).find(key => String(next.entries[key].uid ?? key) === String(command.uid));
        if (key === undefined) throw Error('世界书条目不存在。');
        if (command.type !== 'setentryfield') continue;
        const value = command.value;
        if (typeof value === 'string' && value.length > 500000 || command.field === 'key' && (!Array.isArray(value) || value.length > 100 || value.some(key => typeof key !== 'string' || key.length > 300))) throw Error('世界书字段内容过大或无效。');
        next.entries[key][command.field] = structuredClone(value);
    }
    return next;
}
