// Only the recognized MVU entry paths are enabled. Importing runs the original
// module; this layer must never substitute an implementation of its features.
export const MVU_MODULE_URL = 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js';
const UNVERSIONED_MVU_MODULE = /^https:\/\/(?:testingcf|cdn|fastly)\.jsdelivr\.net\/gh\/MagicalAstrogy\/MagVarUpdate\/artifact\/bundle\.js$/;
export const SCHEMA_MODULE_REVISION = 'a796a5da2cc5993182d2ed44ddefac156e11af1c';
export function staticSchemaModule(content) {
    const match = /^\s*import\s*\{\s*registerMvuSchema(?:\s+as\s+([a-zA-Z_$][\w$]*))?\s*\}\s*from\s*(['"])(https:\/\/(?:testingcf|cdn)\.jsdelivr\.net\/gh\/StageDog\/tavern_resource(?:@[a-f0-9]{40})?\/dist\/util\/mvu_zod\.js)\2\s*;?/m.exec(content);
    if (!match) return null;
    const [, alias, , entryUrl] = match;
    const url = entryUrl.includes('tavern_resource@') ? entryUrl : entryUrl.replace('tavern_resource/', 'tavern_resource@' + SCHEMA_MODULE_REVISION + '/');
    return { source: match[0], url, alias };
}
export function remoteSchemaContent(content) {
    const entry = staticSchemaModule(content);
    const binding = entry?.alias ? `registerMvuSchema: ${entry.alias}` : 'registerMvuSchema';
    const source = entry ? content.replace(entry.source, () => `const {${binding}} = await import(${JSON.stringify(entry.url)});`) : content;
    return source
        .replace(/\bexport\s+const\s+Schema\b/, 'const Schema')
        .replace(/^([ \t]*)export[ \t]+(?=const[ \t]+[\p{ID_Start}_$][\p{ID_Continue}$]*\s*=\s*z\.object\()/gmu, '$1');
}
export function approvedModuleUrl(value, schema = false) {
    const hosts = schema ? 'testingcf|cdn' : 'testingcf|cdn|fastly';
    const project = schema ? 'StageDog/tavern_resource' : 'MagicalAstrogy/MagVarUpdate';
    const path = schema ? '/dist/util/mvu_zod.js' : '/artifact/bundle.js';
    return new RegExp('^https://(?:' + hosts + ')\\.jsdelivr\\.net/gh/' + project + '@' + (schema ? '[a-f0-9]{40}' : '(?:beta|[a-f0-9]{40})') + path.replaceAll('.', '\\.') + '$').test(value);
}
function normalizeMvuModule(url) {
    return UNVERSIONED_MVU_MODULE.test(url) ? url.replace('/MagVarUpdate/', '/MagVarUpdate@beta/') : url;
}

export function fallbackModuleUrls(content, schema = false) {
    const text = String(content || '').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\r\n]*/gm, '').trim();
    const importCall = /\bimport\s*\(\s*(['"])(https:\/\/[^'"\s]+)\1\s*\)/g;
    const imports = [...text.matchAll(importCall)].map(match => match[2]);
    if (imports.length !== 2 && (schema || imports.length !== 3)) return null;
    const urls = schema ? imports : imports.map(normalizeMvuModule);
    if (!urls.every(url => approvedModuleUrl(url, schema))) return null;
    if (new Set(imports.map(url => new URL(url).pathname)).size !== 1) return null;
    if (schema) return urls;
    if (new Set(urls).size !== urls.length) return null;
    if (urls.length === 2) {
        if (!/^try\s*\{\s*await import\([\s\S]*\}\s*catch\s*\(\w+\)\s*\{[\s\S]*await import\([^;]+\);?\s*\}\s*$/.test(text)) return null;
    } else {
        const shape = text.replace(importCall, 'IMPORT');
        const nested = /^try\s*\{\s*await\s+IMPORT\s*;?\s*\}\s*catch\s*\(\w+\)\s*\{\s*try\s*\{\s*await\s+IMPORT\s*;?\s*\}\s*catch\s*\(\w+\)\s*\{\s*try\s*\{\s*await\s+IMPORT\s*;?\s*\}\s*catch\s*\((\w+)\)\s*\{\s*(?:console\.error\(\s*(['"])[^'"\r\n]*\2\s*,\s*\1\s*\)\s*;?\s*)?\}\s*\}\s*\}$/;
        if (!nested.test(shape)) return null;
    }
    return urls;
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
            if (url.href !== match[2]) return null;
            const entry = normalizeMvuModule(url.href);
            if (!approvedModuleUrl(entry)) return null;
            urls.push(entry);
        } catch { return null; }
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
        const primary = 'https://testingcf.jsdelivr.net/npm/' + path;
        const fallback = 'https://cdn.jsdelivr.net/npm/' + path;
        let library;
        try {
            library = await importer(primary);
        } catch (primaryError) {
            try {
                library = await importer(fallback);
            } catch (fallbackError) {
                throw Error(`${name} 的两个 CDN 均加载失败。testingcf.jsdelivr.net：${primaryError?.message || primaryError}。cdn.jsdelivr.net：${fallbackError?.message || fallbackError}`, { cause: fallbackError });
            }
        }
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
