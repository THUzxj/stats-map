import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, buildLegend, legendSvg, validateDataset, renderSvg } from '../src/index.js';
import { flowModel, flowSvg } from '../src/renderers/flow.js';
import { sample } from './fixtures/encoding.js';

function graph(){
  const {geography,dataset}=sample();
  geography.regions.push({id:'c',label:'C without geometry',level_id:'area'});
  dataset.relations=[['ab','a','b',10],['ba','b','a',5],['aa','a','a',3],['bc','b','c',7],['missing','a','c',null]].map(([id,origin,destination,value])=>({id,origin_region_id:origin,destination_region_id:destination,series_id:'one',period_id:'t',status:value==null?'missing':'value',value}));
  return {geography,dataset,view:new DatasetView(dataset,geography),anchors:new Map([['a',[10,20]],['b',[150,90]]])};
}

test('flow statistics separate incoming, outgoing and internal and retain missing geometry diagnostics',()=>{
  const {view,anchors}=graph(),model=flowModel(view,'one','t');
  assert.equal(model.before.total,25);assert.equal(model.filtered.total,25);assert.equal(model.filtered.internal,3);assert.equal(model.filtered.crossBoundary,22);
  assert.deepEqual(model.filtered.nodes.get('a'),{id:'a',incoming:5,outgoing:10,internal:3});
  assert.deepEqual(model.filtered.nodes.get('b'),{id:'b',incoming:10,outgoing:12,internal:0});
  const result=flowSvg(model,anchors);
  assert.equal(result.renderedTotal,18);
  assert.deepEqual(result.diagnostics,[{code:'MISSING_ANCHOR',relation_id:'bc',region_ids:['c']}]);
  assert.equal(model.missing,true);
  const legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'}},view,'t');
  assert.match(legendSvg(legend),/Before filtering 25 \/ After filtering 25/);
  assert.match(legendSvg(legend),/Between regions 22 \/ Internal 3/);
});

test('each flow mode renders directed non-overlapping reverse edges and a distinct self loop',()=>{
  const {view,anchors}=graph();
  for(const mode of ['curved','straight','sankey']){
    const result=flowSvg(flowModel(view,'one','t',{mode}),anchors,'instance');
    const path=id=>result.body.match(new RegExp(`<path data-relation-id="${id}"[^>]*? d="([^"]+)"`))[1];
    assert.notEqual(path('ab'),path('ba'));
    assert.match(result.layout.edges.find(edge=>edge.id==='aa').path,/C/);
    assert.match(result.layout.edges.find(edge=>edge.id==='ab').path,mode==='curved'?/Q/:mode==='sankey'?/C/:/L/);
    if(mode==='sankey'){assert.ok(result.layout.edges.every(edge=>edge.ribbon));assert.match(path('ab'),/Z$/);}
    if(mode!=='sankey')assert.match(result.body,/marker-end="url\(#flow-[^)]+\)"/);
    assert.doesNotMatch(result.body,/NaN|Infinity/);
  }
});

test('horizontal reciprocal flow paths separate spatially and end before covering node centers',()=>{
  const {view}=graph(),anchors=new Map([['a',[0,0]],['b',[200,0]]]);
  for(const mode of ['straight','sankey']){
    const result=flowSvg(flowModel(view,'one','t',{mode}),anchors);
    const ab=result.layout.edges.find(edge=>edge.id==='ab'),ba=result.layout.edges.find(edge=>edge.id==='ba');
    assert.notEqual(ab.start[1],ba.end[1]);assert.notEqual(ab.end[1],ba.start[1]);
    assert.ok(ab.start[0]>0);assert.ok(ba.start[0]<200);assert.ok(ab.end[0]<200);assert.ok(ba.end[0]>0);
    assert.ok(Math.abs(ab.start[1]-ba.end[1])>=(ab.width+ba.width)/2);
  }
});

test('flow filters disclose before and after totals without mutating source edges',()=>{
  const {view}=graph(),original=structuredClone(view.data.relations);
  const min=flowModel(view,'one','t',{minValue:6});assert.equal(min.before.total,25);assert.equal(min.filtered.total,17);
  const scoped=flowModel(view,'one','t',{},['a','b']);assert.equal(scoped.filtered.total,18);
  const external=flowModel(view,'one','t',{showInternal:false});assert.equal(external.filtered.total,22);assert.equal(external.filtered.internal,0);
  const top=flowModel(view,'one','t',{topLocations:1});assert.deepEqual(top.top,['b']);assert.equal(top.filtered.total,22);
  assert.deepEqual(view.data.relations,original);
});

test('flow gradients, outlines, bundling, stacking and donut nodes preserve edge identities',()=>{
  const {view,anchors}=graph(),model=flowModel(view,'one','t',{gradient:true,outline:true,bundling:.6,stack:true,nodeShape:'donut'}),a=flowSvg(model,anchors,'a'),b=flowSvg(model,anchors,'b');
  assert.equal((a.definitions.match(/<linearGradient /g)??[]).length,3);
  assert.match(a.body,/data-flow-channel="incoming"/);assert.match(a.body,/data-flow-channel="internal"/);
  assert.equal((a.body.match(/data-relation-id="ab"/g)??[]).length,2);
  assert.match(a.body,/Incoming \/ Other: 5/);assert.match(a.body,/Outgoing \/ Other: 10/);assert.match(a.body,/Internal \/ Internal: 3/);
  assert.notEqual(a.definitions,b.definitions);
  assert.equal(a.renderedTotal,b.renderedTotal);
});

test('flow rejects duplicate edge ids and keys, negative size and unsafe precision',()=>{
  const {geography,dataset}=graph();
  for(const duplicate of [{...dataset.relations[0],origin_region_id:'c'}, {...dataset.relations[0],id:'another'}])assert.throws(()=>validateDataset({...dataset,relations:[...dataset.relations,duplicate]},geography));
  const negative=structuredClone(dataset);negative.relations[0].value=-1;
  assert.throws(()=>flowModel(new DatasetView(negative,geography),'one','t'),error=>error.code==='UNSUPPORTED_VALUE');
  const unsafe=structuredClone(dataset);unsafe.relations[0].value=Number.MAX_SAFE_INTEGER+1;
  assert.throws(()=>validateDataset(unsafe,geography),error=>error.code==='PRECISION_LOSS');
});

test('flow renderer returns total coverage and geometry diagnostics to the host',()=>{
  const {geography,view}=graph(),result=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer:{id:'edges',type:'flow',encoding:{relation_series_id:'one'}}});
  assert.equal(result.flowSummary.total,25);assert.equal(result.flowSummary.renderedTotal,18);
  assert.equal(result.diagnostics[0].relation_id,'bc');
});
