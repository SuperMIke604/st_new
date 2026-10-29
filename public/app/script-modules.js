// Only the recognized MVU entry paths are enabled. Importing runs the original
// module; this layer must never substitute an implementation of its features.
export const MVU_MODULE_URL = 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js';
export function approvedModuleUrl(value, schema = false) {
    const project = schema ? 'StageDog/tavern_resource' : 'MagicalAstrogy/MagVarUpdate';
    const path = schema ? '/dist/util/mvu_zod.js' : '/artifact/bundle.js';
    return new RegExp('^https://(?:testingcf|cdn)\\.jsdelivr\\.net/gh/' + project + '@' + (schema ? '[a-f0-9]{40}' : '(?:beta|[a-f0-9]{40})') + path.replaceAll('.', '\\.') + '$').test(value);
}
export function fallbackModuleUrls(content, schema = false) {
    const text = String(content || '').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\r\n]*/gm, '').trim();
    const imports = [...text.matchAll(/\bimport\s*\(\s*(['"])(https:\/\/[^'"\s]+)\1\s*\)/g)].map(match => match[2]);
    if (imports.length !== 2 || !imports.every(url => approvedModuleUrl(url, schema))) return null;
    if (new URL(imports[0]).pathname !== new URL(imports[1]).pathname) return null;
    if (!schema && !/^try\s*\{\s*await import\([\s\S]*\}\s*catch\s*\(\w+\)\s*\{[\s\S]*await import\([^;]+\);?\s*\}\s*$/.test(text)) return null;
    return imports;
}
export function scriptModuleUrls(content) {
    const fallback = fallbackModuleUrls(content);
    if (fallback) return fallback;
    let rest = String(content || ''), urls = [];
    const trivia = /^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/;
    while (rest) {
        rest = rest.replace(trivia, '');
        if (!rest) break;
        const match = /^import\s*(['"])(https:\/\/[^'"\s\\]+)\1\s*;?/.exec(rest);
        if (!match) return null;
        try {
            const url = new URL(match[2]);
            if (url.href !== match[2] || !approvedModuleUrl(match[2])) return null;
        } catch { return null; }
        urls.push(match[2]);
        if (urls.length > 20) return null;
        rest = rest.slice(match[0].length);
    }
    return urls.length ? urls : null;
}

// Serialized into the isolated script iframe. An imported module completing is
// not proof that its asynchronous startup or application-specific features work.
export async function loadScriptModules(urls, importer = url => import(url), fallback = false) {
    for (const url of urls) {
        let timer, timedOut = false;
        try {
            await Promise.race([
                importer(url),
                new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(Error('远程模块加载超时')); }, 30000); }),
            ]);
            if (fallback) return;
        } catch (error) {
            // import() cannot be cancelled: a slow primary could still execute.
            // Only a rejected import is safe to retry on the alternate origin.
            if (fallback && !timedOut && url !== urls.at(-1)) continue;
            throw Error(`远程模块加载失败（${url}）：${error?.message || error}。请检查网络、跨域响应及脚本所需接口。`, { cause: error });
        } finally { clearTimeout(timer); }
    }
}

// These globals are declared as externals by MVU's webpack configuration. Use
// the actual upstream libraries, not app-specific versions of their behavior.
export async function loadMvuLibraries(importer = url => import(url), target = window) {
    const definitions = [
        ['Vue', 'vue@3.5.21/dist/vue.esm-browser.prod.js', false],
        ['_', 'lodash@4.17.21/+esm', true],
        ['YAML', 'yaml@2.8.0/+esm', false],
        ['z', 'zod@4.1.11/+esm', false],
    ];
    const libraries = await Promise.all(definitions.map(async ([name, path, useDefault]) => {
        const library = await importer('https://testingcf.jsdelivr.net/npm/' + path);
        return [name, useDefault ? library.default : library];
    }));
    for (const [name, library] of libraries) target[name] = library;
}

export function requireMvuHost(host = window) {
    const missing = [];
    if (typeof host.SillyTavern?.saveChat !== 'function') missing.push('SillyTavern.saveChat');
    if (typeof host.getTavernHelperVersion !== 'function') missing.push('getTavernHelperVersion');
    if (missing.length) throw Error(`原版 MVU 所需的宿主接口尚未接入：${missing.join('、')}。不会使用内置 MVU 功能代替原脚本运行。`);
}
