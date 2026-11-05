/* Tüsinu mutation engine: lexical analysis, verified against supplied tests. */
(function(root){
const swaps={'===':'!==','!==':'===','==':'!=','!=':'==','<=':'<','>=':'>','<':'<=','>':'>=','+':'-','-':'+','&&':'||','||':'&&'};
function tokens(code){
 const out=[]; let i=0;
 while(i<code.length){const start=i,c=code[i];
  if(/\s/.test(c)){i++;continue;}
  if(code.slice(i,i+2)==='//'){while(i<code.length&&code[i]!='\n')i++;continue;}
  if(code.slice(i,i+2)==='/*'){i=code.indexOf('*/',i+2);if(i<0)throw Error('Незакрытый комментарий');i+=2;continue;}
  if(c==='"'||c==="'"||c==='`'){i++;while(i<code.length){if(code[i]==='\\'){i+=2;continue;}if(code[i++]===c)break;}continue;}
  if(/[\w$]/.test(c)){while(i<code.length&&/[\w$]/.test(code[i]))i++;out.push({value:code.slice(start,i),start,end:i});continue;}
  const op=['===','!==','=>','<=','>=','==','!=','++','--','&&','||','+=','-=','**','?.','??'].find(x=>code.startsWith(x,i))||c;i+=op.length;out.push({value:op,start,end:i});
 } return out;
}
function analyze(files){let candidates=[],functions=0,conditions=0,loops=0;
 for(const [file,code] of Object.entries(files)){const ts=tokens(code);functions+=ts.filter(t=>t.value==='function'||t.value==='=>').length;conditions+=ts.filter(t=>t.value==='if').length;loops+=ts.filter(t=>['for','while','do'].includes(t.value)).length;
  for(const t of ts)if(swaps[t.value])candidates.push({file,start:t.start,end:t.end,before:t.value,after:swaps[t.value],line:code.slice(0,t.start).split('\n').length,kind:['+','-'].includes(t.value)?'Арифметика':['&&','||'].includes(t.value)?'Логическое условие':'Сравнение и границы'});
 }return {files:Object.keys(files).length,functions,conditions,loops,candidates};}
function mutate(files,list){const result={...files};for(const file of Object.keys(files)){for(const m of list.filter(x=>x.file===file).sort((a,b)=>b.start-a.start))result[file]=result[file].slice(0,m.start)+m.after+result[file].slice(m.end);}return result;}
const api={tokens,analyze,mutate};if(typeof module!=='undefined')module.exports=api;else root.MutationEngine=api;
})(globalThis);
