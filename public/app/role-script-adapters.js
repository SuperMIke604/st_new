import { isGenerationFetchScript } from './scripts.js';
export function roleScriptContent(script, adapter) {
    let content = script.content || '';
    if (adapter === 'button-input') return content.replace(/eventOnButton\(([^,\n]+),\s*\(\)\s*=>\s*\{(\s*const\s+\w+\s*=\s*)prompt\(([^;]+)\);/g, 'eventOnButton($1, async () => {$2await SillyTavern.callGenericPopup($3, SillyTavern.POPUP_TYPE.INPUT);');
    if (adapter === 'native-widget' && content.includes('getLocalWorldInfo')) content = `const __bookName=getCharWorldbookNames().primary; if(__bookName) window.world_info_data={ [__bookName]: { entries:Object.fromEntries((await getWorldbook(__bookName)).map(entry=>[entry.uid,entry])) } };\n` + content;
    if (adapter === 'native-widget') content = content.replace(/shadow\.appendChild\((faLink|fa)\);/, `const __iconFallback=document.createElement('style'); __iconFallback.textContent='.fa::before,.fas::before{content:"◆";font-family:system-ui}.fa-map::before,.fa-map-marked-alt::before{content:"🗺"}.fa-book::before,.fa-book-open::before{content:"▤"}.fa-times::before{content:"×"}.fa-chevron-down::before{content:"⌄"}.fa-search::before{content:"⌕"}'; shadow.appendChild(__iconFallback);`);
    if (adapter === 'role-engine') {
        // Await the original injection tasks at the generation barrier. No dice
        // rules, parser prompts or accounting algorithms are reimplemented.
        content = content.replaceAll('  发骰池();', '  window.__scriptDiceReady = 发骰池();')
            .replace('  同步月度锚();', '  await 同步月度锚();')
            .replace('  同步可偶遇();', '  await 同步可偶遇();');
        const end = content.lastIndexOf('})();');
        if (end < 0) throw Error('角色引擎结构已变化，请重新检查兼容性。');
        content = content.slice(0, end) + "eventOn(tavern_events.GENERATION_STARTED, () => window.__scriptDiceReady);\n" + content.slice(end);
    }
    if (adapter === 'generation-fetch') {
        if (!isGenerationFetchScript(content)) throw Error('生成脚本结构已变化，请重新检查兼容性。');
        content = content.replace(/function resolvePenetratedWindow\(\) \{[\s\S]*?\n    \}/, 'function resolvePenetratedWindow() { return window; }');
        return content.replace('engine.install(targetWin);', `engine.disposeGenerationInterceptor = registerGenerationInterceptor((url, init, next) => engine.isEnabled ? engine.intercept(next, null, [url, init]) : next(url, init));`).replace('engine.dispose();', 'engine.disposeGenerationInterceptor?.(); engine.dispose();').replace('$(onMount);', 'onMount();');
    }
    if (['mvu', 'mvu-schema'].includes(adapter)) return '';
    if (['role-avatar', 'role-archive'].includes(adapter)) {
        content = content.replaceAll("$('<div></div>').text(文案).css(常态)", "$('<div role=\"button\" tabindex=\"0\"></div>').text(文案).css(常态)").replaceAll('<div class="mxav-link"></div>', '<div class="mxav-link" role="button" tabindex="0"></div>');
        if (/^\s*\(async\s*\(/.test(content)) content = 'await ' + content;
    }
    if (adapter !== 'role-avatar') return content;
    const start = content.indexOf('  function 开库() {'), end = content.indexOf('  function 规范名(', start);
    if (start < 0 || end < 0) throw Error('头像库版本结构已变化，请重新检查适配。');
    return (content.slice(0, start) + `
  const 读全部=()=>__avatarStore('list');
  const 存记录=records=>__avatarStore('put',{records});
  const 删记录=key=>__avatarStore('delete',{key:String(key)});
  const 清空库=()=>__avatarStore('clear');
` + content.slice(end)).replace('window.indexedDB ?? 宿主窗口.indexedDB', 'true');
}
