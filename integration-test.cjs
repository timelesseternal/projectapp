const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{Worker:Thread}=require('node:worker_threads'),{resolveObjectURL}=require('node:buffer'),{webcrypto}=require('node:crypto');
const E=require('./dist/engine.js');
const {DB,PROJECT_TEMPLATES}=require('./server.cjs');

class BrowserWorker {
 constructor(url){this.ready=resolveObjectURL(url).text().then(code=>{this.thread=new Thread("const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=x=>parentPort.postMessage(x);parentPort.on('message',data=>self.onmessage({data}));"+code,{eval:true});this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));});}
 postMessage(x){this.ready.then(()=>this.thread.postMessage(x));}
 terminate(){this.ready.then(()=>this.thread.terminate());}
}
function element(){return {value:'',textContent:'',innerHTML:'',style:{},disabled:false,dataset:{},classList:{toggle(){},add(){},remove(){}},querySelectorAll(){return[];},addEventListener(){},focus(){},click(){}};}
const els=new Map(),get=s=>{if(!els.has(s))els.set(s,element());return els.get(s);};
const doc={querySelector:get,querySelectorAll:()=>[],createElement:element,addEventListener(){}};
const ctx={document:doc,location:{search:'',pathname:'/'},URLSearchParams,URL,Blob,Worker:BrowserWorker,structuredClone,crypto:webcrypto,MutationEngine:E,BroadcastChannel:class{postMessage(){}},setTimeout,clearTimeout,setInterval:()=>0,console,window:{open(){}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/dist/engine.js','utf8'),ctx);vm.runInContext(fs.readFileSync(__dirname+'/dist/app.js','utf8'),ctx);

async function main(){
 // 1. Original JS UI & Worker lifecycle
 await get('#prepare').onclick();assert.equal(vm.runInContext('state.mutations.length',ctx),3);assert.equal(get('#start').disabled,false);
 get('#start').onclick();assert(vm.runInContext('state.active',ctx));assert.equal(get('#editor').disabled,false);
 await get('#run').onclick();assert(vm.runInContext('state.results.some(x=>!x.pass)',ctx));
 get('#editor').value=vm.runInContext('demoCode',ctx);get('#editor').oninput();get('#explanation').value='Исправлены граничное условие, скидка и сумма';get('#record').onclick();
 await get('#run').onclick();assert(vm.runInContext('state.results.every(x=>x.pass)',ctx));await get('#finish').onclick();
 assert(vm.runInContext('state.finished && !state.active',ctx));assert(get('#report-content').innerHTML.includes('6/6'));assert(get('#report-content').innerHTML.includes('3/3'));assert.equal(get('#editor').disabled,true);assert.equal(vm.runInContext('state.notes.length',ctx),1);
 const timeout=await vm.runInContext("execute({'loop.js':'while(true){}'},[{name:'loop',expression:'true',expected:true}])",ctx);assert(timeout.error.includes('2 секунды'));
 await vm.runInContext("upload([{name:'bad.js',size:1,text:async()=>''}])",ctx);assert(get('#toast').textContent.includes('tests.json'));

 // 2. Go & Rust multi-language analysis, transpilation & 3 mutations verification
 for(const tplKey of ['go-order','rust-rating']){
  const tpl=PROJECT_TEMPLATES[tplKey];
  const baseRes=await vm.runInContext(`execute(${JSON.stringify(tpl.files)},${JSON.stringify(tpl.tests)})`,ctx);
  assert(!baseRes.error && baseRes.results.every(t=>t.pass), `Baseline failed for ${tplKey}`);
  const analysis=E.analyze(tpl.files);
  assert.equal(analysis.functions,4,`Expected 4 functions in ${tplKey}`);
  const selected=[];
  for(const m of analysis.candidates){
   if(selected.some(x=>x.line===m.line))continue;
   const r=await vm.runInContext(`execute(${JSON.stringify(E.mutate(tpl.files,[m]))},${JSON.stringify(tpl.tests)})`,ctx);
   if(!r.error && r.results.some(x=>!x.pass))selected.push(m);
   if(selected.length===3)break;
  }
  assert.equal(selected.length,3,`Expected 3 verified mutations for ${tplKey}`);
 }

 // 3. SQLite Database & Auth verification
 const users=DB.getUsers();
 assert(users.some(u=>u.role==='student'), 'DB should have student');
 assert(users.some(u=>u.role==='auditor'), 'DB should have auditor');
 assert(users.some(u=>u.role==='teacher'), 'DB should have teacher');
 const teacher=DB.findUserByLogin('teacher');
 assert.equal(teacher.role,'teacher');
 const token=DB.createSession(teacher.id);
 assert.equal(DB.getUserByToken(token).username,'teacher');
 DB.deleteSession(token);
 assert.equal(DB.getUserByToken(token),null);
 const audits=DB.listAudits();
 assert(audits.length>=1,'DB should have seeded audit');

 console.log('PASS: prepare, baseline Worker, three mutants, start, failing tests, editor repair, observation, passing tests, finish, report 6/6 and 3/3, editor lock, worker timeout, upload validation, Go & Rust 3-mutation verification, SQLite DB & Auth.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
