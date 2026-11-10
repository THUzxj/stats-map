import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMapTarget, mapTarget } from '../src/core/interaction-events.js';

function target(attributes={}) {
  const layer={getAttribute:name=>name==='data-layer-id'?'charts':null};
  const element={getAttribute:name=>attributes[name]??null,closest:()=>layer};
  return {closest:()=>element};
}
function map(){
  const events=[],selected=[];
  return {events:{emit:(name,payload)=>events.push({name,payload})},geography:{id:'g',revision:'r1'},spec:{view:{period_id:'t'}},toggleSelection:id=>selected.push(id),emitted:events,selected};
}

test('component interactions retain identity and values without rewriting region selection',()=>{
  const instance=map(),element=target({'data-region-id':'a','data-component-index':'0','data-series-id':'one','data-value':'0','data-share':'0'});
  assert.equal(mapTarget(element).kind,'component');
  dispatchMapTarget(instance,{target:element});
  assert.deepEqual(instance.selected,[]);
  assert.equal(instance.emitted[0].name,'componentclick');
  assert.equal(instance.emitted[0].payload.value,0);
  assert.equal(instance.emitted[0].payload.share,0);
  assert.equal(instance.emitted[0].payload.period_id,'t');
  assert.equal(instance.emitted[0].payload.layer_id,'charts');
  instance.spec.interaction={componentClickSelectsRegion:true};
  dispatchMapTarget(instance,{target:element});
  assert.deepEqual(instance.selected,['a']);
});

test('edge and region event dispatch remain separate and hover does not change selection',()=>{
  const instance=map();
  dispatchMapTarget(instance,{target:target({'data-relation-id':'edge'})});
  assert.equal(instance.emitted[0].name,'relationclick');
  assert.deepEqual(instance.selected,[]);
  dispatchMapTarget(instance,{target:target({'data-region-id':'a'})},'hover');
  assert.deepEqual(instance.selected,[]);
  assert.equal(instance.emitted[1].name,'regionhover');
  dispatchMapTarget(instance,{target:target({'data-region-id':'a'})});
  assert.deepEqual(instance.selected,['a']);
  assert.equal(instance.emitted[2].name,'regionclick');
});
