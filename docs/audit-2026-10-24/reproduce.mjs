// Read-only audit probes: mocked APIs; no real model, user data or remote requests.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { applyRegex } from '../../public/app/regex.js';
import { parseUpdate, defaultDatabase } from '../../public/app/database.js';
import { init } from '../../server/st-new-updater/index.mjs';
import { createHash } from 'node:crypto';
const main = await fs.readFile(new URL('../../public/app/main.js', import.meta.url), 'utf8');
function extract(start, end) { return main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start))); }
const state = { character: { avatar: 'A.png' }, file: 'A-chat', header: {}, chat: [{mes:'A private chat'}], own: {}, saves: Promise.resolve() };
let saved;
const context = vm.createContext({ state, api: { post: async path => path.endsWith('/get') ? { avatar:'B.png' } : [], saveChat: async (...args) => { saved = args; } },
  assertSaved(){}, synchronize(){}, status(){}, loadChat: async () => { throw Error('mock chat read failure'); }, saveOwn(){}, copy: structuredClone });
vm.runInContext(extract('async function openCharacter(', 'async function loadChat(') + extract('function saveChat()', 'async function chatsPanel('), context);
await vm.runInContext("openCharacter('B.png').catch(()=>{})", context);
await vm.runInContext('saveChat()', context);
assert.equal(saved[0], 'B.png'); assert.equal(saved[1], 'A-chat');
console.log('F1: failed B chat load leaves save target B.png / A-chat with A chat contents');
const ranges=[];
const autoState={own:{database:{auto:true}},chat:[{is_user:false},{is_user:true},{is_user:false}]};
const auto = vm.createContext({state:autoState,panelDirty:false,currentDatabase:()=>({settings:{updateBatchSize:1,autoUpdateFrequency:0}}),updateDatabase:async(a,b)=>ranges.push([a,b]),notify(){}});
vm.runInContext(extract('async function autoUpdateDatabase()', 'const tokenCounts'),auto);
await vm.runInContext('autoUpdateDatabase()',auto);
// The first actual update attaches only to AI index 0, because index 1 is a user.
autoState.chat[0].TavernDB_ACU_Data={};
autoState.chat.push({is_user:true},{is_user:false});
await vm.runInContext('autoUpdateDatabase()',auto);
assert.deepEqual(ranges,[[0,1],[0,1]]);
console.log('F2: default automatic database ranges repeat:',JSON.stringify(ranges));
const routes=new Map(); await init({post:(name,handler)=>routes.set(name,handler)});
const originalFetch=globalThis.fetch; let fetched=false;
try {
 globalThis.fetch=async()=>{fetched=true;throw Error('audit sentinel: stop before network or filesystem mutation');};
 const res={status(code){this.code=code;return this;},json(value){this.value=value;}};
 await routes.get('/install')({user:{profile:{admin:false}},body:{revision:'a'.repeat(64)}},res);
 assert.equal(fetched,true);assert.equal(res.code,500);
 console.log('F3: non-admin install reaches remote-download phase instead of returning 403');
} finally { globalThis.fetch=originalFetch; }
const output=applyRegex('secret',[{findRegex:'/secret/g',replaceString:'$1',placement:[2]}],2);
assert.equal(output,'0');
console.log('F4: nonexistent capture $1 becomes match offset:',JSON.stringify(output));
assert.throws(()=>parseUpdate('<dataUpdate>{"operations":[]}</dataUpdate>',defaultDatabase()));
console.log('F5: documented no-change operations=[] is rejected');
const manifest=JSON.parse(await fs.readFile(new URL('../../version.json',import.meta.url),'utf8'));
for(const [name,hash] of Object.entries(manifest.files)){
 const content=await fs.readFile(new URL('../../'+name,import.meta.url));
 assert.equal(createHash('sha256').update(content.toString().replaceAll('\r\n','\n')).digest('hex'),hash,name);
}
console.log('Manifest hashes verified:',Object.keys(manifest.files).length);
