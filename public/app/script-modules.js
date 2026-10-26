// Only the user-requested MVU entry point is enabled for now. Importing runs the original
// module; this layer must never substitute an implementation of its features.
export const MVU_MODULE_URL = 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js';
export function scriptModuleUrls(content) {
    let rest = String(content || ''), urls = [];
    const trivia = /^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/;
    while (rest) {
        rest = rest.replace(trivia, '');
        if (!rest) break;
        const match = /^import\s*(['"])(https:\/\/[^'"\s\\]+)\1\s*;?/.exec(rest);
        if (!match) return null;
        try {
            const url = new URL(match[2]);
            if (url.href !== MVU_MODULE_URL || match[2] !== MVU_MODULE_URL) return null;
        } catch { return null; }
        urls.push(match[2]);
        if (urls.length > 20) return null;
        rest = rest.slice(match[0].length);
    }
    return urls.length ? urls : null;
}

// Serialized into the isolated script iframe. An imported module completing is
// not proof that its asynchronous startup or application-specific features work.
export async function loadScriptModules(urls, importer = url => import(url)) {
    for (const url of urls) {
        let timer;
        try {
            await Promise.race([
                importer(url),
                new Promise((_, reject) => { timer = setTimeout(() => reject(Error('远程模块加载超时')), 30000); }),
            ]);
        } catch (error) {
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
