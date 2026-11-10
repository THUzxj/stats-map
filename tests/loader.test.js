import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, loadBundle, sha256Bytes } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

async function external(){
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset}),bundle=structuredClone(map.bundle);map.destroy();
  const bytes=new TextEncoder().encode(JSON.stringify(dataset));
  bundle.resources=bundle.resources.map(entry=>entry.resource.kind==='stats-map/dataset'?{storage:'external',ref:{kind:dataset.kind,id:dataset.id,revision:dataset.revision},path:'resources/amounts.json',sha256:''}:entry);
  bundle.resources.find(entry=>entry.storage==='external').sha256=await sha256Bytes(bytes);
  return {bundle,bytes,dataset};
}

test('bundle loading hashes original bytes, verifies identity and ignores unverified parsed sidecars',async()=>{
  const {bundle,bytes,dataset}=await external();
  const changed={...dataset,title:'unverified substitute'};
  const result=await loadBundle(bundle,()=>({bytes,resource:changed}));
  assert.equal(result.resources.find(entry=>entry.resource.kind==='stats-map/dataset').resource.title,dataset.title);
  await assert.rejects(loadBundle(bundle,()=>new TextEncoder().encode(JSON.stringify(changed))),error=>error.code==='HASH_MISMATCH');
  const mismatched=structuredClone(bundle);mismatched.resources.find(entry=>entry.storage==='external').ref.id='different';
  await assert.rejects(loadBundle(mismatched,()=>bytes),error=>error.code==='REFERENCE_MISMATCH');
  await assert.rejects(loadBundle(bundle,()=>dataset),error=>error.code==='LOAD_FAILED');
});

test('bundle cancellation settles promptly even if a resolver remains pending and ignores late responses',async()=>{
  const {bundle,bytes}=await external(),controller=new AbortController();let finish,signal;
  const pending=loadBundle(bundle,(_path,_ref,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});},{signal:controller.signal});
  await Promise.resolve();controller.abort();await assert.rejects(pending,error=>error.code==='CANCELLED');assert.equal(signal,controller.signal);
  finish(bytes);await Promise.resolve();
  let called=false;await assert.rejects(loadBundle(bundle,()=>{called=true;return bytes;},{signal:controller.signal}),error=>error.code==='CANCELLED');assert.equal(called,false);
});
