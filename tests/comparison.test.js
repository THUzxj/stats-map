import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, SmallMultiples } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

function bundle(type,encoding,options={}){
  const {geography,dataset}=sample();dataset.periods=[{id:'early',label:'Early',order:0},{id:'late',label:'Late',order:1}];
  dataset.observations=dataset.observations.flatMap(observation=>[{...observation,id:observation.id+'early',period_id:'early'},{...observation,id:observation.id+'late',period_id:'late',value:observation.value*10}]);
  const map=createMap(null,{geography,dataset});map.setLayers([{id:'base',type,encoding:{dataset_id:dataset.id,...encoding},options}]);const result=structuredClone(map.bundle);result.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource=map.exportSpec();map.destroy();return result;
}
const panels=[{id:'early',period_id:'early'},{id:'late',period_id:'late'}];

test('small multiple proportional symbols and mushroom halves retain a common maximum across periods',()=>{
  for(const type of ['proportionalSymbol','mushroom']){
    const multiples=new SmallMultiples(null,bundle(type,type==='mushroom'?{series_ids:['one','two']}:{series_id:'one'},{maxRadius:20}),panels);
    assert.equal(multiples.maps[0].spec.layers[0].options.maxValue,type==='mushroom'?600:400);
    const radius=map=>Number(map.render().svg.match(type==='mushroom'?/data-symbol-region-id="a"[^>]+data-radius="([^"]+)"/:/data-symbol-region-id="a"[^>]+ r="([^"]+)"/)[1]);
    assert.ok(Math.abs((radius(multiples.maps[0])/radius(multiples.maps[1]))**2-.1)<1e-12);multiples.destroy();
  }
});

test('small multiples share both bivariate axes, continuous colors and alpha domains',()=>{
  for(const type of ['bivariateChoropleth','alpha']){
    const multiples=new SmallMultiples(null,bundle(type,{x:{dataset_id:'amounts',series_id:'one'},y:{dataset_id:'amounts',series_id:'two'}},{colorMode:'continuous',colors:['#0000ff','#ff0000']}),panels);
    const first=multiples.maps[0].spec.layers[0],last=multiples.maps[1].spec.layers[0];
    assert.deepEqual(first.classification,last.classification);assert.deepEqual(first.options,last.options);
    assert.deepEqual(first.options.colorDomain,[10,400]);
    if(type==='alpha'){
      assert.deepEqual(first.options.opacity.domain,[30,600]);
      assert.deepEqual(multiples.maps[0].render().legends[0].bands,multiples.maps[1].render().legends[0].bands);
    }else assert.equal(first.classification.axes.length,2);
    multiples.destroy();
  }
});

test('small multiples lock composition size, radar, bar height/width and temporal domains',()=>{
  for(const [type,options] of [['pieChart',{sizeBy:'total'}],['pieChart',{mode:'radar',radarValueMode:'absolute'}],['bar',{mode:'stacked',widthSeriesId:'total'}],['coxcomb',{}],['sparkline',{}]]){
    const multiples=new SmallMultiples(null,bundle(type,type==='sparkline'?{series_id:'one'}:{series_ids:['one','two']},options),panels);
    const first=multiples.maps[0].spec.layers[0].options,last=multiples.maps[1].spec.layers[0].options;
    assert.deepEqual(first,last);
    if(type==='sparkline')assert.deepEqual(first.yDomain,[0,400]);
    else {assert.equal(first.totalMaximum,1000);assert.equal(first.componentMaximum,600);}
    if(type==='bar'){assert.equal(first.maxValue,1000);assert.equal(first.maxWidthValue,1000);}
    multiples.destroy();
  }
});

test('constant shared class domains retain their labels in empty panels and resolved exports',()=>{
  const input=bundle('choropleth',{series_id:'one'}),dataset=input.resources.find(entry=>entry.resource.kind==='stats-map/dataset').resource;
  dataset.observations.forEach(row=>row.value=7);dataset.periods.push({id:'empty',label:'Empty',order:2});
  const multiples=new SmallMultiples(null,input,[...panels,{id:'empty',period_id:'empty'}]);
  try{
    for(const map of multiples.maps){assert.deepEqual(map.spec.layers[0].classification.resolvedDomain,[7,7]);assert.deepEqual(map.render().legends[0].items.map(item=>item.label),['7']);assert.deepEqual(map.exportSpec({resolved:true}).layers[0].classification.resolvedDomain,[7,7]);}
    assert.equal(multiples.maps[2].lastRender.legends[0].missing,true);
  }finally{multiples.destroy();}
});
