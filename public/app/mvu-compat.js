const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const clone = value => structuredClone(value);
function safeKey(key) { if (forbidden.has(key)) throw Error('变量路径包含禁止的字段。'); return key; }
function scalar(value) {
    const text = value.trim();
    if (!text) return {};
    if (/^[&*!>|]/.test(text)) throw Error('此初始变量 YAML 语法暂不支持。');
    if (text.startsWith("'")) { if (!text.endsWith("'")) throw Error('初始变量引号未闭合。'); return text.slice(1, -1).replace(/''/g, "'"); }
    if (/^(?:\{|\[|"|-?\d|true$|false$|null$)/.test(text)) {
        try { return JSON.parse(text); } catch { if (/^[{\["]/.test(text)) throw Error('初始变量格式无效。'); }
    }
    return text;
}
export function parseInitialVariables(source) {
    if (source.length > 500000) throw Error('初始变量过大。');
    const trimmed = source.trim();
    if (trimmed.startsWith('{')) { const result = JSON.parse(trimmed); validateObject(result); return result; }
    const root = {}, stack = [{ indent: -1, value: root }];
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim() || /^\s*#/.test(line)) continue;
        if (/^\s*\t/.test(line)) throw Error('初始变量缩进不能使用制表符。');
        const match = /^( *)([^:#][^:]*):(?:\s+(.*)|\s*)$/.exec(line);
        if (!match) throw Error('此初始变量 YAML 语法暂不支持。');
        const indent = match[1].length, key = safeKey(match[2].trim().replace(/^['"]|['"]$/g, ''));
        while (stack.at(-1).indent >= indent) stack.pop();
        if (!stack.length) throw Error('初始变量缩进无效。');
        const value = scalar(match[3] || ''); stack.at(-1).value[key] = value;
        if (!match[3]?.trim()) stack.push({ indent, value });
    }
    validateObject(root); return root;
}
function validateObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('MVU 变量需要是对象。');
    const visit = (item, depth = 0) => { if (depth > 100) throw Error('变量嵌套层级过深。'); if (typeof item === 'number' && !Number.isFinite(item)) throw Error('变量包含非有限数值。'); if (!item || typeof item !== 'object') return; for (const key of Object.keys(item)) { safeKey(key); visit(item[key], depth + 1); } };
    visit(value);
}
export function initialVariablesFromBook(book) {
    const entries = Object.values(book?.entries || {}).filter(entry => /\[InitVar\]/i.test(entry.comment || entry.name || ''));
    if (!entries.length) return null;
    let result = {};
    for (const entry of entries) result = { ...result, ...parseInitialVariables(entry.content || '') };
    return result;
}
function parts(path) {
    if (path === '') return [];
    if (typeof path !== 'string' || !path.startsWith('/')) throw Error('JSONPatch 变量路径无效。');
    return path.slice(1).split('/').map(key => safeKey(key.replace(/~1/g, '/').replace(/~0/g, '~')));
}
function read(root, path) {
    let value = root;
    for (const key of parts(path)) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw Error('变量路径不存在。'); value = value[key]; }
    return value;
}
function write(root, path, value, operation) {
    const keys = parts(path); if (!keys.length) { if (operation === 'remove') throw Error('不能删除全部 MVU 变量。'); validateObject(value); return clone(value); }
    const key = keys.pop(); let parent = root;
    for (const part of keys) { if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) throw Error('变量路径不存在。'); parent = parent[part]; }
    if (!parent || typeof parent !== 'object') throw Error('变量路径不是对象。');
    if (Array.isArray(parent)) {
        const inserting = operation === 'add' || operation === 'insert';
        const index = key === '-' && inserting ? parent.length : /^\d+$/.test(key) ? Number(key) : -1;
        if (index < 0 || index > parent.length || (!inserting && index === parent.length)) throw Error('变量数组索引无效。');
        if (inserting) parent.splice(index, 0, clone(value));
        else if (operation === 'remove') parent.splice(index, 1);
        else parent[index] = clone(value);
    } else if (operation === 'remove') { if (!Object.hasOwn(parent, key)) throw Error('变量路径不存在。'); delete parent[key]; }
    else {
        if (operation === 'insert' && Object.hasOwn(parent, key)) throw Error('insert 不能覆盖已有变量。');
        if (operation === 'replace' && !Object.hasOwn(parent, key)) throw Error('replace 的变量路径不存在。');
        parent[key] = clone(value);
    }
    return root;
}
export function applyMvuPatch(data, operations) {
    validateObject(data);
    if (!Array.isArray(operations) || operations.length > 500 || JSON.stringify(operations).length > 1000000) throw Error('JSONPatch 更新格式无效或数据过大。');
    let result = clone(data);
    for (const operation of operations) {
        const { op, path, value, from } = operation || {};
        if (op === 'test') { if (JSON.stringify(read(result, path)) !== JSON.stringify(value)) throw Error('变量更新 test 校验失败。'); }
        else if (op === 'copy' || op === 'move') {
            if (op === 'move' && path.startsWith(from + '/')) throw Error('不能将变量移动到自身内部。');
            const current = clone(read(result, from)); if (op === 'move') result = write(result, from, undefined, 'remove'); result = write(result, path, current, 'add');
        } else if (op === 'delta') {
            const current = read(result, path);
            if (typeof current !== 'number' || typeof value !== 'number' || !Number.isFinite(current + value)) throw Error('delta 只能更新有限数值。');
            result = write(result, path, current + value, 'replace');
        } else if (['add', 'insert', 'replace', 'remove'].includes(op)) { if (op !== 'remove' && !Object.hasOwn(operation, 'value')) throw Error('变量更新缺少 value。'); result = write(result, path, value, op); }
        else throw Error(`暂不支持的变量更新操作：${String(op)}`);
    }
    validateObject(result); if (JSON.stringify(result).length > 1000000) throw Error('MVU 变量数据过大。'); return result;
}
export function messageMvuPatch(text) {
    const sections = [...String(text || '').matchAll(/<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable>/gi)];
    if ((String(text).match(/<UpdateVariable\b/gi) || []).length !== sections.length) throw Error('变量更新块未闭合。');
    return sections.flatMap(([, section]) => {
        const blocks = [...section.matchAll(/<JSONPatch\b[^>]*>([\s\S]*?)<\/JSONPatch>/gi)];
        if ((section.match(/<JSONPatch\b/gi) || []).length !== blocks.length) throw Error('JSONPatch 更新块未闭合。');
        return blocks.flatMap(([, raw]) => {
        const patch = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); if (!Array.isArray(patch)) throw Error('JSONPatch 更新必须是数组。'); return patch;
        });
    });
}
function fingerprint(text) { let value = 2166136261; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619); return `${text.length}:${value >>> 0}`; }
export function prepareMvuSnapshots(chat, seed, sourceText = message => message.mes || '') {
    let data = seed ? clone(seed) : null;
    let replaying = false;
    const staged = [];
    for (const message of chat) {
        const swipe = message.swipe_id || 0, variables = message.variables?.[swipe], stamp = message.extra?.independentMvu?.[swipe];
        if (message.is_user) { if (variables?.stat_data) data = clone(variables.stat_data); continue; }
        const source = fingerprint(String(message.mes || ''));
        if (variables?.stat_data && (!stamp || (!replaying && stamp.source === source))) { data = clone(variables.stat_data); if (!stamp) replaying = false; continue; }
        const raw = String(sourceText(message));
        let operations = messageMvuPatch(raw);
        if (!operations.length && !/<UpdateVariable\b/i.test(raw) && Array.isArray(stamp?.detachedOperations)) operations = clone(stamp.detachedOperations);
        if (!data) { if (operations.length) throw Error('缺少 MVU 初始变量，不能处理更新。'); continue; }
        if (operations.length) data = applyMvuPatch(data, operations);
        replaying = true;
        const detachedOperations = operations.length && !/<UpdateVariable\b/i.test(message.mes || '') ? clone(operations) : null;
        staged.push({ message, swipe, variables: { ...(variables || {}), stat_data: clone(data) }, source, detachedOperations });
    }
    // Parse every message before mutating any snapshots; failures keep originals.
    return { count: staged.length, data, commit() { for (const item of staged) { (item.message.variables ||= {})[item.swipe] = item.variables; ((item.message.extra ||= {}).independentMvu ||= {})[item.swipe] = { version: 1, source: item.source, ...(item.detachedOperations ? { detachedOperations: item.detachedOperations } : {}) }; } } };
}
