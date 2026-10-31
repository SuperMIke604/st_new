import { validateVariables } from './variable-manager.js';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const revisions = new WeakMap();
export function helperMessageRevision(message) {
    const swipes = message.swipes || [], cached = revisions.get(message);
    if (cached && cached.mes === message.mes && cached.swipe === (message.swipe_id || 0) && cached.user === !!message.is_user && cached.swipes.length === swipes.length && cached.swipes.every((text, index) => text === swipes[index])) return cached.revision;
    const source = JSON.stringify([message.mes || '', message.swipe_id || 0, message.swipes || null, !!message.is_user]);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
    const revision = `${source.length}:${hash >>> 0}`;
    revisions.set(message, { mes: message.mes, swipe: message.swipe_id || 0, user: !!message.is_user, swipes: [...swipes], revision });
    return revision;
}
export function patchHelperVariables(records, changes) {
    if (!Array.isArray(records) || !records[0] || Object.hasOwn(records[0], 'mes')) throw Error('聊天文件格式无效。');
    if (!Array.isArray(changes) || changes.length > 500 || JSON.stringify(changes).length > 4000000) throw Error('脚本变量保存批次无效或过大。');
    const next = structuredClone(records), seen = new Set();
    for (const change of changes) {
        if (!change || !['chat', 'message'].includes(change.type)) throw Error('不支持此脚本变量范围。');
        const key = change.type === 'chat' ? 'chat' : `message:${change.message_id}`;
        if (seen.has(key)) throw Error('脚本保存包含重复目标。'); seen.add(key);
        const value = validateVariables(change.value), base = validateVariables(change.base);
        let current;
        if (change.type === 'chat') current = next[0].chat_metadata?.variables || {};
        else {
            if (!Number.isSafeInteger(change.message_id) || change.message_id < 0) throw Error('消息楼层无效。');
            const message = next[change.message_id + 1];
            if (!message || helperMessageRevision(message) !== change.revision) throw Error('消息或回复分支已变化，脚本变量未写入。');
            const count = Math.max(1, message.swipes?.length || 0, (message.swipe_id || 0) + 1);
            for (const index of Object.keys(value)) if (!/^(0|[1-9]\d*)$/.test(index) || Number(index) >= count || !value[index] || typeof value[index] !== 'object' || Array.isArray(value[index])) throw Error('回复分支变量格式无效。');
            current = message.variables || {};
        }
        if (!equal(current, base) && !equal(current, value)) throw Error('变量已被其他页面或脚本修改，请重新读取。');
        if (change.type === 'chat') (next[0].chat_metadata ||= {}).variables = value;
        else next[change.message_id + 1].variables = value;
    }
    return next;
}
export function patchHelperMessages(records, patches, { greetings = [] } = {}) {
    if (!Array.isArray(records) || !records[0] || Object.hasOwn(records[0], 'mes')) throw Error('聊天文件格式无效。');
    if (!Array.isArray(patches) || patches.length > 100 || JSON.stringify(patches).length > 4000000) throw Error('消息修改批次无效。');
    let next = structuredClone(records); const seen = new Set();
    for (const patch of patches) {
        if (!Number.isSafeInteger(patch?.message_id) || patch.message_id < 0 || seen.has(patch.message_id)) throw Error('消息楼层无效或重复。');
        seen.add(patch.message_id);
        const message = next[patch.message_id + 1];
        if (!message || helperMessageRevision(message) !== patch.revision) throw Error('消息或回复分支已变化，修改未写入。');
        if (Object.keys(patch).some(key => !['message_id', 'revision', 'base', 'message', 'data', 'swipes_data', 'swipe_id'].includes(key))) throw Error('此消息修改字段尚未接入。');
        if (patch.swipe_id !== undefined) {
            if (patch.message !== undefined || patch.data !== undefined || patch.swipes_data !== undefined || message.is_user) throw Error('切换回复不能同时改写正文或变量。');
            const target = next[patch.message_id + 1];
            if (!target.swipes?.length && patch.message_id === 0 && greetings.length && target.mes === greetings[0]) {
                target.swipes = structuredClone(greetings); target.swipe_info ||= [{ extra: structuredClone(target.extra || {}) }];
            }
            if (!Number.isSafeInteger(patch.swipe_id) || patch.swipe_id < 0 || patch.swipe_id >= (target.swipes?.length || 1)) throw Error('回复分支不存在。');
            target.swipe_id = patch.swipe_id; target.mes = target.swipes?.[patch.swipe_id] ?? target.mes;
            if (target.swipe_info?.[patch.swipe_id]) Object.assign(target, structuredClone(target.swipe_info[patch.swipe_id]));
        }
        if (patch.data !== undefined && patch.swipes_data !== undefined) throw Error('不可同时修改 data 和 swipes_data。');
        let variables = structuredClone(message.variables || {});
        if (patch.data !== undefined) variables[message.swipe_id || 0] = validateVariables(patch.data);
        if (patch.swipes_data !== undefined) {
            const count = message.swipes?.length || 1;
            if (!Array.isArray(patch.swipes_data) || patch.swipes_data.length !== count) throw Error('回复分支数量已变化。');
            variables = Object.fromEntries(patch.swipes_data.map((value, index) => [index, validateVariables(value)]));
        }
        if (patch.data !== undefined || patch.swipes_data !== undefined) {
            next = patchHelperVariables(next, [{ type: 'message', message_id: patch.message_id, revision: patch.revision, base: patch.base, value: variables }]);
        }
        const target = next[patch.message_id + 1];
        if (patch.message !== undefined) {
            if (typeof patch.message !== 'string' || patch.message.length > 1000000) throw Error('消息正文格式无效或过大。');
            target.mes = patch.message;
            if (Array.isArray(target.swipes)) target.swipes[target.swipe_id || 0] = patch.message;
        }
    }
    return next;
}
