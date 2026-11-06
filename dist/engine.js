/* CodeSense mutation engine: lexical & structural analysis for JS, Go, Rust, verified against supplied tests. */
(function(root){
const swaps={'===':'!==','!==':'===','==':'!=','!=':'==','<=':'<','>=':'>','<':'<=','>':'>=','+':'-','-':'+','&&':'||','||':'&&'};
function tokens(code){
 const out=[]; let i=0;
 while(i<code.length){const start=i,c=code[i];
  if(/\s/.test(c)){i++;continue;}
  if(code.slice(i,i+2)==='//'){while(i<code.length&&code[i]!=='\n')i++;continue;}
  if(code.slice(i,i+2)==='/*'){i=code.indexOf('*/',i+2);if(i<0)throw Error('Незакрытый комментарий');i+=2;continue;}
  if(c==='"'||c==="'"||c==='`'){i++;while(i<code.length){if(code[i]==='\\'){i+=2;continue;}if(code[i++]===c)break;}continue;}
  if(/[\w$]/.test(c)){while(i<code.length&&/[\w$]/.test(code[i]))i++;out.push({value:code.slice(start,i),start,end:i});continue;}
  const op=['===','!==','=>','<=','>=','==','!=','++','--','&&','||','+=','-=','**','?.','??',':=','->','..'].find(x=>code.startsWith(x,i))||c;i+=op.length;out.push({value:op,start,end:i});
 } return out;
}
function analyze(files){
 let candidates=[],functions=0,conditions=0,loops=0,functionList=[],conditionList=[],loopList=[];
 for(const [file,code] of Object.entries(files)){
  const ts=tokens(code);
  const lineOf=pos=>code.slice(0,pos).split('\n').length;
  for(let idx=0;idx<ts.length;idx++){
   const t=ts[idx];
   if(t.value==='function'||t.value==='=>'||t.value==='func'||t.value==='fn'){
    functions++;
    const next=ts[idx+1];
    const fnName=(t.value!=='=>'&&next&&/^[a-zA-Z_$][\w$]*$/.test(next.value))?next.value:'anonymous';
    functionList.push({file,name:fnName,line:lineOf(t.start),keyword:t.value});
   }
   if(t.value==='if'||t.value==='switch'||t.value==='match'){
    conditions++;
    conditionList.push({file,line:lineOf(t.start),keyword:t.value});
   }
   if(['for','while','do','loop'].includes(t.value)){
    loops++;
    loopList.push({file,line:lineOf(t.start),keyword:t.value});
   }
   if(swaps[t.value]){
    const line=lineOf(t.start);
    const lineText=(code.split('\n')[line-1]||'').trim();
    if(/^package\b|^import\b|^use\b/.test(lineText))continue;
    candidates.push({
     file,start:t.start,end:t.end,before:t.value,after:swaps[t.value],line,
     kind:['+','-'].includes(t.value)?'Арифметика и возврат значения':['&&','||'].includes(t.value)?'Логическое условие':'Сравнение и границы',
     preview:lineText
    });
   }
  }
 }
 return {files:Object.keys(files).length,functions,conditions,loops,functionList,conditionList,loopList,candidates};
}
function mutate(files,list){
 const result={...files};
 for(const file of Object.keys(files)){
  for(const m of list.filter(x=>x.file===file).sort((a,b)=>b.start-a.start)){
   result[file]=result[file].slice(0,m.start)+m.after+result[file].slice(m.end);
  }
 }
 return result;
}
function transpileFile(filename,code){
 if(filename.endsWith('.go')){
  let s=code
   .replace(/^\s*package\s+\w+\s*$/gm,'')
   .replace(/^\s*import\s*\([\s\S]*?\)/gm,'')
   .replace(/^\s*import\s+"[^"]*"\s*$/gm,'')
   .replace(/\bfunc\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:[A-Za-z0-9_\[\]\*]+|\([^)]*\))?\s*\{/g,(_,name,params)=>{
    const cleanParams=params.split(',').map(p=>p.trim().split(/\s+/)[0]).filter(Boolean).join(', ');
    return 'function '+name+'('+cleanParams+') {';
   })
   .replace(/\bvar\s+([A-Za-z_]\w*)\s+[A-Za-z0-9_\[\]]+\s*=/g,'let $1 =')
   .replace(/\bfor\s+([A-Za-z_]\w*)\s*:=\s*([^;]+);([^;]+);([^{]+)\{/g,'for (let $1 = $2; $3; $4) {')
   .replace(/\b([A-Za-z_]\w*)\s*:=/g,'let $1 =')
   .replace(/\belse\s+if\s+([^{]+)\{/g,'else if ($1) {')
   .replace(/\bif\s+([^{]+)\{/g,'if ($1) {')
   .replace(/\bfor\s+([^{;]+)\{/g,'while ($1) {')
   .replace(/\[\](?:int|float64|string|bool)\s*\{([^}]*)\}/g,'[$1]');
  return 'const len = x => x ? x.length : 0;\n' + s;
 }
 if(filename.endsWith('.rs')){
  let s=code
   .replace(/\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*[A-Za-z0-9_\[\]&<>]+)?\s*\{/g,(_,name,params)=>{
    const cleanParams=params.split(',').map(p=>p.trim().split(':')[0].replace(/\bmut\s+/,'').trim()).filter(Boolean).join(', ');
    return 'function '+name+'('+cleanParams+') {';
   })
   .replace(/\blet\s+mut\s+([A-Za-z_]\w*)(?:\s*:[^=]+)?\s*=/g,'let $1 =')
   .replace(/\blet\s+([A-Za-z_]\w*)(?:\s*:[^=]+)?\s*=/g,'const $1 =')
   .replace(/\bfor\s+([A-Za-z_]\w*)\s+in\s+([^\.\s]+)\.\.([^{\s]+)\s*\{/g,'for (let $1 = $2; $1 < $3; $1++) {')
   .replace(/\belse\s+if\s+([^{]+)\{/g,'else if ($1) {')
   .replace(/\bif\s+([^{]+)\{/g,'if ($1) {')
   .replace(/\bwhile\s+([^{]+)\{/g,'while ($1) {')
   .replace(/\s+as\s+(?:f64|i32|i64|usize|f32)\b/g,'');
  return s;
 }
 return code;
}
function transpileAll(files){
 return Object.keys(files).sort().map(k=>transpileFile(k,files[k])).join('\n;\n');
}
const api={tokens,analyze,mutate,transpileFile,transpileAll};
if(typeof module!=='undefined')module.exports=api;else root.MutationEngine=api;
})(globalThis);
