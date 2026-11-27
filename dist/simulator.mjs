// Keep exact TLA literals across the worker boundary, including 64-bit integers.
function proposalField(literal) {
  if(literal.startsWith('"')){
    const box=document.createElement('textarea');
    box.rows=1;box.value=JSON.parse(literal);
    box.spellcheck=false;box.autocomplete='off';
    return {box,read:()=>JSON.stringify(box.value)};
  }
  if(literal==='TRUE' || literal==='FALSE'){
    const box=document.createElement('select');
    box.add(new Option('TRUE'));box.add(new Option('FALSE'));
    box.value=literal;
    return {box,read:()=>box.value};
  }
  const box=document.createElement('input');
  box.type='number';box.step='1';box.required=true;box.value=literal;
  return {box,read:()=>box.value};
}

export function simulator(container, request) {
  let view, history=[], generation=0, selection=0;
  const section = (tag,text) => Object.assign(document.createElement(tag),{textContent:text});
  const button = (text,click) => Object.assign(section('button',text),{type:'button',onclick:click});
  function clear(message) {
    generation++;view=null;history=[];selection=0;
    container.replaceChildren(section('p',message));
  }
  async function load() {
    const token=++generation;
    let next;
    try {next=await request({mode:'simulate'})}catch(e){next={error:e.message}}
    if(token!==generation)return;
    if(next.error){
      container.replaceChildren(section('p',next.error));
      return;
    }
    view=next;selection=0;render();
  }
  function render(message='') {
    const {variables,current,actions}=view;
    const top=document.createElement('div');top.className='stateHeading';
    top.append(section('h3',history.length?'Current state':'Starting state'));
    if(history.length)top.append(button('Back',()=>{
      generation++;const prior=history.pop();view=prior.view;selection=prior.selection;render();
    }));
    const values=document.createElement('dl');values.className='stateValues';
    variables.forEach((v,i)=>values.append(section('dt',v),section('dd',current[i])));
    container.replaceChildren(top,values);
    if(view.safe!==null){
      const safety=section('p',view.safe?'This state satisfies the invariant.':'This state violates the invariant.');
      safety.className=view.safe?'accepted':'invalid';
      container.append(safety);
    }
    const fieldset=document.createElement('fieldset');
    const form=document.createElement('form');form.append(fieldset);container.append(form);
    const feedback=section('p',message);feedback.setAttribute('aria-live','polite');
    feedback.className='accepted';
    if(!actions.length){fieldset.append(section('p','No enabled actions.'));fieldset.append(feedback);return}
    const select=document.createElement('select');
    const label=section('label','Action');label.append(select);fieldset.append(label);
    for(const action of actions){
      const repeated=actions.some(other=>other!==action && other.name===action.name);
      select.add(new Option(repeated?action.name+' (branch '+(action.index+1)+')':action.name,String(action.index)));
    }
    select.selectedIndex=selection;
    select.onchange=()=>{selection=select.selectedIndex;render()};
    const action=actions[selection];
    const inputs=[];
    variables.forEach((v,i)=>{
      const field=action.fields[i];
      if(!field.editable)return;
      const {box,read}=proposalField(field.first);
      const label=section('label',v+"′");label.append(box);
      if(field.first!==field.last)label.append(section('small','Integer range '+field.first+' … '+field.last));
      fieldset.append(label);inputs.push({i,read});
    });
    if(!inputs.length)fieldset.append(section('p','This action keeps every variable unchanged.'));
    const submit=section('button','Try transition');submit.className='primary';fieldset.append(submit,feedback);
    form.onsubmit=async event=>{
      event.preventDefault();
      const candidate=current.slice();
      for(const {i,read} of inputs)candidate[i]=read();
      const token=++generation;
      fieldset.disabled=true;
      try{
        const next=await request({mode:'simulate',current,candidate,action:action.index});
        if(token!==generation)return;
        if(next.error)throw Error(next.error);
        history.push({view,selection});view=next;selection=0;render('Transition accepted.');
      }catch(error){
        if(token!==generation)return;
        feedback.textContent=error.message;feedback.className='invalid';fieldset.disabled=false;
      }
    };
  }
  return {clear,start:()=>{clear('Loading initial state…');return load()}};
}
