import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, buildLegend, DatasetView, validateMapSpec, layerCapabilities, listRenderers, capabilities } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

function multiple() {
  const {geography,dataset}=sample(),instance=createMap(null,{geography,dataset}),bundle=structuredClone(instance.bundle);instance.destroy();
  const second=structuredClone(dataset);second.id='second';second.units[0].label='second units';
  second.observations=second.observations.filter(observation=>observation.region_id==='a').map(observation=>({...observation,value:1000}));
  bundle.resources.push({storage:'inline',resource:second});
  const spec=bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource;
  spec.dataset_refs.push({id:second.id,revision:second.revision});
  spec.layers=[{id:'comparison',role:'base',type:'bivariateChoropleth',encoding:{x:{dataset_id:dataset.id,series_id:'one'},y:{dataset_id:second.id,series_id:'one'}},classification:{method:'threshold',thresholds:[20,50]}}];
  return {bundle,spec,first:dataset,second,geography};
}

test('independent bivariate and alpha channels resolve colliding series ids in different datasets',()=>{
  const {bundle,spec,first,second,geography}=multiple(),map=createMap(bundle);
  let svg=map.render().svg;
  assert.match(svg,/<path data-region-id="a"[^>]+fill="#d1e5f0"/);
  assert.match(svg,/<path data-region-id="b"[^>]+fill="#e5e7eb"/);
  const views=new Map([[first.id,new DatasetView(first,geography)],[second.id,new DatasetView(second,geography)]]);
  let legend=buildLegend(spec.layers[0],views.get(first.id),'t',{datasetViews:views});
  assert.deepEqual(legend.axes.map(axis=>axis.unit),['items','second units']);
  map.setLayers([{...spec.layers[0],type:'alpha'}]);svg=map.render().svg;
  assert.match(svg,/<path data-region-id="b"[^>]+fill="#e5e7eb"/);
  legend=buildLegend(map.spec.layers[0],views.get(first.id),'t',{datasetViews:views});
  assert.equal(legend.unit,'second units');assert.equal(legend.bands[0].value,1000);
  const next=structuredClone(second);next.revision='r2';next.observations=next.observations.map(observation=>({...observation,value:2000}));map.setData(next);
  assert.equal(map.datasets.get(first.id).revision,'r1');assert.equal(map.datasets.get(second.id).revision,'r2');
  assert.equal(map._views.get(second.id).observation('one','a','t').value,2000);map.destroy();
});

test('unimplemented cross-dataset compositions fail explicitly and setData validation is transactional',()=>{
  const {bundle,spec,first,second,geography}=multiple();
  assert.throws(()=>validateMapSpec({...spec,layers:[{...spec.layers[0],type:'mushroom'}]},geography,new Map([[first.id,first],[second.id,second]])),error=>error.code==='UNSUPPORTED_ENCODING');
  const map=createMap(bundle),before=map.render().svg,priorSpec=map.spec,priorViews=map._views,priorProjection=map.projection;
  const bad=structuredClone(second);bad.series=bad.series.filter(series=>series.id!=='one');bad.observations=bad.observations.filter(observation=>observation.series_id!=='one');
  assert.throws(()=>map.setData(bad),/unknown series/);
  assert.equal(map.spec,priorSpec);assert.equal(map._views,priorViews);assert.equal(map.projection,priorProjection);assert.equal(map.render().svg,before);
  map.destroy();assert.throws(()=>map.setData(first),error=>error.code==='LIFECYCLE');
});

test('inherited dataset ids on nested channels validate and render through the same resolver',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  map.setLayers([{id:'base',role:'base',type:'bivariateChoropleth',encoding:{dataset_id:dataset.id,x:{series_id:'one'},y:{series_id:'two'}}}]);
  const svg=map.render().svg;assert.match(svg,/<path data-region-id="a"[^>]+fill="#2166ac"/);assert.match(svg,/<path data-region-id="b"[^>]+fill="#d73027"/);map.destroy();
});

test('bar layers require the base role and cannot silently overlap another base',()=>{
  const {bundle,spec,geography,first,second}=multiple(),datasets=new Map([[first.id,first],[second.id,second]]),bar={id:'bar',type:'bar',encoding:{dataset_id:first.id,series_ids:['one','two']}};
  assert.throws(()=>validateMapSpec({...spec,layers:[{...bar,role:'overlay'}]},geography,datasets),error=>error.code==='UNSUPPORTED_LAYER_COMBINATION');
  assert.throws(()=>validateMapSpec({...spec,layers:[spec.layers[0],bar]},geography,datasets),/at most one base/);
  const map=createMap(bundle);map.setLayers([bar]);assert.match(map.render().svg,/data-bar-mode/);map.destroy();
});

test('surface renderers default to base and reject incompatible explicit roles',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  assert.equal(map.spec.layers[0].role,'base');
  assert.match(map.render().svg,/<g data-layer-id="base">[\s\S]*data-region-id="a"/);
  assert.throws(()=>map.setLayers([{id:'areas',role:'overlay',type:'choropleth',encoding:{dataset_id:dataset.id,series_id:'one'}}]),error=>error.code==='UNSUPPORTED_LAYER_COMBINATION');
  assert.throws(()=>map.setLayers([{id:'symbols',role:'base',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'}}]),error=>error.code==='UNSUPPORTED_LAYER_COMBINATION');
  map.destroy();
});

test('all renderer role capabilities agree with validation and omitted roles sort bases before overlays',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography),map=createMap(null,{geography,dataset});
  for(const renderer of listRenderers()){
    const role=renderer.defaultRole,other=role==='base'?'overlay':'base';
    assert.deepEqual(renderer.capabilities.roles,[role]);
    const report=layerCapabilities({type:renderer.type,role:other,encoding:{series_id:'one'}},view,geography);
    assert.equal(report.supported,false);assert.ok(report.reasons.includes(`${renderer.type} requires the ${role} role`));
  }
  const layers=[{id:'symbols',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'}},{id:'areas',type:'ch',encoding:{dataset_id:dataset.id,series_id:'one'}}],original=structuredClone(layers);
  map.setLayers(layers);assert.deepEqual(layers,original);assert.deepEqual(map.spec.layers.map(layer=>layer.role),['overlay','base']);
  let svg=map.render().svg;assert.ok(svg.indexOf('<g data-layer-id="areas">')<svg.indexOf('<g data-layer-id="symbols">'));
  const before=map.spec;assert.throws(()=>map.setLayers([layers[1],{...layers[1],id:'duplicate'}]),/at most one base/);assert.equal(map.spec,before);
  const reports=capabilities({...map.spec,layers:[layers[1],{...layers[1],id:'duplicate'}]},geography,new Map([[dataset.id,dataset]]));
  assert.ok(reports.every(report=>!report.supported&&report.reasons.some(reason=>/at most one base/.test(reason))));
  map.setLayers([layers[1]]);map.setRenderer('ps',{dataset_id:dataset.id,series_id:'one'});assert.equal(map.spec.layers[0].role,'overlay');
  map.setRenderer('ch',{dataset_id:dataset.id,series_id:'one'});assert.equal(map.spec.layers[0].role,'base');map.destroy();
});

test('semantic rendering failures leave data, spec and mounted output unchanged',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset}),before=map.render().svg,spec=map.spec;
  assert.throws(()=>map.setLayers([{id:'base',type:'categorical',encoding:{dataset_id:dataset.id,series_id:'one'}}]),/category series/);
  assert.equal(map.spec,spec);assert.equal(map.render().svg,before);
  const invalid=structuredClone(map.bundle);invalid.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource.layers[0].type='categorical';
  assert.throws(()=>map.setBundle(invalid),/category series/);assert.equal(map.spec,spec);
  const negative=structuredClone(dataset);negative.observations=negative.observations.map(observation=>({...observation,value:-1}));
  map.setLayers([{id:'base',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'}}]);const prior=map.spec,view=map._views;
  assert.throws(()=>map.setData(negative),/negative/);assert.equal(map.spec,prior);assert.equal(map._views,view);map.destroy();
});
