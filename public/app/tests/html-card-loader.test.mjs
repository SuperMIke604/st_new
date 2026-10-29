import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteHtmlUrl, fetchRemoteHtml, remoteHtmlDocument } from '../html-card-loader.js';
import { isHtmlPreview, previewDocument } from '../code-blocks.js';

const url = 'https://testingcf.jsdelivr.net/gh/example/cards@v1.0.0/dist/home/index.html';
const loader = value => `<body>\n<script>\n$('body').load('${value}')\n</script>\n</body>`;

test('body-only fenced cards render and only pinned public CDN loaders are accepted', () => {
    assert.equal(isHtmlPreview(loader(url), ''), true);
    assert.equal(isHtmlPreview(loader(url), 'javascript'), false);
    assert.equal(remoteHtmlUrl(loader(url)), url);
    for (const value of [url.replace('@v1.0.0', '@master'), url + '?secret=value', url.replace('testingcf.jsdelivr.net', '127.0.0.1:8000'), url.replace('https:', 'http:'), url.replace('https://', 'https://user:password@'), url.replace('index.html', '%2e%2e/index.html')]) {
        assert.equal(remoteHtmlUrl(loader(value)), null, value);
    }
    assert.equal(remoteHtmlUrl(loader(url) + '<script>other()</script>'), null);
});

test('remote HTML fetch omits credentials and rejects failures, invalid content and oversized responses', async () => {
    let options;
    const source = '<html><body>form</body></html>';
    assert.equal(await fetchRemoteHtml(url, async (_, value) => { options = value; return { ok: true, text: async () => source }; }), source);
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
    await assert.rejects(fetchRemoteHtml('http://127.0.0.1:8000/api/secrets', () => assert.fail('must not fetch')), /固定版本/);
    await assert.rejects(fetchRemoteHtml(url, async () => ({ ok: false, status: 404 })), /HTTP 404/);
    await assert.rejects(fetchRemoteHtml(url, async () => ({ ok: true, text: async () => 'not a page' })), /内容无效/);
    await assert.rejects(fetchRemoteHtml(url, async () => ({ ok: true, headers: { get: () => '2000001' } })), /2MB/);
});

test('remote Vue bundles use the upstream library without opening fetch or same-origin access', () => {
    const source = '<script type="module">const module={};module.exports=Vue;</script><style>.card{color:red}</style>';
    const result = remoteHtmlDocument(source);
    assert.ok(result.includes('const Vue = __cardVue;'));
    assert.ok(result.includes('module.exports=Vue;'));
    assert.equal(remoteHtmlDocument('<script>ordinary()</script>'), '<script>ordinary()</script>');
    assert.ok(remoteHtmlDocument('<script type="module">function themeHost(){return window.top||window}</script>').includes('return window}'));
    const html = previewDocument(result, {}, true);
    assert.ok(html.includes("connect-src 'none'"));
    assert.ok(html.includes("form-action 'none'"));
    assert.ok(!html.includes('allow-same-origin'));
    assert.ok(!previewDocument(source).includes("script-src 'unsafe-inline' https:"));
});
