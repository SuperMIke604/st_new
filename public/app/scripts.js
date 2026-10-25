export function scriptTrees(settings = {}, character = null) {
    const helper = settings.extension_settings?.tavern_helper;
    const legacy = settings.extension_settings?.TavernHelper;
    const globals = helper?.script?.scripts ?? legacy?.scriptsRepository;
    return {
        global: Array.isArray(globals) ? globals : [],
        character: Array.isArray((character?.data || character)?.extensions?.tavern_helper?.scripts) ? (character?.data || character).extensions.tavern_helper.scripts : [],
    };
}
export function validateScriptTree(tree, depth = 0) {
    if (!Array.isArray(tree) || depth > 12 || tree.length > 300) throw Error('脚本文件夹格式无效或层级过多。');
    for (const item of tree) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('脚本格式无效。');
        if (item.type === 'folder') validateScriptTree(item.scripts || item.children, depth + 1);
        else if (typeof item.content !== 'string') throw Error('脚本代码必须是文字。');
    }
    return tree;
}
export async function saveCharacterScripts(api, avatar, tree) {
    validateScriptTree(tree);
    // Patch only scripts: variables and other helper metadata can change while
    // the editor is open and must not be copied back from an old card snapshot.
    const result = await api.post('/api/characters/merge-attributes', { avatar, data: { extensions: { tavern_helper: { scripts: structuredClone(tree) } } } });
    if (result !== 'OK' && result?.ok !== true) throw Error('角色卡脚本保存失败。');
    const card = await api.post('/api/characters/get', { avatar_url: avatar }, { signal: AbortSignal.timeout(15000) });
    if (JSON.stringify(scriptTrees({}, card).character) !== JSON.stringify(tree)) throw Error('脚本保存核验失败，请重试。');
    return card;
}
export function scriptRows(tree, parentEnabled = true, folder = '') {
    return (Array.isArray(tree) ? tree : []).flatMap((item, index) => {
        if (!item || typeof item !== 'object') return [];
        const enabled = parentEnabled && item.enabled !== false;
        if (item.type === 'folder') return scriptRows(item.scripts || item.children, enabled, [folder, item.name].filter(Boolean).join(' / '));
        return [{ script: item, parent: tree, index, enabled, folder }];
    });
}
export function scriptScopeEnabled(settings, character, scope) {
    const enabled = settings.extension_settings?.tavern_helper?.script?.enabled;
    const legacy = settings.extension_settings?.TavernHelper;
    if (scope === 'global') return (enabled?.global ?? legacy?.global_script_enabled) !== false;
    const characters = enabled?.characters ?? legacy?.characters_with_scripts;
    return !Array.isArray(characters) || characters.includes(character?.avatar);
}
export function patchScriptScope(settings, scope, { tree, enabled, avatar, allAvatars = [] }) {
    const helper = (settings.extension_settings ||= {}).tavern_helper ||= {};
    const scripts = helper.script ||= {};
    if (!scripts.enabled || typeof scripts.enabled !== 'object' || Array.isArray(scripts.enabled)) scripts.enabled = {};
    if (scope === 'global') { validateScriptTree(tree); scripts.scripts = structuredClone(tree); scripts.enabled.global = enabled; }
    else {
        const current = scripts.enabled.characters ?? settings.extension_settings.TavernHelper?.characters_with_scripts;
        const avatars = new Set(Array.isArray(current) ? current : allAvatars);
        if (enabled) avatars.add(avatar); else avatars.delete(avatar);
        scripts.enabled.characters = [...avatars];
    }
}
export function scriptSupport(script) {
    const text = String(script.content || '');
    if (/^\s*import\s*['"]https:\/\/[^'"\s]+\/MagVarUpdate@[^'"\s]+\/artifact\/bundle\.js['"]\s*;?\s*$/.test(text)) return { supported: true, adapter: 'mvu', reason: '使用内置 MVU 兼容：InitVar 初始化和 JSONPatch 更新；不加载外部 beta 模块。' };
    if (text.includes('世界书名前缀') && text.includes('切换场景') && /\bgetWorldbook\b/.test(text)) return { supported: true, adapter: 'world-switch', reason: '支持切换此角色关联世界书的条目启用状态。' };
    if (text.includes('fate-phone-container') && text.includes('getMvuDataSafe') && text.includes('initFatePhone')) return { supported: true, adapter: 'mvu-status', reason: '已适配此状态栏在独立面板读取当前聊天的 MVU 变量。' };
    if (/^\s*import\s|\bimport\s*\(/m.test(text)) return { supported: false, reason: '依赖外部模块导入，当前兼容环境暂不支持。' };
    if (/\bindexedDB\b/.test(text)) return { supported: false, reason: '依赖本地数据库（IndexedDB），当前隔离环境暂不支持。' };
    const nativeParent = /\b(?:parent|top)\s*\.\s*(?:document|jQuery)\b/.test(text) || [...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*window\.(?:parent|top)\b/g)].some(match => text.includes(match[1] + '.document') || text.includes(match[1] + '.jQuery'));
    if (nativeParent) return { supported: false, reason: '需要访问酒馆原生页面，此接口暂未接入。' };
    if (/\b(?:getWorldbook|replaceWorldbook|getLorebookEntries|setLorebookEntries)\b/.test(text)) return { supported: false, reason: '依赖世界书读写接口，暂未接入。' };
    if (/\bcreateChatMessages\s*\(/.test(text)) return { supported: false, reason: '依赖创建聊天消息接口，暂未接入。' };
    return { supported: true, reason: '可在脚本面板中尝试运行；仅提供已接入的兼容接口。' };
}
export function characterScriptPlan(settings, character) {
    const enabled = scriptScopeEnabled(settings, character, 'character');
    return scriptRows(scriptTrees(settings, character).character).map(row => ({ ...row.script, scope: 'character', enabled: enabled && row.enabled }));
}
export function usesMvuCompat(settings, character) { return characterScriptPlan(settings, character).some(script => script.enabled && scriptSupport(script).adapter === 'mvu'); }
export function activeScripts(settings, character) {
    const trees = scriptTrees(settings, character);
    return ['global', 'character'].flatMap(scope => scriptScopeEnabled(settings, character, scope) ? scriptRows(trees[scope]).filter(row => row.enabled).map(({ script }) => ({ ...script, scope })) : []);
}
export function scriptSnapshot({ chat = [], header, character, settings = {} }) {
    const recent = Math.max(0, chat.length - 40);
    const latest = chat.findLastIndex(message => message.variables?.[message.swipe_id || 0]?.stat_data);
    let budget = 2000000;
    const messages = chat.map((message, index) => ({ message_id: index, name: message.name, is_user: !!message.is_user, mes: index >= recent ? String(message.mes || '').slice(0, 20000) : '', swipe_id: message.swipe_id || 0, variables: {} }));
    for (let index = chat.length - 1; index >= 0; index--) {
        if (index < recent && index !== latest) continue;
        const variables = chat[index].variables || {}, size = JSON.stringify(variables).length;
        if (size <= budget) { messages[index].variables = structuredClone(variables); budget -= size; }
    }
    return {
        characterName: character?.name || '', userName: settings.username || 'User',
        worldbookName: (character?.data || character)?.extensions?.world || '',
        mvuSeed: header?.chat_metadata?.independentMvuSeed ? { stat_data: structuredClone(header.chat_metadata.independentMvuSeed) } : null,
        characterVariables: structuredClone((character?.data || character)?.extensions?.tavern_helper?.variables || {}),
        chatVariables: structuredClone(header?.chat_metadata?.variables || {}),
        chat: messages,
    };
}
export function latestMvuData(snapshot, target = 'latest') {
    const messages = snapshot.chat || [];
    if (Number.isInteger(target)) {
        const message = messages[target]; return message?.variables?.[message.swipe_id || 0] || {};
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i], vars = message.variables?.[message.swipe_id || 0];
        if (vars?.stat_data) return vars;
    }
    return snapshot.mvuSeed || {};
}
