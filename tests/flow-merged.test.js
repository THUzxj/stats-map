import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, flowModel, flowSvg, flowWidth, buildLegend, legendSvg, buildTooltip, DatasetView } from '../src/index.js';
import { flowDisplayEdges, flowRouteId } from '../src/renderers/flow-routes.js';
import { mapTarget, dispatchMapTarget } from '../src/core/interaction-events.js';
import { comparisonDomains } from '../src/components/comparison.js';
import { sample } from './fixtures/encoding.js';

function fixture(records=[['ab','a','b',10],['ba','b','a',5],['aa','a','a',3]],options={}){
  const {geography,dataset}=sample();
  dataset.relations=records.map(([id,origin,destination,value])=>({id,origin_region_id:origin,destination_region_id:destination,value,status:value===null?'missing':'value',series_id:'one',period_id:'t',source_flag:id,evidence:{source_id:id,sha256:(id==='ab'?'a':'b').repeat(64)}}));
  dataset.sources=[{id:'synthetic',title:'Synthetic OD'}];dataset.series[0].source_refs=['synthetic'];
  const map=createMap(null,{geography,dataset});map.setLayers([{id:'flows',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options:{reciprocalMode:'merged',...options}}]);
  const view=new DatasetView(dataset,geography),model=flowModel(view,'one','t',map.spec.layers[0].options),anchors=new Map([['a',[0,0]],['b',[200,0]]]);
  return {geography,dataset,map,view,model,anchors};
}
const target=()=>({layer_id:'flows',kind:'route',route_id:flowRouteId('a','b'),endpoint_region_ids:['spoof','ids'],source_relation_ids:['spoof'],value:999});
function domTarget(attributes){
  const layer={getAttribute:name=>name==='data-layer-id'?'flows':null},element={getAttribute:name=>attributes[name]??null,closest:()=>layer};
  return {closest:selector=>selector.includes('[data-flow-route-id]')||selector.startsWith('[data-relation-id]')?element:null};
}

test('merged routes conserve graph totals with a separate derived identity and scale',()=>{
  const {map,model,anchors,dataset}=fixture(),raw=structuredClone(dataset.relations),result=flowSvg(model,anchors),route=result.layout.edges.find(edge=>edge.route_id);
  assert.equal(model.edges.length,3);assert.equal(model.displayEdges.length,2);assert.equal(route.value,15);assert.deepEqual(route.source_relation_ids,['ab','ba']);assert.deepEqual(route.endpoint_region_ids,['a','b']);assert.equal(route.width,12);assert.equal(model.maximum,15);
  assert.equal(result.renderedTotal,18);assert.equal(model.filtered.total,18);assert.equal(model.filtered.internal,3);assert.deepEqual(model.filtered.nodes.get('a'),{id:'a',incoming:5,outgoing:10,internal:3});
  assert.match(result.body,/data-flow-route-id=/);assert.doesNotMatch(result.body,/data-relation-id="ab"|data-relation-id="ba"/);assert.equal(route.arrow_size,undefined);assert.doesNotMatch(result.body,/marker-end=/);assert.equal(result.layout.edges.find(edge=>edge.id==='aa').self,true);
  assert.deepEqual(dataset.relations,raw);map.destroy();
});

test('reciprocal routes are invariant under input and id ordering without delimiter collisions',()=>{
  const first=fixture(),second=fixture([...first.dataset.relations].reverse().map(e=>[e.id,e.origin_region_id,e.destination_region_id,e.value]));
  assert.deepEqual(first.model.displayEdges,second.model.displayEdges);assert.deepEqual(flowSvg(first.model,first.anchors),flowSvg(second.model,second.anchors));
  assert.equal(flowRouteId('b','a'),flowRouteId('a','b'));assert.notEqual(flowRouteId('a|b','c'),flowRouteId('a','b|c'));assert.notEqual(flowRouteId('a\u0000b','c'),flowRouteId('a','b\u0000c'));
  assert.equal(JSON.parse(flowRouteId('a"<','β').slice('flow-route:'.length))[0],'a"<');first.map.destroy();second.map.destroy();
});

test('every line mode, variable width and bundles retain neutral merged routes and original self loops',()=>{
  for(const mode of ['curved','straight','sankey'])for(const widthGradient of [false,true]){
    const {map,model,anchors}=fixture(undefined,{mode,widthGradient,gradient:true,outline:true,stack:true,minWidth:2,maxWidth:20}),result=flowSvg(model,anchors),route=result.layout.edges.find(e=>e.route_id);
    assert.equal(result.renderedTotal,18);assert.equal(route.width,20);assert.doesNotMatch(result.body,/marker-end=/);assert.equal(route.source_relation_ids.length,2);assert.equal(result.layout.midpoints.length,0);
    for(const node of result.layout.nodes.values())for(const side of ['left','right']){const ports=node[side].filter(p=>p.edge.width);if(ports.length)assert.equal((ports[0].interval[0]+ports.at(-1).interval[1])/2,node.y);}
    if(route.ribbon)assert.match(route.render_path,/Z$/);assert.doesNotMatch(result.body,/NaN|Infinity/);map.destroy();
  }
  const bundled=fixture(undefined,{bundling:true});assert.equal(flowSvg(bundled.model,bundled.anchors).layout.bundle.algorithm,'subdivision-force');bundled.map.destroy();
});

test('filtering occurs on raw edges before summing routes and scale follows displayed values',()=>{
  const {map,model,anchors}=fixture(undefined,{minValue:6,minWidth:2,maxWidth:14});
  assert.equal(model.before.total,18);assert.equal(model.filtered.total,10);assert.equal(model.maximum,10);assert.deepEqual(model.displayEdges[0].source_relation_ids,['ab']);
  const tooltip=buildTooltip(map,target());assert.equal(tooltip.target.value,10);assert.deepEqual(tooltip.target.source_relation_ids,['ab']);assert.equal(tooltip.derived.value,10);
  assert.ok(tooltip.rows.some(r=>r.label.includes('B → A / ba / Excluded')&&r.value==='5 items'));assert.ok(tooltip.rows.some(r=>r.label.includes('A → B / ab / Displayed')&&r.value==='10 items'));
  const legend=buildLegend(map.spec.layers[0],map._views.get('amounts'),'t');assert.equal(legend.maximum,10);assert.match(legendSvg(legend),/Displayed route total/);assert.match(legendSvg(legend),/stroke-width="8"/);
  assert.equal(flowSvg(model,anchors).renderedTotal,10);assert.match(map.export('csv'),/ba,b,a,t,one,value,5/);map.destroy();
});

test('zero, missing and absent reverse directions retain distinct route provenance',()=>{
  for(const reverse of [0,null,'absent']){
    const records=[['ab','a','b',10],...(reverse==='absent'?[]:[['ba','b','a',reverse]])],{map,model}=fixture(records),tip=buildTooltip(map,target()),channel=tip.channels[0];
    assert.equal(tip.derived.value,10);assert.equal(channel.observation,null);assert.equal(channel.reported_observation,null);assert.equal(channel.registered_relations.length,reverse==='absent'?1:2);
    if(reverse===0){assert.deepEqual(channel.route.source_relation_ids,['ab','ba']);assert.ok(tip.rows.some(r=>r.label.includes('B → A / ba / Displayed')&&r.value==='0 items'));assert.deepEqual(channel.coverage,{present:2,expected:2});}
    if(reverse===null){assert.deepEqual(channel.route.source_relation_ids,['ab']);assert.ok(tip.rows.some(r=>r.label.includes('B → A / ba / Excluded')&&r.value==='No data'));assert.deepEqual(channel.coverage,{present:1,expected:2});}
    if(reverse==='absent')assert.ok(!tip.rows.some(r=>r.label.includes('B → A')));
    assert.equal(model.displayEdges.length,1);map.destroy();
  }
  const zero=fixture([['ab','a','b',0],['ba','b','a',0]],{mode:'sankey',outline:true,minWidth:2});const svg=flowSvg(zero.model,zero.anchors);assert.equal(svg.layout.edges[0].width,0);assert.equal(svg.layout.edges[0].render_path,'');assert.doesNotMatch(svg.body,/data-flow-outline/);zero.map.destroy();
});

test('route tooltip discloses each evidence and uses authoritative values instead of target attributes',()=>{
  const {map}=fixture(),tip=buildTooltip(map,target());
  assert.equal(tip.title,'A ↔ B');assert.equal(tip.derived.type,'flow-route-sum');assert.equal(tip.derived.value,15);assert.deepEqual(tip.target.endpoint_region_ids,['a','b']);assert.equal(tip.target.value,15);
  assert.equal(tip.channels[0].observation,null);assert.deepEqual(tip.channels[0].relations.map(e=>e.value),[10,5]);assert.ok(tip.rows.some(r=>r.label==='Evidence / ab'&&r.value.includes('a'.repeat(64))));assert.ok(tip.rows.some(r=>r.label==='Evidence / ba'&&r.value.includes('b'.repeat(64))));
  assert.ok(tip.rows.some(r=>r.label==='Source flag / ba'&&r.value==='ba'));assert.ok(tip.rows.some(r=>r.value==='Synthetic OD'));
  map.setLocale('zh');assert.ok(buildTooltip(map,target()).rows.some(r=>r.label==='显示路线合计'));map.setLayers(map.spec.layers.map(l=>({...l,options:{reciprocalMode:'separate'}})));assert.equal(buildTooltip(map,target()),null);map.destroy();
});

test('route events preserve composite identity with independent click/focus semantics and no region selection',()=>{
  const {map}=fixture(),events=[];map.on('routeclick',payload=>events.push(payload));map.on('routefocus',payload=>events.push(payload));
  const element=domTarget({'data-flow-route-id':target().route_id,'data-route-endpoint-region-ids':'["wrong","ids"]','data-source-relation-ids':'["wrong"]','data-value':'999','data-series-id':'one'});
  assert.equal(mapTarget(element).kind,'route');assert.equal(mapTarget(element).relation_id,undefined);
  dispatchMapTarget(map,{target:element});dispatchMapTarget(map,{target:element},'focus');assert.equal(events.length,2);
  for(const event of events){assert.equal(event.value,15);assert.deepEqual(event.source_relation_ids,['ab','ba']);assert.deepEqual(event.endpoint_region_ids,['a','b']);assert.equal(event.channels[0].observation,null);assert.equal(event.relation_id,undefined);assert.equal(event.origin_region_id,undefined);}
  assert.equal(map.selection.size,0);assert.equal(mapTarget(domTarget({'data-flow-route-id':target().route_id,'data-flow-outline':'true'})),null);
  map.setLayers(map.spec.layers.map(l=>({...l,options:{reciprocalMode:'separate'}})));dispatchMapTarget(map,{target:element});assert.equal(events.length,2);map.destroy();
});

test('accessible standalone routes list both directions once without assigning raw relation identity',()=>{
  const {map}=fixture(undefined,{mode:'sankey',outline:true});const svg=map.export('svg'),mark=svg.match(/<path data-flow-route-id="[^>]*tabindex="0"[^>]*>/g);
  assert.equal(mark.length,1);assert.match(mark[0],/A ↔ B/);assert.match(mark[0],/Displayed route total: 15 items/);assert.match(mark[0],/A → B \/ ab \/ Displayed: 10 items/);assert.match(mark[0],/B → A \/ ba \/ Displayed: 5 items/);assert.doesNotMatch(mark[0],/data-relation-id=|data-origin-region-id=/);
  assert.equal(map.export('csv').split('\r\n').length,4);assert.doesNotMatch(map.export('csv'),/flow-route:/);map.destroy();
});

test('merged scale freezes in resolved specs and is shared over multiple periods',()=>{
  const {map,dataset}=fixture();const data=structuredClone(dataset);data.revision='r2';data.periods.push({id:'t2',label:'T2',order:1});data.relations.push(...data.relations.map(e=>({...e,id:e.id+'2',period_id:'t2',value:e.value*2})));map.setData(data);
  const domains=comparisonDomains(map.spec,[map.spec,{...map.spec,view:{period_id:'t2'}}],map.datasets,map.geography);assert.equal(domains.get('flows').options.maxValue,30);
  const spec=map.exportSpec({resolved:true});assert.equal(spec.layers[0].options.maxValue,15);assert.equal(spec.layers[0].options.reciprocalMode,'merged');map.setView({period_id:'t2'});assert.equal(map.exportSpec({resolved:true}).layers[0].options.maxValue,30);map.destroy();
});

test('missing-anchor routes return composite diagnostics without fabricated relation ids',()=>{
  const {map,model}=fixture(),result=flowSvg(model,new Map([['a',[0,0]]]));
  const diagnostic=result.diagnostics.find(d=>d.route_id);assert.deepEqual(diagnostic,{code:'MISSING_ANCHOR',route_id:flowRouteId('a','b'),source_relation_ids:['ab','ba'],region_ids:['b']});assert.equal(diagnostic.relation_id,undefined);assert.equal(result.renderedTotal,3);map.destroy();
});

test('sum precision and overflow failures reject merged updates transactionally',()=>{
  const {map}=fixture();const data=structuredClone(map.datasets.get('amounts'));data.relations[0].value=Number.MAX_SAFE_INTEGER;data.relations[1].value=1;
  const previous=JSON.stringify(map.spec),svg=map.render().svg;assert.throws(()=>map.setData(data),e=>e.code==='PRECISION_LOSS');assert.equal(JSON.stringify(map.spec),previous);assert.equal(map.lastRender.svg,svg);assert.equal(map.datasets.get('amounts').relations[0].value,10);map.destroy();
});


test('a reported id equal to a derived route id stays distinct through bundling and export',()=>{
  const records=[['ab','a','b',10],['ba','b','a',5],[flowRouteId('a','b'),'a','a',3]],{map,model,anchors}=fixture(records,{bundling:true}),result=flowSvg(model,anchors);
  assert.equal(new Set(result.layout.edges.map(e=>e.layout_key)).size,2);assert.equal(result.renderedTotal,18);assert.equal(result.layout.bundle.paths.size,1);assert.deepEqual(result.layout.edges.find(e=>e.self).source_relation_ids,[flowRouteId('a','b')]);
  assert.equal(buildTooltip(map,target()).derived.value,15);assert.match(map.export('csv'),/flow-route:/);map.destroy();
});


test('fractional reciprocal sums remain deterministic under raw input permutations',()=>{
  const edges=[{id:'z',origin_region_id:'a',destination_region_id:'b',value:.1},{id:'a',origin_region_id:'b',destination_region_id:'a',value:.2}];
  assert.deepEqual(flowDisplayEdges(edges,'merged'),flowDisplayEdges([...edges].reverse(),'merged'));
  assert.equal(flowDisplayEdges(edges,'merged')[0].value,.30000000000000004);
});
