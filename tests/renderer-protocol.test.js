import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { adapterFixture, matrixMap } from './fixtures/adapter-matrix.js';
import { protocolRenderer } from './fixtures/protocol-renderer.js';

const extension=protocolRenderer(lib);
function map(options={}) {
  const fixture=adapterFixture(lib,'canonical');
  const result=matrixMap(lib,fixture,{id:'marks',type:extension.definition.type,options},'geographic');
  result.setLayers(result.spec.layers.map(layer=>({...layer,id:'marks'})));
  return result;
}
const options=(map,value)=>map.setLayers(map.spec.layers.map(layer=>({...layer,options:value})));

test('registration validates every name and hook before changing the registry',()=>{
  const count=lib.listRenderers().length,original=lib.getRenderer('ch');
  for(const definition of [{type:'reservedAlias',aliases:['newAlias','ch'],render(){}},{type:'duplicateAlias',aliases:['same','same'],render(){}},{type:'invalidHook',prepare:3,render(){}},{type:'missingRender'},{type:'invalidRole',defaultRole:'unknown',render(){}}])assert.throws(()=>lib.registerRenderer(definition));
  assert.equal(lib.listRenderers().length,count);assert.equal(lib.getRenderer('ch'),original);
  assert.throws(()=>lib.getRenderer('newAlias'));
  assert.equal(lib.getRenderer(extension.definition.type+'Alias'),extension.definition);
  assert.ok(lib.listRenderers().includes(extension.definition));
});

test('direct rendering follows validation, preparation, render and cleanup with shared accessible values',()=>{
  const m=map(),view=new lib.DatasetView([...m.datasets.values()][0],m.geography),before=extension.active.size;
  try{
    const result=lib.renderSvg({geography:m.geography,datasetView:view,datasetViews:m._views,spec:m.spec,layer:m.spec.layers[0]});
    assert.match(result.svg,/data-region-id="zero" data-value="0"/);assert.match(result.svg,/tabindex="0"/);
    assert.equal(result.collisionRadii.get('zero'),10);assert.equal(extension.active.size,before);
    assert.equal(m.capabilities()[0].supported,true);
  }finally{m.destroy();}
});

test('main and inset frames update, hit test in local pixels, describe, hide and destroy independently',()=>{
  const m=map();try{
    m.setSpec({...m.spec,insets:[{id:'detail',x:600,y:200,width:160,height:140,region_ids:['zero']}]});
    const main=m.rendererFrames.values().next().value,local=[...m.rendererFrames.values()].find(frame=>frame.context.insetId==='detail');
    assert.equal(extension.active.size,2);assert.ok(main.result.svg.includes('data-value="0"'));
    const point=main.context.anchors.get('zero');assert.equal(m.hitTest(point).regionId,'zero');assert.equal(m.hitTest(point).layerId,'marks');
    const insetPoint=local.context.anchors.get('zero'),hit=m.hitTest([600+insetPoint[0],220+insetPoint[1]]);
    assert.equal(hit.regionId,'zero');assert.equal(hit.insetId,'detail');
    const model=lib.buildTooltip(m,{layer_id:'marks',region_id:'zero',inset_id:'detail'});
    assert.equal(model.title,'Fictional mark zero');assert.equal(model.rows[0].value,'0');
    m.setSelection(['zero']);assert.equal(extension.active.size,2);assert.match(m.lastRender.svg,/fill="#ff9900"/);
    assert.ok(extension.calls.some(call=>call[0]==='update'));
    m.toggleInset('detail',false);assert.equal(extension.active.size,1);
    m.setLayers([{id:'base',type:'choropleth',encoding:m.spec.layers[0].encoding}]);assert.equal(extension.active.size,0);
  }finally{m.destroy();m.destroy();assert.equal(extension.active.size,0);}
});

test('validation, prepare, update and late inset failures retain committed state, output and resource ownership',()=>{
  const m=map();try{
    m.setSpec({...m.spec,insets:[{id:'detail',x:600,y:200,width:160,height:140,region_ids:['zero']}]});
    m.setSelection(['zero']);const spec=m.spec,last=m.lastRender,state=m.state.get(),frames=m.rendererFrames,events=[];
    m.on('specchange',()=>events.push('specchange'));m.on('render',()=>events.push('render'));
    for(const value of [{invalidEncoding:true},{failPrepare:true},{failUpdate:true},{failRender:true},{failInset:true}]){
      assert.throws(()=>options(m,value));assert.equal(m.spec,spec);assert.equal(m.lastRender,last);assert.equal(m.rendererFrames,frames);
      assert.deepEqual(m.state.get(),state);assert.equal(extension.active.size,2);assert.deepEqual(events,[]);
    }
    options(m,{});assert.equal(extension.active.size,2);assert.deepEqual(events,['specchange','render']);
    options(m,{failDestroy:true});m.setSelection([]);assert.equal(extension.active.size,2);
  }finally{m.destroy();assert.equal(extension.active.size,0);}
});

test('dataset and geography changes and rejected bundle replacement are transactional for custom renderers',()=>{
  const m=map();try{
    const data=[...m.datasets.values()][0],next=structuredClone(data);next.revision='r2';next.observations.find(row=>row.region_id==='zero').value=7;
    m.setData(next);assert.equal(m.datasets.get(next.id),next);assert.match(m.lastRender.svg,/data-region-id="zero" data-value="7"/);
    const geo=structuredClone(m.geography);geo.revision='r2';
    assert.throws(()=>m.setGeography(geo));assert.equal(m.geography.revision,'r1');
    const bundle=structuredClone(m.bundle),spec=bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource;spec.layers[0].options={failRender:true};
    const old=m.lastRender;assert.throws(()=>m.setBundle(bundle));assert.equal(m.lastRender,old);assert.equal(extension.active.size,1);
  }finally{m.destroy();}
});

test('Dorling measurement disposes transient frames and uses the extension collision radii',()=>{
  const m=map();try{
    m.setLayout({type:'dorling',worker:false,iterations:3});
    assert.equal(extension.active.size,1);assert.ok(extension.calls.some(call=>call[0]==='prepare'&&call[3]==='measure'));
    for(const node of m.layoutPositions.values())assert.ok(node.radius>=10);
  }finally{m.destroy();}
});

test('invalid outputs and async stages are rejected and their candidate resources are disposed',()=>{
  for(const [suffix,render] of [['empty',()=>({svg:'broken'})],['radius',()=>({svg:'<svg></svg>',collisionRadii:new Map([['zero',NaN]])})],['async',async()=>({svg:'<svg></svg>'})]]){
    let active=0;const entry=lib.registerRenderer({type:'fictionalInvalid'+suffix,prepare(context){active++;context.services.onDispose(()=>active--);},render});
    const m=map();try{
      assert.throws(()=>m.setRenderer(entry.type,m.spec.layers[0].encoding));assert.equal(active,0);assert.equal(extension.active.size,1);
    }finally{m.destroy();}
  }
});
