import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, exportRelations, validateMapSpec, DatasetView, buildLegend, legendSvg, layerCapabilities, renderSvg } from '../src/index.js';
import { flowModel, flowSvg } from '../src/renderers/flow.js';
import { flowLayout, flowWidth, flowRibbon } from '../src/renderers/flow-layout.js';
import { bundleFlowPaths } from '../src/renderers/flow-bundle.js';
import { sample } from './fixtures/encoding.js';

function graph(records,options={},positions={a:[0,0],b:[200,0],c:[100,80],d:[-200,0]}){
  const {geography,dataset}=sample();
  geography.regions=Object.keys(positions).map(id=>({id,label:id.toUpperCase(),level_id:'area'}));
  dataset.observations=[];
  dataset.relations=records.map(([id,origin,destination,value])=>({id,origin_region_id:origin,destination_region_id:destination,value,status:'value',series_id:'one',period_id:'t'}));
  const view=new DatasetView(dataset,geography),model=flowModel(view,'one','t',options),anchors=new Map(Object.entries(positions));
  return {view,model,anchors,geography};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const snapshot=layout=>({edges:layout.edges,nodes:[...layout.nodes]});
const fixture=[['ab','a','b',10],['ba','b','a',5],['ca','c','a',8],['ad','a','d',4],['da','d','a',3],['aa','a','a',2],['zero','d','c',0]];

test('spatial Sankey centers both side stacks and conserves every raw width and value',()=>{
  const {model,anchors}=graph(fixture,{mode:'sankey',stackGap:2,minWidth:1,maxWidth:20}),original=structuredClone(model.edges),layout=flowLayout(model,anchors);
  for(const node of layout.nodes.values()){
    assert.deepEqual([node.x,node.y],anchors.get(node.id));
    for(const side of ['left','right']){
      const ports=node[side].filter(port=>port.edge.width>0);if(!ports.length)continue;
      close((ports[0].interval[0]+ports.at(-1).interval[1])/2,node.y);
      for(let i=1;i<ports.length;i++)close(ports[i].interval[0]-ports[i-1].interval[1],2);
      for(const port of ports)close(port.interval[1]-port.interval[0],flowWidth(port.edge.value,model.maximum,model.options));
    }
  }
  assert.ok(layout.nodes.get('a').left.some(p=>p.at==='start'));assert.ok(layout.nodes.get('a').left.some(p=>p.at==='end'));
  assert.ok(layout.nodes.get('a').right.some(p=>p.at==='start'));assert.ok(layout.nodes.get('a').right.some(p=>p.at==='end'));
  assert.deepEqual(model.edges,original);assert.equal(layout.edges.reduce((n,e)=>n+e.value,0),32);
  for(const edge of layout.edges)assert.deepEqual(edge.source_relation_ids,[edge.id]);
});

test('port ordering and force results are deterministic under input permutation',()=>{
  for(const order of ['angle','value-ascending','value-descending','id']){
    const one=graph(fixture,{mode:'sankey',order}),two=graph([...fixture].reverse(),{mode:'sankey',order});
    assert.deepEqual(snapshot(flowLayout(one.model,one.anchors)),snapshot(flowLayout(two.model,two.anchors)));
    if(order==='value-descending')assert.deepEqual(flowLayout(one.model,one.anchors).nodes.get('a').right.map(p=>p.edge.value),[10,8,5]);
  }
  const routes=[{id:'p',start:[0,0],end:[200,0]},{id:'q',start:[0,10],end:[200,10]},{id:'r',start:[0,15],end:[200,15]}];
  assert.deepEqual(bundleFlowPaths(routes),bundleFlowPaths([...routes].reverse()));
});

test('reciprocal midpoint half routes retain separate values and derived destinations',()=>{
  const {model,anchors}=graph(fixture,{mode:'sankey',reciprocalMode:'midpoint'}),layout=flowLayout(model,anchors);
  assert.equal(layout.midpoints.length,2);
  const ab=layout.edges.find(e=>e.id==='ab'),ba=layout.edges.find(e=>e.id==='ba');
  assert.deepEqual(ab.start,ba.start);assert.equal(ab.start[0],100);assert.equal(ab.value,10);assert.equal(ba.value,5);
  close(ab.width/ba.width,2);assert.equal(ab.origin_region_id,'a');assert.equal(ab.destination_region_id,'b');
  assert.equal(ab.end[0],200-layout.nodes.get('b').radius-1);assert.equal(ba.end[0],layout.nodes.get('a').radius+1);
  close(ab.start[1],(ab.end[1]+ba.end[1])/2);
  assert.equal(layout.edges.find(e=>e.id==='ca').midpoint,undefined);
});

test('cycles, self loops, vertical and coincident anchors stay finite with explicit diagnostics',()=>{
  const records=[['ab','a','b',10],['bc','b','c',8],['ca','c','a',6],['dd','d','d',3],['cd','c','d',2],['zero','b','d',0]];
  for(const mode of ['curved','straight','sankey']){
    const {model,anchors}=graph(records,{mode},{a:[0,0],b:[0,100],c:[150,50],d:[150,50]}),result=flowSvg(model,anchors);
    assert.doesNotMatch(result.body,/NaN|Infinity/);assert.equal(result.renderedTotal,29);
    assert.deepEqual(result.diagnostics,[{code:'COINCIDENT_FLOW_ANCHORS',relation_id:'cd',region_ids:['c','d']}]);
    for(const edge of result.layout.edges)assert.ok(edge.points.every(p=>p.every(Number.isFinite)));
    assert.ok(result.layout.edges.find(e=>e.id==='cd').points.some(p=>p[1]<40));
    assert.equal(result.layout.edges.find(e=>e.id==='zero').width,0);assert.equal(result.layout.edges.find(e=>e.id==='dd').ribbon,true);assert.equal(result.layout.edges.find(e=>e.id==='cd').ribbon,true);
  }
});

test('spatial Sankey bypasses an intervening symbol and respects configured sampling',()=>{
  const {model,anchors}=graph([['ab','a','b',10],['cc','c','c',8]],{mode:'sankey',maxWidth:12,widthGradientSettings:{samples:64}},{a:[0,0],b:[200,0],c:[100,0]}),layout=flowLayout(model,anchors),edge=layout.edges.find(e=>e.id==='ab'),node=layout.nodes.get('c');
  const crossing=edge.points.filter(p=>Math.abs(p[0]-node.x)<=node.radius+edge.width/2);
  assert.ok(crossing.length>5);for(const point of crossing)assert.ok(Math.abs(point[1]-node.y)>=node.radius+edge.width/2+2);
  assert.equal(edge.points.length,64*3+1);assert.deepEqual(edge.points[0],edge.start);assert.deepEqual(edge.points.at(-1),edge.end);
});

test('stack false collapses ports without moving geographic nodes',()=>{
  const {model,anchors}=graph(fixture,{mode:'sankey',stack:false}),layout=flowLayout(model,anchors);
  assert.equal(layout.stack,false);for(const node of layout.nodes.values()){assert.equal(node.span,0);for(const side of ['left','right'])assert.ok(node[side].every(port=>Math.hypot(port.point[0]-node.x,port.point[1]-node.y)<=node.radius+1+1e-8));}
});

test('force bundles nearby parallel interiors, pins endpoints and leaves distant and reverse routes independent',()=>{
  const routes=[{id:'p',start:[0,0],end:[200,0]},{id:'q',start:[0,10],end:[200,10]},{id:'far',start:[0,500],end:[200,500]},{id:'back',start:[200,20],end:[0,20]}],original=structuredClone(routes),result=bundleFlowPaths(routes);
  assert.equal(result.algorithm,'subdivision-force');assert.equal(result.compatible_pairs,1);
  for(const route of routes){const points=result.paths.get(route.id);assert.deepEqual(points[0],route.start);assert.deepEqual(points.at(-1),route.end);}
  const a=result.paths.get('p')[4],b=result.paths.get('q')[4];assert.ok(a[1]>0);assert.ok(b[1]<10);assert.ok(b[1]-a[1]<5);
  assert.ok(result.paths.get('far').every(p=>p[1]===500));assert.ok(result.paths.get('back').every(p=>p[1]===20));assert.deepEqual(routes,original);
  assert.equal(bundleFlowPaths(routes,{compatibilityThreshold:0}).compatible_pairs,1);
  const integrated=graph([['ab','a','b',10],['cd','c','d',8]],{bundling:true,showNodes:false},{a:[0,0],b:[200,0],c:[0,10],d:[200,10]});
  const svg=flowSvg(integrated.model,integrated.anchors);assert.equal(svg.layout.bundle.compatible_pairs,1);assert.match(svg.layout.edges[0].path,/C/);
});

test('bundling rejects invalid routes/settings, honours cancellation and limits force work',()=>{
  const route={id:'a',start:[0,0],end:[200,0]};
  for(const settings of [{iterations:0},{subdivisions:33},{distanceMax:0},{alphaDecay:2},{linkStrength:NaN},{surprise:1},{constructor:1},[]])assert.throws(()=>bundleFlowPaths([route],settings),e=>e.code==='INVALID_ENCODING');
  for(const routes of [[route,route],[{...route,start:[NaN,0]}],[{...route,id:7}],null])assert.throws(()=>bundleFlowPaths(routes),e=>e.code==='INVALID_ENCODING');
  const controller=new AbortController();controller.abort();assert.throws(()=>bundleFlowPaths([route],{},{signal:controller.signal}),e=>e.code==='ABORTED');
  assert.throws(()=>bundleFlowPaths(Array.from({length:1000},(_,i)=>({...route,id:String(i)})),{iterations:1000,subdivisions:16}),e=>e.code==='FLOW_BUNDLE_LIMIT');
  assert.equal(bundleFlowPaths([route],{distanceMax:null}).paths.size,1);
});

test('ribbon cross sections, taper, zero and legend use the same width scale',()=>{
  const points=[[0,0],[50,0],[100,0]];
  assert.equal(flowRibbon(points,0),'');assert.equal(flowRibbon(points,10), 'M0,5L50,5L100,5L100,-5L50,-5L0,-5Z');
  assert.equal(flowRibbon(points,10,{widthGradient:true,widthGradientSettings:{startRatio:.2}}),'M0,1L50,3L100,5L100,-5L50,-3L0,-1Z');
  const {view,model,anchors}=graph([['ab','a','b',10],['ba','b','a',0]],{mode:'sankey',minWidth:4,maxWidth:20,gradient:true,opacityGradient:true,widthGradient:true,outline:true,outlineWidth:2});
  const legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'},options:model.options},view,'t');
  for(const ratio of [.25,.5,1])assert.ok(legendSvg(legend).includes(`stroke-width="${flowWidth(10*ratio,10,model.options)}"`));
  const result=flowSvg(model,anchors),zero=result.layout.edges.find(e=>e.id==='ba');assert.equal(zero.render_path,'');assert.equal(zero.width,0);
  assert.equal((result.body.match(/data-flow-outline=/g)??[]).length,1);assert.match(result.definitions,/stop-opacity="0.25"/);assert.equal(result.renderedTotal,10);
});

test('flow option rejection is shared by models and capability reports',()=>{
  const {view,geography}=graph(fixture);
  for(const options of [{mode:'sankey',bundling:true},{minWidth:20,maxWidth:2},{reciprocalMode:'merge'},{order:()=>0},{curvatureSettings:[]},{widthGradientSettings:{samples:2}},{opacity:2},{stack:1},{maxNodeValue:-2},{opacity:null},{maxWidth:null},{topLocations:null}]){
    assert.throws(()=>flowModel(view,'one','t',options));
    const capability=layerCapabilities({type:'flow',encoding:{relation_series_id:'one'},options},view,geography);assert.equal(capability.supported,false);assert.ok(capability.reasons.length);
  }
});

test('flow layout and accessible export retain only one focus target per visible relation',()=>{
  const {view,geography}=graph([['ab','a','b',10],['ba','b','a',5]],{mode:'sankey'});
  // Reuse the fixture geometry with its original a/b identities.
  geography.features=sample().geography.features;
  const result=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer:{id:'flows',type:'flow',encoding:{relation_series_id:'one'},options:{mode:'sankey',outline:true}}});
  assert.equal(result.flowLayout.algorithm,'spatial-flow');
  assert.equal((result.svg.match(/data-relation-id="ab"[^>]*tabindex="0"/g)??[]).length,1);
  assert.doesNotMatch(result.svg,/data-flow-stem=[^>]*tabindex/);assert.doesNotMatch(result.svg,/data-flow-outline=[^>]*tabindex/);
});


test('OD CSV retains raw missing, zero, filtered edges and source evidence without route aggregation',()=>{
  const {geography,dataset}=sample();dataset.sources=[{id:'source',title:'Synthetic, source'}];dataset.series[0].source_refs=['source'];
  dataset.relations=[['ab','a','b',10],['ba','b','a',0],['aa','a','a',null]].map(([id,origin,destination,value])=>({id,origin_region_id:origin,destination_region_id:destination,series_id:'one',period_id:'t',status:value===null?'missing':'value',value,source_flag:'p',evidence:{source_id:'source',sha256:'a'.repeat(64),page:3}}));
  const original=structuredClone(dataset.relations),map=createMap(null,{geography,dataset});
  map.setLayers([{id:'flow',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options:{mode:'sankey',reciprocalMode:'midpoint',minValue:5}}]);
  const csv=map.export('csv');assert.match(csv,/^relation_id,origin_region_id,destination_region_id/);assert.match(csv,/ba,b,a,t,one,value,0,/);assert.match(csv,/aa,a,a,t,one,missing,,/);assert.ok(csv.includes('a'.repeat(64)));assert.ok(csv.includes('Synthetic, source'));assert.equal(csv.split('\r\n').length,4);
  const scoped=map.export('csv',{regionIds:['a','a']});assert.equal(scoped.split('\r\n').length,2);assert.match(scoped,/aa,a,a/);
  assert.equal(csv,exportRelations(new DatasetView(dataset,geography),'one','t'));assert.equal(csv,map.export('csv',{layerId:'flow'}));
  assert.throws(()=>map.export('csv',{layerId:'unknown'}),e=>e.code==='EXPORT_UNAVAILABLE');
  assert.deepEqual(dataset.relations,original);map.destroy();
});

test('invalid flow settings fail spec validation before mounting',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset}),spec=structuredClone(map.spec);
  spec.layers=[{id:'flow',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options:{mode:'sankey',bundling:true}}];
  assert.throws(()=>validateMapSpec(spec),e=>e.code==='UNSUPPORTED_ENCODING');map.destroy();
});


test('wide directed line arrows extend beyond the shaft without covering destination nodes',()=>{
  const {model,anchors}=graph([['ab','a','b',10]],{mode:'straight',maxWidth:20}),result=flowSvg(model,anchors),edge=result.layout.edges[0],target=result.layout.nodes.get('b');
  assert.equal(edge.arrow_size,30);assert.equal(edge.end[0]+edge.arrow_size,target.x-target.radius-1);assert.match(result.definitions,/markerWidth="30" markerHeight="30" refX="0"/);assert.match(result.body,/marker-end=/);
  const none=graph([['ab','a','b',10]],{mode:'straight',arrows:false});assert.equal(flowSvg(none.model,none.anchors).layout.edges[0].arrow_size,undefined);
});
