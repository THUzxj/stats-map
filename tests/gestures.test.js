import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/index.js';
import { TouchGestures } from '../src/core/gestures.js';
import { sample } from './fixtures/encoding.js';

function setup(){const {geography,dataset}=sample(),map=createMap(null,{geography,dataset,width:800,height:500}),container={style:{touchAction:'pan-y'},getBoundingClientRect:()=>({left:0,top:0,width:800,height:500})};map.container=container;const gestures=new TouchGestures(map,container);return {map,gestures,container};}
const pointer=(pointerId,x,y,insetId=null)=>({pointerId,clientX:x,clientY:y,preventDefault(){this.prevented=true;},target:{closest:selector=>selector==='[data-inset-id]'&&insetId?{getAttribute:()=>insetId}:null}});
test('two-finger gestures preserve the focal point, pan with the midpoint and suppress accidental selection clicks',()=>{
  const {map,gestures,container}=setup();map.render();const before=map.getViewTransform();
  gestures.down(pointer(1,300,250));assert.equal(gestures.active,undefined);gestures.move(pointer(1,310,250));assert.deepEqual(map.getViewTransform(),before);
  gestures.down(pointer(2,500,250));gestures.move(pointer(1,210,250));gestures.move(pointer(2,600,250));
  const transform=map.getViewTransform();assert.ok(Math.abs(transform.zoom-390/190)<1e-9);
  const translation=map.projection.translate[0];gestures.move(pointer(1,260,250));gestures.move(pointer(2,650,250));assert.ok(Math.abs(map.projection.translate[0]-translation-50)<1e-9);
  assert.equal(gestures.suppressClick(),true);assert.deepEqual(map.getState().selection,[]);
  gestures.up(pointer(2,600,250));assert.equal(gestures.active,null);const after=map.getViewTransform();gestures.move(pointer(1,230,250));assert.deepEqual(map.getViewTransform(),after);
  gestures.destroy();assert.equal(container.style.touchAction,'pan-y');map.container=null;map.destroy();
});
test('touch gestures isolate inset transformations and cancel without leaving pointer state',()=>{
  const {map,gestures}=setup();map.setSpec({...map.spec,insets:[{id:'detail',x:500,y:250,width:260,height:180}]});const before=structuredClone(map.projection);
  gestures.down(pointer(1,550,350,'detail'));gestures.down(pointer(2,650,350,'detail'));gestures.move(pointer(2,700,350,'detail'));
  assert.deepEqual(map.projection,before);assert.ok(Math.abs(map.spec.insets[0].transform.zoom-1.5)<1e-9);
  gestures.cancel();assert.equal(gestures.pointers.size,0);assert.equal(gestures.active,null);
  gestures.down(pointer(1,300,250));gestures.down(pointer(2,600,350,'detail'));assert.equal(gestures.active,null);
  gestures.destroy();map.container=null;map.destroy();
});
