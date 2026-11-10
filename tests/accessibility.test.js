import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/index.js';
import { sample } from './fixtures/encoding.js';
import { dispatchMapTarget } from '../src/core/interaction-events.js';

test('region, component and relation targets expose keyboard focus and escaped statistical descriptions',()=>{
  const {geography,dataset}=sample();geography.regions[0].label='A <scripted label>';dataset.sources=[{id:'source',title:'Synthetic & source'}];
  const map=createMap(null,{geography,dataset}),svg=map.render().svg;
  assert.match(svg,/<path data-region-id="a"[^>]+role="button" tabindex="0" aria-label="A &lt;scripted label&gt;[^\"]+10 items[^\"]+Synthetic &amp; source/);
  map.setLayers([{id:'parts',type:'pieChart',encoding:{dataset_id:dataset.id,series_ids:['one','two']}}]);
  assert.match(map.render().svg,/<path data-component-index="0"[^>]+aria-label="[^\"]+10 items/);
  const data=structuredClone(dataset);data.relations=[{id:'edge',series_id:'one',period_id:'t',origin_region_id:'a',destination_region_id:'b',status:'value',value:5}];map.setData(data);map.setLayers([{id:'edges',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'}}]);
  assert.match(map.render().svg,/<path data-relation-id="edge"[^>]+role="button" tabindex="0"/);map.destroy();
});

test('focus events retain the correct dataset revision, series, units and source evidence',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  const layer={getAttribute:name=>name==='data-layer-id'?'base':null},element={getAttribute:name=>name==='data-region-id'?'a':null,closest:()=>layer},target={closest:selector=>selector.startsWith('[data-relation-id]')?element:null};
  const events=[];map.on('regionfocus',payload=>events.push(payload));dispatchMapTarget(map,{target},'focus');
  assert.equal(events[0].channels[0].observation.value,10);assert.equal(events[0].channels[0].unit.label,'items');assert.equal(events[0].channels[0].dataset_ref.revision,'r1');assert.deepEqual(map.getState().selection,[]);map.destroy();
});
