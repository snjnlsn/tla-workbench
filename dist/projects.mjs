import {examples} from './examples.mjs';
export function loadWorkspace(storage) {
  const get = key => {
    try {return JSON.parse(storage.getItem(key))} catch {return null}
  };
  const saved = get('tla-projects-1');
  if(saved?.projects?.[saved.active]) {
    if(!saved.exampleRevision) {
      const seed = saved.projects[0];
      const legacySource = examples.HappyPath.replace('MODULE HappyPath','MODULE SadPath').replace('1..3','1..4');
      const old = seed.files[1];
      if(seed.name === 'Seat reservations' && seed.files[0]?.name === 'HappyPath' &&
         old?.name === 'SadPath' && old.source === legacySource && old.invariant === 'Safety' &&
         old.limit === 10000 && old.deadlock === undefined && old.configText === undefined) {
        seed.files.splice(1,1);
        if(seed.active >= 1) seed.active--;
      }
      saved.exampleRevision = 2;
    }
    return saved;
  }
  const files = Object.entries(examples).map(([name,source])=>({
    name,source,invariant:'Safety',limit:10000,
  }));
  const projects=[{name:'Seat reservations',files,active:0}];
  const old=get('tla-workbench-1');
  if(old?.files?.length) projects.push({name:'Previous workspace',files:old.files,active:old.active||0});
  return {projects,active:projects.length-1,exampleRevision:2};
}

export function assembleModels(entries) {
  const texts=new Map(entries.map(entry=>[entry.path,entry.text]));
  if(texts.size!==entries.length) throw Error('Two files have the same path.');
  const models=[];
  const configs=new Map();
  for(const [path,text] of texts){
    if(/\.cfg$/i.test(path)) configs.set(path.slice(0,-4),text);
  }
  for(const [path,text] of texts){
    if(!/\.tla$/i.test(path)) continue;
    const name=path.slice(0,-4);
    const model={name,source:text,limit:10000};
    if(configs.has(name)) model.configText=configs.get(name);
    models.push(model);
  }
  if(!models.length) throw Error('No .tla files were found.');
  return models;
}

export async function githubProject(link,signal) {
  let url;
  try {url=new URL(link.trim())} catch {throw Error('Enter a GitHub repository URL.')}
  const match=url.pathname.match(/^\/([A-Za-z0-9-]+)\/([\w.-]+?)\/?$/);
  if(url.origin!=='https://github.com'||url.username||url.password||!match)
    throw Error('Use a repository URL such as https://github.com/owner/repo.');
  const repo=match[2].replace(/\.git$/,'');
  if(!repo || repo==='.' || repo==='..') throw Error('Invalid repository name.');
  const base='https://api.github.com/repos/'+match[1]+'/'+repo+'/git/';
  async function request(path,raw=false){
    const response=await fetch(base+path,{signal,credentials:'omit',headers:{
      Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',
    }});
    if(!response.ok){
      if(response.status===403||response.status===429)throw Error('GitHub denied the request. The public API rate limit may have been reached.');
      if(response.status===404)throw Error('Repository or file unavailable. Use a public repository.');
      throw Error('GitHub returned HTTP '+response.status+'.');
    }
    return raw?response.text():response.json();
  }
  const root=await request('trees/HEAD');
  const dir=root.tree.find(entry=>entry.type==='tree'&&entry.path==='tla');
  if(!dir) throw Error('The repository has no top-level /tla directory.');
  const tree=await request('trees/'+dir.sha+'?recursive=1');
  if(tree.truncated) throw Error('GitHub returned an incomplete directory listing.');
  const files=tree.tree.filter(e=>e.type==='blob' && e.mode!=='120000' && /\.(tla|cfg)$/i.test(e.path));
  const entries=[];
  for(const entry of files) entries.push({path:entry.path,text:await request('blobs/'+entry.sha,true)});
  return {name:match[1]+'/'+repo,active:0,files:assembleModels(entries)};
}
