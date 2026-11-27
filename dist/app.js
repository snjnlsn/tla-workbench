import {readConfig} from "./config.mjs";
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const moduleText = (name, body) => "---- MODULE " + name + " ----\nEXTENDS Integers\n\n" + body + "\n====\n";
const counter = moduleText("Counter", "VARIABLE count\n\nInit == count = 0\n\nIncrement == /\\ count < 4\n             /\\ count' = count + 1\n\nReset == /\\ count = 4\n         /\\ count' = 0\n\nNext == Increment \\/ Reset\n\nSafety == count >= 0 /\\ count <= 4");
const toggle = moduleText("Toggle", "VARIABLE bit\n\nInit == bit = 0\n\nFlip == bit' = 1 - bit\n\nNext == Flip\n\nSafety == bit = 0 \\/ bit = 1");
const overflow = counter.replace("MODULE Counter","MODULE Overflow").replace("count < 4","count < 5");
const defaults = {files:[["Counter",counter],["Toggle",toggle],["Overflow",overflow]].map(([name,source])=>({name,source,invariant:"Safety",limit:1000})),active:0};
let workspace;
try { workspace = JSON.parse(localStorage.getItem("tla-workbench-1")); } catch {}
if (!workspace?.files?.[workspace.active]) workspace = defaults;
const file = () => workspace.files[workspace.active];
function persist() { try { localStorage.setItem("tla-workbench-1",JSON.stringify(workspace)); } catch {} }
let worker, timer, result, selected = 0;
function stop() {clearTimeout(timer);worker?.terminate();worker=null;$("run").disabled=false}
function invalidate() {
  stop();result=null;$("summary").textContent="Run the model to check this specification.";
  $("graphcount").textContent="Ready";$("canvas").textContent="Run the model to explore its states.";
  $("inspector").textContent="State inspector";$("trace").replaceChildren();
}
function paint() {
  const source=$("source");
  $("numbers").textContent=source.value.split("\n").map((_,i)=>i+1).join("\n");
  const tokens=/\\\*[^\n]*|\b(?:MODULE|EXTENDS|VARIABLES?|Integers|Naturals|TRUE|FALSE)\b|\b\d+\b|\b[A-Za-z]\w*(?=\s*==)/g;
  let html="",end=0;
  for(const m of source.value.matchAll(tokens)){
    const cls=m[0].startsWith("\\*")?"comment":/^\d/.test(m[0])?"num":/^\s*==/.test(source.value.slice(m.index+m[0].length))?"def":"kw";
    html+=escape(source.value.slice(end,m.index))+'<span class="'+cls+'">'+escape(m[0])+'</span>';end=m.index+m[0].length;
  }
  $("paint").innerHTML=html+escape(source.value.slice(end))+"\n";
  syncScroll();position();
}
function syncScroll(){ $("paint").scrollTop=$("numbers").scrollTop=$("source").scrollTop;$("paint").scrollLeft=$("source").scrollLeft; }
function position(){const lines=$("source").value.slice(0,$("source").selectionStart).split("\n");$("position").textContent="Ln "+lines.length+" · Col "+(lines.at(-1).length+1)}
function openFile(i){
  workspace.active=i;persist();invalidate();
  $("files").replaceChildren(...workspace.files.map((f,j)=>{const b=document.createElement("button");b.textContent=f.name+".tla";b.className=i===j?"active":"";b.onclick=()=>openFile(j);return b}));
  $("source").value=file().source;$("filename").textContent=file().name+".tla";paint();run();
}
$("source").oninput=()=>{file().source=$("source").value;persist();paint();invalidate()};
$("source").onscroll=syncScroll;$("source").onselect=position;$("source").onkeyup=position;$("source").onclick=position;
function run(){
  stop();invalidate();$("summary").textContent="Checking reachable states…";$("run").disabled=true;
  const start=performance.now();worker=new Worker("./worker.js");
  const finish=data=>{stop();result=data;selected=data.trace?.at(-1)??0;renderResult(performance.now()-start)};
  worker.onmessage=e=>finish(e.data);worker.onerror=e=>finish({status:"error",error:e.message||"The checker could not start."});
  timer=setTimeout(()=>finish({status:"limited",error:"Execution time limit reached."}),15000);
  worker.postMessage(file());
}
$("run").onclick=run;document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"&&!$("dialog").open){e.preventDefault();run()}});
function renderResult(ms){
  const r=result,titles={passed:r.invariant?"Invariant holds":"Exploration complete",deadlock:"Deadlock found",violated:"Invariant violated",limited:"Check incomplete",error:"Specification error"};
  const detail=r.error??(r.status==="passed"?(r.invariant?r.invariant+" holds in every reachable state.":"Explored all reachable states. No invariant selected."):r.status==="limited"?"The state limit stopped exploration.":r.status==="deadlock"?"No action is enabled in the final trace state.":"A reachable state violates "+r.invariant+".");
  const metrics=r.states?[["States",r.states.length],["Transitions",r.edges.length],["Elapsed",Math.round(ms)+" ms"]]:[];
  $("summary").innerHTML='<div class="status"><span class="stamp '+(r.status==="passed"?"":"bad")+'">'+(r.status==="passed"?"✓":"!")+'</span><div><strong>'+titles[r.status]+'</strong><small>'+escape(detail)+'</small></div></div>'+metrics.map(([label,value])=>'<div class="metric"><small>'+label+'</small><b>'+value+'</b></div>').join("");
  if(!r.states){$("canvas").textContent="No state graph available.";$("graphcount").textContent="—";return}
  drawGraph();
  if(r.trace.length){$("trace").append("Counterexample ");for(const id of r.trace){const b=document.createElement("button");b.textContent="S"+id;b.onclick=()=>selectState(id);$("trace").append(b)}}
}
function selectState(i){selected=i;drawGraph()}
function drawGraph(){
  const {states,edges,variables,trace}=result,total=states.length;
  const ids=Array.from({length:Math.min(total,12)},(_,i)=>i);
  if(selected>=12)ids[11]=selected;
  const points=new Map(ids.map((id,i)=>{const a=2*Math.PI*i/ids.length-Math.PI/2;return [id,ids.length===1?[150,142]:[150+95*Math.cos(a),142+96*Math.sin(a)]]}));
  $("graphcount").textContent=(total>12?"12 / ":"")+total+" states";
  let svg='<svg viewBox="0 0 300 284" aria-label="Reachable state graph"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="#709986"/></marker></defs>';
  const visible=edges.filter(([i,j])=>points.has(i)&&points.has(j));
  for(const [i,j,name] of visible){const [x,y]=points.get(i),[u,v]=points.get(j);let path;
    if(i===j)path='M '+(x-12)+' '+(y-14)+' c -32 -42 56 -42 27 0';
    else{const dx=u-x,dy=v-y,d=Math.hypot(dx,dy),bend=visible.some(([a,b])=>a===j&&b===i)?19:0;
      const cx=(x+u)/2-dy/d*bend,cy=(y+v)/2+dx/d*bend;
      const angle=Math.atan2(v-cy,u-cx);
      path='M '+x+' '+y+' Q '+cx+' '+cy+' '+(u-23*Math.cos(angle))+' '+(v-23*Math.sin(angle));}
    svg+='<path d="'+path+'" fill="none" stroke="#709986" stroke-width="1.6" marker-end="url(#arrow)"><title>'+escape(name)+'</title></path>';
  }
  for(const id of ids){const [x,y]=points.get(id),active=id===selected,bad=id===trace.at(-1);
    svg+='<g class="node" data-id="'+id+'" role="button" tabindex="0" aria-label="Inspect state '+id+'"><circle cx="'+x+'" cy="'+y+'" r="20" fill="'+(bad?"#ffdacc":active?"#a9dec1":"#e8f2e7")+'" stroke="'+(bad?"#a35238":"#4b886a")+'" stroke-width="'+(active?3:1.5)+'"/><text x="'+x+'" y="'+(y+5)+'" text-anchor="middle">S'+id+'</text></g>';
  }
  $("canvas").innerHTML=svg+"</svg>";
  for(const node of $("canvas").querySelectorAll(".node")){node.onclick=()=>selectState(+node.dataset.id);node.onkeydown=e=>{if(["Enter"," "].includes(e.key)){e.preventDefault();node.click();$("canvas").querySelector('[data-id="'+selected+'"]').focus()}}}
  $("inspector").innerHTML='<b>S'+selected+'</b> '+escape(variables.map((v,i)=>v+" = "+JSON.stringify(states[selected][i])).join(", "))+(selected===0?" · Initial state":"");
}
function dialog(html){$("dialogbody").innerHTML=html;$("dialog").showModal()}
$("settings").onclick=()=>{
  dialog('<h2>Model configuration</h2><form id="config"><label>Invariant name (optional)<input id="inv" pattern="[A-Za-z][A-Za-z0-9_]*"></label><label>State limit<input id="limit" type="number" min="1" max="10000" required></label><label><input id="deadlock" type="checkbox" style="width:auto"> Check deadlocks</label><button class="primary">Apply and run</button></form>');
  $("deadlock").checked=!!file().deadlock;$("inv").value=file().invariant??result?.invariant??"";$("limit").value=file().limit;$("config").onsubmit=e=>{e.preventDefault();file().deadlock=$("deadlock").checked;file().invariant=$("inv").value;file().limit=+$("limit").value;persist();$("dialog").close();run()};
};
$("guide").onclick=()=>dialog('<h2>Quick reference</h2><p>This checker explores a finite-state subset of TLA+. Use it to check safety invariants.</p><p>Declare variables with <code>VARIABLE</code> or <code>VARIABLES</code>. In <code>Init</code>, assign an integer, string, or Boolean value to each variable.</p><p>Define each action with guards and one primed assignment per variable. Use <code>x&#39; = x</code> to keep a value. Join named actions in <code>Next</code> with <code>\\\\/</code>.</p><p>Use a primed membership constraint such as <code>i&#39; &#92;in 0..10</code> for integer choices. Import a .tla file together with its matching .cfg to use its model settings. Use integer arithmetic, comparisons, parentheses, conjunction and disjunction. Choose the invariant and state limit in Configuration.</p><p>Open <b>Overflow.tla</b> to inspect a failing trace. Edits are saved in this browser.</p>'.replace("x\\'","x'"));
function addFile(name,source,settings={}){workspace.files.push({name,source,limit:10000,...settings});openFile(workspace.files.length-1)}
$("new").onclick=()=>{dialog('<h2>New specification</h2><form id="create"><label>Module name<input id="name" required pattern="[A-Za-z][A-Za-z0-9_]*" autofocus></label><button class="primary">Create specification</button></form>');$("create").onsubmit=e=>{e.preventDefault();const name=$("name").value;$("dialog").close();addFile(name,counter.replace("MODULE Counter","MODULE "+name))}};
$("upload").onchange=async event=>{
  const files=Array.from(event.target.files);
  event.target.value="";
  if(!files.length)return;
  try {
    const spec=files.find(f=>/\.tla$/i.test(f.name));
    const config=files.find(f=>/\.cfg$/i.test(f.name));
    if(!spec || files.length!==1+Number(!!config))throw Error("Select one .tla file and optionally its matching .cfg file.");
    const name=spec.name.replace(/\.tla$/i,"");
    if(config && config.name.replace(/\.cfg$/i,"")!==name)throw Error("Select a configuration with the same base name as the module.");
    addFile(name,await spec.text(),config?readConfig(await config.text()):{});
  } catch(error){dialog("<h2>Import error</h2><p>"+escape(error.message)+"</p>")}
};
$("download").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([file().source],{type:"text/plain"}));a.download=file().name+".tla";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
openFile(workspace.active);
