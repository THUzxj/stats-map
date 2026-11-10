import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

test('scheme exports freeze actual thresholds and scale domains while keeping raw spec available',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  map.setLayers([{id:'areas',type:'choropleth',encoding:{dataset_id:dataset.id,series_id:'one'},classification:{method:'quantile',classes:3}},{id:'symbols',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'two'}}]);
  const raw=map.exportSpec(),exported=JSON.parse(map.export('spec'));
  assert.equal(raw.layers[0].classification.method,'quantile');assert.equal(exported.layers[0].classification.method,'threshold');assert.deepEqual(exported.layers[0].classification.thresholds,map.render().renders[0].domain.breaks);assert.equal(exported.layers[1].options.maxValue,60);
  const restored=createMap(null,{geography,dataset,spec:exported});
  assert.equal(restored.render().renders[0].domain.classify(10),map.render().renders[0].domain.classify(10));assert.equal(restored.render().renders[0].domain.classify(40),map.render().renders[0].domain.classify(40));
  assert.equal(map.spec.layers[0].classification.method,'quantile');map.destroy();restored.destroy();
});

test('CSV observations retain original units, resource revisions, flags and source SHA evidence',()=>{
  const {geography,dataset}=sample();dataset.sources=[{id:'original',title:'Synthetic original',sha256:'a'.repeat(64)}];dataset.observations[0].value=0;dataset.observations[0].evidence={source_id:'original',sha256:'b'.repeat(64),cell:'C4'};
  dataset.observations[0].source_flag='p';
  const map=createMap(null,{geography,dataset}),csv=map.export('csv',{regionIds:['a','a']});
  assert.match(csv,/unit_id,unit_label,scope_id,measure_type,review_status,dataset_id,dataset_revision,geography_id,geography_revision,sources/);
  assert.match(csv,/a,t,one,value,0,/);assert.match(csv,/u,items,all,actual,reviewed,amounts,r1,areas,r1/);assert.ok(csv.includes('b'.repeat(64)));assert.ok(csv.includes('a'.repeat(64)));assert.match(csv,/C4/);assert.match(csv,/,p$/);assert.equal(csv.split('\r\n').length,2);map.destroy();
});
