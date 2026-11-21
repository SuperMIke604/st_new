const previous = /^async function readPrevious\(M,mid\)\{[^\r\n]+\}$/m;
const previousFull = /^async function readPreviousFull\(M, mid\) \{[\s\S]*?^\}/m;
const parser = /  const parsed = await M\.parseMessage\(cleanMsg, clone\(base\)\);[\s\S]*?^\}/m;
const missingApi = /^  if \(typeof M\?\.parseMessage !== 'function' \|\| typeof M\?\.replaceMvuData !== 'function'\) \{[\s\S]*?^  \}/m;
const variableDefaults = /^  for \(const k of \['道侣','人物','灵宠','绝色榜','事件'\]\) \{[\s\S]*?^  if \(isRecord\(base\.stat_data\.世界\)[^\r\n]+/m;

export function adaptHtmlMvuReparse(source) {
    const signature = 'async function rereadFromMessage(M, mid, overrideBlock = null)';
    if (!source.includes(signature) || !source.includes('id="patch-apply"') ||
        !source.includes('repairUpdateVariableBlocks(rawMsg, base.stat_data)') ||
        ![previous, previousFull, parser, missingApi, variableDefaults].every(pattern => pattern.test(source))) return null;
    return source
        .replace(previous, "async function readPrevious() { return (await window.__companionMvu('previous'))?.stat_data || null; }")
        .replace(previousFull, "async function readPreviousFull() { return window.__companionMvu('previous'); }")
        .replace(missingApi, '')
        .replace('  const base = prevFull || (isRecord(existing?.stat_data?.主角) && isRecord(existing?.stat_data?.世界) ? clone(existing) : null);', '  const base = prevFull;')
        .replace("  if (!base) throw Error('未找到可承接的前层变量快照');\n", '')
        .replace(variableDefaults, "  if (!base) throw Error('未找到可承接的前层变量快照');")
        .replace(parser, `  const result = await window.__companionMvu('reparse', { text: cleanMsg, base });
  return {sd: result.data.stat_data, mode: result.changed ? 'reparsed' : 'unchanged', fixes, cleanMsg};
}`)
        .replace('async function refresh(force = false, reparse = false, overrideBlock = null) {', 'let pendingReparse;\nasync function refresh(force = false, reparse = false, overrideBlock = null) {')
        .replace('  if (busy) { pending = true; return; }', `  if (busy) {
    if (reparse) pendingReparse = { overrideBlock };
    else pending = true;
    return;
  }`)
        .replace("    notice('正在重阅本层正文并重填天道簿……');", "    $('patch-apply').disabled = true;\n    $('notice').dataset.reparseFeedback = 'true';\n    notice('正在重阅本层正文并重填天道簿……');")
        .replace('    if (pending) { pending = false; scheduleRefresh(60); }', `    $('patch-apply').disabled = false;
    if (pendingReparse) {
      const next = pendingReparse;
      pendingReparse = null;
      queueMicrotask(() => refresh(true, true, next.overrideBlock));
    } else if (pending) { pending = false; scheduleRefresh(60); }`)
        .replace("    } else {\n      notice('第 ' + mid + ' 层 · 本层变量快照。'", "    } else if (!$('notice').dataset.reparseFeedback) {\n      notice('第 ' + mid + ' 层 · 本层变量快照。'")
        .replace("        if ($('patch-fold').open) displayPatch();", "        if ($('patch-fold').open && !$('patch-text').value) displayPatch();");
}

export function isReparseMvuData(data) {
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    return object(data?.stat_data?.主角) && object(data?.stat_data?.世界);
}

export function previousMvuSource(chat, index) {
    for (let id = index - 1; id >= Math.max(0, index - 40); id--) {
        const message = chat[id], data = message.variables?.[message.swipe_id || 0];
        if (isReparseMvuData(data)) return { id, message, data };
    }
    return null;
}

export function reparseMvuBase(data) {
    const base = structuredClone(data);
    for (const key of ['道侣', '人物', '灵宠', '绝色榜', '事件']) {
        const value = base.stat_data[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) base.stat_data[key] = {};
    }
    const trends = base.stat_data.世界.动向;
    if (!trends || typeof trends !== 'object' || Array.isArray(trends)) base.stat_data.世界.动向 = {};
    return base;
}
