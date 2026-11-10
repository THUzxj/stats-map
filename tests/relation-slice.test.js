import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, relationSlice, relationSliceView, createMap, buildTooltip, buildRanking, buildRegionList, validateMapSpec, SmallMultiples } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

function fixture(){
  const {geography,dataset}=sample();
  for(const id of ['c','d','e'])geography.regions.push({id,label:id.toUpperCase(),level_id:'area'});
  dataset.periods.push({id:'u',label:'U',order:1});
  dataset.sources=[{id:'source',title:'Synthetic OD source'}];
  dataset.relations=[['aa','a','a',99],['ab','a','b',0],['ac','a','c',-4],['ad','a','d',-4],['ae','a','e',null],['ba','b','a',12],['ca','c','a',6]].map(([id,origin_region_id,destination_region_id,value])=>({id,origin_region_id,destination_region_id,value,status:value===null?'suppressed':'value',series_id:'one',period_id:'t',evidence:{source_id:'source',sha256:'a'.repeat(64),page:id},source_flag:id}));
  dataset.relations.push({...dataset.relations[1],id:'ab-u',period_id:'u',value:21});
  const spec={schema_version:1,kind:'stats-map/spec',id:'slice',revision:'r1',geography_ref:dataset.geography_ref,dataset_refs:[{id:dataset.id,revision:dataset.revision}],view:{period_id:'t',relation_region_id:'a'},layout:{type:'grid-square'},layers:[{id:'partners',type:'choropleth',encoding:{dataset_id:dataset.id,relation_series_id:'one',relation_slice:{axis:'origin',include_internal:false}},classification:{method:'equalInterval',classes:3}}],interaction:{relationRegionOnClick:true}};
  return {geography,dataset,spec,view:new DatasetView(dataset,geography)};
}
function frame(f=fixture()){return createMap(null,{...f,spec:f.spec});}

test('OD slice preserves asymmetry, negative scores, zero, suppressed and absent pairs without observation fallback',()=>{
  const {view,spec}=fixture(),out=relationSlice(view,'one','t',{axis:'origin'},spec),incoming=relationSlice(view,'one','t',{axis:'destination'},spec);
  assert.equal(out.byRegion.get('b').value,0);assert.equal(incoming.byRegion.get('b').value,12);
  assert.equal(out.byRegion.get('c').value,-4);assert.equal(out.byRegion.get('e').status,'suppressed');
  assert.equal(incoming.byRegion.get('d').status,'missing');assert.equal(incoming.byRegion.get('d').relation_slice.reported_status,null);
  assert.equal(view.observation('one','b','t').value,40);assert.equal(view.data.relations.length,8);
  assert.deepEqual(out.byRegion.get('b').evidence,view.relations('one','t').find(row=>row.id==='ab').evidence);
});

test('top ranks signed values with deterministic partner ties after scope and internal exclusions',()=>{
  const {view,spec}=fixture(),slice={axis:'origin',include_internal:false,top:2};
  const model=relationSlice(view,'one','t',slice,spec);
  assert.deepEqual(model.top,['b','c']);assert.equal(model.byRegion.get('a').relation_slice.excluded_reason,'internal');
  assert.equal(model.byRegion.get('d').status,'out_of_scope');assert.equal(model.byRegion.get('d').relation_slice.reported_value,-4);
  assert.equal(model.byRegion.get('e').status,'suppressed');
  assert.deepEqual(relationSlice(view,'one','t',slice,{...spec,view:{...spec.view,region_ids:['d','e']}}).top,['d']);
});

test('facade projects composition and all periods without mutating or deriving missing OD ratios',()=>{
  const {view,spec}=fixture(),projected=relationSliceView(view,{axis:'origin'},spec);
  assert.equal(projected.observation('one','b','u').value,21);
  assert.equal(projected.observation('two','b','t').status,'missing');
  assert.equal(projected.summary(['b'],'one','t').value,0);
  assert.equal(projected.summary(['b','c'],'one','t').value,null);
  assert.throws(()=>projected.summary(['b'],'one','t',{basisId:'basis'}),/aggregation basis/);
  assert.equal(view.observation('one','b','t').value,40);
});

test('render, legend, tooltip, accessibility, ranking and list use the same projected values and actual OD evidence',()=>{
  const map=frame(),render=map.render(),tooltip=buildTooltip(map,{layer_id:'partners',region_id:'b'});
  assert.equal(tooltip.channels[0].observation.value,0);assert.equal(tooltip.channels[0].reported_observation.id,'ab');
  assert.equal(tooltip.derived.type,'relation-region-slice');assert.equal(tooltip.channels[0].relations[0].id,'ab');
  assert.match(render.svg,/A → B/);assert.match(render.svg,/ab/);assert.match(tooltip.rows.map(row=>row.value).join(' '),/sha256/);
  assert.deepEqual(buildRanking(map).rows.map(row=>[row.region_id,row.value]),[['b',0],['c',-4],['d',-4]]);
  assert.equal(buildRegionList(map).rows.find(row=>row.region_id==='b').channels[0].observation.value,0);
  assert.deepEqual(render.renders[0].domain.domain,[-4,-4,0]);assert.equal(render.legends[0].missing,true);
  assert.equal(map.capabilities()[0].supported,true);map.destroy();
});

test('anchor changes are transactional, independent of selection, serializable and refreshed by setData',()=>{
  const map=frame(),events=[];map.on('relationregionchange',event=>events.push(event));map.setSelection(['c']);
  map.setRelationRegion('b',{source:'test',inset_id:'detail'});
  assert.equal(buildRanking(map).rows[0].value,12);assert.deepEqual([...map.selection],['c']);
  assert.deepEqual(events[0],{region_id:'b',previous_region_id:'a',source:'test',inset_id:'detail'});
  const previous=map.spec;assert.throws(()=>map.setRelationRegion('unknown'));assert.equal(map.spec,previous);
  const saved=map.getState();map.setRelationRegion('a');map.loadState(saved);assert.equal(map.spec.view.relation_region_id,'b');
  const reopened=frame({...fixture(),spec:map.exportSpec({resolved:true})});assert.equal(buildRanking(reopened).rows[0].value,12);
  const next=structuredClone(map.datasets.get('amounts'));next.relations.find(row=>row.id==='ba').value=17;map.setData(next);assert.equal(buildRanking(map).rows[0].value,17);
  next.relations[0].value=Infinity;assert.throws(()=>map.setData(next));assert.equal(buildRanking(map).rows[0].value,17);
  map.destroy();reopened.destroy();
});

test('CSV keeps raw OD as default; explicit projection includes exclusions, zero, missing and source identity',()=>{
  const map=frame(),before=map.export('csv');map.setView({region_ids:['b','c']});
  assert.equal(map.export('csv'),before);assert.match(before,/relation_id,origin_region_id/);
  const csv=map.export('csv',{relationSlice:true});assert.match(csv,/derived_type,axis,anchor_region_id/);assert.match(csv,/relation-region-slice,origin,a,b,a,b,ab,t,one,value,0,value,0/);
  assert.match(csv,/relation-region-slice,origin,a,a,a,a,aa,t,one,out_of_scope,,value,99,internal/);assert.match(csv,/source/);
  map.setRelationRegion('b');assert.match(map.export('csv',{relationSlice:true}),/relation-region-slice,origin,b,c,b,c,,t,one,missing,,,/);
  map.destroy();
});

test('invalid slice specifications and incompatible regional aggregation fail before committing state',()=>{
  const {geography,dataset,spec}=fixture(),datasets=new Map([[dataset.id,dataset]]);
  for(const slice of [{axis:'both'},{axis:'origin',top:0},{axis:'origin',top:1.2},{axis:'origin',region_id:'unknown'},{axis:'origin',include_internal:1},{axis:'origin',typo:true}]){
    const next=structuredClone(spec);next.layers[0].encoding.relation_slice=slice;assert.throws(()=>validateMapSpec(next,geography,datasets));
  }
  const map=frame(),previous=map.spec;
  assert.throws(()=>map.setSpec({...map.spec,aggregation:{dataset_id:dataset.id,basis_id:'basis',display_value:'rollup'}}));assert.equal(map.spec,previous);
  assert.throws(()=>map.setLayers([{...spec.layers[0],type:'flow'}]),/flow cannot/);
  const encoding={...spec.layers[0].encoding};delete encoding.relation_slice;assert.throws(()=>map.setLayers([{...spec.layers[0],encoding}]),/requires relation_slice/);map.destroy();
});

test('sparkline tooltip uses the current slice across time and reports the actual direction',()=>{
  const f=fixture();f.spec.layers[0].type='sparkline';f.spec.layers[0].encoding={dataset_id:f.dataset.id,series_id:'one',relation_slice:{axis:'origin'}};
  const map=frame(f),tooltip=buildTooltip(map,{layer_id:'partners',region_id:'b',period_id:'u'});
  assert.deepEqual(tooltip.chart.periods.map(point=>point.value),[0,21]);assert.equal(tooltip.channels[0].reported_observation.id,'ab-u');
  map.setRelationRegion('b');assert.deepEqual(buildTooltip(map,{layer_id:'partners',region_id:'a'}).chart.periods.map(point=>point.value),[12,null]);map.destroy();
});

test('named bivariate channels keep separate slices while shared-view compositions reject mixed slices',()=>{
  const f=fixture(),slice=axis=>({dataset_id:f.dataset.id,series_id:'one',relation_slice:{axis}});
  f.spec.layers[0]={id:'partners',type:'bivariateChoropleth',encoding:{x:slice('origin'),y:slice('destination')}};
  const map=frame(f),tooltip=buildTooltip(map,{layer_id:'partners',region_id:'b'});assert.deepEqual(tooltip.channels.map(channel=>channel.observation.value),[0,12]);
  assert.equal(buildRegionList(map).rows.find(row=>row.region_id==='b').channels.length,2);
  assert.throws(()=>map.setLayers([{...f.spec.layers[0],type:'mushroom'}]),/same relation_slice/);map.destroy();
});

test('regional exception observations are retained without inheriting the OD slice',()=>{
  const f=fixture();f.dataset.dimensions=[{id:'flags',values:[{id:'flag',label:'Flag'}]}];f.dataset.metrics.push({id:'flag',label:'Flag',value_type:'category',aggregation:'none',category_dimension_id:'flags'});
  f.dataset.series.push({id:'flag',metric_id:'flag',unit_id:'u',scope_id:'all'});f.dataset.observations.push({id:'flag-a',series_id:'flag',region_id:'a',period_id:'t',value:'flag',status:'value'});
  f.spec.layers[0].encoding.exception={series_id:'flag'};const map=frame(f);assert.match(map.render().svg,/data-exception="flag"/);
  assert.equal(buildTooltip(map,{layer_id:'partners',region_id:'a'}).channels[1].reported_observation.id,'flag-a');map.destroy();
});

test('ratios use the reported OD score without calculating from regional dependency observations',()=>{
  const f=fixture();f.dataset.metrics.push({id:'ratio',label:'Score',value_type:'number',aggregation:'ratio',derivation:{type:'ratio',numerator_series_id:'two',denominator_series_id:'total'}});
  f.dataset.series[0].metric_id='ratio';const projected=relationSliceView(new DatasetView(f.dataset,f.geography),{axis:'origin'},f.spec);
  assert.equal(projected.observation('one','b','t').value,0);assert.equal(projected.summary(['b'],'one','t').value,0);
  assert.equal(projected.observation('one','e','t').status,'suppressed');
  const map=frame(f);assert.equal(buildTooltip(map,{layer_id:'partners',region_id:'b'}).channels[0].observation.value,0);map.destroy();
});

test('composition components and declared totals all use the same selected OD row',()=>{
  const f=fixture();f.dataset.relations=f.dataset.relations.filter(row=>row.value===null||row.value>=0);
  f.dataset.relations.push(...[['two',4],['total',10]].map(([series_id,value])=>({id:series_id+'-ab',series_id,value,status:'value',origin_region_id:'a',destination_region_id:'b',period_id:'t'})));
  f.spec.layers[0]={id:'partners',type:'pieChart',encoding:{dataset_id:f.dataset.id,series_ids:['one','two'],relation_slice:{axis:'origin'}},options:{totalSeriesId:'total',showOther:true}};
  const map=frame(f);map.render();const tooltip=buildTooltip(map,{layer_id:'partners',region_id:'b',series_id:'__other__'});
  assert.equal(tooltip.derived.value,6);assert.equal(tooltip.derived.total,10);assert.deepEqual(tooltip.channels.map(channel=>channel.observation.value),[0,4,10]);
  assert.match(map.export('csv',{seriesId:'two',relationSlice:true}),/two-ab/);map.destroy();
});

test('small multiples resolve a shared domain across independent anchor slices and periods',()=>{
  const map=frame(),bundle={...map.bundle,resources:map.bundle.resources.map(entry=>entry.resource?.kind==='stats-map/spec'?{storage:'inline',resource:map.spec}:entry)};
  const panels=new SmallMultiples(null,bundle,[{id:'out',view:{relation_region_id:'a'}},{id:'reverse',view:{relation_region_id:'b'}},{id:'later',period_id:'u'}],{sharedDomain:true});
  assert.deepEqual(panels.maps.map(panel=>panel.spec.layers[0].classification.thresholds),panels.maps.map(()=>panels.maps[0].spec.layers[0].classification.thresholds));
  assert.deepEqual(panels.maps.map(panel=>buildRanking(panel).rows[0].value),[0,12,21]);
  assert.equal(panels.maps[0].spec.layers[0].classification.thresholds.at(-1)>12,true);panels.destroy();map.destroy();
});

test('a pinned slice anchor stays fixed when the interactive anchor changes',()=>{
  const f=fixture();f.spec.layers[0].encoding.relation_slice.region_id='b';const map=frame(f);
  map.setRelationRegion('c');assert.equal(buildRanking(map).rows[0].value,12);assert.equal(buildTooltip(map,{layer_id:'partners',region_id:'a'}).derived.anchor_region_id,'b');map.destroy();
});

