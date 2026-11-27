import test from 'node:test';
import {readConfig} from '../dist/config.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {instance:{exports:wasm}}=await WebAssembly.instantiate(await readFile(new URL('../dist/checker.wasm',import.meta.url)));
const model = "---- MODULE Test ----\nVARIABLES x, y\nInit == x = 0 /\\ y = 1\nStep == x < 2 /\\ x' = x + 1 /\\ y' = x\nNext == Step\nSafety == y <= 1\n====";
function check(source,limit=100,options={}){
  const bytes=Buffer.from(JSON.stringify({source,limit,invariant:"Safety",...options}));
  const ptr=wasm.reserve(bytes.length);
  new Uint8Array(wasm.memory.buffer,ptr,bytes.length).set(bytes);
  const length=wasm.run(ptr,bytes.length);
  return JSON.parse(Buffer.from(wasm.memory.buffer,wasm.output(),length).toString());
}
test('simultaneous assignments and terminal states',()=>{
  const result=check(model);
  assert.equal(result.status,'passed');
  assert.deepEqual(result.states,[[0,1],[1,0],[2,1]]);
});
test('returns a path to the violation',()=>assert.deepEqual(check(model.replace('y <= 1','x < 2')).trace,[0,1,2]));
test('state limit is inconclusive',()=>assert.equal(check(model,2).status,'limited'));
test('invalid syntax and missing assignments are errors',()=>{
  for(const source of [model.replace("y' = x","TRUE"),model.replace('y <= 1','[]FALSE')]) assert.equal(check(source).status,'error');
});

const choiceModel = [
  "---- MODULE Choose ----",
  "VARIABLES label, x, y",
  'Begin == label = "ready" /\\ x = 0 /\\ y = 0',
  'Choose == label = "ready" /\\ label\' = "done" /\\ x\' \\in 1..2 /\\ y\' \\in x..1',
  "Advance == Choose",
  "====",
].join("\n");
const cfg = "INIT Begin\nNEXT Advance\nCHECK_DEADLOCK FALSE";
test('paired configuration explores the product of independent interval choices',()=>{
  const r=check(choiceModel,100,readConfig(cfg));
  assert.equal(r.status,"passed");
  assert.equal(r.invariant,"");
  assert.deepEqual(r.states,[["ready",0,0],["done",1,0],["done",1,1],["done",2,0],["done",2,1]]);
  assert.equal(r.edges.length,4);
});
test('enabled deadlock checking reports a terminal state and trace',()=>{
  const r=check(choiceModel,100,readConfig(cfg.replace("FALSE","TRUE")));
  assert.equal(r.status,"deadlock");
  assert.deepEqual(r.trace,[0,1]);
});
test('empty intervals disable an action and large intervals stop at the limit',()=>{
  assert.equal(check(choiceModel.replace("1..2","2..1"),100,readConfig(cfg)).states.length,1);
  assert.equal(check(choiceModel.replace("1..2","1..9223372036854775807"),4,readConfig(cfg)).status,"limited");
});
test('unsupported configuration directives cannot silently drop a property',()=>{
  assert.throws(()=>readConfig(cfg+"\nPROPERTY Progress"));
});
