import { isGenerationFetchScript, isUnicodeFloorScript } from './scripts.js';

function unicodeFloorContent(content) {
    if (!isUnicodeFloorScript(content)) throw Error('4A 脚本结构已变化，请重新检查兼容性。');
    function replace(original, adapted) {
        if (!(typeof original === 'string' ? content.includes(original) : original.test(content))) throw Error('4A 脚本结构已变化，请重新检查兼容性。');
        content = content.replace(original, () => adapted);
    }
    function replaceFunction(name, adapted) {
        replace(new RegExp(`    function ${name}\\(\\) \\{[\\s\\S]*?\\n    \\}`), adapted);
    }
    replaceFunction('hostWindows', '    function hostWindows() { return [window]; }');
    replaceFunction('hostDocument', '    function hostDocument() { return document; }');
    replace(/    const parentWin = \(function \(\) \{[\s\S]*?\n    \} catch \(e\) \{\}/, '    const parentWin = window;');
    replaceFunction('settingsStorage', `    const scopedStorage = { ...SillyTavern.getContext().extensionSettings.unicodeFloor };
    function settingsStorage() {
        return {
            getItem: key => scopedStorage[key] ?? null,
            setItem(key, value) {
                scopedStorage[key] = value;
                SillyTavern.getContext().extensionSettings.unicodeFloor = { ...scopedStorage };
                SillyTavern.saveSettingsDebounced();
            },
        };
    }`);
    replaceFunction('installFetch', `    let stopGeneration;
    function installFetch() {
        if (runtime.installed) return;
        stopGeneration = registerGenerationInterceptor((url, init, next) => {
            const input = JSON.parse(init.body);
            const adapted = { ...init, body: JSON.stringify({ ...input, type: init.generationType }) };
            return handleGeneration((path, request) => {
                const outgoing = JSON.parse(request.body);
                const body = { ...input };
                for (const key of ['messages', 'stream', 'tools', 'tool_choice', 'parallel_tool_calls']) {
                    if (Object.hasOwn(outgoing, key)) body[key] = outgoing[key];
                    else delete body[key];
                }
                if (body.tools?.some(tool => tool.function?.name === SYNTHETIC_TOOL_NAME)) {
                    const processing = input.custom_prompt_post_processing;
                    if (processing && !TOOL_COMPATIBLE_POSTPROCESS.has(processing)) {
                        body.custom_prompt_post_processing = processing === 'merge' ? 'merge_tools'
                            : processing === 'semi' ? 'semi_tools' : 'strict_tools';
                    }
                }
                return next(path, { ...request, body: JSON.stringify(body) });
            }, null, [url, adapted]);
        });
        runtime.installed = true;
    }`);
    replaceFunction('removeFetch', `    function removeFetch() {
        stopGeneration?.();
        stopGeneration = undefined;
        runtime.installed = false;
    }`);
    replaceFunction('syncStPostProcessingForToolTransport', '    function syncStPostProcessingForToolTransport() {}');
    // The continuation serves the current chat generation once. Keep the
    // original response processing, including its terminal empty/error paths.
    replace(/            let didHttpShieldRescue = false;[\s\S]*?(?=\n            if \(!response.ok\) \{)/, '            const didHttpShieldRescue = false;');
    replace('const maxAttempts = rescueCtx && rescueCtx.allowEmptyRescue !== false ? 2 : 1;', 'const maxAttempts = 1;');
    replace('const maxAttempts = allowEmptyRescue ? 2 : 1;', 'const maxAttempts = 1;');
    replace(/            if \(!blockedOrEmpty \|\| attempt >= 1 \|\| run.signal.aborted\) \{[\s\S]*?(?=\n        \}\n        return currentResp;)/, '            return cleanedResponse || currentResp;');
    replace('for (let attempt = 0; attempt < 2; attempt++)', 'for (let attempt = 0; attempt < 1; attempt++)');
    replace(/            if \(!didHttpShieldRescue && result.stats.recoveredChars === 0 && !run.signal.aborted\) \{[\s\S]*?(?=\n            run.finish\(result.stats\);)/, '');
    replace(/        cleanupLegacyAntiRouteResiduals\(\);[\s\S]*?const launcher = registerLauncher\(\);/, `        loadSettings();
        loadTextLibrary();
        exposeApi();
        syncFetchInstallation();
        const launcher = registerLauncher();`);
    replace("    setTimeout(() => { try { init(); } catch (error) { console.error('[' + SCRIPT_NAME + '] initialization failed', error); notify('error', 'Initialization failed: ' + (error?.message || String(error))); } }, 0);", '    init();');
    return content;
}

export function roleScriptContent(script, adapter) {
    let content = script.content || '';
    if (adapter === 'unicode-floor') return unicodeFloorContent(content);
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
