const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demoCode="function subtotal(price, quantity) {\n  return price * quantity;\n}\n\nfunction delivery(total) {\n  if (total >= 10000) return 0;\n  return 1000;\n}\n\nfunction discount(total, isMember) {\n  if (isMember && total > 5000) return total * 0.9;\n  return total;\n}\n\nfunction orderTotal(price, quantity, isMember) {\n  const total = subtotal(price, quantity);\n  return discount(total, isMember) + delivery(total);\n}\n";
const demoTests=[{name:'Обычный заказ',expression:'orderTotal(1000,2,false)',expected:3000},{name:'Бесплатная доставка на границе',expression:'delivery(10000)',expected:0},{name:'Доставка ниже порога',expression:'delivery(9999)',expected:1000},{name:'Скидка участнику',expression:'discount(6000,true)',expected:5400},{name:'Без скидки для гостя',expression:'discount(6000,false)',expected:6000},{name:'Итог с бесплатной доставкой',expression:'orderTotal(6000,2,false)',expected:12000}];
let files={'order.js':demoCode},tests=structuredClone(demoTests),state=null,current='order.js',busy=false;

const goDemoCode=`package main

func subtotal(price int, quantity int) int {
  return price * quantity
}

func delivery(total int) int {
  if total >= 10000 {
    return 0
  }
  return 1000
}

func discount(total int, isMember bool) int {
  if isMember && total > 5000 {
    return total * 0.9
  }
  return total
}

func orderTotal(price int, quantity int, isMember bool) int {
  total := subtotal(price, quantity)
  return discount(total, isMember) + delivery(total)
}
`;

const rustDemoCode=`pub fn base_points(tasks: i32, weight: i32) -> i32 {
  return tasks * weight;
}

pub fn streak_bonus(days: i32) -> i32 {
  if days >= 7 {
    return 50;
  }
  return 0;
}

pub fn peer_multiplier(score: i32, verified: bool) -> i32 {
  if verified && score > 100 {
    return score + 25;
  }
  return score;
}

pub fn final_rating(tasks: i32, weight: i32, days: i32, verified: bool) -> i32 {
  let raw: i32 = base_points(tasks, weight);
  return peer_multiplier(raw, verified) + streak_bonus(days);
}
`;
const rustDemoTests=[
  {name:'Базовый рейтинг без бонусов',expression:'final_rating(5, 10, 3, false)',expected:50},
  {name:'Бонус за серию ровно 7 дней',expression:'streak_bonus(7)',expected:50},
  {name:'Без бонуса за 6 дней',expression:'streak_bonus(6)',expected:0},
  {name:'Надбавка за верифицированный P2P > 100',expression:'peer_multiplier(120, true)',expected:145},
  {name:'Без надбавки без верификации',expression:'peer_multiplier(120, false)',expected:120},
  {name:'Итоговый рейтинг со всеми бонусами',expression:'final_rating(6, 20, 7, true)',expected:195}
];

let projectMeta={title:'JavaScript: Расчёт заказа',language:'javascript',repoUrl:''};
let currentUser={username:'student',name:'Алихан Садыков',role:'student',cohort:'Go & JS Core · Wave 4'};
let authToken='';
let sseStream=null;

const isAuditor=new URLSearchParams(location.search).has('auditor'),channel=new BroadcastChannel('codesense-audit-v1');

function toast(msg){$('#toast').textContent=msg;$('#toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').style.display='none',6500);}

async function apiFetch(url,options={}){
  if(typeof fetch!=='function')return null;
  try{
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(authToken)headers['Authorization']='Bearer '+authToken;
    const res=await fetch(url,{...options,headers});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||'Ошибка запроса');
    return data;
  }catch(err){
    if(options.throwOnError)throw err;
    return null;
  }
}

function view(id){
  if(isAuditor)id='auditor';
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('hidden',v.id!==id));
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  const titles={setup:'Новый аудит',workspace:'Рабочая область (Защита)',report:'Результат защиты',auditor:'Экран P2P-аудитора',database:'База: Учителя и Студенты'};
  $('#breadcrumb').innerHTML='Рабочее пространство <span>/ '+(titles[id]||'Аудит')+'</span>';
  if(id==='auditor')drawAuditor();
  if(id==='database')loadDatabaseDashboard();
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>view(b.dataset.view));

function codeOf(f){
  return Object.keys(f).sort().map(k=>f[k]).join('\n;\n');
}
function executableOf(f){
  if(typeof MutationEngine!=='undefined'&&typeof MutationEngine.transpileAll==='function'){
    return MutationEngine.transpileAll(f);
  }
  return codeOf(f);
}
function detectLang(f){
  const names=Object.keys(f);
  if(names.some(n=>n.endsWith('.go')))return 'go';
  if(names.some(n=>n.endsWith('.rs')))return 'rust';
  return 'javascript';
}

function execute(f,t){
  return new Promise(resolve=>{
    const source="self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;self.onmessage=async e=>{try{const {code,tests}=e.data;const fn=new Function(code+'\\nreturn ['+tests.map(t=>'('+t.expression+')').join(',')+'];');const values=await Promise.all(fn());self.postMessage({results:values.map((v,i)=>({name:tests[i].name,pass:JSON.stringify(v)===JSON.stringify(tests[i].expected),actual:v,expected:tests[i].expected}))});}catch(err){self.postMessage({error:err.message});}};";
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url);
    let done=false;
    const finish=x=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);resolve(x);};
    const timer=setTimeout(()=>finish({error:'Превышено время выполнения (2 секунды)'}),2000);
    worker.onmessage=e=>finish(e.data);
    worker.onerror=e=>{e.preventDefault();finish({error:e.message||'Ошибка выполнения'});};
    worker.postMessage({code:executableOf(f),tests:t});
  });
}

function validateTests(t){
  if(!Array.isArray(t)||!t.length||t.length>100)throw Error('Нужно от 1 до 100 тестов');
  for(const x of t)if(typeof x.name!=='string'||typeof x.expression!=='string'||!('expected'in x))throw Error('У теста нужны name, expression и expected');
}

async function upload(list){
  if(state?.active||busy)return toast('Дождитесь завершения текущей операции');
  try{
    if(!list.length)return;
    let next={},newTests=null,total=0;
    for(const f of list){
      total+=f.size;
      if(total>1e6)throw Error('Общий размер больше 1 МБ');
      if(f.name==='tests.json'){
        newTests=JSON.parse(await f.text());
        validateTests(newTests);
      }else if(/\.(js|go|rs)$/.test(f.name)){
        if(next[f.name])throw Error('Одинаковые имена файлов');
        next[f.name]=await f.text();
      }else throw Error('Поддерживаются файлы .js, .go, .rs и tests.json');
    }
    if(!Object.keys(next).length||!newTests)throw Error('Загрузите исходные файлы (.js/.go/.rs) и tests.json вместе');
    files=next;tests=newTests;state=null;
    const lang=detectLang(files);
    projectMeta={title:'Загруженный проект ('+Object.keys(files).join(', ')+')',language:lang,repoUrl:''};
    $('#files-status').textContent='Загружено: '+Object.keys(files).length+' файлов ('+lang.toUpperCase()+') · '+tests.length+' тестов';
    toast('Проект успешно загружен');
  }catch(e){toast(e.message);}
}

$('#upload').onchange=e=>upload([...e.target.files]);
$('#drop').ondragover=e=>e.preventDefault();
$('#drop').ondrop=e=>{e.preventDefault();upload([...e.dataTransfer.files]);};

function selectTemplate(tplId){
  if(state?.active||busy)return toast('Сначала завершите текущую операцию');
  document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active-chip',c.dataset.template===tplId));
  if(tplId==='go-order'){
    files={'order.go':goDemoCode};
    tests=structuredClone(demoTests);
    projectMeta={title:'Go: Расчёт заказа и доставки',language:'go',repoUrl:'https://github.com/tomorrow-school/go-order-engine'};
    $('#files-status').textContent='Go-проект: order.go · 6 тестов (Tomorrow School Go Piscine)';
    toast('Загружен проект на Go (order.go)');
  }else if(tplId==='rust-rating'){
    files={'scorer.rs':rustDemoCode};
    tests=structuredClone(rustDemoTests);
    projectMeta={title:'Rust: Система рейтинга P2P-пула',language:'rust',repoUrl:'https://github.com/tomorrow-school/rust-p2p-scorer'};
    $('#files-status').textContent='Rust-проект: scorer.rs · 6 тестов (Tomorrow School Rust Track)';
    toast('Загружен проект на Rust (scorer.rs)');
  }else{
    files={'order.js':demoCode};
    tests=structuredClone(demoTests);
    projectMeta={title:'JavaScript: Расчёт заказа',language:'javascript',repoUrl:'https://github.com/timelesseternal/projectapp'};
    $('#files-status').textContent='Демо-проект: расчёт заказа · 6 тестов';
    toast('Демонстрационный проект восстановлен');
  }
  state=null;
}

$('#demo').onclick=()=>selectTemplate('js-order');
document.querySelectorAll('.chip[data-template]').forEach(btn=>{
  if(btn.id!=='demo')btn.onclick=()=>selectTemplate(btn.dataset.template);
});

const ghBtn=$('#github-import-btn');
if(ghBtn){
  ghBtn.onclick=async()=>{
    if(state?.active||busy)return toast('Сначала завершите текущую защиту');
    const url=($('#github-url')?.value||'').trim();
    if(!url)return toast('Введите ссылку на GitHub-репозиторий');
    ghBtn.disabled=true;
    ghBtn.textContent='Импорт…';
    try{
      const data=await apiFetch('/api/github/import',{method:'POST',body:JSON.stringify({repoUrl:url}),throwOnError:true});
      if(data&&data.files&&data.tests){
        files=data.files;
        tests=data.tests;
        projectMeta={title:data.title||url,language:data.language||detectLang(files),repoUrl:data.repoUrl||url};
        state=null;
        $('#files-status').textContent=`Импортировано из GitHub (${projectMeta.language.toUpperCase()}): ${Object.keys(files).join(', ')} · ${tests.length} тестов`;
        toast('Репозиторий успешно импортирован: '+projectMeta.title);
      }
    }catch(e){
      toast(e.message||'Не удалось импортировать репозиторий');
    }finally{
      ghBtn.disabled=false;
      ghBtn.textContent='Импортировать GitHub';
    }
  };
}

async function saveStateToServer(){
  if(!state)return;
  const saved=await apiFetch('/api/audits',{
    method:'POST',
    body:JSON.stringify({
      id:state.id,
      room_code:state.roomCode,
      title:state.title||projectMeta.title,
      language:state.language||projectMeta.language,
      repo_url:state.repoUrl||projectMeta.repoUrl,
      student_name:state.studentName,
      auditor_name:state.auditorName,
      verdict:state.verdict,
      teacher_comment:state.teacherComment,
      state
    })
  });
  if(saved?.audit?.room_code&&!state.roomCode){
    state.roomCode=saved.audit.room_code;
  }
}

function connectSse(roomOrId){
  if(typeof EventSource==='undefined'||!roomOrId)return;
  if(sseStream)sseStream.close();
  try{
    sseStream=new EventSource('/api/audits/'+encodeURIComponent(roomOrId)+'/stream');
    sseStream.onmessage=ev=>{
      try{
        const msg=JSON.parse(ev.data);
        if(msg.type==='audit_update'&&msg.audit?.state){
          if(isAuditor||currentUser.role!=='student'||!state?.active){
            state=msg.audit.state;
            drawAuditor();
            if(state.finished)renderReport();
          }
        }
      }catch{}
    };
  }catch{}
}

function sync(){
  if(!isAuditor&&state){
    channel.postMessage({type:'state',state});
    saveStateToServer();
  }
}

function addLog(text){
  state.log.push({time:new Date().toLocaleTimeString('ru-RU'),text});
  sync();
}

function saveEditor(){if(state&&current)state.edited[current]=$('#editor').value;}

function renderFiles(){
  const keys=Object.keys(state.edited);
  if(!keys.includes(current))current=keys[0];
  $('#file-list').innerHTML=keys.map(k=>'<button data-file="'+esc(k)+'" class="'+(k===current?'selected':'')+'">⌘ '+esc(k)+'</button>').join('');
  $('#filename').textContent=current;
  $('#editor').value=state.edited[current];
  $('#file-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{saveEditor();current=b.dataset.file;renderFiles();});
  const a=state.analysis;
  $('#analysis').innerHTML=a.files+' файлов<br>'+a.functions+' функций<br>'+a.conditions+' условий<br>'+a.loops+' циклов';
  const structEl=$('#structure-details');
  if(structEl){
    const fnNames=(a.functionList||[]).map(f=>`<code>${esc(f.name)}</code> (стр. ${f.line})`).join('<br>');
    structEl.innerHTML=(fnNames?'<b>Функции:</b><br>'+fnNames+'<br>':'')+`<b>Точек логики:</b> ${(a.candidates||[]).length}`;
  }
  const langBadge=$('#editor-lang-badge');
  if(langBadge){
    const langName=({go:'Go (Golang)',rust:'Rust',javascript:'JavaScript'})[state.language||'javascript']||'JavaScript';
    langBadge.textContent=langName+' · 3 активные мутации';
  }
  const roomBadge=$('#room-code-badge');
  if(roomBadge&&state.roomCode)roomBadge.textContent='КОМНАТА: '+state.roomCode;
  const partEl=$('#session-participants');
  if(partEl&&state.studentName){
    partEl.textContent=`Студент: ${state.studentName} · Аудитор: ${state.auditorName}`;
  }
}

function updateAntiLlmBadge(){
  const el=$('#anti-llm-status');
  if(!el||!state?.antiCheat)return;
  const {tabSwitches,largePastes}=state.antiCheat;
  if(tabSwitches===0&&largePastes===0){
    el.textContent='🛡 Anti-LLM: Чисто (0 переключений)';
    el.classList.remove('warn');
  }else{
    el.textContent=`⚠ Anti-LLM: вкладок ${tabSwitches}, вставок ${largePastes}`;
    el.classList.add('warn');
  }
}

$('#prepare').onclick=async()=>{
  if(busy)return;
  if(state?.active)return toast('Сначала завершите текущую защиту');
  busy=true;$('#prepare').disabled=true;$('#prepare').textContent='Анализ и проверка…';
  try{
    validateTests(tests);
    const baseline=await execute(files,tests);
    if(baseline.error)throw Error('Исходный проект: '+baseline.error);
    if(baseline.results.some(t=>!t.pass))throw Error('Исходный проект должен проходить все тесты');
    const analysis=MutationEngine.analyze(files),selected=[];
    for(const m of analysis.candidates.slice(0,80)){
      if(selected.some(x=>x.file===m.file&&x.line===m.line))continue;
      const result=await execute(MutationEngine.mutate(files,[m]),tests);
      if(!result.error&&result.results.some(t=>!t.pass)){
        selected.push({...m,testIndexes:result.results.flatMap((t,i)=>t.pass?[]:[i])});
        if(selected.length===3)break;
      }
    }
    if(selected.length!==3)throw Error('Не удалось найти 3 проверяемые мутации на разных строках. Добавьте условия и граничные тесты.');
    const mutated=MutationEngine.mutate(files,selected),check=await execute(mutated,tests);
    if(check.error||check.results.every(x=>x.pass))throw Error('Комбинация мутаций не подходит. Измените набор тестов.');
    const roomCode='TS-'+Math.floor(100+Math.random()*900);
    const studentName=$('#select-student')?.value||currentUser.name||'Алихан Садыков';
    const auditorName=$('#select-auditor')?.value||'Тимур Бектуров';
    state={
      id:crypto.randomUUID(),
      roomCode,
      title:projectMeta.title||'Проект студента',
      language:detectLang(files),
      repoUrl:projectMeta.repoUrl||'',
      studentName,
      auditorName,
      original:structuredClone(files),
      edited:mutated,
      tests:structuredClone(tests),
      mutations:selected,
      analysis,
      active:false,
      finished:false,
      start:null,
      deadline:null,
      results:[],
      notes:[],
      log:[],
      runs:0,
      antiCheat:{tabSwitches:0,largePastes:0,events:[]},
      auditorChecklist:{m0:false,m1:false,m2:false,comment:''},
      verdict:'pending',
      teacherComment:''
    };
    addLog('Аудит подготовлен ('+roomCode+'): 3 проверенные мутации');
    renderFiles();
    updateAntiLlmBadge();
    $('#session-state').textContent='Готово к защите · 3 мутации';
    $('#start').disabled=false;$('#editor').disabled=true;$('#run').disabled=true;$('#finish').disabled=true;
    $('#test-results').textContent='Нажмите «Начать защиту», чтобы запустить 10-минутный таймер и открыть редактор.';
    if($('#student-notes-list'))$('#student-notes-list').innerHTML='';
    if($('#notes-counter'))$('#notes-counter').textContent='Наблюдений записано: 0';
    connectSse(state.id);
    view('workspace');
    toast('Аудит готов (комната '+roomCode+'). Откройте экран аудитора перед стартом.');
  }catch(e){toast(e.message);}finally{busy=false;$('#prepare').disabled=false;$('#prepare').innerHTML='Создать аудит (3 мутации) <span>↗</span>';}
};

$('#start').onclick=()=>{
  if(!state||state.active||state.finished)return;
  state.active=true;state.start=Date.now();state.deadline=state.start+600000;
  $('#editor').disabled=false;$('#explanation').disabled=false;$('#explanation').value='';
  $('#record').disabled=false;$('#start').disabled=true;$('#run').disabled=false;$('#finish').disabled=false;
  $('#session-state').textContent='Защита идёт · 10 минут без LLM-помощников';
  addLog('Началась 10-минутная защита');
  $('#editor').focus();
};

$('#editor').oninput=()=>{if(!state?.active)return;saveEditor();sync();};
$('#editor').onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target;t.setRangeText('  ',t.selectionStart,t.selectionEnd,'end');saveEditor();sync();}};

// Anti-LLM Focus & Paste Monitoring
if(typeof document.addEventListener==='function'){
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state?.active&&!isAuditor){
      state.antiCheat=state.antiCheat||{tabSwitches:0,largePastes:0,events:[]};
      state.antiCheat.tabSwitches++;
      const ev=`Переключение вкладки/окна (#${state.antiCheat.tabSwitches})`;
      state.antiCheat.events.push({time:new Date().toLocaleTimeString('ru-RU'),text:ev});
      updateAntiLlmBadge();
      addLog('⚠ Anti-LLM: '+ev);
    }
  });
}
if($('#editor')&&typeof $('#editor').addEventListener==='function'){
  $('#editor').addEventListener('paste',e=>{
    if(!state?.active)return;
    const pasted=(e.clipboardData?.getData('text')||'');
    if(pasted.length>45){
      state.antiCheat=state.antiCheat||{tabSwitches:0,largePastes:0,events:[]};
      state.antiCheat.largePastes++;
      const ev=`Крупная вставка из буфера (${pasted.length} симв.)`;
      state.antiCheat.events.push({time:new Date().toLocaleTimeString('ru-RU'),text:ev});
      updateAntiLlmBadge();
      addLog('⚠ Anti-LLM: '+ev);
      toast('Внимание: крупная вставка кода зафиксирована в журнале аудитора');
    }
  });
}

function renderTests(result){
  $('#test-results').innerHTML=result.error
    ?'<p class="fail">'+esc(result.error)+'</p>'
    :result.results.map(t=>'<div class="test-row"><span>'+esc(t.name)+'</span><span class="'+(t.pass?'pass':'fail')+'">'+(t.pass?'✓ Пройден':'✕ Ожидалось '+esc(JSON.stringify(t.expected))+', получено '+esc(JSON.stringify(t.actual)))+'</span></div>').join('');
}

$('#run').onclick=async()=>{
  if(!state?.active||busy)return;
  if(Date.now()>=state.deadline)return finish();
  saveEditor();busy=true;$('#run').disabled=true;
  const id=state.id,revision=codeOf(state.edited),r=await execute(state.edited,state.tests);
  if(state?.id===id&&!state.finished){
    state.runs++;
    if(codeOf(state.edited)===revision){
      state.results=r.results||[];state.error=r.error||null;state.checkedCode=revision;
      renderTests(r);
      addLog('Тесты: '+(r.error||r.results.filter(t=>t.pass).length+'/'+state.tests.length));
    }else toast('Код изменился во время проверки. Запустите тесты ещё раз.');
  }
  busy=false;$('#run').disabled=!state?.active;
};

$('#record').onclick=()=>{
  if(!state?.active)return;
  const text=$('#explanation').value.trim();
  if(!text)return toast('Опишите найденную ошибку');
  state.notes.push({text,time:new Date().toLocaleTimeString('ru-RU')});
  $('#explanation').value='';
  if($('#notes-counter'))$('#notes-counter').textContent='Наблюдений записано: '+state.notes.length;
  if($('#student-notes-list')){
    $('#student-notes-list').innerHTML=state.notes.map((n,i)=>`<div><b>#${i+1} (${esc(n.time)}):</b> ${esc(n.text)}</div>`).join('');
  }
  addLog('Студент зафиксировал наблюдение');
  toast('Наблюдение записано');
};

async function finish(){
  if(!state?.active||state.finished)return;
  state.active=false;state.finished=true;state.end=Date.now();
  saveEditor();
  $('#editor').disabled=true;$('#run').disabled=true;$('#finish').disabled=true;$('#record').disabled=true;$('#explanation').disabled=true;
  const result=await execute(state.edited,state.tests);
  state.results=result.results||[];state.error=result.error||null;state.checkedCode=codeOf(state.edited);
  const passed=state.results.filter(t=>t.pass).length;
  const restored=state.mutations.filter(m=>mutationStatus(m)==='Связанные тесты пройдены').length;
  state.verdict=(passed===state.tests.length&&restored===3)?'passed':'needs_work';
  addLog('Защита завершена: тестов '+passed+'/'+state.tests.length+', мутаций '+restored+'/3');
  renderTests(result);renderReport();sync();view('report');
}
$('#finish').onclick=finish;

setInterval(()=>{
  if(isAuditor||!state?.active)return;
  const left=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));
  $('#timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');
  $('#timer').classList.toggle('danger',left<=60);
  if(!left)finish();
},250);

function mutationStatus(m){
  if(state.error||state.checkedCode!==codeOf(state.edited))return 'Проверка не завершена';
  return m.testIndexes.every(i=>state.results[i]?.pass)?'Связанные тесты пройдены':'Связанные тесты не пройдены';
}

function download(name,text){
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function renderReport(){
  if(!state?.finished)return;
  const passed=state.results.filter(t=>t.pass).length;
  const restored=state.mutations.filter(m=>mutationStatus(m)==='Связанные тесты пройдены').length;
  const anti=state.antiCheat||{tabSwitches:0,largePastes:0};
  const verdictLabels={
    passed:'✓ Зачтено: понимание кода подтверждено',
    needs_work:'⚠ Требуется доработка / дополнительный разбор',
    ai_suspected:'✕ Подозрение на внешние подсказки (ИИ)',
    pending:'Ожидает решения аудитора'
  };

  $('#report-content').innerHTML=
    '<div class="stats">'+
      '<div><b>'+passed+'/'+state.tests.length+'</b><span>Тестов пройдено</span></div>'+
      '<div><b>'+restored+'/3</b><span>Мутаций по тестам</span></div>'+
      '<div><b>'+Math.min(600,Math.max(1,Math.round((state.end-state.start)/1000)))+'с</b><span>Время защиты</span></div>'+
      '<div><b>'+(anti.tabSwitches+anti.largePastes)+'</b><span>Событий Anti-LLM</span></div>'+
    '</div>'+
    '<h2>'+(passed===state.tests.length?'Поведение восстановлено по всем тестам':'Есть ошибки для обсуждения')+'</h2>'+
    '<p class="muted">Сессия <b>'+esc(state.roomCode||'LOCAL')+'</b> · Студент: <b>'+esc(state.studentName||'Студент')+'</b> · Аудитор: <b>'+esc(state.auditorName||'Аудитор')+'</b> · Статус в БД: <b>'+esc(verdictLabels[state.verdict||'pending'])+'</b></p>'+
    (state.error?'<p class="fail">'+esc(state.error)+'</p>':'')+
    state.mutations.map((m,i)=>{
      const confirmed=state.auditorChecklist?.['m'+i]?' · ✓ Объяснение подтверждено аудитором':'';
      return '<div class="mutation"><strong>0'+(i+1)+' / '+esc(m.kind)+'</strong><p>'+esc(m.file)+' : строка '+m.line+' &nbsp; <code>'+esc(m.before)+'</code> заменено на <code>'+esc(m.after)+'</code></p><span>'+mutationStatus(m)+confirmed+'</span></div>';
    }).join('')+
    '<h2>Наблюдения студента ('+state.notes.length+')</h2>'+
    (state.notes.map(n=>'<p>• '+esc(n.text)+' <small class="muted">('+esc(n.time)+')</small></p>').join('')||'<p class="muted">Наблюдения не зафиксированы</p>')+
    '<div class="verdict-box">'+
      '<div class="section-number">ОЦЕНКА АУДИТОРА И ПРЕПОДАВАТЕЛЯ (СОХРАНЯЕТСЯ В БАЗУ ДАННЫХ)</div>'+
      '<h2>Финальный вердикт по P2P-защите</h2>'+
      '<div class="participants-row">'+
        '<div><label class="field-label">Решение по защите</label>'+
          '<select id="report-verdict-select">'+
            '<option value="passed" '+(state.verdict==='passed'?'selected':'')+'>✓ Зачтено (Студент понимает код)</option>'+
            '<option value="needs_work" '+(state.verdict==='needs_work'?'selected':'')+'>⚠ На доработку (Частичное понимание)</option>'+
            '<option value="ai_suspected" '+(state.verdict==='ai_suspected'?'selected':'')+'>✕ Не зачтено (Подозрение на генерацию без понимания)</option>'+
          '</select>'+
        '</div>'+
        '<div><label class="field-label">Комментарий преподавателя / аудитора</label>'+
          '<input type="text" id="report-teacher-comment" value="'+esc(state.teacherComment||'')+'" placeholder="Отзыв о понимании архитектуры и логики…">'+
        '</div>'+
      '</div>'+
      '<button type="button" class="secondary" id="save-verdict-btn">Сохранить вердикт в БД SQLite</button>'+
    '</div>'+
    '<div class="report-actions">'+
      '<button class="primary" id="export-report">Скачать отчёт JSON</button>'+
      '<button class="secondary" id="download-code">Скачать исправленные файлы</button>'+
      '<button class="secondary" id="again">Новый аудит</button>'+
    '</div>';

  $('#export-report').onclick=()=>download('codesense-report.json',JSON.stringify({...state,notice:'Отчёт P2P-аудита CodeSense (Tomorrow School).'},null,2));
  $('#download-code').onclick=()=>Object.entries(state.edited).forEach(([name,text])=>download(name,text));
  $('#again').onclick=()=>view('setup');
  const saveVerdictBtn=$('#save-verdict-btn');
  if(saveVerdictBtn){
    saveVerdictBtn.onclick=async()=>{
      state.verdict=$('#report-verdict-select').value;
      state.teacherComment=$('#report-teacher-comment').value.trim();
      await saveStateToServer();
      renderReport();
      toast('Вердикт и комментарий сохранены в базу данных');
    };
  }
}

function drawAuditor(){
  if(!state){
    $('#auditor-content').innerHTML='<p class="muted">Ожидание активной сессии… Создайте аудит или подключитесь к комнате.</p>';
    return;
  }
  const anti=state.antiCheat||{tabSwitches:0,largePastes:0,events:[]};
  const checklist=state.auditorChecklist||{m0:false,m1:false,m2:false,comment:''};

  $('#auditor-content').innerHTML=
    '<div class="stats">'+
      '<div><b>'+(state.active?'LIVE':state.finished?'FINISH':'READY')+'</b><span>Состояние ('+esc(state.roomCode||'LOCAL')+')</span></div>'+
      '<div><b>'+state.runs+'</b><span>Запусков тестов</span></div>'+
      '<div><b>'+state.results.filter(x=>x.pass).length+'/'+state.tests.length+'</b><span>Последняя проверка</span></div>'+
      '<div><b>'+(anti.tabSwitches+anti.largePastes)+'</b><span>Anti-LLM сигналы</span></div>'+
    '</div>'+
    '<p class="muted">Студент: <b>'+esc(state.studentName||'Студент')+'</b> · Аудитор: <b>'+esc(state.auditorName||'Аудитор')+'</b> · '+
    (state.active?'Осталось времени: <b>'+Math.max(0,Math.ceil((state.deadline-Date.now())/1000))+' сек</b>':'Ожидание старта или защита завершена')+'</p>'+
    '<h2>Скрытая карта 3 мутаций и чек-лист понимания</h2>'+
    state.mutations.map((m,i)=>
      '<div class="mutation">'+
        '<strong>Мутация #0'+(i+1)+' · '+esc(m.file)+' : строка '+m.line+' ('+esc(m.kind)+')</strong>'+
        '<p>Оригинал: <code>'+esc(m.before)+'</code> → Мутация: <code>'+esc(m.after)+'</code></p>'+
        '<p>Статус по тестам: <b>'+mutationStatus(m)+'</b></p>'+
        '<label class="check-row"><input type="checkbox" class="auditor-check" data-idx="'+i+'" '+(checklist['m'+i]?'checked':'')+'> Студент самостоятельно нашёл эту мутацию и объяснил, почему она ломала логику</label>'+
      '</div>'
    ).join('')+
    '<div class="auditor-grid">'+
      '<div>'+
        '<h2>Живой код студента</h2>'+
        Object.entries(state.edited).map(([k,v])=>'<p><b>'+esc(k)+'</b></p><pre class="audit-code">'+esc(v)+'</pre>').join('')+
      '</div>'+
      '<div>'+
        '<h2>Наблюдения студента ('+state.notes.length+')</h2>'+
        (state.notes.map(n=>'<p><b>'+esc(n.time)+'</b> · '+esc(n.text)+'</p>').join('')||'<p class="muted">Пока нет записей от студента</p>')+
        '<h2>Контроль честности (Anti-LLM)</h2>'+
        '<p class="muted">Переключений вкладок: <b>'+anti.tabSwitches+'</b> · Крупных вставок кода: <b>'+anti.largePastes+'</b></p>'+
        '<h2>Журнал сессии</h2>'+
        '<div class="log">'+state.log.map(l=>esc(l.time)+' · '+esc(l.text)).join('<br>')+'</div>'+
      '</div>'+
    '</div>';

  document.querySelectorAll('.auditor-check').forEach(chk=>{
    chk.onchange=()=>{
      state.auditorChecklist=state.auditorChecklist||{m0:false,m1:false,m2:false};
      state.auditorChecklist['m'+chk.dataset.idx]=chk.checked;
      saveStateToServer();
      channel.postMessage({type:'state',state});
      toast('Отметка аудитора сохранена');
    };
  });
}

channel.onmessage=e=>{
  if(e.data.type==='state'){
    state=e.data.state;
    if(isAuditor)drawAuditor();
    if(state.finished)renderReport();
  }else if(e.data.type==='request')sync();
};

$('#auditor-open').onclick=()=>window.open(location.pathname+'?auditor=1','codesense-auditor');

// --- Join Room by Code ---
const joinBtn=$('#join-room-btn');
if(joinBtn){
  joinBtn.onclick=async()=>{
    const code=($('#join-code-input')?.value||'').trim();
    if(!code)return toast('Введите код комнаты (например, TS-101)');
    const data=await apiFetch('/api/audits/'+encodeURIComponent(code));
    if(!data?.audit?.state)return toast('Сессия с кодом '+code+' не найдена в БД');
    state=data.audit.state;
    connectSse(data.audit.id);
    if(currentUser.role==='auditor'||currentUser.role==='teacher'){
      view('auditor');
      toast('Подключено к сессии '+data.audit.room_code+' в режиме аудитора');
    }else if(state.finished){
      renderReport();
      view('report');
    }else{
      renderFiles();
      view('workspace');
      toast('Подключено к сессии '+data.audit.room_code);
    }
  };
}

const refreshAuditorBtn=$('#refresh-auditor-btn');
if(refreshAuditorBtn){
  refreshAuditorBtn.onclick=async()=>{
    if(state?.id){
      const d=await apiFetch('/api/audits/'+encodeURIComponent(state.id));
      if(d?.audit?.state){state=d.audit.state;drawAuditor();toast('Данные сессии обновлены из БД');return;}
    }
    const list=await apiFetch('/api/audits');
    if(list?.audits?.length){
      state=list.audits[0].state;
      drawAuditor();
      toast('Загружена последняя сессия из БД: '+list.audits[0].room_code);
    }
  };
}

// --- Database Dashboard (Users: Teachers, Auditors, Students + Audits History) ---
async function loadDatabaseDashboard(){
  const [usersRes,auditsRes]=await Promise.all([apiFetch('/api/users'),apiFetch('/api/audits')]);
  const users=usersRes?.users||[];
  const audits=auditsRes?.audits||[];

  if($('#stat-users'))$('#stat-users').textContent=String(users.length||4);
  if($('#stat-audits'))$('#stat-audits').textContent=String(audits.length||1);
  const finished=audits.filter(a=>a.status==='finished');
  const passedCount=finished.filter(a=>a.verdict==='passed').length;
  if($('#stat-pass-rate')){
    $('#stat-pass-rate').textContent=finished.length?Math.round((passedCount/finished.length)*100)+'%':'100%';
  }

  // Update participant selects on setup screen
  const studentSelect=$('#select-student'),auditorSelect=$('#select-auditor');
  if(studentSelect&&users.length){
    const students=users.filter(u=>u.role==='student');
    if(students.length){
      studentSelect.innerHTML=students.map(u=>`<option value="${esc(u.name)}">${esc(u.name)} (${esc(u.cohort)})</option>`).join('');
    }
  }
  if(auditorSelect&&users.length){
    const auditors=users.filter(u=>u.role==='auditor'||u.role==='teacher');
    if(auditors.length){
      auditorSelect.innerHTML=auditors.map(u=>`<option value="${esc(u.name)}">${esc(u.name)} (${u.role==='teacher'?'Преподаватель':'P2P-Аудитор'})</option>`).join('');
    }
  }

  const roleBadges={
    student:'<span class="badge badge-student">Студент</span>',
    auditor:'<span class="badge badge-auditor">P2P-Аудитор</span>',
    teacher:'<span class="badge badge-teacher">Преподаватель / Ментор</span>'
  };

  const uBox=$('#users-table-container');
  if(uBox){
    uBox.innerHTML='<table class="data-table"><thead><tr><th>Имя</th><th>Логин / Email</th><th>Роль</th><th>Когорта</th><th>Аудитов в БД</th></tr></thead><tbody>'+
      users.map(u=>`<tr><td><b>${esc(u.name)}</b></td><td><code>${esc(u.username)}</code> · ${esc(u.email)}</td><td>${roleBadges[u.role]||esc(u.role)}</td><td>${esc(u.cohort)}</td><td><b>${u.auditsCount||0}</b> (успешно: ${u.passedCount||0})</td></tr>`).join('')+
      '</tbody></table>';
  }

  const aBox=$('#audits-table-container');
  if(aBox){
    aBox.innerHTML='<table class="data-table"><thead><tr><th>Код</th><th>Проект и Язык</th><th>Студент</th><th>P2P-Аудитор</th><th>Тесты и Мутации</th><th>Вердикт</th><th>Действие</th></tr></thead><tbody>'+
      audits.map(a=>`<tr>
        <td><code><b>${esc(a.room_code)}</b></code></td>
        <td><b>${esc(a.title)}</b><br><small class="muted">${esc((a.language||'js').toUpperCase())} ${a.repo_url?'· '+esc(a.repo_url):''}</small></td>
        <td>${esc(a.student_name)}</td>
        <td>${esc(a.auditor_name)}</td>
        <td>Тесты: <b>${a.score_tests}/${a.total_tests}</b> · Мутации: <b>${a.score_mutations}/3</b></td>
        <td><span class="badge ${a.verdict==='passed'?'badge-pass':'badge-warn'}">${a.verdict==='passed'?'Зачтено':a.status==='active'?'Идёт защита':'На проверке'}</span></td>
        <td><button type="button" class="secondary small-btn open-audit-row" data-id="${esc(a.id)}">Открыть</button></td>
      </tr>`).join('')+
      '</tbody></table>';

    aBox.querySelectorAll('.open-audit-row').forEach(btn=>{
      btn.onclick=()=>{
        const found=audits.find(x=>x.id===btn.dataset.id);
        if(!found?.state)return;
        state=found.state;
        if(state.finished){
          renderReport();
          view('report');
        }else{
          drawAuditor();
          view('auditor');
        }
      };
    });
  }
}

// --- Authentication & Role Switching ---
function updateHeaderUser(user){
  if(!user)return;
  currentUser=user;
  const roleMap={student:'СТУДЕНТ',auditor:'P2P-АУДИТОР',teacher:'ПРЕПОДАВАТЕЛЬ'};
  if($('#current-role-tag'))$('#current-role-tag').textContent=roleMap[user.role]||'СТУДЕНТ';
  if($('#current-user-name'))$('#current-user-name').textContent=user.name;
  document.querySelectorAll('.role-pill').forEach(p=>{
    p.classList.toggle('active-role',p.dataset.quickLogin===user.role);
  });
}

document.querySelectorAll('.role-pill').forEach(btn=>{
  btn.onclick=async()=>{
    const login=btn.dataset.quickLogin;
    const res=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({login,quickDemo:true})});
    if(res?.user){
      authToken=res.token;
      updateHeaderUser(res.user);
      toast(`Вы вошли как: ${res.user.name} (${res.user.role==='teacher'?'Преподаватель':res.user.role==='auditor'?'P2P-Аудитор':'Студент'})`);
      if(res.user.role==='teacher')view('database');
      else if(res.user.role==='auditor'&&state)view('auditor');
    }
  };
});

const authModal=$('#auth-modal');
if($('#open-auth-modal'))$('#open-auth-modal').onclick=()=>authModal?.classList.remove('hidden');
if($('#open-register-btn'))$('#open-register-btn').onclick=()=>{
  authModal?.classList.remove('hidden');
  $('#tab-register')?.click();
};
if($('#close-auth-modal'))$('#close-auth-modal').onclick=()=>authModal?.classList.add('hidden');

if($('#tab-login')&&$('#tab-register')){
  $('#tab-login').onclick=()=>{
    $('#tab-login').classList.add('active');
    $('#tab-register').classList.remove('active');
    $('#login-form').classList.remove('hidden');
    $('#register-form').classList.add('hidden');
  };
  $('#tab-register').onclick=()=>{
    $('#tab-register').classList.add('active');
    $('#tab-login').classList.remove('active');
    $('#register-form').classList.remove('hidden');
    $('#login-form').classList.add('hidden');
  };
}

if($('#login-form')){
  $('#login-form').onsubmit=async e=>{
    e.preventDefault();
    const login=$('#login-username').value.trim();
    const password=$('#login-password').value;
    const res=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({login,password})});
    if(!res?.user)return toast('Неверный логин или пароль');
    authToken=res.token;
    updateHeaderUser(res.user);
    authModal?.classList.add('hidden');
    toast('Добро пожаловать, '+res.user.name+'!');
    loadDatabaseDashboard();
  };
}

if($('#register-form')){
  $('#register-form').onsubmit=async e=>{
    e.preventDefault();
    const body={
      name:$('#reg-name').value.trim(),
      username:$('#reg-username').value.trim(),
      email:$('#reg-email').value.trim(),
      role:$('#reg-role').value,
      cohort:$('#reg-cohort').value.trim(),
      password:$('#reg-password').value
    };
    const res=await apiFetch('/api/auth/register',{method:'POST',body:JSON.stringify(body)});
    if(!res?.user)return toast('Ошибка регистрации (возможно, логин или email занят)');
    authToken=res.token;
    updateHeaderUser(res.user);
    authModal?.classList.add('hidden');
    toast('Пользователь '+res.user.name+' добавлен в базу данных SQLite!');
    loadDatabaseDashboard();
  };
}

// Initial bootstrap
if(isAuditor){
  view('auditor');
  channel.postMessage({type:'request'});
  setInterval(drawAuditor,1000);
}else{
  view('setup');
  loadDatabaseDashboard();
}
