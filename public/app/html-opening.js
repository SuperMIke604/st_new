import { validateVariables } from './variable-manager.js';

// Match the original opening's handlers as a group before adapting its source.
const draftHandler = /    function pushToInput\(text\) \{[\s\S]*?\n    \}/;
const variableHandlers = /    function findVarFn\(\) \{[\s\S]*?\n    async function setVar\(path, value\) \{[\s\S]*?\n    \}/;
const worldHandlers = /    function pickTH\(names\) \{[\s\S]*?\n    async function syncWorldbook\(enableNames\) \{[\s\S]*?\n    \}/;
const confirmation = /      const okCount = writes\.filter\(Boolean\)\.length;[\s\S]*?(?=      const fixOn = S\.desc === 'body';)/;
const draftResult = /      if \(pushToInput\(brief\)\)[^\n]*\n      else \{[^\n]*\}/;
const variableWriter = 'const put = async (path, val) => { writes.push(!!(await setVar(path, val))); };';
const sealRead = /    const M = mvu\(\);\s+const create = api\('createChatMessages'\);[\s\S]*?    const data = clone\(await M\.getMvuData\(floor\) \|\| \{\}\);/;
const sealSubmit = /    await M\.replaceMvuData\(data, floor\);[\s\S]*?    await trigger\('\/trigger'\);\s+    notice\([^\r\n]+\);/;

export function adaptHtmlOpening(source) {
    if (!source.includes("bind('go', start);") || !source.includes("pd().querySelector('#send_textarea')") || !source.includes(variableWriter) ||
        !source.includes("await setVar('环境与剧情.开局激活', marker);") || !source.includes('function aiGen(side)') || !source.includes('if (pushToInput(prompt))') ||
        ![draftHandler, variableHandlers, worldHandlers, confirmation, draftResult].every(pattern => pattern.test(source))) return null;

    return source
        .replace(draftHandler, `    async function pushToInput(text) {
      try { return await window.__companionOpening('draft', { text }); }
      catch (error) { log(esc(error.message)); return false; }
    }`)
        .replace(variableHandlers, `    const openingVariables = [];
    async function setVar(path, value) { openingVariables.push([path, value]); }`)
        .replace(worldHandlers, `    async function syncWorldbook(entries) {
      try {
        const turned = await window.__companionOpening('worldbook', { entries });
        return { ok: true, turned };
      } catch (error) { return { ok: false, msg: error.message }; }
    }`)
        .replace("      const writes = [];\n", '')
        .replace(variableWriter, 'const put = setVar;')
        .replace(confirmation, '')
        .replace(draftResult, `      try {
        const result = await window.__companionOpening('confirm', { variables: openingVariables, entries: enable, text: brief });
        lastEnable = enable;
        log('变量写入：<b>成功 ' + result.variables + ' 项</b>');
        log('世界书开关：<b>已开启 ' + result.turned + ' 个条目</b>。');
        log('开场指令：<b>已写入输入框</b>，按回车即可降临。');
      } catch (error) {
        log('开局未完成：' + esc(error.message));
        log('开场指令，可手动复制：'); log(esc(brief));
      }`)
        .replace('function aiGen(side)', 'async function aiGen(side)')
        .replace('if (pushToInput(prompt))', 'if (await pushToInput(prompt))')
        .replace("bind('go', start);", `bind('go', async () => {
        openingVariables.length = 0;
        try { await start(); } catch (error) { log('开局未完成：' + esc(error.message)); }
        finally { $('go').disabled = false; }
      });`);
}

export function adaptMvuSealOpening(source) {
    if (!source.includes('id="finish-copy"') || !source.includes('data._赤孽开局命牒 = sealedCommand;') ||
        !source.includes('data.schema = openingSchema(opening, data.schema || {});') || !sealRead.test(source) || !sealSubmit.test(source)) return null;
    return source
        .replace('落契后保存初始变量，并发送以下命牒开启首章。', '落契后保存初始变量，并将以下命牒填入输入框。确认后发送即可开启首章。')
        .replace(/(<button id="finish-copy"[^>]*>[^<]*<\/button>)/, '$1<button id="finish-draft" class="small-btn" type="button" hidden>填入输入框</button>')
        .replace("  let stage = 'editing';\n", '')
        .replace(sealRead, `    const base = await window.__companionOpening('seal-state');
    const data = clone(base);`)
        .replace(sealSubmit, `    await window.__companionOpening('seal', { base, data, text: sealedCommand });
    complete('初始变量已保存，命牒已填入输入框。确认后发送即可开启首章。');
    notice('命牒已成。');`)
        .replace(/^    if \(stage === '(?:saved|sent)'\)[^\r\n]+\r?\n/gm, '')
        .replace("  $('finish-text').textContent = message;", `  $('finish-text').textContent = message;
  $('finish-draft').hidden = !sealedCommand;`)
        .replace("$('enter').onclick = () => goToPage(0);", `$('finish-draft').onclick = async () => {
  try {
    await window.__companionOpening('seal', { text: sealedCommand });
    notice('命牒已填入输入框。');
  } catch (error) { notice(error.message || String(error), true); }
};
$('enter').onclick = () => goToPage(0);`);
}

export function sealedOpeningVariables(chat, text) {
    if (chat.length !== 1 || chat[0].is_user || typeof text !== 'string' || !text.trim()) return null;
    const data = chat[0].variables?.[chat[0].swipe_id || 0];
    return data?.stat_data?._开局已创建 === true && data.schema && data._赤孽开局命牒 === text ? structuredClone(data) : null;
}

export function openingVariableData(base, paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100 || JSON.stringify(paths).length > 150000) throw Error('开局变量格式无效或过大。');
    const data = validateVariables(base);
    const roots = new Set(['环境与剧情', '待赎者状态', '施堕者列表', '救赎者状态']);
    const blocked = new Set(['__proto__', 'prototype', 'constructor']);
    for (const pair of paths) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || pair[0].length > 400) throw Error('开局变量路径无效。');
        const parts = pair[0].split('.'), leaf = parts.pop();
        if (!roots.has(parts[0] ?? leaf) || parts.length > 8 || [...parts, leaf].some(key => !key.trim() || blocked.has(key))) throw Error('开局变量路径无效。');
        if (!parts.length && (!pair[1] || typeof pair[1] !== 'object' || Array.isArray(pair[1]))) throw Error('开局变量结构无效。');
        let target = data;
        for (const key of parts) {
            if (!Object.hasOwn(target, key)) target[key] = {};
            if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) throw Error('开局变量结构已变化，请检查当前聊天变量。');
            target = target[key];
        }
        target[leaf] = pair[1];
    }
    return validateVariables(data);
}

export function openingWorldCommands(book, entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 50 ||
        entries.some(name => typeof name !== 'string' || !name.trim() || name.length > 250)) throw Error('开局世界书条目无效。');
    const targets = new Set(entries), found = new Set(), commands = [];
    for (const [key, entry] of Object.entries(book.entries || {})) {
        if (!targets.has(entry.comment)) continue;
        found.add(entry.comment);
        if (entry.disable) commands.push({ type: 'setentryfield', uid: entry.uid ?? key, field: 'disable', value: false });
    }
    const missing = [...targets].filter(name => !found.has(name));
    if (missing.length) throw Error('当前角色的世界书缺少开局条目：' + missing.join('、'));
    return commands;
}
