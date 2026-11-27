import {loadWorkspace,assembleModels,githubProject} from "./projects.mjs";
import {simulator} from "./simulator.mjs";
import {readConfig} from "./config.mjs";
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const workspace=loadWorkspace(localStorage);
const project=()=>workspace.projects[workspace.active];
const file=()=>project().files[project().active];
function persist(){
  try {
    localStorage.setItem("tla-projects-1",JSON.stringify(workspace));
    $("storageNotice").hidden=true;
  } catch {
    $("storageNotice").textContent="Browser storage is full or unavailable. This session’s changes could not be saved.";
    $("storageNotice").hidden=false;
  }
}
function setView(graph){
  $("runnerView").setAttribute("aria-pressed",String(!graph));
  $("graphView").setAttribute("aria-pressed",String(graph));
  $("simulator").hidden=graph;$("graphPane").hidden=!graph;
  if(graph && result?.states) drawGraph();
  if(!graph && result?.states) $("graphcount").textContent=result.states.length+" states";
}
$("runnerView").onclick=()=>setView(false);
$("graphView").onclick=()=>setView(true);
function modelOptions(){
  const model=file();
  const config=model.configText===undefined?{}:readConfig(model.configText);
  return {...model,...config};
}
const simWorkers=new Set();
const runner=simulator($("simulator"),input=>{
  const options=modelOptions();
  return new Promise(resolve=>{
    const w=new Worker("./worker.js");
    const finish=data=>{clearTimeout(timeout);simWorkers.delete(cancel);w.terminate();resolve(data)};
    const cancel=()=>finish({error:"Run superseded."});
    const timeout=setTimeout(()=>finish({error:"Transition timed out."}),15000);
    simWorkers.add(cancel);
    w.onmessage=event=>finish(event.data);w.onerror=event=>finish({error:event.message||"Checker failed."});
    w.postMessage({...options,...input});
  });
});
let worker, timer, result, selected = 0;
const visitedPath=[];
function stop() {clearTimeout(timer);worker?.terminate();worker=null;$("run").disabled=false}
function invalidate() {
  runner.clear("Run the model to try a transition.");for(const cancel of simWorkers)cancel();
  stop();result=null;visitedPath.length=0;$("steps").hidden=true;$("summary").textContent="Run the model to check this specification.";
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
  project().active=i;persist();invalidate();setView(false);
  $("projectList").replaceChildren(...workspace.projects.map((p,j)=>new Option(p.name,String(j))));
  $("projectList").value=String(workspace.active);
  $("projectCrumb").textContent=project().name;
  $("files").replaceChildren(...project().files.map((f,j)=>{const b=document.createElement("button");b.textContent=f.name+".tla";b.className=i===j?"active":"";b.onclick=()=>openFile(j);return b}));
  $("source").value=file().source;$("filename").textContent=file().name+".tla";paint();run();
}
$("source").oninput=()=>{file().source=$("source").value;persist();paint();invalidate()};
$("source").onscroll=syncScroll;$("source").onselect=position;$("source").onkeyup=position;$("source").onclick=position;
function run(){
  invalidate();runner.start();$("summary").textContent="Checking reachable states…";$("run").disabled=true;
  const start=performance.now();worker=new Worker("./worker.js");
  const finish=data=>{stop();result=data;selected=data.trace?.at(-1)??0;renderResult(performance.now()-start)};
  worker.onmessage=e=>finish(e.data);worker.onerror=e=>finish({status:"error",error:e.message||"The checker could not start."});
  timer=setTimeout(()=>finish({status:"limited",error:"Execution time limit reached."}),15000);
  try {
    worker.postMessage(modelOptions());
  } catch (error) {
    finish({status:"error", error:error.message});
  }
}
$("run").onclick=run;document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"&&!$("dialog").open){e.preventDefault();run()}});
function renderResult(ms){
  const r=result,titles={passed:r.invariant?"Invariant holds":"Exploration complete",deadlock:"Deadlock found",violated:"Invariant violated",limited:"Check incomplete",error:"Specification error"};
  const detail=r.error??(r.status==="passed"?(r.invariant?r.invariant+" holds in every reachable state.":"Explored all reachable states. No invariant selected."):r.status==="limited"?"The state limit stopped exploration.":r.status==="deadlock"?"No action is enabled in the final trace state.":"A reachable state violates "+r.invariant+".");
  const metrics=r.states?[["States",r.states.length],["Transitions",r.edges.length],["Elapsed",Math.round(ms)+" ms"]]:[];
  $("summary").innerHTML='<div class="status"><span class="stamp '+(r.status==="passed"?"":"bad")+'">'+(r.status==="passed"?"✓":"!")+'</span><div><strong>'+titles[r.status]+'</strong><small>'+escape(detail)+'</small></div></div>'+metrics.map(([label,value])=>'<div class="metric"><small>'+label+'</small><b>'+value+'</b></div>').join("");
  if(!r.states){$("canvas").textContent="No state graph available.";$("graphcount").textContent="—";return}
  if(!$("graphPane").hidden) drawGraph();else $("graphcount").textContent=r.states.length+" states";
  if(r.trace.length){$("trace").append("Counterexample ");for(const id of r.trace){const b=document.createElement("button");b.textContent="S"+id;b.onclick=()=>{setView(true);selectState(id)};$("trace").append(b)}}
}
function selectState(i){visitedPath.length=0;selected=i;drawGraph()}
$("stepState").onclick=()=>{
  visitedPath.push(selected);
  selected=Number($("successors").value);
  drawGraph();
};
$("backState").onclick=()=>{
  if(visitedPath.length){selected=visitedPath.pop();drawGraph()}
};
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
  $("inspector").innerHTML='<b>S'+selected+'</b> '+escape(variables.map((v,i)=>v+" = "+JSON.stringify(states[selected][i])).join(", "))+(selected<result.initial_count?" · Initial state":"");
  const options=edges.filter(([from])=>from===selected).map(([,to,action])=>new Option(action+" → S"+to,String(to)));
  $("steps").hidden=false;
  $("backState").disabled=!visitedPath.length;
  $("stepState").disabled=!options.length;
  $("successors").disabled=!options.length;
  $("successors").replaceChildren(...(options.length?options:[new Option("No recorded transition","")]));

}
function dialog(html){$("dialogbody").innerHTML=html;$("dialog").showModal()}
function downloadText(name, text) {
  const link=document.createElement("a");
  link.href=URL.createObjectURL(new Blob([text],{type:"text/plain"}));
  link.download=name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
$("settings").onclick=()=>{
  const model=file();
  const raw=model.configText!==undefined;
  const fields=raw
    ? '<label>Configuration file<textarea id="cfgText" rows="10" spellcheck="false"></textarea></label><button id="saveCfg" type="button">Download .cfg</button>'
    : '<label>Invariant name (optional)<input id="inv" pattern="[A-Za-z][A-Za-z0-9_]*"></label><label><input id="deadlock" type="checkbox" style="width:auto"> Check deadlocks</label>';
  dialog('<h2>Model configuration</h2><form id="config">'+fields+'<label>State limit<input id="limit" type="number" min="1" max="10000" required></label><button class="primary">Apply and run</button></form>');
  if(raw){
    $("cfgText").value=model.configText;
    $("saveCfg").onclick=()=>downloadText(model.name+".cfg",$("cfgText").value);
  } else {
    $("deadlock").checked=!!model.deadlock;
    $("inv").value=model.invariant??result?.invariant??"";
  }
  $("limit").value=model.limit;
  $("config").onsubmit=e=>{
    e.preventDefault();
    if(raw) model.configText=$("cfgText").value;
    else {
      model.deadlock=$("deadlock").checked;
      model.invariant=$("inv").value;
    }
    model.limit=+$("limit").value;
    persist();$("dialog").close();run();
  };
};
$("guide").onclick=()=>dialog('<h2>Quick reference</h2><p>This checker explores a finite-state subset of TLA+. Use it to check safety invariants.</p><p>Declare variables with <code>VARIABLE</code> or <code>VARIABLES</code>. In <code>Init</code>, assign an integer, string, or Boolean value to each variable.</p><p>Define each action with guards and one primed assignment per variable. Use <code>x&#39; = x</code> to keep a value. Join named actions in <code>Next</code> with <code>\\\\/</code>.</p><p>Use a primed membership constraint such as <code>i&#39; &#92;in 0..10</code> for integer choices. Import a .tla file together with its matching .cfg to use its model settings. Use integer arithmetic, comparisons, parentheses, conjunction and disjunction. Choose the invariant and state limit in Configuration.</p><p>In the Seat reservations project, open <b>SadPath.tla</b> and reserve 4 seats to see a safety violation. Edits are saved in this browser.</p>'.replace("x\\'","x'"));
function blankModel(name){
  return {name,limit:10000,source:["---- MODULE "+name+" ----","EXTENDS Integers","VARIABLE count","Init == count = 0","Next == count' = count","Safety == count = 0","====",""].join("\n")};
}
function addProject(p){
  const base=p.name;
  for(let n=2;workspace.projects.some(other=>other.name===p.name);n++)p.name=base+" ("+n+")";
  workspace.active=workspace.projects.push(p)-1;openFile(p.active);
}
$("projectList").onchange=e=>{workspace.active=Number(e.target.value);openFile(project().active)};
function createItem(isProject){
  const kind=isProject?"project":"model";
  dialog('<h2>New '+kind+'</h2><form id="create"><label>Name<input id="itemName" required autofocus></label><button class="primary">Create '+kind+'</button></form>');
  if(!isProject)$("itemName").pattern="[A-Za-z][A-Za-z0-9_]*";
  $("create").onsubmit=e=>{
    e.preventDefault();
    const name=$("itemName").value.trim();
    if(!name)return;
    if(!isProject && project().files.some(f=>f.name===name)){
      $("itemName").setCustomValidity("A model with this name already exists.");
      $("itemName").reportValidity();$("itemName").oninput=()=>$("itemName").setCustomValidity("");return;
    }
    $("dialog").close();
    if(isProject)addProject({name,active:0,files:[blankModel("Main")]});
    else openFile(project().files.push(blankModel(name))-1);
  };
}
$("newProject").onclick=()=>createItem(true);
$("new").onclick=()=>createItem(false);
$("upload").onchange=async e=>{
  const files=Array.from(e.target.files);e.target.value="";
  if(!files.length)return;
  const target=project();
  try{
    const entries=await Promise.all(files.map(async f=>({path:f.name,text:await f.text()})));
    for(const entry of entries.filter(e=>/\.cfg$/i.test(e.path))){
      if(!entries.some(e=>/\.tla$/i.test(e.path)&&e.path.slice(0,-4)===entry.path.slice(0,-4)))
        throw Error("Select the matching .tla file for "+entry.path+".");
    }
    const models=assembleModels(entries);
    if(models.some(m=>target.files.some(f=>f.name===m.name)))throw Error("A model with this name already exists in this project.");
    const first=target.files.length;target.files.push(...models);
    if(project()===target)openFile(first);else persist();
  }catch(err){dialog("<h2>Import error</h2><p>"+escape(err.message)+"</p>")}
};
$("github").onclick=()=>{
  dialog('<h2>Import GitHub project</h2><form id="repoForm"><label>Public repository URL<input id="repoURL" type="url" required placeholder="https://github.com/owner/repo" autofocus></label><p>Import models and matching configurations from the repository’s top-level <code>/tla</code> directory.</p><button class="primary">Import project</button><p id="repoStatus" aria-live="polite"></p></form>');
  const controller=new AbortController();
  $("dialog").addEventListener("close",()=>controller.abort(),{once:true});
  $("repoForm").onsubmit=async e=>{
    e.preventDefault();const submit=e.target.querySelector("button");
    submit.disabled=true;$("repoStatus").textContent="Reading repository…";
    try{
      const imported=await githubProject($("repoURL").value,controller.signal);
      if(!controller.signal.aborted){$("dialog").close();addProject(imported)}
    }catch(err){if(!controller.signal.aborted)$("repoStatus").textContent=err.message}
    finally{submit.disabled=false}
  };
};
$("download").onclick=()=>downloadText(file().name+".tla",file().source);
openFile(project().active);
