import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguage, codeTokens, previewDocument, isHtmlPreview, decorateCodeBlocks } from '../code-blocks.js';

test('complete imported HTML documents render even when their fences say text or test', () => {
    const document = '<!DOCTYPE html>\n<html lang="zh-CN"><head><style>.card{color:red}</style></head><body><div class="card">Status</div></body></html>\n';
    for (const language of ['text', 'test', 'plaintext', 'html', 'language-html', '']) assert.equal(isHtmlPreview(document, language), true);
    assert.equal(isHtmlPreview('<div>an example</div>', 'text'), false);
    assert.equal(isHtmlPreview('const page = `<html><body>test</body></html>`;', 'javascript'), false);
    assert.equal(isHtmlPreview('print("example")', 'python'), false);
});

test('a text-labelled HTML card becomes an isolated frame with its actual message floor', () => {
    const originalDocument = globalThis.document, originalWindow = globalThis.window;
    let frame;
    const source = '<html><head><style>body{color:red}</style></head><body>Status</body></html>';
    const code = { textContent: source, classList: ['language-text'], parentElement: { replaceWith(value) { frame = value; } } };
    globalThis.document = { createElement(tag) { assert.equal(tag, 'iframe'); return { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener() {} }; } };
    globalThis.window = { addEventListener() {} };
    try {
        decorateCodeBlocks({ querySelectorAll: () => [code] }, { messageId: 10 });
        assert.equal(frame.name, 'TH-message--10--preview');
        assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms');
        assert.ok(frame.srcdoc.includes(source));
        assert.equal(frame.referrerPolicy, 'no-referrer');
    } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});
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


test('sample card send bridge compiles and preserves multiline form content', () => {
    const html=previewDocument('');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(()=>new Function(script));
    assert.ok(script.includes('triggerSlash'));
    assert.ok(html.includes('https://fonts.googleapis.com'));
});
