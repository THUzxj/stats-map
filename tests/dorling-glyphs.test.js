import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { dispatchMapTarget } from '../src/core/interaction-events.js';
import { adapterFixture, matrixCases, matrixAdapters, matrixMap } from './fixtures/adapter-matrix.js';

for(const adapter of matrixAdapters)test(`${adapter}: Dorling uses every renderer footprint and preserves frozen legend sizes`,()=>{
  const fixture=adapterFixture(lib,adapter),original=JSON.stringify(fixture);
  for(const row of matrixCases()){
    const map=matrixMap(lib,fixture,row,'dorling');
    try{
      const result=map.render();assert.equal(result.layout.status,'settled');assert.equal(result.layout.collision_pairs,0,row.id);assert.deepEqual(result.layout.overflow_region_ids,[]);
      assert.ok([...map.layoutPositions.values()].every(node=>Number.isFinite(node.radius)&&node.radius>=0));
      assert.equal(map.capabilities()[0].supported,true,row.id);
      for(const [id,node] of map.layoutPositions)assert.equal(map.hitTest([node.x,node.y]).regionId,id,row.id);
      const before=structuredClone([...map.layoutPositions]);map.render();assert.deepEqual([...map.layoutPositions],before,row.id);
      const reopened=lib.createMap(null,{geography:fixture.geography,dataset:fixture.dataset,spec:map.exportSpec({resolved:true}),width:760,height:560});
      assert.deepEqual(reopened.render().legends.map(legend=>lib.legendSvg(legend,0,0,'test')),result.legends.map(legend=>lib.legendSvg(legend,0,0,'test')),row.id);reopened.destroy();
      assert.doesNotMatch(map.export('svg'),/\b(?:NaN|Infinity)\b/,row.id);
    }finally{map.destroy();}
  }
  assert.equal(JSON.stringify(fixture),original);
});

test('Dorling keeps projected geographic anchors when the map extent is wider than anchor extent',()=>{
  const fixture=adapterFixture(lib,'canonical'),geography=structuredClone(fixture.geography);
  // A long province boundary with explicit interior anchors models the common
  // case where the full geography reaches farther than its statistical points.
  geography.features.features.find(feature=>feature.properties.region_id==='a').geometry={type:'Polygon',coordinates:[[[-1000,0],[1000,0],[1000,3],[-1000,3],[-1000,0]]]};
  geography.anchors=['a','b','zero','gap'].map((region_id,index)=>({region_id,role:'symbol',point:[index*100,1.5],method:'fixture',version:1}));
  const spec={schema_version:1,kind:'stats-map/spec',id:'dorling-anchor-alignment',revision:'r1',geography_ref:{id:geography.id,revision:geography.revision},dataset_refs:[{id:fixture.dataset.id,revision:fixture.dataset.revision}],view:{period_id:'early'},layout:{type:'dorling',worker:false,padding:20},layers:[
    {id:'base',type:'choropleth',role:'base',encoding:{dataset_id:fixture.dataset.id,series_id:'one'}},
    {id:'symbols',type:'proportionalSymbol',role:'overlay',encoding:{dataset_id:fixture.dataset.id,series_id:'one'},options:{maxRadius:12}}
  ]};
  const map=lib.createMap(null,{geography,dataset:fixture.dataset,spec,width:760,height:560});
  try{
    map.render();
    const anchors=lib.screenAnchors(geography,map.projection,{regionIds:geography.regions.map(region=>region.id)});
    const offsets=[...map.layoutPositions].map(([id,node])=>Math.hypot(node.x-anchors.get(id)[0],node.y-anchors.get(id)[1]));
    assert.ok(Math.max(...offsets)<40,'Dorling must not rescale compact anchors to the full viewport');
  }finally{map.destroy();}
});

test('dense coincident nodes settle deterministically within pixel bounds and report impossible packing',()=>{
  const nodes=Array.from({length:18},(_,i)=>({id:'node-'+i,x:300,y:200,radius:10+i%4*3}));
  const options={seed:7,iterations:800,strength:.75,bounds:[20,20,580,380],gap:3};
  const first=lib.dorlingLayout(nodes,options),second=lib.dorlingLayout([...nodes].reverse(),options);
  assert.deepEqual(first,second);assert.equal(lib.dorlingMetrics(first,options).collision_pairs,0);assert.deepEqual(lib.dorlingMetrics(first,options).overflow_region_ids,[]);
  assert.ok(nodes.every(node=>node.x===300&&node.y===200));
  const impossible=lib.dorlingLayout([{id:'a',x:0,y:0,radius:50},{id:'b',x:0,y:0,radius:50}],{bounds:[0,0,40,40],iterations:10});
  const metrics=lib.dorlingMetrics(impossible,{bounds:[0,0,40,40]});assert.equal(metrics.collision_pairs,1);assert.deepEqual(metrics.overflow_region_ids,['a','b']);
});

test('Sankey collision envelopes cover port stacks after neighbours cross to the same side',()=>{
  const fixture=adapterFixture(lib,'canonical');
  fixture.dataset.relations=['b','zero'].map((id,i)=>({id:'edge-'+i,origin_region_id:'a',destination_region_id:id,period_id:'early',series_id:'one',status:'value',value:20}));
  const map=matrixMap(lib,fixture,matrixCases().find(row=>row.id==='flow-sankey'),'geographic');
  try{
    const spec={...map.spec,layout:{type:'dorling'}},radii=[];
    for(const xs of [[300,200,400,600],[300,400,500,600]]){
      const positions=new Map(fixture.geography.regions.map((region,i)=>[region.id,{id:region.id,x:xs[i],y:250,radius:12,surfaceRadius:12,glyphSize:36}]));
      const render=lib.renderSvg({geography:fixture.geography,spec,layer:spec.layers[0],datasetView:map._views.get(fixture.dataset.id),datasetViews:map._views,layoutPositions:positions,layoutType:'dorling',measureCollisions:true});
      const radius=render.collisionRadii.get('a'),node=render.flowLayout.nodes.get('a');radii.push(radius);
      for(const port of [...node.left,...node.right])for(const y of port.interval)assert.ok(Math.hypot(node.radius+1,y-node.y)<=radius);
    }
    assert.equal(radii[0],radii[1],'reserved size must not depend on initial port side');
  }finally{map.destroy();}
});

test('internal flow envelopes include wide gradient starts and outlines',()=>{
  const fixture=adapterFixture(lib,'canonical');fixture.dataset.relations=[{id:'internal',origin_region_id:'a',destination_region_id:'a',period_id:'early',series_id:'one',status:'value',value:20}];
  const row={...matrixCases().find(row=>row.id==='flow-sankey'),options:{mode:'sankey',widthGradient:true,widthGradientSettings:{minStartWidth:100},outline:true,outlineWidth:30}};
  const map=matrixMap(lib,fixture,row,'dorling');
  try{
    const result=map.render(),node=map.layoutPositions.get('a');
    const outline=result.renders[0].svg.match(/data-flow-outline="true"[^>]* d="([^"]+)"/)[1];
    const values=outline.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    for(let i=0;i<values.length;i+=2)assert.ok(Math.hypot(values[i]-node.x,values[i+1]-node.y)<=node.radius,'outlined internal ribbon escapes reserved envelope');
  }finally{map.destroy();}
});

test('glyph domains refresh on period/data/size changes and repeated zoom never mutates cached layout',()=>{
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-circle'),map=matrixMap(lib,fixture,row,'dorling');
  try{
    map.setLayers([{...map.spec.layers[0],options:{maxRadius:20,maxValue:100}}]);
    const initial=map.layoutPositions.get('a').radius;
    map.setView({period_id:'late'});assert.ok(map.layoutPositions.get('a').radius>initial);
    const replacement=structuredClone(fixture.dataset);replacement.observations.find(o=>o.series_id==='one'&&o.region_id==='a'&&o.period_id==='late').value=1;
    map.setData(replacement);assert.ok(map.layoutPositions.get('a').radius<initial);
    const raw=structuredClone([...map.dorlingPositions]),r=map.layoutPositions.get('a').radius;
    map.setViewTransform({zoom:1.3,pan:[.1,.1]});const transformed=structuredClone([...map.layoutPositions]);
    map.render();assert.deepEqual([...map.layoutPositions],transformed);assert.deepEqual([...map.dorlingPositions],raw);assert.equal(map.layoutPositions.get('a').radius,r);
    map.resetView();assert.deepEqual([...map.layoutPositions],raw);
  }finally{map.destroy();}
});

test('custom paths support displacement and invalid options fail before replacing state',()=>{
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-custom'),map=matrixMap(lib,fixture,row,'geographic'),before=map.exportSpec();
  map.setLayout({type:'dorling'});assert.equal(map.lastRender.layout.collision_pairs,0);assert.deepEqual(map.exportSpec().layers,before.layers);
  const report=lib.layerCapabilities(map.spec.layers[0],new lib.DatasetView(fixture.dataset,fixture.geography),fixture.geography,'dorling');assert.equal(report.supported,true);
  for(const layout of [{iterations:-1},{iterations:1.5},{iterations:10001},{strength:0},{gap:-1},{seed:1.5},{tolerance:NaN},{worker:'yes'}])assert.throws(()=>map.setLayout({type:'dorling',...layout}));
  map.destroy();
});

test('grid and Dorling insets share renderer positions, selection and displaced hit testing',()=>{
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='pie-flag'),map=matrixMap(lib,fixture,row,'geographic');
  for(const type of ['grid-square','grid-hex','dorling']){
    map.setSpec({...map.spec,insets:[{id:'inset',x:200,y:40,width:350,height:260,layout:{type}}]});
    const view=map.lastRender.insets[0],node=view.layoutPositions.get('a');
    assert.equal(map.hitTest([node.x+200,node.y+60]).regionId,'a');assert.equal(map.hitTest([node.x+200,node.y+60]).insetId,'inset');
    map.setSelection(['a']);assert.match(map.lastRender.svg,/data-inset-id="inset"[\s\S]+data-selection-region-id="a"/);
    assert.ok(view.renders[0].anchors.every(anchor=>anchor.method==='layout'));
  }
  map.destroy();
});

test('only a rendered geographic overview intercepts inset clicks for recentering',()=>{
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-circle'),map=matrixMap(lib,fixture,row,'geographic');
  const inset={getAttribute:name=>name==='data-inset-id'?'detail':null},layer={getAttribute:name=>name==='data-layer-id'?'theme':null};
  const element={getAttribute:name=>name==='data-symbol-region-id'?'b':null,closest:()=>layer};
  const target={closest:selector=>selector==='[data-inset-id]'?inset:selector.startsWith('[data-relation-id]')?element:null};
  const events=[];map.on('regionclick',event=>events.push(event));let recentered=0;map.recenterFromMinimap=()=>recentered++;map._eventPoint=()=>[0,0];
  try{
    for(const type of ['grid-square','grid-hex','dorling']){
      map.setSpec({...map.spec,insets:[{id:'detail',x:200,y:40,width:350,height:260,layout:{type},minimap:true}]});map.setSelection([]);
      assert.equal(map.insetViews[0].overview,null);dispatchMapTarget(map,{target});
      assert.deepEqual(map.getState().selection,['b']);assert.equal(events.at(-1).inset_id,'detail');assert.equal(recentered,0);
    }
    map.setSpec({...map.spec,insets:[{id:'detail',x:200,y:40,width:350,height:260,minimap:true}]});map.setSelection([]);
    dispatchMapTarget(map,{target});assert.equal(recentered,1);assert.deepEqual(map.getState().selection,[]);assert.equal(events.length,3);
  }finally{map.destroy();}
});

test('pending Worker replacements ignore stale callbacks, settle diagnostics and release on layout switch',async()=>{
  const original=globalThis.Worker,workers=[];
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(message){this.request=message;this.callback=this.onmessage;}terminate(){this.terminated=true;}};
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-circle');
  let map;
  try{
    map=matrixMap(lib,fixture,row,'dorling');map.render();assert.equal(map.lastRender.layout.status,'pending');
    const first=workers.at(-1);map.setView({period_id:'late'});const second=workers.at(-1);assert.ok(first.terminated);
    first.callback({data:{requestId:first.request.requestId,status:'done',nodes:[{id:'stale',x:0,y:0,radius:1}]}});await Promise.resolve();assert.equal(map.layoutPositions.has('stale'),false);
    second.callback({data:{requestId:second.request.requestId,status:'done',nodes:lib.dorlingLayout(second.request.nodes,second.request.options)}});await Promise.resolve();assert.equal(map.lastRender.layout.status,'settled');assert.ok(second.terminated);
    const count=workers.length;map.setLegendFilter('theme',['numeric']);assert.equal(workers.length,count,'legend filtering does not restart displacement');
    map.setView({period_id:'early'});const third=workers.at(-1);map.setLayout({type:'geographic'});assert.ok(third.terminated);assert.equal(map.dorlingSimulation.pending,null);
  }finally{map?.destroy();globalThis.Worker=original;}
});

test('Worker errors settle as failed without replacing data or retaining an active worker',async()=>{
  const original=globalThis.Worker,workers=[];
  globalThis.Worker=class{constructor(){workers.push(this);}postMessage(message){this.request=message;}terminate(){this.terminated=true;}};
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-circle');
  let map;
  try{
    map=matrixMap(lib,fixture,row,'dorling');map.render();const errors=[];map.on('error',event=>errors.push(event));
    workers.at(-1).onerror({message:'synthetic Worker failure'});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(map.lastRender.layout.status,'failed');assert.equal(map.dorlingSimulation.pending,null);assert.equal(map.dorlingSimulation.worker,null);assert.ok(workers.at(-1).terminated);
    assert.equal(errors[0].source,'dorling');assert.match(errors[0].error.message,/synthetic Worker failure/);assert.equal(map.datasets.get(fixture.dataset.id),fixture.dataset);
    map.setView({period_id:'late'});workers.at(-1).onmessageerror();await new Promise(resolve=>setImmediate(resolve));assert.equal(map.lastRender.layout.status,'failed');assert.equal(errors.length,2);
  }finally{map?.destroy();globalThis.Worker=original;}
});
