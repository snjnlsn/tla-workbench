import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {readConfig} from '../../dist/config.mjs';
import {check} from './engine.mjs';

const jar = resolve(process.env.TLA_JAR || 'tla2tools.jar');
assert.equal(createHash('sha256').update(readFileSync(jar)).digest('hex'),
  '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88','Expected TLC 2.19 (release v1.7.4)');
const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const config = 'INIT Init\nNEXT Next\nCHECK_DEADLOCK FALSE\n';
const fixture = (dir, name) => ({name, source:read(dir+'/'+name+'.tla'), cfg:read(dir+'/'+name+'.cfg')});
const model = (name, body, cfg=config) => ({name, source:'---- MODULE '+name+' ----\nEXTENDS Integers\nVARIABLE s\n'+body+'\n====',cfg});

function reference({name,source,cfg},args=[]) {
  const cwd=mkdtempSync(join(tmpdir(),'tla-parity-'));
  try {
    writeFileSync(join(cwd,name+'.tla'),source);
    writeFileSync(join(cwd,name+'.cfg'),cfg);
    const run=spawnSync('java',['-Xmx256m','-XX:+UseParallelGC','-cp',jar,'tlc2.TLC','-workers','1',
      '-dump','dot','graph.dot',...args,name+'.tla'],{cwd,encoding:'utf8',timeout:30000});
    if(run.error) throw run.error;
    const log=run.stdout+run.stderr;
    if(run.status!==0) return {log,status:run.status};
    assert.match(log,/Model checking completed. No error/);
    return {log,status:0,graph:parseGraph(readFileSync(join(cwd,'graph.dot'),'utf8'))};
  } finally {rmSync(cwd,{recursive:true,force:true})}
}

// The fixtures use scalar values. Use variable names rather than TLC fingerprints or BFS order.
const key = pairs => JSON.stringify(pairs.sort(([a],[b])=>a.localeCompare(b)));
function parseGraph(dot) {
  const nodes=new Map(), initial=new Set(), edges=[];
  for(const line of dot.split('\n')) {
    const node=line.match(/^(-?\d+) \[label=("(?:[^"\\]|\\.)*")/);
    const edge=line.match(/^(-?\d+) -> (-?\d+)/);
    if(edge) edges.push(edge.slice(1,3));
    if(!node) continue;
    const value=key(JSON.parse(node[2]).split('\n').map(assignment=>{
      const match=assignment.match(/^(?:\/\\ )?(\w+) = (.+)$/);
      assert.ok(match,assignment);
      return [match[1],JSON.parse(match[2].replace(/^TRUE$/,'true').replace(/^FALSE$/,'false'))];
    }));
    nodes.set(node[1],value);
    if(line.includes('style = filled')) initial.add(value);
  }
  assert.ok(nodes.size);
  return {states:new Set(nodes.values()),initial,edges:new Set(edges.map(([a,b])=>JSON.stringify([nodes.get(a),nodes.get(b)])))};
}
function wasmGraph(spec) {
  const result=check(spec.source,readConfig(spec.cfg));
  assert.equal(result.status,'passed',result.error);
  const states=result.states.map(state=>key(result.variables.map((name,i)=>[name,state[i]])));
  return {states:new Set(states),initial:new Set(states.slice(0,result.initial_count)),
    edges:new Set(result.edges.map(([a,b])=>JSON.stringify([states[a],states[b]])))};
}
test('TLC and shipped WASM reject the same precedence conflict',()=>{
  const spec=fixture('fixtures','Grouping');
  const tlc=reference(spec);
  assert.notEqual(tlc.status,0);
  assert.match(tlc.log,/Precedence conflict/);
  assert.match(check(spec.source,readConfig(spec.cfg)).error,/Precedence conflict/);
});
test('Test.tla and Test.cfg produce identical reachable graphs',()=>{
  const spec=fixture('../../example_tla','Test');
  const tlc=reference(spec);
  assert.equal(tlc.status,0,tlc.log);
  assert.equal(tlc.graph.states.size,2003);
  assert.equal(tlc.graph.edges.size,2002);
  assert.deepEqual(wasmGraph(spec),tlc.graph);
});

const reductions = {
  AssignmentNext: "Init == s = 23\nNext == s' = 1\nInv == s /= 0",
  AssignmentNext2: "Init == s = \"\"\nNext == s' = 1",
  AssignmentNext3: "Init == s = 0\nNext == "+[0,2,4,6,8].map(n=>"s' = "+n).join(" \\/ "),
  AssignmentInit: "Init == "+[1,2,5,9,11].map(n=>"s = "+n).join(" \\/ ")+"\nNext == s = 1 /\\ s' = s",
};
for(const [name,body] of Object.entries(reductions)) {
  test(name+': compare original TLC graph, reduced TLC graph and reduced WASM graph',()=>{
    const original=fixture('upstream/tlatools/org.lamport.tlatools/test-model',name);
    const expected=reference(original,['-deadlock']); // Matches the upstream Java harness.
    assert.equal(expected.status,0,expected.log);
    const reduced=model('Reduced',body,config+(name==='AssignmentNext'?'INVARIANT Inv\n':''));
    const actual=reference(reduced);
    assert.equal(actual.status,0,actual.log);
    assert.deepEqual(actual.graph,expected.graph);
    assert.deepEqual(wasmGraph(reduced),expected.graph);
  });
}

for(const [name,extra,setting,pattern,status] of [
  ['BadInvariant','Inv == s < 2','INVARIANT Inv',/Invariant Inv is violated/,'violated'],
  ['DeadEnd','','CHECK_DEADLOCK TRUE',/Deadlock reached/,'deadlock'],
]) {
  test(name+': compare failure and validate the witness',()=>{
    const spec=model(name,"Init == s = 0\nNext == s < 2 /\\ s' = s + 1\n"+extra,"INIT Init\nNEXT Next\n"+setting);
    const tlc=reference(spec);
    assert.notEqual(tlc.status,0);
    assert.match(tlc.log,pattern);
    const result=check(spec.source,readConfig(spec.cfg));
    assert.equal(result.status,status);
    assert.deepEqual(result.trace.map(id=>result.states[id]),[[0],[1],[2]]);
  });
}

test('parentheses, arithmetic binding, and nested list indentation distinguish evaluation order',()=>{
  const spec=model('Binding', [
    'Init == s = 0',
    "Next == s' = s",
    'Inv ==',
    '    /\\ TRUE \\/ (FALSE /\\ FALSE)',
    '    /\\ (8 + 3 - 1) = 10',
    '    /\\ (10 - 2 * 3) = 4',
    '    /\\  \\/ FALSE',
    '        \\/ TRUE',
  ].join('\n'),config+'INVARIANT Inv');
  const native=reference(spec);
  assert.equal(native.status,0,native.log);
  assert.deepEqual(wasmGraph(spec),native.graph);
});
