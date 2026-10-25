export const MESSAGE_VARIABLES = Symbol('message variables');
export function messageVariableContext(chat = [], seed = null) {
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index]; if (!message || message.is_system) continue;
        const variables = message.variables?.[message.swipe_id || 0];
        if (variables && typeof variables === 'object' && Object.keys(variables).length) return variables;
    }
    return seed ? { stat_data: seed } : {};
}
function clean(value, depth = 0) {
    if (depth > 80) throw Error('变量嵌套过深。');
    if (Array.isArray(value)) return value.map(item => clean(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$') && !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]));
    return value;
}
function yaml(value, indent = 0) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value) && value.length) return value.map(item => item && typeof item === 'object' && Object.keys(item).length ? `${pad}-\n${yaml(item, indent + 2)}` : `${pad}- ${JSON.stringify(item)}`).join('\n');
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return Object.entries(value).map(([key, item]) => item && typeof item === 'object' && Object.keys(item).length ? `${pad}${JSON.stringify(key)}:\n${yaml(item, indent + 2)}` : `${pad}${JSON.stringify(key)}: ${JSON.stringify(item)}`).join('\n');
    return pad + JSON.stringify(value);
}
export function resolveMessageVariableMacro(key, variables = {}) {
    const match = /^(get|format)_message_variable::([\s\S]+)$/i.exec(key.trim());
    if (!match) return undefined;
    let value = variables;
    for (const part of match[2].trim().replace(/\[(\d+)\]/g, '.$1').split('.')) {
        if (part.startsWith('$') || ['__proto__', 'prototype', 'constructor'].includes(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) return '';
        value = value[part];
    }
    if (value === undefined) return '';
    const sanitized = clean(value);
    return match[1].toLowerCase() === 'get' ? JSON.stringify(sanitized) : yaml(sanitized);
}
