export function validateExtensionPrompt(payload) {
    const { name, value, position = 1, depth = 0, scan = false, role = 0 } = payload || {};
    if (typeof name !== 'string' || !name || name.length > 100 || typeof value !== 'string' || value.length > 100000) throw Error('脚本提示词名称或内容无效。');
    if (![0, 1].includes(position) || !Number.isInteger(depth) || depth < 0 || depth > 100 || scan !== false || ![0, 1, 2].includes(role)) throw Error('暂只支持系统区或聊天深度注入，不支持扫描脚本提示词。');
    return { name, content: value, position, depth, role: ['system', 'user', 'assistant'][role] };
}
