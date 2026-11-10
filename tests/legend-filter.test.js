import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/index.js';
import { sample } from './fixtures/encoding.js';
import { dispatchMapTarget } from '../src/core/interaction-events.js';

function map(){const {geography,dataset}=sample();return createMap(null,{geography,dataset});}
const region=(svg,id)=>svg.match(new RegExp(`<path data-region-id="${id}"[^>]*>`))[0];

test('class filters retain selection, observations, classification and zoom and survive state round trips',()=>{
  const instance=map();instance.setLayers([{id:'areas',role:'base',type:'choropleth',encoding:{dataset_id:'amounts',series_id:'one'},classification:{method:'threshold',thresholds:[20]}}]);
  instance.setSelection(['b']);instance.setViewTransform({zoom:2,pan:[.1,.2]});const observations=JSON.stringify([...instance.datasets.values()][0].observations),domain=instance.render().renders[0].domain;
  const events=[];instance.on('legendfilterchange',payload=>events.push(payload));instance.setLegendFilter('areas',['class:0']);
  let svg=instance.render().svg;assert.match(region(svg,'b'),/data-filtered="true"/);assert.doesNotMatch(region(svg,'a'),/data-filtered/);assert.match(svg,/<g data-map-selection="true"[^>]+stroke="#111827"[^>]*><path data-selection-region-id="b"/);
  assert.deepEqual(instance.getState().selection,['b']);assert.equal(JSON.stringify([...instance.datasets.values()][0].observations),observations);
  assert.deepEqual(instance.render().renders[0].domain.breaks,domain.breaks);assert.equal(instance.getViewTransform().zoom,2);assert.deepEqual(events[0].keys,['class:0']);
  const state=instance.getState();instance.setLegendFilter('areas',null);instance.loadState(state);assert.deepEqual(instance.spec.view.legend_filters,{areas:['class:0']});
  instance.toggleLegendFilter('areas','class:0');assert.deepEqual(instance.spec.view.legend_filters,{});
  instance.setLegendFilter('areas',[]);svg=instance.render().svg;assert.match(region(svg,'a'),/data-filtered/);assert.match(region(svg,'b'),/data-filtered/);
  instance.destroy();
});

test('each layer gets a scoped legend and composition filtering retains geometry, shares and totals',()=>{
  const instance=map();instance.setLayers([{id:'areas',role:'base',title:'Amounts',type:'choropleth',encoding:{dataset_id:'amounts',series_id:'one'}},{id:'parts',role:'overlay',title:'Components',type:'pieChart',encoding:{dataset_id:'amounts',series_ids:['one','two']},options:{totalSeriesId:'total'}}]);
  const before=instance.render();assert.deepEqual(before.legends.map(legend=>legend.layer_id),['areas','parts']);
  assert.match(before.svg,/data-legend-layer-id="areas"/);assert.match(before.svg,/data-legend-layer-id="parts"/);assert.match(before.svg,/aria-label="Components"/);
  const component=svg=>svg.match(/<path data-component-index="1" data-region-id="a"[^>]+>/)[0];
  const prior=component(before.svg);instance.setLegendFilter('parts',['component:one']);const after=component(instance.render().svg);
  assert.match(after,/data-filtered="true"/);assert.equal(after.match(/ d="([^"]+)"/)[1],prior.match(/ d="([^"]+)"/)[1]);assert.match(after,/data-share="0.3"/);assert.match(after,/data-value="30"/);
  assert.equal(instance.render().renders[0].svg,before.renders[0].svg);
  instance.destroy();
});

test('bivariate cell and categorical filters keep missing separate and dispatch legend events without region selection',()=>{
  const instance=map();instance.setLayers([{id:'comparison',type:'bivariateChoropleth',encoding:{dataset_id:'amounts',series_ids:['one','two']},classification:{method:'threshold',thresholds:[20,50]}}]);
  instance.setLegendFilter('comparison',['bivariate:0:1']);assert.doesNotMatch(region(instance.render().svg,'a'),/data-filtered/);assert.match(region(instance.render().svg,'b'),/data-filtered/);
  const legend={getAttribute:name=>name==='data-legend-layer-id'?'comparison':null},item={getAttribute:name=>name==='data-legend-key'?'bivariate:0:1':null},target={closest:selector=>selector==='[data-legend-layer-id]'?legend:selector==='[data-legend-key]'?item:null};
  const events=[];instance.on('legendclick',payload=>events.push(payload));dispatchMapTarget(instance,{target});assert.deepEqual(instance.getState().selection,[]);assert.equal(events[0].key,'bivariate:0:1');assert.deepEqual(instance.spec.view.legend_filters,{});
  const dataset=structuredClone([...instance.datasets.values()][0]);dataset.dimensions=[{id:'kind',values:[{id:'x',label:'X'},{id:'y',label:'Y'}]}];dataset.metrics=[{id:'kind',label:'Kind',value_type:'category',aggregation:'none',category_dimension_id:'kind'}];dataset.series=[{...dataset.series[0],metric_id:'kind'}];dataset.observations=[{id:'a',series_id:'one',region_id:'a',period_id:'t',status:'value',value:'x'}];
  const categorical=createMap(null,{geography:instance.geography,dataset});instance.destroy();
  categorical.setLayers([{id:'kind',type:'categorical',encoding:{dataset_id:'amounts',series_id:'one'}}]);categorical.setLegendFilter('kind',['missing']);
  assert.match(region(categorical.render().svg,'a'),/data-filtered/);assert.doesNotMatch(region(categorical.render().svg,'b'),/data-filtered/);categorical.destroy();
});
