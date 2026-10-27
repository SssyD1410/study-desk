const COL=['#1f6f5c','#c8553d','#d9a21b','#3b6fb6','#8a4fa3','#2a9d8f','#e07a5f'];
const QN=['Do first (urgent + important)','Schedule (important)','Delegate (urgent)','Eliminate (neither)'];
const $=s=>document.querySelector(s);
const I=n=>'<svg class="ic" aria-hidden="true"><use href="#i-'+n+'"/></svg>';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const blank=()=>({topics:[],log:[],run:null,pause:null,todos:[],notified:{},pomo:{focus:25,brk:5,topic:'',phase:'idle',end:0,count:0,day:''}});
let S=blank(),REV=0,ME=null;
function adopt(st){S=Object.assign(blank(),st||{});S.pomo=Object.assign(blank().pomo,S.pomo||{});S.notified=S.notified||{};if(S.run&&!topic(S.run.t))S.run=null;ensureIds()}
let tab='tasks';

// ---- server sync: every change is saved to the account; other devices are pulled in periodically
async function api(method,url,body){
 const h={'X-Study-Desk':'1'};if(body!==undefined)h['Content-Type']='application/json';
 const r=await fetch(url,{method,credentials:'same-origin',headers:h,body:body!==undefined?JSON.stringify(body):undefined});
 let d={};try{d=await r.json()}catch(e){}
 if(r.status===401&&ME&&url!=='/api/password'&&url!=='/api/account')signedOut('Your session ended. Please sign in again.');
 return {ok:r.ok,status:r.status,data:d}}
let dirty=false,syncing=false,syncT=null;
const setSync=t=>{const e=$('#sync');if(e)e.textContent=t};
const save=()=>{if(!ME)return;dirty=true;clearTimeout(syncT);syncT=setTimeout(push,400)};
async function push(){
 if(syncing||!dirty||!ME)return;clearTimeout(syncT);syncing=true;dirty=false;let again=true;
 try{const r=await api('PUT','/api/state',{baseRev:REV,state:S});
  if(r.ok){REV=r.data.rev;setSync('')}
  else if(r.status===409){adopt(r.data.state);REV=r.data.rev;dirty=false;again=false;msg('Updated with changes from another device.');render()}
  else if(r.status===401)again=false;
  else{dirty=true;again=false;setSync(r.data.error||'Not saved yet. Retrying…');syncT=setTimeout(push,5000)}}
 catch(e){dirty=true;again=false;setSync('Offline. Changes will be saved when the connection is back.');syncT=setTimeout(push,5000)}
 syncing=false;if(again&&dirty)push()}
const typing=()=>{const a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA')&&a.value&&a.type!=='checkbox'};
async function pull(){
 if(!ME||dirty||syncing)return;
 try{const r=await api('GET','/api/state?rev='+REV);
  if(r.ok&&!r.data.unchanged&&!dirty&&!syncing){adopt(r.data.state);REV=r.data.rev;if(!edit&&!typing())render()}}catch(e){}}
window.addEventListener('beforeunload',()=>{if(dirty&&ME)try{fetch('/api/state',{method:'PUT',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Study-Desk':'1'},body:JSON.stringify({baseRev:REV,state:S})})}catch(e){}});
const uid=()=>Math.random().toString(36).slice(2,9);
const dayStart=d=>new Date(d).setHours(0,0,0,0);
const ov=(s,e,a,b)=>Math.max(0,Math.min(e,b)-Math.max(s,a));
function spent(tid,a,b){const now=Date.now();let t=0;for(const l of S.log)if(l.t===tid)t+=ov(l.s,l.e,a,b);
 if(S.run&&S.run.t===tid)t+=ov(S.run.s,now,a,b);return t}
const today=()=>[dayStart(Date.now()),dayStart(Date.now())+864e5];
const fmt=ms=>{const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s%60).padStart(2,'0')};
const hm=ms=>{const m=Math.round(ms/6e4);return m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m'};
function stopRun(){if(S.run){const e=Date.now();if(e-S.run.s>1000)S.log.push({t:S.run.t,s:S.run.s,e,id:uid()});S.run=null}}
function startRun(t){stopRun();S.pause=null;S.run={t,s:Date.now()}}
let AC=null;
function getCtx(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume()}catch(e){}return AC}
function beep(){const a=getCtx();if(!a)return;
 for(let i=0;i<3;i++){const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+i*.3;o.frequency.value=i%2?660:880;g.gain.value=.4;o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+.2)}}
const topic=id=>S.topics.find(t=>t.id===id);

function vTasks(){
 const [a,b]=today();let tot=0,goal=0;
 S.topics.forEach(t=>{tot+=Math.min(spent(t.id,a,b),t.goal*6e4);goal+=t.goal*6e4});
 let h=`<div class="card"><div class="row"><b>Today overall</b><span class="sp"></span><span class="mut" data-all>${hm(tot)} of ${hm(goal)}</span></div>
 <div class="bar"><i data-allbar style="width:${goal?tot/goal*100:0}%;background:var(--acc)"></i></div></div>`;
 h+=`<div class="card row"><input type="text" id="tn" placeholder="New topic, e.g. Linear algebra" data-add="topic"><input type="number" id="tg" value="60" min="5" step="5" aria-label="Goal in minutes"><span class="mut">min goal</span><button class="b p" data-act="addTopic">Add topic</button></div>`;
 if(!S.topics.length)h+=`<div class="empty">Add a topic and a daily goal, then press Start to track your time.</div>`;
 for(const t of S.topics){const run=S.run&&S.run.t===t.id,pz=(S.pause&&S.pause.t===t.id)||(S.pomo.paused&&S.pomo.phase==='focus'&&S.pomo.topic===t.id),ms=spent(t.id,a,b),p=Math.min(100,ms/(t.goal*6e4)*100);
  h+=`<div class="card"><div class="row"><span class="dot" style="background:${t.color}"></span><b>${esc(t.name)}</b><span class="sp"></span>
  <span class="big" data-t="${t.id}">${fmt(ms)}</span></div>
  <div class="bar"><i data-bar="${t.id}" style="width:${p}%;background:${t.color}"></i></div>
  <div class="row"><span class="mut" data-pct="${t.id}">${Math.round(p)}% of ${t.goal} min${p>=100?' · goal reached':''}</span><span class="sp"></span>
  ${run?`<button class="b" data-act="pause" data-id="${t.id}">Pause</button><button class="b" data-act="stop" data-id="${t.id}">Stop</button>`:pz?`<button class="b p" data-act="resume" data-id="${t.id}">Resume</button><button class="b" data-act="stop" data-id="${t.id}">Stop</button>`:`<button class="b p" data-act="start" data-id="${t.id}">Start</button>`}
  <button class="x" data-act="delTopic" data-id="${t.id}" aria-label="Delete topic">${I('x')}</button></div></div>`}
 return h}

function vPomo(){
 const p=S.pomo,ph=p.phase,idle=ph==='idle';
 const opts=S.topics.map(t=>`<option value="${t.id}" ${p.topic===t.id?'selected':''}>${esc(t.name)}</option>`).join('');
 const lab=({idle:'Ready to focus',focus:'Focus time',breakwait:'Focus done. Your break is ready',break:'Break time'}[ph]||'')+(p.paused?' (paused)':'');
 const ms=idle?p.focus*6e4:ph==='breakwait'?p.brk*6e4:p.paused?p.left:Math.max(0,p.end-Date.now());
 const btns=idle?`<button class="b p" data-act="pStart" ${S.topics.length?'':'disabled'}>Start focus</button>`:ph==='breakwait'?`<button class="b p" data-act="bStart">Start break</button><button class="b" data-act="bSkip">Skip break</button>`:`<button class="b ${p.paused?'p':''}" data-act="${p.paused?'resume':'pause'}">${p.paused?'Resume':'Pause'}</button><button class="b" data-act="pStop">Stop</button>`;
 return `<div class="card"><div class="mut" style="text-align:center" data-phase>${lab}</div>
 <div class="clock" data-clock>${fmt(ms)}</div>
 <div class="row" style="justify-content:center">
 ${S.topics.length?`<select data-act="pTopic" ${idle?'':'disabled'}>${opts}</select>`:'<span class="mut">Add a topic first (Topics tab)</span>'}
 ${btns}</div>
 <p class="mut" style="text-align:center">Focus time counts toward the chosen topic. Breaks never start on their own. ${p.day===new Date().toDateString()?p.count:0} pomodoro(s) done today.</p></div>
 <div class="card row"><label>Focus <input type="number" min="1" max="120" value="${p.focus}" data-act="pFocus"> min</label>
 <label>Break <input type="number" min="1" max="60" value="${p.brk}" data-act="pBrk"> min</label></div>`}

function item(t){return `<div class="it ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} data-act="toggle" data-id="${t.id}" aria-label="Done">
 <span>${esc(t.text)}</span><select data-act="move" data-id="${t.id}" aria-label="Quadrant">${QN.map((n,i)=>`<option value="${i}" ${t.q===i?'selected':''}>${n.split(' (')[0]}</option>`).join('')}</select>
 <button class="x" data-act="delTodo" data-id="${t.id}" aria-label="Delete">${I('x')}</button></div>`}

function vMatrix(){
 let h='<div class="grid">';
 for(let i=0;i<4;i++){const l=S.todos.filter(t=>t.q===i&&!t.done);
  h+=`<div class="q q${i}"><h3>${QN[i]}</h3><div class="row" style="margin:6px 0"><input type="text" placeholder="Add task" data-add="q" data-q="${i}"></div>${l.map(item).join('')||'<div class="mut">Nothing here</div>'}</div>`}
 return h+'</div><p class="mut">Tasks are shared with the To-do tab. Use the dropdown on a task to move it between quadrants.</p>'}

function vTodo(){
 const open=S.todos.filter(t=>!t.done),dn=S.todos.filter(t=>t.done);
 return `<div class="card row"><input type="text" id="todoIn" placeholder="What needs doing?" data-add="todo"><select id="todoQ">${QN.map((n,i)=>`<option value="${i}">${n.split(' (')[0]}</option>`).join('')}</select><button class="b p" data-act="addTodo">Add</button></div>
 <div class="card">${open.map(item).join('')||'<div class="empty">No open tasks.</div>'}</div>
 ${dn.length?`<div class="card"><div class="row"><b>Completed</b><span class="sp"></span><button class="b" data-act="clearDone">Clear</button></div>${dn.map(item).join('')}</div>`:''}`}

let stat={v:'week',a:dayStart(Date.now()),m:'time',c:'cal'},statN=0,lastDay=dayStart(Date.now());
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x.getTime()};
const nextDay=d=>addDays(d,1);
function range(){const a=new Date(stat.a),v=stat.v;let s,e;
 if(v==='day'){s=stat.a;e=nextDay(s)}
 else if(v==='week'){s=addDays(stat.a,-((a.getDay()+6)%7));e=addDays(s,7)}
 else if(v==='month'){s=new Date(a.getFullYear(),a.getMonth(),1).getTime();e=new Date(a.getFullYear(),a.getMonth()+1,1).getTime()}
 else{s=new Date(a.getFullYear(),0,1).getTime();e=new Date(a.getFullYear()+1,0,1).getTime()}
 return [s,e]}
function shift(n){const a=new Date(stat.a),v=stat.v;
 stat.a=v==='day'?addDays(stat.a,n):v==='week'?addDays(stat.a,7*n):v==='month'?new Date(a.getFullYear(),a.getMonth()+n,1).getTime():new Date(a.getFullYear()+n,0,1).getTime()}
function segs(){const o=S.log.map(l=>({t:l.t,s:l.s,e:l.e,id:l.id}));if(S.run)o.push({t:S.run.t,s:S.run.s,e:Date.now()});return o}
function dayMap(){const m={};for(const l of segs()){let d=dayStart(l.s);while(d<l.e){const n=nextDay(d),x=ov(l.s,l.e,d,n);if(x>0){(m[d]=m[d]||{})[l.t]=(m[d][l.t]||0)+x}d=n}}return m}
function niceMax(mx){if(!mx)return 36e5;for(const st of [9e5,18e5,36e5,72e5,144e5,18e6,36e6,72e6,18e7,36e7])if(mx/st<=4)return Math.ceil(mx/st)*st;return mx}
const fd=(d,o)=>new Date(d).toLocaleDateString(undefined,o);
const ft=d=>new Date(d).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
let edit=null,rArm=false;
const toLI=ts=>{const d=new Date(ts),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};
function ensureIds(){S.log.forEach(l=>{if(!l.id)l.id=uid()})}
const focusEd=()=>{const f=$('#sed');if(f&&f.scrollIntoView)f.scrollIntoView({block:'center'})};
function addS(){if(!S.topics.length)return;const now=Math.floor(Date.now()/6e4)*6e4;let st=range()[0]+9*36e5,en=st+36e5;if(en>now){en=now;st=en-36e5}
 edit={id:'',t:S.topics[0].id,s:st,e:en,err:'',arm:false};render();focusEd()}
function editS(id){const l=S.log.find(x=>x.id===id);if(!l)return;stat.v='day';stat.a=dayStart(l.s);edit={id,t:l.t,s:l.s,e:l.e,err:'',arm:false};render();focusEd()}
function readForm(){const g=(i,o)=>{const v=$(i).value;return v===toLI(o)?o:new Date(v).getTime()};edit.t=$('#etp').value;edit.s=g('#ess',edit.s);edit.e=g('#eee',edit.e)}
function saveS(){if(!edit)return;readForm();const {id,t,s,e}=edit,now=Date.now();let err='';
 if(isNaN(s)||isNaN(e))err='Enter a start and an end time.';
 else if(e-s<6e4)err='The end must be at least 1 minute after the start.';
 else if(e>now+6e4)err='The end cannot be in the future.';
 else{const c=segs().find(l=>l.id!==id&&ov(l.s,l.e,s,e)>0);if(c)err='This overlaps '+(topic(c.t)?.name||'another session')+' ('+ft(c.s)+' – '+ft(c.e)+', '+fd(c.s,{month:'short',day:'numeric'})+'). Adjust the times.'}
 if(err){edit.err=err;render();return}
 if(id){const l=S.log.find(x=>x.id===id);if(l){l.t=t;l.s=s;l.e=e}}else S.log.push({id:uid(),t,s,e});
 S.log.sort((a,b)=>a.s-b.s);edit=null;stat.v='day';stat.a=dayStart(s);save();render()}
function delS(){if(!edit||!edit.id)return;if(!edit.arm){readForm();edit.arm=true;render();return}
 S.log=S.log.filter(x=>x.id!==edit.id);edit=null;save();render()}
function sessCard(it){
 const frm=edit?`<div id="sed" style="border:1px solid var(--acc);border-radius:10px;padding:12px;margin:12px 0"><b>${edit.id?'Edit session':'Add session'}</b>
  <div class="row" style="margin-top:8px"><label class="fl">Topic<select id="etp">${S.topics.map(t=>`<option value="${t.id}" ${t.id===edit.t?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
  <label class="fl">Start<input type="datetime-local" id="ess" value="${toLI(edit.s)}" max="${toLI(Date.now())}"></label>
  <label class="fl">End<input type="datetime-local" id="eee" value="${toLI(edit.e)}" max="${toLI(Date.now())}"></label></div>
  ${edit.err?`<div class="err">${esc(edit.err)}</div>`:''}
  <div class="row" style="margin-top:10px"><button class="b p" data-act="saveS">Save</button><button class="b" data-act="cancelS">Cancel</button>${edit.id?`<button class="b" data-act="delS">${edit.arm?'Confirm delete':'Delete'}</button>`:''}</div></div>`:'';
 return `<div class="card"><div class="row"><b>Sessions</b><span class="sp"></span><button class="b" data-act="addS">+ Add session</button></div>${frm}`+
 (it.length?it.map(x=>{const t=topic(x.t)||{name:'(deleted topic)',color:'#999'};return `<div class="it"><span class="dot" style="background:${t.color}"></span><span>${esc(t.name)}<br><small class="mut">${ft(x.s)} – ${ft(x.e)}${x.id?'':' · in progress'}</small></span><span class="mut">${hm(x.e-x.s)}</span>${x.id?`<button class="b" data-act="editS" data-id="${x.id}">Edit</button>`:''}</div>`}).join(''):'<div class="mut" style="margin-top:10px">No sessions on this day. Use Add session to log one.</div>')+'</div>'}
function calcRange(lo0,hi0,nowH){let lo=Math.max(0,Math.floor(lo0)-1),hi=Math.min(24,Math.ceil(hi0)+1);
 if(nowH!=null){lo=Math.min(lo,Math.floor(nowH));hi=Math.max(hi,Math.ceil(nowH)+1)}
 hi=Math.min(24,hi);while(hi-lo<6){if(lo>0)lo--;if(hi-lo<6&&hi<24)hi++}return [lo,hi]}
const hh=k=>String(k%24).padStart(2,'0')+':00';
function blk(x,dayTs,lo,PX,full){const t=topic(x.t);if(!t)return '';const top=((x.s-dayTs)/36e5-lo)*PX,ht=Math.max(5,(x.e-x.s)/36e5*PX);
 const txt=ht>=(full?30:24)?(full?`<b>${esc(t.name)}</b> · ${hm(x.e-x.s)}<br>${ft(x.s)} – ${ft(x.e)}`:hm(x.e-x.s)):'';
 return `<div class="blk${full?'':' w'}" ${x.id?`data-act="editS" data-id="${x.id}"`:''} style="top:${top}px;height:${ht}px;background:${t.color};${x.id?'cursor:pointer':''}" title="${esc(t.name)} ${ft(x.s)}–${ft(x.e)}">${txt}</div>`}
function dayTL(it,s){const PX=44,now=Date.now(),nowH=dayStart(now)===s?(now-s)/36e5:null;
 const [lo,hi]=calcRange(it.length?Math.min(...it.map(x=>(x.s-s)/36e5)):8,it.length?Math.max(...it.map(x=>(x.e-s)/36e5)):18,nowH);
 let h=`<div class="tl" style="height:${(hi-lo)*PX}px">`;
 for(let k=lo;k<=hi;k++)h+=`<div class="hr" style="top:${(k-lo)*PX}px"><span>${hh(k)}</span></div>`;
 h+=it.map(x=>blk(x,s,lo,PX,true)).join('');
 if(nowH!=null)h+=`<div class="now" style="left:50px;top:${(nowH-lo)*PX}px"></div>`;
 return h+'</div>'}
function weekTL(s,e){const PX=36,now=Date.now(),days=[];for(let d=s;d<e;d=nextDay(d))days.push(d);
 const sg=segs(),per=days.map(d=>{const n=nextDay(d);return sg.map(l=>({t:l.t,id:l.id,s:Math.max(l.s,d),e:Math.min(l.e,n)})).filter(x=>x.e-x.s>=1000)});
 let mn=99,mx=-1;days.forEach((d,i)=>per[i].forEach(x=>{mn=Math.min(mn,(x.s-d)/36e5);mx=Math.max(mx,(x.e-d)/36e5)}));
 if(mx<0){mn=8;mx=18}
 const ti=days.indexOf(dayStart(now)),nowH=ti>=0?(now-days[ti])/36e5:null,[lo,hi]=calcRange(mn,mx,nowH),H=(hi-lo)*PX;
 let h=`<div class="wk"><div class="wkh"><span></span>${days.map(d=>`<div class="wd ${dayStart(now)===d?'td':''}" data-act="goDay" data-d="${d}"><small>${fd(d,{weekday:'short'})}</small><b>${new Date(d).getDate()}</b></div>`).join('')}</div>
 <div class="wkb"><div class="wg" style="height:${H}px">${Array.from({length:hi-lo},(_,k)=>`<span style="top:${k*PX}px">${hh(lo+k)}</span>`).join('')}</div>`;
 days.forEach((d,i)=>{h+=`<div class="wc" style="height:${H}px;background-size:100% ${PX}px">${per[i].map(x=>blk(x,d,lo,PX,false)).join('')}${i===ti?`<div class="now" style="top:${(nowH-lo)*PX}px"></div>`:''}</div>`});
 return h+'</div></div>'}
function yearCal(s,dm){const y=new Date(s).getFullYear(),now=dayStart(Date.now()),ye=new Date(y+1,0,1).getTime();let mx=1;
 for(const k in dm)if(+k>=s&&+k<ye)mx=Math.max(mx,Object.values(dm[k]).reduce((a,b)=>a+b,0));
 let h='<div class="yg">';
 for(let m=0;m<12;m++){const a=new Date(y,m,1).getTime(),b=new Date(y,m+1,1).getTime(),off=(new Date(a).getDay()+6)%7;let mt=0,c='';
  for(let d=a;d<b;d=nextDay(d)){const v=Object.values(dm[d]||{}).reduce((x,z)=>x+z,0),pc=v?Math.round(25+75*v/mx):0;mt+=v;
   c+=`<div class="yc ${d===now?'td':''}" data-act="goDay" data-d="${d}" style="${v?`background:color-mix(in srgb,var(--acc) ${pc}%,transparent);${pc>=55?'color:var(--accink)':''}`:''}" title="${esc(fd(d,{month:'short',day:'numeric'})+': '+hm(v))}">${new Date(d).getDate()}</div>`}
  h+=`<div class="ym"><div class="row" data-act="goMonth" data-d="${a}" style="cursor:pointer"><b>${fd(a,{month:'long'})}</b><span class="sp"></span><span class="mut">${mt?hm(mt):''}</span></div><div class="yw">${'MTWTFSS'.split('').map(x=>`<i>${x}</i>`).join('')}${'<div></div>'.repeat(off)}${c}</div></div>`}
 return h+'</div>'}
function monthGrid(s,e,dm){const now=dayStart(Date.now()),off=(new Date(s).getDay()+6)%7;
 let h='<div class="mg">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div class="mh">${x}</div>`).join('')+'<div></div>'.repeat(off);
 for(let d=s;d<e;d=nextDay(d)){const by=dm[d]||{},val=Object.values(by).reduce((a,b)=>a+b,0);
  h+=`<div class="mc ${d===now?'td':''}" data-act="goDay" data-d="${d}"><span class="dn">${new Date(d).getDate()}</span><span class="mt">${val?hm(val):''}</span>${val?`<div class="mb">${S.topics.map(t=>by[t.id]?`<div style="flex:${by[t.id]};background:${t.color}"></div>`:'').join('')}</div>`:''}</div>`}
 return h+'</div>'}
function barChart(v,s,e,keys,dm,total){const B=[];
 if(v==='year'){const y=new Date(s).getFullYear();for(let m=0;m<12;m++){const a=new Date(y,m,1).getTime(),b=new Date(y,m+1,1).getTime(),by={};keys.filter(k=>k>=a&&k<b).forEach(k=>{for(const id in dm[k])by[id]=(by[id]||0)+dm[k][id]});B.push({ts:a,by,lab:fd(a,{month:'short'})})}}
 else for(let d=s;d<e;d=nextDay(d)){const dt=new Date(d).getDate();B.push({ts:d,by:dm[d]||{},lab:v==='week'?fd(d,{weekday:'short'}):(dt%5===1?String(dt):'')})}
 const vals=B.map(b=>Object.values(b.by).reduce((x,y)=>x+y,0)),mxN=niceMax(Math.max(...vals)),avg=total/(vals.filter(x=>x>0).length||1),HH=150;
 return `<div class="ch"><div class="gl" style="bottom:${18+HH}px"><span>${hm(mxN)}</span></div><div class="gl" style="bottom:${18+HH/2}px"><span>${hm(mxN/2)}</span></div>
 <div class="gl" style="bottom:${18+avg/mxN*HH}px;border-top:2px dashed var(--acc)"><span style="color:var(--acc)">avg</span></div><div class="cols ${v==='month'?'m':''}">`+
 B.map((b,i)=>{const val=vals[i],tip=fd(b.ts,v==='year'?{month:'long',year:'numeric'}:{month:'short',day:'numeric'})+': '+hm(val);
  return `<div class="cb" data-act="${v==='year'?'goMonth':'goDay'}" data-d="${b.ts}" title="${esc(tip)}">${v==='month'?'':`<small>${val?hm(val):''}</small>`}<div class="st" style="height:${val/mxN*HH}px">${S.topics.map(t=>`<div style="height:${(b.by[t.id]||0)/mxN*HH}px;background:${t.color}"></div>`).join('')}</div><small>${b.lab}</small></div>`}).join('')+`</div></div><div class="mut" style="margin-top:6px">Tap a bar to open that ${v==='year'?'month':'day'}.</div>`}
function vStats(){
 if(!S.topics.length)return '<div class="empty">Add a topic and track some time. Your charts will appear here.</div>';
 const [s,e]=range(),v=stat.v,dm=dayMap(),keys=Object.keys(dm).map(Number).filter(k=>k>=s&&k<e);
 const tt={};let total=0,active=0;
 const dayIt=v==='day'?segs().map(l=>({t:l.t,id:l.id,s:Math.max(l.s,s),e:Math.min(l.e,e)})).filter(x=>x.e-x.s>=1000).sort((a,b)=>a.s-b.s):[];
 keys.forEach(k=>{let d=0;for(const id in dm[k]){tt[id]=(tt[id]||0)+dm[k][id];d+=dm[k][id]}total+=d;if(d>0)active++});
 const ns=(()=>{const k=stat.a;shift(1);const r=range()[0];stat.a=k;return r})();
 const pl=v==='day'?fd(s,{weekday:'long',month:'short',day:'numeric'}):v==='week'?fd(s,{month:'short',day:'numeric'})+' – '+fd(addDays(e,-1),{month:'short',day:'numeric',year:'numeric'}):v==='month'?fd(s,{month:'long',year:'numeric'}):String(new Date(s).getFullYear());
 let h=`<div class="row" style="margin-bottom:10px"><button class="b" data-act="st">Today</button><button class="b" data-act="sp" data-n="-1" aria-label="Previous">‹</button><button class="b" data-act="sp" data-n="1" ${ns>Date.now()?'disabled':''} aria-label="Next">›</button><b class="ttl">${pl}</b></div>
 <div class="seg">${[['day','Day'],['week','Week'],['month','Month'],['year','Year']].map(([k,n])=>`<button class="${v===k?'on':''}" data-act="sv" data-v="${k}">${n}</button>`).join('')}</div>
 <div class="card" style="margin-top:12px"><div class="big" style="font-size:30px">${hm(total)}</div><div class="mut">${v==='day'?'studied':'total · '+hm(active?total/active:0)+' average per active day'}</div>`;
 if(!total)h+='<div class="empty">No study time recorded in this period.</div>';
 else{
  if(v==='month'||v==='year')h+=`<div class="seg sm"><button class="${stat.c==='cal'?'on':''}" data-act="sc" data-c="cal">Calendar</button><button class="${stat.c==='stack'?'on':''}" data-act="sc" data-c="stack">Stacks</button></div>`;
  if(v==='day'||v==='week')h+=`<div class="seg sm"><button class="${stat.m==='stack'?'on':''}" data-act="sm" data-m="stack">Stacks</button><button class="${stat.m==='time'?'on':''}" data-act="sm" data-m="time">Timeline</button></div>`;
  if(v==='day'){
   if(stat.m==='stack'){const by=dm[s]||{};h+=`<div class="sbar">${S.topics.map(t=>by[t.id]?`<div style="flex:${by[t.id]};background:${t.color}" title="${esc(t.name)} ${hm(by[t.id])}"></div>`:'').join('')}</div>`}
   else h+=dayTL(dayIt,s)}
  else if(v==='week')h+=stat.m==='time'?weekTL(s,e):barChart(v,s,e,keys,dm,total);
  else if(v==='month')h+=stat.c==='cal'?monthGrid(s,e,dm):barChart(v,s,e,keys,dm,total);
  else h+=stat.c==='cal'?yearCal(s,dm):barChart(v,s,e,keys,dm,total)}
 h+='</div>';
 if(v==='day')h+=sessCard(dayIt,s);
 h+=`<div class="card"><b>By topic</b>`+S.topics.map(t=>{const x=tt[t.id]||0;return `<div class="it"><span class="dot" style="background:${t.color}"></span><span>${esc(t.name)}</span><span class="mut">${v==='day'?Math.round(x/(t.goal*6e4)*100)+'% of goal · ':''}${hm(x)}</span></div>`}).join('')+`</div>`;
 return h}

function pauseAll(){const p=S.pomo,now=Date.now();
 if((p.phase==='focus'||p.phase==='break')&&!p.paused){p.paused=true;p.left=Math.max(0,p.end-now);if(p.phase==='focus')stopRun()}
 else if(S.run){S.pause={t:S.run.t};stopRun()}}
function resumeAll(){const p=S.pomo;
 if(p.paused){p.paused=false;p.end=Date.now()+p.left;if(p.phase==='focus')startRun(p.topic)}
 else if(S.pause){const t=S.pause.t;S.pause=null;startRun(t)}}
function stopAll(){stopRun();S.pause=null;const p=S.pomo;if(p.phase==='focus'||p.phase==='break')p.phase='idle';p.paused=false}
function startBreak(){clearAlert();const p=S.pomo;p.paused=false;p.phase='break';p.end=Date.now()+p.brk*6e4}
function skipBreak(){clearAlert();S.pomo.phase='idle';S.pomo.paused=false}
let pw=null;
const POPCSS='body{margin:0;font:500 13px "Segoe UI",-apple-system,system-ui,sans-serif;background:#161c19;color:#e6ece9;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:8px}#pt{font-size:46px;font-weight:300;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}#pl{color:#8b9891}button{font:inherit;font-weight:600;background:#5fc4a8;color:#0b1410;border:0;border-radius:8px;padding:6px 14px;cursor:pointer}button.s{background:#262f2b;color:#e6ece9}.r{display:flex;gap:8px;margin-top:2px}';
const msg=t=>{const m=$('#msg');if(m)m.textContent=t};
let popB=[null,null];
async function popout(){
 if(pw&&!pw.closed){try{pw.focus()}catch(e){}return}
 pw=null;let pip=false;
 if(window.documentPictureInPicture&&!window.desktop)try{pw=await documentPictureInPicture.requestWindow({width:280,height:175});pip=true}catch(e){pw=null}
 if(!pw)try{pw=window.open('','studydesk_timer','popup,width=300,height=195')}catch(e){pw=null}
 if(!pw){msg('Pop-out was blocked. Allow pop-ups for this page and try again.');return}
 pw.document.title='Study Desk';
 pw.document.head.innerHTML='<style>'+POPCSS+'</style>';
 pw.document.body.innerHTML='<div id="pl"></div><div id="pt">--:--</div><div class="r"><button id="pp"></button><button id="pb" class="s"></button></div>';
 const run=i=>()=>{try{if(popB[i])popB[i]()}catch(e){}save();render();updatePop()};
 pw.document.getElementById('pp').onclick=run(0);pw.document.getElementById('pb').onclick=run(1);
 updatePop();msg(pip||window.desktop?'Floating timer is on top of other windows.':'Timer opened in a small window.')}
function updatePop(){
 if(!pw||pw.closed)return;
 try{const d=pw.document,p=S.pomo,now=Date.now(),nm=id=>topic(id)?.name||'';let lab,time,b1='',b2='',f1=null,f2=null,bg='#161c19';
  if(alertState){lab=alertState.title;time='Time is up';bg='#8f2d1f';
   if(p.phase==='breakwait'){b1='Start break';f1=()=>ackAlert(true);b2='Skip break';f2=skipBreak}else{b1='OK';f1=()=>ackAlert(false)}}
  else if(p.phase==='breakwait'){lab='Break ready';time=fmt(p.brk*6e4);b1='Start break';f1=startBreak;b2='Skip break';f2=skipBreak}
  else if(p.phase==='focus'||p.phase==='break'){lab=(p.phase==='focus'?'Focus · '+nm(p.topic):'Break')+(p.paused?' (paused)':'');time=fmt(p.paused?p.left:Math.max(0,p.end-now));b1=p.paused?'Resume':'Pause';f1=p.paused?resumeAll:pauseAll;b2='Stop';f2=stopAll}
  else if(S.run){lab=nm(S.run.t);time=fmt(now-S.run.s);b1='Pause';f1=pauseAll;b2='Stop';f2=stopAll}
  else if(S.pause){lab=nm(S.pause.t)+' (paused)';time='Paused';b1='Resume';f1=resumeAll;b2='Stop';f2=stopAll}
  else{lab='No timer running';time='--:--'}
  popB=[f1,f2];d.body.style.background=bg;d.getElementById('pl').textContent=lab;d.getElementById('pt').textContent=time;
  const pp=d.getElementById('pp'),pb=d.getElementById('pb');pp.textContent=b1;pb.textContent=b2;pp.style.display=b1?'':'none';pb.style.display=b2?'':'none'}catch(e){}}
let alertState=null,aTimer=null,fTimer=null;
function clearAlert(){alertState=null;clearInterval(aTimer);clearInterval(fTimer);aTimer=fTimer=null;const o=$('#ov');if(o)o.remove();document.title='Study Desk';updatePop()}
function ackAlert(startBreak){const sb=startBreak&&S.pomo.phase==='breakwait';clearAlert();
 if(sb){S.pomo.phase='break';S.pomo.end=Date.now()+S.pomo.brk*6e4;save();render()}}
function notify(t,b,kind){
 if(kind==='goal'){beep();msg(t+'. '+b);try{if('Notification' in window&&Notification.permission==='granted')new Notification(t,{body:b,tag:'sdgoal'})}catch(e){}return}
 alertState={title:t,body:b,kind};msg(t+'. '+b);beep();
 let n=0;clearInterval(aTimer);aTimer=setInterval(()=>{if(++n>10)clearInterval(aTimer);else beep()},2500);
 clearInterval(fTimer);let on=true;fTimer=setInterval(()=>{document.title=on?t:'Study Desk';on=!on},900);
 try{if('Notification' in window&&Notification.permission==='granted'){const nt=new Notification(t,{body:b,requireInteraction:true,tag:'studydesk',renotify:true,vibrate:[200,100,200]});nt.onclick=()=>{window.focus();nt.close()}}}catch(e){}
 let o=$('#ov');if(o)o.remove();o=document.createElement('div');o.id='ov';o.setAttribute('role','alertdialog');
 o.innerHTML=`<div class="ovc"><div class="ovi">${I('bell-on')}</div><h2>${esc(t)}</h2><p>${esc(b)}</p><div class="row" style="justify-content:center">${kind==='focus'?'<button class="b p" id="ob1">Start break</button><button class="b" id="ob2">Skip break</button>':'<button class="b p" id="ob1">OK</button>'}</div></div>`;
 document.body.appendChild(o);
 $('#ob1').onclick=()=>ackAlert(kind==='focus');
 const b2=$('#ob2');if(b2)b2.onclick=()=>{clearAlert();S.pomo.phase='idle';save();render()};
 $('#ob1').focus();updatePop()}
function askNotify(){
 if(!('Notification' in window)){msg('Notifications are not supported in this browser.');return}
 try{Notification.requestPermission().then(r=>{msg(r==='granted'?'Alerts are on.':'Alerts are blocked. Allow notifications in the site settings.');render()})}catch(e){msg('Could not ask for permission here.')}}
function checkGoals(){if(!S.run)return;const t=topic(S.run.t);if(!t)return;
 const [a,b]=today(),k=t.id+new Date().toDateString(),before=spent(t.id,a,b)-ov(S.run.s,Date.now(),a,b);
 if(!S.notified[k]&&before<t.goal*6e4&&spent(t.id,a,b)>=t.goal*6e4){S.notified[k]=1;save();notify('Goal reached',t.name+': '+t.goal+' min done','goal')}}
let SRV=null,srvForm=false,delArm=false;
const srvName=()=>SRV?esc(SRV):'This computer';
function srvBlock(){
 if(!window.desktop)return '';
 return `<div class="mut" style="margin-top:12px">Server: <b>${srvName()}</b> · <button class="lnk" data-act="srvShow">Change</button></div>
 ${srvForm?`<div class="row" style="margin-top:8px"><input type="text" id="srvIn" placeholder="https://study.example.com" value="${SRV?esc(SRV):''}"><button class="b p" data-act="srvSet">Connect</button>${SRV?'<button class="b" data-act="srvLocal">Use this computer</button>':''}</div>
 <p class="mut">Connect to a Study Desk server to use one account on several devices. Leave it on this computer to keep everything offline.</p><div class="err" id="srvErr"></div>`:''}`}
function vAccount(){
 const since=ME&&ME.createdAt?fd(ME.createdAt,{year:'numeric',month:'long',day:'numeric'}):'';
 return `<div class="card"><div class="row"><div><b>${esc(ME.username)}</b><div class="mut">Member since ${since}</div></div><span class="sp"></span><button class="b" data-act="logout">Sign out</button></div>
 <p class="mut">${window.desktop&&!SRV?'Your data is saved in a database on this computer.':'Your data is saved to your account on the server, so it follows you to any device where you sign in.'}</p>${srvBlock()}</div>
 <div class="card"><b>Change password</b>
 <div class="row" style="margin-top:8px"><input type="password" id="pwCur" placeholder="Current password" autocomplete="current-password"><input type="password" id="pwNew" placeholder="New password (8+ characters)" autocomplete="new-password"><button class="b p" data-act="chgPw">Update</button></div>
 <div class="mut" id="pwMsg"></div></div>
 <div class="card"><b>Backup</b><p class="mut">Download or copy your topics, sessions and tasks. Paste a backup (including one from the old single-file Study Desk) and restore it to replace your current data.</p>
 <textarea id="bk" rows="6" aria-label="Backup data">${esc(JSON.stringify(S))}</textarea>
 <div class="row"><button class="b p" data-act="dlData">Download</button><button class="b" data-act="copyData">Copy</button><button class="b" data-act="restore">Restore from text</button><span class="mut" id="bkmsg"></span></div></div>
 <div class="card"><b>Delete account</b><p class="mut">Permanently removes your account and all of its data.</p>
 <div class="row"><input type="password" id="delPw" placeholder="Password" autocomplete="current-password"><button class="b" data-act="delAcct">${delArm?'Click again to delete forever':'Delete account'}</button></div><div class="err" id="delMsg"></div></div>`}
function dlData(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{type:'application/json'}));a.download='study-desk-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
async function chgPw(){const c=$('#pwCur').value,n=$('#pwNew').value,m=$('#pwMsg');
 if(n.length<8){m.textContent='New password must be at least 8 characters.';return}
 try{const r=await api('POST','/api/password',{current:c,next:n});m.textContent=r.ok?'Password updated. Other devices were signed out.':r.data.error||'Could not update the password.';if(r.ok){$('#pwCur').value='';$('#pwNew').value=''}}catch(e){m.textContent='Cannot reach the server.'}}
async function delAcct(){const p=$('#delPw').value,m=$('#delMsg');if(!p){m.textContent='Enter your password.';return}
 if(!delArm){delArm=true;render();$('#delPw').value=p;return}delArm=false;
 try{const r=await api('DELETE','/api/account',{password:p});if(r.ok){dirty=false;signedOut('Your account was deleted.')}else{render();$('#delMsg').textContent=r.data.error||'Could not delete the account.'}}catch(e){m.textContent='Cannot reach the server.'}}
async function logout(){await push();try{await api('POST','/api/logout',{})}catch(e){}signedOut('')}
async function srvSet(local){const e=$('#srvErr')||$('#aerr');let u=null;
 if(!local){u=($('#srvIn').value||'').trim();if(!/^https?:\/\//i.test(u))u='https://'+u;
  try{u=new URL(u).origin}catch(x){if(e)e.textContent='That is not a valid address.';return}}
 if(ME)await push();
 try{await window.desktop.setServer(u)}catch(x){if(e)e.textContent=String(x.message||x)}}
function copyData(){const t=$('#bk');t.select();let ok=false;
 try{navigator.clipboard.writeText(t.value);ok=true}catch(e){try{ok=document.execCommand('copy')}catch(e2){}}
 $('#bkmsg').textContent=ok?'Copied.':'Select the text and copy it manually.'}
function restore(){try{const o=JSON.parse($('#bk').value);if(!Array.isArray(o.topics)||!Array.isArray(o.log))throw 0;
 if(!rArm){rArm=true;$('#bkmsg').textContent='Click Restore from text again to replace all current data.';return}rArm=false;
 S=Object.assign({topics:[],log:[],run:null,todos:[],notified:{},pomo:S.pomo},o);ensureIds();save();render();msg('Backup restored.')}catch(e){$('#bkmsg').textContent='That text is not a valid backup.'}}
const views={tasks:vTasks,pomo:vPomo,matrix:vMatrix,todo:vTodo,stats:vStats,data:vAccount};
const names={tasks:'Topics',pomo:'Pomodoro',matrix:'Matrix',todo:'To-do',stats:'Stats',data:'Account'};

// ---- sign in / create account
let authMode='login',authMsg='',canSignup=true;
function vAuth(){const reg=authMode==='register';
 return `<div class="authc"><div class="brand"><svg class="mark" aria-hidden="true"><use href="#logo"/></svg><h1>Study Desk</h1><div class="sub">Track study time, run pomodoros and plan your tasks.</div></div>
 <div class="card">${canSignup?`<div class="seg" style="margin-bottom:14px"><button type="button" class="${reg?'':'on'}" data-act="aMode" data-m="login">Sign in</button><button type="button" class="${reg?'on':''}" data-act="aMode" data-m="register">Create account</button></div>`:''}
 <form id="af" autocomplete="on"><label class="fl">Username<input type="text" name="username" id="aUser" autocomplete="username" required minlength="3" maxlength="32" autocapitalize="none" spellcheck="false"></label>
 <label class="fl">Password<input type="password" name="password" id="aPass" autocomplete="${reg?'new-password':'current-password'}" required ${reg?'minlength="8"':''}></label>
 ${reg?'<label class="fl">Confirm password<input type="password" id="aPass2" autocomplete="new-password" required></label><div class="mut">Usernames use letters, numbers, dots, dashes or underscores. Passwords need at least 8 characters.</div>':''}
 <div class="err" id="aerr">${esc(authMsg)}</div>
 <button class="b p" type="submit" style="width:100%;margin-top:10px">${reg?'Create account':'Sign in'}</button></form>${srvBlock()}</div></div>`}
function showAuth(m){
 if(m!==undefined)authMsg=m;$('#appv').hidden=true;const a=$('#auth');a.hidden=false;a.innerHTML=vAuth();document.title='Study Desk';
 const u=$('#aUser');if(u)u.focus()}
async function submitAuth(){const u=$('#aUser').value.trim(),p=$('#aPass').value,reg=authMode==='register',err=$('#aerr');
 if(reg&&p!==$('#aPass2').value){err.textContent='Passwords do not match.';return}
 const btn=$('#af button[type=submit]');btn.disabled=true;err.textContent='';
 try{const r=await api('POST',reg?'/api/register':'/api/login',{username:u,password:p});
  if(r.ok){authMsg='';await enter(r.data.user)}else{err.textContent=r.data.error||'Something went wrong.';btn.disabled=false}}
 catch(e){err.textContent='Cannot reach the server. Check your connection and try again.';btn.disabled=false}}
async function enter(user){
 const r=await api('GET','/api/state');if(!r.ok){showAuth(r.data.error||'Could not load your data.');return}
 ME=user;adopt(r.data.state);REV=r.data.rev;dirty=false;tab='tasks';edit=null;
 $('#auth').hidden=true;$('#appv').hidden=false;$('#who').innerHTML='<span class="av">'+esc(ME.username[0])+'</span>'+esc(ME.username);render();startTicking()}
function signedOut(m){
 ME=null;clearTimeout(syncT);dirty=false;clearAlert();if(pw&&!pw.closed)try{pw.close()}catch(e){}pw=null;
 S=blank();REV=0;delArm=false;srvForm=false;$('#main').innerHTML='';msg('');setSync('');showAuth(m)}
async function boot(){
 if(window.desktop)try{SRV=await window.desktop.getServer()}catch(e){}
 const q=new URLSearchParams(location.search).get('serverError');if(q){authMsg='Could not reach '+q+'. Switched back to this computer.';history.replaceState(null,'',location.pathname)}
 try{const c=await api('GET','/api/config');canSignup=c.data.allowSignup!==false;const r=await api('GET','/api/me');if(r.ok)return enter(r.data.user)}
 catch(e){return showAuth('Cannot reach the server. Check your connection and try again.')}
 showAuth()}

function render(){
 if(!ME)return;
 $('#date').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
 $('#nav').innerHTML=Object.keys(names).map(k=>`<button class="${k===tab?'on':''}" data-tab="${k}">${names[k]}</button>`).join('');
 $('#main').innerHTML=views[tab]();
 const g='Notification' in window&&Notification.permission==='granted';$('#nb').innerHTML=g?I('bell-on')+'Alerts on':I('bell')+'Enable alerts'}

function tick(){
 if(!ME)return;
 const now=Date.now(),p=S.pomo;
 checkGoals();
 const dn=dayStart(now);if(dn!==lastDay){if(stat.a===lastDay)stat.a=dn;lastDay=dn;if(tab==='stats')render()}
 if(p.phase==='focus'&&!S.run&&!p.paused){p.phase='idle';save();render()}
 else if(p.phase==='focus'&&!p.paused&&now>=p.end){stopRun();p.count=(p.day===new Date().toDateString()?p.count:0)+1;p.day=new Date().toDateString();p.phase='breakwait';notify('Focus session done','Nice work. Start your '+p.brk+' minute break when you are ready.','focus');save();render()}
 else if(p.phase==='break'&&!p.paused&&now>=p.end){p.phase='idle';notify('Break is over','Ready for the next focus session?','break');save();render()}
 if(tab==='stats'){if(!edit&&(S.run||stat.m==='time')&&(++statN)%(S.run?5:30)===0)render();updatePop();return}
 const [a,b]=today();let tot=0,goal=0;
 S.topics.forEach(t=>{const ms=spent(t.id,a,b),pc=Math.min(100,ms/(t.goal*6e4)*100);tot+=Math.min(ms,t.goal*6e4);goal+=t.goal*6e4;
  const e=document.querySelector(`[data-t="${t.id}"]`);if(e)e.textContent=fmt(ms);
  const br=document.querySelector(`[data-bar="${t.id}"]`);if(br)br.style.width=pc+'%';
  const pt=document.querySelector(`[data-pct="${t.id}"]`);if(pt)pt.textContent=Math.round(pc)+'% of '+t.goal+' min'+(pc>=100?' · goal reached':'')});
 const al=$('[data-all]');if(al){al.textContent=hm(tot)+' of '+hm(goal);$('[data-allbar]').style.width=(goal?tot/goal*100:0)+'%'}
 updatePop();
 const c=$('[data-clock]');if(c&&(p.phase==='focus'||p.phase==='break'))c.textContent=fmt(p.paused?p.left:Math.max(0,p.end-now));
 if(!fTimer)document.title=S.run?(topic(S.run.t)?.name||'')+' · Study Desk':'Study Desk'}

function addTodo(text,q){text=text.trim();if(!text)return;S.todos.push({id:uid(),text,q:+q,done:false});save();render()}
function addTopic(){const n=$('#tn').value.trim();if(!n)return;const g=Math.max(5,+$('#tg').value||60);
 S.topics.push({id:uid(),name:n,goal:g,color:COL[S.topics.length%COL.length]});if(!S.pomo.topic)S.pomo.topic=S.topics[0].id;save();render()}

document.addEventListener('click',e=>{
 getCtx();
 const tb=e.target.closest('[data-tab]');if(tb){edit=null;tab=tb.dataset.tab;if(tab==='stats')stat.a=dayStart(Date.now());render();return}
 const el=e.target.closest('[data-act]');if(!el||el.tagName==='SELECT'||el.tagName==='INPUT')return;
 const id=el.dataset.id,act=el.dataset.act;
 if(act==='aMode'){authMode=el.dataset.m;authMsg='';return showAuth()}
 if(act==='srvShow'){srvForm=!srvForm;return ME?render():showAuth()}
 if(act==='srvSet')return srvSet(false);
 if(act==='srvLocal')return srvSet(true);
 if(!ME)return;
 if(act==='logout')return logout();
 if(act==='chgPw')return chgPw();
 if(act==='delAcct')return delAcct();
 if(act==='dlData')return dlData();
 if(act==='addTopic')return addTopic();
 if(['sv','sp','st','goDay','goMonth'].includes(act))edit=null;
 if(act==='addS')return addS();
 if(act==='editS')return editS(id);
 if(act==='cancelS'){edit=null;return render()}
 if(act==='saveS')return saveS();
 if(act==='delS')return delS();
 if(act==='sc'){stat.c=el.dataset.c;return render()}
 if(act==='sv'){const [rs,re]=range(),t0=dayStart(Date.now());if(t0>=rs&&t0<re)stat.a=t0;stat.v=el.dataset.v;return render()}
 if(act==='sm'){stat.m=el.dataset.m;return render()}
 if(act==='sp'){shift(+el.dataset.n);return render()}
 if(act==='st'){stat.a=dayStart(Date.now());return render()}
 if(act==='goDay'){stat.a=+el.dataset.d;stat.v='day';return render()}
 if(act==='goMonth'){stat.a=+el.dataset.d;stat.v='month';return render()}
 if(act==='popout')return popout();if(act==='notify')return askNotify();if(act==='copyData')return copyData();if(act==='restore')return restore();
 if(act==='start'){stopAll();startRun(id)}
 if(act==='stop')stopAll();
 if(act==='pause')pauseAll();
 if(act==='resume')resumeAll();
 if(act==='delTopic'){if(S.run&&S.run.t===id)stopRun();if(S.pause&&S.pause.t===id)S.pause=null;S.topics=S.topics.filter(t=>t.id!==id);S.log=S.log.filter(l=>l.t!==id)}
 if(act==='pStart'){try{if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().then(render)}catch(e){}
 const t=S.pomo.topic||S.topics[0]?.id;if(!t)return;S.pomo.topic=t;S.pomo.paused=false;S.pomo.phase='focus';S.pomo.end=Date.now()+S.pomo.focus*6e4;startRun(t)}
 if(act==='pStop')stopAll();
 if(act==='bStart')startBreak();
 if(act==='bSkip')skipBreak();
 if(act==='addTodo'){addTodo($('#todoIn').value,$('#todoQ').value);return}
 if(act==='delTodo')S.todos=S.todos.filter(t=>t.id!==id);
 if(act==='clearDone')S.todos=S.todos.filter(t=>!t.done);
 save();render()});
document.addEventListener('change',e=>{
 if(!ME)return;
 const el=e.target.closest('[data-act]');if(!el)return;const act=el.dataset.act,id=el.dataset.id,t=S.todos.find(x=>x.id===id);
 if(act==='toggle'&&t)t.done=el.checked;
 if(act==='move'&&t)t.q=+el.value;
 if(act==='pTopic')S.pomo.topic=el.value;
 if(act==='pFocus')S.pomo.focus=Math.max(1,+el.value||25);
 if(act==='pBrk')S.pomo.brk=Math.max(1,+el.value||5);
 save();render()});
document.addEventListener('submit',e=>{if(e.target.id==='af'){e.preventDefault();submitAuth()}});
document.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&e.target.id==='srvIn'){srvSet(false);return}
 if(e.key==='Enter'&&e.target.id==='pwNew'){chgPw();return}
 if(e.key!=='Enter'||!e.target.dataset.add||!ME)return;const k=e.target.dataset.add;
 if(k==='topic')addTopic();
 if(k==='todo')addTodo(e.target.value,$('#todoQ').value);
 if(k==='q')addTodo(e.target.value,e.target.dataset.q)});
let ticking=false;
function startTicking(){if(ticking)return;ticking=true;
 let tk=false;const fb=()=>{if(!tk){tk=true;setInterval(tick,1000)}};
 try{const w=new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000)'],{type:'text/javascript'})));w.onmessage=tick;w.onerror=fb}catch(e){fb()}
 document.addEventListener('visibilitychange',()=>{tick();if(document.visibilityState==='visible')pull()});
 window.addEventListener('focus',pull);setInterval(pull,20000)}
boot();
