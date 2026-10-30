import { scriptModuleUrls, fallbackModuleUrls } from './script-modules.js';
import { helperMessageRevision } from './helper-state.js';

export function scriptTrees(settings = {}, character = null, preset = null) {
    const helper = settings.extension_settings?.tavern_helper;
    const legacy = settings.extension_settings?.TavernHelper;
    const globals = helper?.script?.scripts ?? legacy?.scriptsRepository;
    return {
        global: Array.isArray(globals) ? globals : [],
        preset: Array.isArray(preset?.extensions?.tavern_helper?.scripts) ? preset.extensions.tavern_helper.scripts : [],
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
export function patchGlobalScripts(settings, tree) {
    validateScriptTree(tree);
    const helper = (settings.extension_settings ||= {}).tavern_helper ||= {};
    const scripts = helper.script ||= {};
    scripts.scripts = structuredClone(tree);
}
export function patchPresetScripts(preset, tree) {
    validateScriptTree(tree);
    const helper = (preset.extensions ||= {}).tavern_helper ||= {};
    helper.scripts = structuredClone(tree);
}
export async function savePresetScripts(api, name, tree) {
    validateScriptTree(tree);
    api.readCache?.clear();
    const latest = await api.settings();
    const index = latest.bundle.openai_setting_names.indexOf(name);
    if (index < 0) throw Error('此预设已不存在，请重新选择。');
    const raw = latest.bundle.openai_settings[index];
    const data = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    patchPresetScripts(data, tree);
    const result = await api.post('/api/presets/save', { apiId: 'openai', name, preset: data });
    if (!result?.name) throw Error('预设脚本保存失败。');
    const saved = await api.settings();
    const savedIndex = saved.bundle.openai_setting_names.indexOf(result.name);
    const savedRaw = saved.bundle.openai_settings[savedIndex];
    const preset = typeof savedRaw === 'string' ? JSON.parse(savedRaw) : savedRaw;
    if (savedIndex < 0 || JSON.stringify(scriptTrees({}, null, preset).preset) !== JSON.stringify(tree)) throw Error('预设脚本保存核验失败，请重试。');
    return preset;
}
export function isGenerationFetchScript(text) {
    return typeof text === 'string' && text.includes("Symbol.for('__ATE_FETCH_HOOK__')") && text.includes('class AntiTruncationEngine') && text.includes('function resolvePenetratedWindow()') && text.includes('engine.install(targetWin);') && text.includes('async intercept(original, thisArg, args)') && text.includes('engine.dispose();');
}
export function scriptSupport(script) {
    const text = String(script.content || '');
    if (isGenerationFetchScript(text)) return { supported: true, adapter: 'generation-fetch', reason: '通过隔离的生成处理器运行原始请求改写及响应还原逻辑；不访问宿主页面或连接密钥。' };
    if (scriptModuleUrls(text)) return { supported: true, adapter: 'remote-module', reason: '加载原始 MVU 模块，通过独立助手接口提供变量更新和脚本设置。' };
    if (fallbackModuleUrls(text, true) && text.includes('export const Schema = z.object(') && text.includes('registerMvuSchema(Schema)')) return { supported: true, adapter: 'remote-schema', reason: '加载锁定版本的原始结构注册模块及角色变量结构。' };
    if (/^\s*import\s*\{\s*registerMvuSchema\s*\}\s*from\s*['"]https:\/\/[^'"]+\/mvu_zod\.js['"]/m.test(text) && text.includes('export const Schema = z.object(')) return { supported: true, adapter: 'mvu-schema', reason: '使用本地 Zod 校验变量结构、默认值和转换，不加载远程模块。' };
    if (text.includes('逐梦演艺圈_头像库') && text.includes('  function 开库() {') && text.includes('  function 规范名(')) return { supported: true, adapter: 'role-avatar', reason: '头像库使用按角色隔离的本地持久存储，支持本地图片与导入导出。' };
    if (text.includes('fate-phone-container') && text.includes('getMvuDataSafe') && text.includes('updateVariablesWith')) return { supported: true, adapter: 'mvu-status', reason: '支持角色状态栏及变量编辑器。' };
    if (text.includes('世界书名前缀') && text.includes('createChatMessages') && text.includes('triggerSlash') && /条目名前缀:\s*['"](?:Char_|Script_|Summary_)/.test(text)) return { supported: true, adapter: 'role-archive', reason: '支持当前角色的人设、剧本和总结生成，以及关联世界书归档。' };
    if (text.includes('世界书名前缀') && text.includes('切换场景') && /\bgetWorldbook\b/.test(text)) return { supported: true, adapter: 'world-switch', reason: '支持切换此角色关联世界书的条目启用状态。' };
    if (text.includes('fate-phone-container') && text.includes('getMvuDataSafe') && text.includes('initFatePhone')) return { supported: true, adapter: 'mvu-status', reason: '已适配此状态栏在独立面板读取当前聊天的 MVU 变量。' };
    if (/^\s*import\s|\bimport\s*\(/m.test(text)) return { supported: false, reason: '依赖外部模块导入，当前兼容环境暂不支持。' };
    if (/\bindexedDB\b/.test(text)) return { supported: false, reason: '依赖本地数据库（IndexedDB），当前隔离环境暂不支持。' };
    const nativeParent = /\b(?:parent|top)\s*\.\s*(?:document|jQuery)\b/.test(text) || [...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*window\.(?:parent|top)\b/g)].some(match => text.includes(match[1] + '.document') || text.includes(match[1] + '.jQuery'));
    if (nativeParent) return { supported: false, reason: '需要访问酒馆原生页面，此接口暂未接入。' };
    if (/\bsetLorebookEntries\s*\(/.test(text)) return { supported: false, reason: 'setLorebookEntries 接口尚未接入，请使用已支持的世界书接口。' };
    return { supported: true, reason: '可在脚本面板中尝试运行；仅提供已接入的兼容接口。' };
}
export function characterScriptPlan(settings, character) {
    return scriptRows(scriptTrees(settings, character).character).map(row => ({ ...row.script, scope: 'character', enabled: row.enabled }));
}
export function nativeScriptPlan(settings, character, preset) {
    return [...scriptRows(scriptTrees(settings, character, preset).preset).map(row => ({ ...row.script, scope: 'preset', enabled: row.enabled })), ...scriptRows(scriptTrees(settings, character).global).map(row => ({ ...row.script, scope: 'global', enabled: row.enabled })), ...characterScriptPlan(settings, character)];
}
export function usesMvuCompat(settings, character) { return characterScriptPlan(settings, character).some(script => script.enabled && scriptSupport(script).adapter === 'mvu'); }
export function activeScripts(settings, character, preset) {
    const trees = scriptTrees(settings, character, preset);
    return ['preset', 'global', 'character'].flatMap(scope => scriptRows(trees[scope]).filter(row => row.enabled).map(({ script }) => ({ ...script, scope })));
}
export function scriptSnapshot({ chat = [], header, character, preset, settings = {}, own = {}, file = '' }) {
    const recent = Math.max(0, chat.length - 40);
    const latest = chat.findLastIndex(message => message.variables?.[message.swipe_id || 0]?.stat_data);
    let budget = 2000000;
    const messages = chat.map((message, index) => ({ message_id: index, revision: helperMessageRevision(message), textAvailable: false, swipesAvailable: false, variablesAvailable: !Object.keys(message.variables || {}).length, name: message.name, is_user: !!message.is_user, is_system: !!message.is_system, mes: '', swipe_id: message.swipe_id || 0, variables: {} }));
    let textBudget = 2000000;
    for (let index = chat.length - 1; index >= recent; index--) {
        const text = String(chat[index].mes || '');
        if (text.length <= 100000 && text.length <= textBudget) { messages[index].mes = text; messages[index].textAvailable = true; textBudget -= text.length; }
        const swipes = chat[index].swipes || [text];
        let size = 0;
        for (const swipe of swipes) { size += String(swipe).length; if (size > 500000) break; }
        if (size <= 500000 && size <= textBudget) { messages[index].swipes = structuredClone(swipes); messages[index].swipesAvailable = true; textBudget -= size; }
    }
    for (let index = chat.length - 1; index >= 0; index--) {
        if (index < recent && index !== latest) continue;
        const variables = chat[index].variables || {}, size = JSON.stringify(variables).length;
        if (size <= budget) { messages[index].variables = structuredClone(variables); messages[index].variablesAvailable = true; budget -= size; }
    }
    return {
        characterName: character?.name || '', userName: settings.username || 'User',
        characterDescription: String((character?.data || character)?.description || '').slice(0, 100000),
        palette: own.palette === 'moss' ? 'moss' : 'paper',
        worldbookName: (character?.data || character)?.extensions?.world || '',
        chatId: file || header?.chat_metadata?.integrity || header?.chat_metadata?.chat_id || '',
        helperSettings: structuredClone(settings.extension_settings?.independentHelper?.mvu || {}),
        helperScriptSettings: structuredClone(settings.extension_settings?.independentHelper?.scriptSettings || {}),
        helperLegacyScriptId: (() => { const plan = nativeScriptPlan(settings, character, preset), index = plan.findIndex(script => script.enabled && scriptSupport(script).adapter === 'remote-module'); return index < 0 ? '' : `${plan[index].scope}-${plan[index].id || index}`; })(),
        helperButtons: structuredClone(settings.extension_settings?.independentHelper?.scriptButtons || {}),
        helperGlobals: structuredClone(settings.extension_settings?.variables?.global || {}),
        lorebookSettings: { ...(settings.extension_settings?.independentHelper?.loreSettings || {}), selected_global_lorebooks: structuredClone(settings.world_info_settings?.world_info?.globalSelect || []), scan_depth: settings.world_info_settings?.world_info_depth ?? 2, context_percentage: settings.world_info_settings?.world_info_budget ?? 25, budget_cap: settings.world_info_settings?.world_info_budget_cap ?? 0, max_recursion_steps: settings.world_info_settings?.world_info_max_recursion_steps ?? 0, recursive: settings.world_info_settings?.world_info_recursive !== false, case_sensitive: !!settings.world_info_settings?.world_info_case_sensitive, match_whole_words: !!settings.world_info_settings?.world_info_match_whole_words },
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
