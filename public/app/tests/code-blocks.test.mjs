import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguage, codeTokens, previewDocument } from '../code-blocks.js';
test('language aliases and highlighting preserve source text exactly', () => {
    assert.equal(codeLanguage('language-js'), 'javascript');
    for (const [language, source] of [['javascript', 'const x = "<img onerror=alert(1)>";\n// test\nreturn 42;'], ['html', '<style>.x { color:red }</style>\n<div>卡片</div>'], ['python', '# note\nprint("你好")']]) {
        const tokens = codeTokens(source, language);
        assert.equal(tokens.map(token => token.text).join(''), source);
        assert.ok(tokens.some(token => token.kind));
    }
});
test('HTML preview keeps CSS and embeds restrictive policy before user markup', () => {
    const source = '<style>body{color:red}</style><div>test</div><script>alert(1)</script>';
    const document = previewDocument(source);
    assert.ok(document.includes(source));
    assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf(source));
    assert.ok(document.includes("default-src 'none'"));
    assert.ok(document.includes("style-src 'unsafe-inline'"));
    assert.ok(document.includes("script-src 'unsafe-inline'"));
    assert.ok(document.includes("connect-src 'none'"));
    assert.ok(document.includes("parent.postMessage"));
    assert.ok(document.includes("new ResizeObserver"));
});


test('interactive HTML preserves native controls, handlers and scripts inside the preview', () => {
    const source = '<details><summary>展开</summary>内容</details><input id="name"><button onclick="document.querySelector(\'#name\').value=\'已点击\'">点击</button><script>document.body.dataset.ready="true"</script>';
    const html = previewDocument(source);
    assert.ok(html.includes(source));
    assert.ok(html.indexOf('tavern-html-height') < html.indexOf(source));
    assert.ok(html.includes("form-action 'none'"));
});
