const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('./dist/engine.js');
const src=fs.readFileSync(__dirname+'/dist/app.js','utf8'),ctx={structuredClone};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('const demoCode='),src.indexOf('let files='))+';this.code=demoCode;this.tests=demoTests;',ctx);
const files={'order.js':ctx.code},tests=ctx.tests;
function run(f){return tests.map(t=>JSON.stringify(vm.runInNewContext(Object.values(f).join('\n')+'\n'+t.expression,{}, {timeout:200}))===JSON.stringify(t.expected));}
assert(run(files).every(Boolean));
const a=E.analyze(files),selected=[];
for(const m of a.candidates){if(selected.some(x=>x.line===m.line))continue;if(run(E.mutate(files,[m])).some(x=>!x))selected.push(m);if(selected.length===3)break;}
assert.equal(selected.length,3);assert(run(E.mutate(files,selected)).some(x=>!x));assert.equal(a.functions,4);
assert.equal(E.analyze({'a.js':'// x > y\nconst s = "a < b"; /* x + y */'}).candidates.length,0);
const changed=E.mutate(files,selected);assert.notEqual(changed['order.js'],files['order.js']);assert.equal(files['order.js'],ctx.code);
fs.mkdirSync(__dirname+'/example',{recursive:true});fs.writeFileSync(__dirname+'/example/order.js',ctx.code);fs.writeFileSync(__dirname+'/example/tests.json',JSON.stringify(tests,null,2));
console.log('PASS: baseline, exactly three killed mutations, combined mutation, function analysis, comments and strings, immutable source.');
console.log(selected.map(m=>({line:m.line,before:m.before,after:m.after})));
