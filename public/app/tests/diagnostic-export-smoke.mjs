// Local-only browser smoke test. No model, user files or real API credentials.
// node public/app/tests/diagnostic-export-smoke.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
const waiting = new Set();
const page = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>日志下载连接验证</title>
<style>body{font:16px/1.6 system-ui;max-width:700px;margin:32px auto;padding:16px}button{font:inherit;padding:10px;margin:5px}pre{white-space:pre-wrap}</style>
<h1>日志下载连接验证</h1><p>本地模拟请求，不调用模型。</p>
<button id="headers">开始等待响应头</button><button id="stream">开始模拟流式回复</button><button id="export">导出日志</button><button id="release">完成模拟回复</button><pre id="state">尚未开始</pre>
<script type="module">
import {exportDiagnostics} from '/diagnostic-export.js';
let phase='尚未开始',exports=0,hidden=0,complete=0;const output=document.querySelector('#state');
const draw=()=>output.textContent=JSON.stringify({phase,exports,hidden,complete},null,2);
addEventListener('pagehide',()=>{hidden++;draw()});
async function start(path){phase='等待响应头';draw();try{const response=await fetch(path);phase='正在接收';draw();const reader=response.body.getReader();while(!(await reader.read()).done){phase='已收到首段，等待后续';draw()}phase='接收完成';complete++;draw()}catch(error){phase='请求失败：'+error.name;draw()}}
document.querySelector('#headers').onclick=()=>start('/pending');document.querySelector('#stream').onclick=()=>start('/stream');
document.querySelector('#export').onclick=()=>{exports++;exportDiagnostics(JSON.stringify({schema:3,phase}),document.body,()=>phase!=='接收完成');draw()};
document.querySelector('#release').onclick=()=>fetch('/release');
</script></html>`;
const server = http.createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return; }
    if (req.url === '/diagnostic-export.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(new URL('../diagnostic-export.js', import.meta.url))); return; }
    if (req.url === '/pending' || req.url === '/stream') {
        waiting.add(res); res.on('close', () => waiting.delete(res));
        if (req.url === '/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: first\n\n'); }
        return;
    }
    if (req.url === '/release') { for (const item of waiting) { if (!item.headersSent) item.writeHead(200, { 'Content-Type': 'text/event-stream' }); item.end('data: complete\n\n'); } res.end('ok'); return; }
    res.writeHead(404); res.end();
});
server.listen(8126, '127.0.0.1', () => console.log('Browser smoke test: http://127.0.0.1:8126/'));
