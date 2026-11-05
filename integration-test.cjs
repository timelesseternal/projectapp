const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{Worker:Thread}=require('node:worker_threads'),{resolveObjectURL}=require('node:buffer'),{webcrypto}=require('node:crypto');
class BrowserWorker {
 constructor(url){this.ready=resolveObjectURL(url).text().then(code=>{this.thread=new Thread("const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=x=>parentPort.postMessage(x);parentPort.on('message',data=>self.onmessage({data}));"+code,{eval:true});this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));});}
 postMessage(x){this.ready.then(()=>this.thread.postMessage(x));}
 terminate(){this.ready.then(()=>this.thread.terminate());}
}
function element(){return {value:'',textContent:'',innerHTML:'',style:{},disabled:false,classList:{toggle(){}},querySelectorAll(){return[];},focus(){},click(){}};}
const els=new Map(),get=s=>{if(!els.has(s))els.set(s,element());return els.get(s);};
const doc={querySelector:get,querySelectorAll:()=>[],createElement:element};
const ctx={document:doc,location:{search:'',pathname:'/'},URLSearchParams,URL,Blob,Worker:BrowserWorker,structuredClone,crypto:webcrypto,BroadcastChannel:class{postMessage(){}},setTimeout,clearTimeout,setInterval:()=>0,console,window:{open(){}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/dist/engine.js','utf8'),ctx);vm.runInContext(fs.readFileSync(__dirname+'/dist/app.js','utf8'),ctx);
async function main(){
 await get('#prepare').onclick();assert.equal(vm.runInContext('state.mutations.length',ctx),3);assert.equal(get('#start').disabled,false);
 get('#start').onclick();assert(vm.runInContext('state.active',ctx));assert.equal(get('#editor').disabled,false);
 await get('#run').onclick();assert(vm.runInContext('state.results.some(x=>!x.pass)',ctx));
 get('#editor').value=vm.runInContext('demoCode',ctx);get('#editor').oninput();get('#explanation').value='Исправлены граничное условие, скидка и сумма';get('#record').onclick();
 await get('#run').onclick();assert(vm.runInContext('state.results.every(x=>x.pass)',ctx));await get('#finish').onclick();
 assert(vm.runInContext('state.finished && !state.active',ctx));assert(get('#report-content').innerHTML.includes('6/6'));assert(get('#report-content').innerHTML.includes('3/3'));assert.equal(get('#editor').disabled,true);assert.equal(vm.runInContext('state.notes.length',ctx),1);
 const timeout=await vm.runInContext("execute({'loop.js':'while(true){}'},[{name:'loop',expression:'true',expected:true}])",ctx);assert(timeout.error.includes('2 секунды'));
 await vm.runInContext("upload([{name:'bad.js',size:1,text:async()=>''}])",ctx);assert(get('#toast').textContent.includes('tests.json'));
 console.log('PASS: prepare, baseline Worker, three mutants, start, failing tests, editor repair, observation, passing tests, finish, report 6/6 and 3/3, editor lock, worker timeout, upload validation.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
