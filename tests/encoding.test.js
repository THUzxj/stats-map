import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, renderSvg, buildLegend, legendSvg, layerCapabilities, createMap } from '../src/index.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { symbolScale, symbolShapeSvg } from '../src/renderers/symbols.js';

import { sample } from './fixtures/encoding.js';

function render(geography,dataset,layer,options={}) {
  return renderSvg({geography,datasetView:new DatasetView(dataset,geography),spec:{view:{period_id:'t'}},layer,viewport:{width:300,height:200},...options}).svg;
}
const layer=(type,options={})=>({id:'layer',type,encoding:{series_ids:['one','two']},options});

test('symbol area and height encodings share the actual symbol geometry with the legend',()=>{
  const {geography,dataset}=sample();
  for(const shape of ['circle','square','diamond','triangle','star','wye','cross','bar','spike']){
    const options={shape,maxRadius:20,scaleMode:'area'},scale=symbolScale([10,40],options);
    const r1=scale.radius(10),r2=scale.radius(40);
    assert.equal(['bar','spike'].includes(shape)?r1/r2:(r1/r2)**2,.25);
    if(['bar','spike'].includes(shape))assert.equal(scale.mode,'height');
    const config={...layer('proportionalSymbol',options),encoding:{series_id:'one'}};
    const legend=buildLegend(config,new DatasetView(dataset,geography),'t');
    assert.equal(legend.marks[0].radius,r1);
    const mark=specializedLegendLayout(legend,210,legend.presentation).elements.find(item=>item.type==='symbol');
    assert.equal(mark.radius,r1);assert.ok(legendSvg(legend).includes(symbolShapeSvg(shape,mark.x,mark.y,r1,legend.options)));
    assert.equal(symbolScale([10,40],{...options,scaleMode:'height'}).radius(10),5);
  }
  assert.throws(()=>symbolScale([-1,2]),error=>error.code==='UNSUPPORTED_VALUE');
});

test('controlled custom symbols serialize path data and reject executable SVG markup',()=>{
  const {geography,dataset}=sample(),options={shape:'custom',customShape:{viewBox:[0,0,10,10],path:'M0 0 L10 0 L5 10 Z'}};
  const scale=symbolScale([10,40],options);
  assert.equal(scale.radius(10),10);
  assert.match(symbolShapeSvg('custom',50,50,10,options),/d="M0 0 L10 0 L5 10 Z" transform="translate\(50 50\) scale\(2\) translate\(-5 -5\)"/);
  assert.match(render(geography,dataset,{...layer('proportionalSymbol',options),encoding:{series_id:'one'}}),/M0 0 L10 0 L5 10 Z/);
  assert.throws(()=>symbolScale([1],{...options,customShape:{...options.customShape,path:'<svg onload="alert(1)">'}}),error=>error.code==='INVALID_ENCODING');
  assert.throws(()=>symbolScale([1],{...options,customShape:{...options.customShape,viewBox:[0,0,-1,10]}}),error=>error.code==='INVALID_ENCODING');
});

test('mushroom halves use a common area scale in both orientations and in their legend',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography);
  const starts=[];
  for(const orientation of ['horizontal','vertical']){
    const config=layer('mushroom',{orientation,maxRadius:20});
    const svg=render(geography,dataset,config);
    const paths=[...svg.matchAll(/<path data-symbol-region-id="([^"]+)" data-component-index="([^"]+)" data-radius="([^"]+)" d="([^"]+)"/g)];
    assert.equal(paths.length,4);
    const radii=paths.map(match=>Number(match[3]));
    assert.ok(Math.abs((radii[0]/radii[1])**2-1/3)<1e-12);
    assert.ok(Math.abs((radii[2]/radii[3])**2-2/3)<1e-12);
    assert.equal(radii[3],20);
    const legend=buildLegend(config,view,'t');
    assert.equal(legend.type,'mushroom');
    assert.equal(legend.marks.at(-1).value,60);
    assert.equal(legend.marks.at(-1).radius,20);
    assert.match(legendSvg(legend),/two/);
    starts.push(paths[0][4]);
  }
  assert.notEqual(starts[0],starts[1]);
});

test('mushroom distinguishes zero from absent halves and rejects incompatible units',()=>{
  const {geography,dataset}=sample();
  dataset.observations.find(o=>o.id==='a-0').value=0;
  dataset.observations=dataset.observations.filter(o=>o.id!=='b-1');
  const config=layer('mushroom');
  const svg=render(geography,dataset,config);
  assert.match(svg,/data-symbol-region-id="a" data-component-index="0" data-radius="0"/);
  assert.doesNotMatch(svg,/<circle data-symbol-region-id="a" data-status="incomplete"/);
  assert.match(svg,/<circle data-symbol-region-id="b" data-status="incomplete"/);
  assert.equal(buildLegend(config,new DatasetView(dataset,geography),'t').missing,true);
  dataset.units.push({id:'different',label:'different',dimension:'count'});
  dataset.series.find(s=>s.id==='two').unit_id='different';
  const view=new DatasetView(dataset,geography);
  assert.equal(layerCapabilities(config,view,geography).supported,false);
  assert.throws(()=>render(geography,dataset,config),error=>error.code==='INCOMPARABLE_COMPONENTS');
});

test('stripe composition fills polygon boundaries and holes with proportional repeating stripes',()=>{
  const {geography,dataset}=sample();
  const config=layer('stripeComposition',{stripeWidth:40,orientation:35,totalSeriesId:'total',categoryOrder:['two','one'],colors:{one:'#123456',two:'#abcdef'}});
  const svg=render(geography,dataset,config,{namespace:'first',selection:['a']});
  assert.match(svg,/patternUnits="userSpaceOnUse" width="40" height="40" patternTransform="rotate\(35\)"/);
  assert.match(svg,/data-series-id="two" data-value="30" data-share="0.3" x="0" y="0" width="12"/);
  assert.match(svg,/data-series-id="one" data-value="10" data-share="0.1" x="12" y="0" width="4"/);
  assert.match(svg,/data-series-id="__other__" data-value="60" data-share="0.6"[^>]+width="24"/);
  const outsideDefs=svg.replace(/<defs>[\s\S]*?<\/defs>/,'');
  assert.doesNotMatch(outsideDefs,/<rect/);
  assert.match(outsideDefs,/<path data-region-id="a" d="[^"]+Z M[^"]+Z" fill-rule="evenodd" fill="url\(#[^)]+\)" data-composition-status="value" stroke="#111827" stroke-width="2.5"/);
  const legend=buildLegend(config,new DatasetView(dataset,geography),'t');
  assert.deepEqual(legend.items.map(item=>item.id),['two','one','__other__']);
  assert.equal(legend.items[0].color,'#abcdef');
  assert.match(legendSvg(legend),/Other/);
  const patternId=svg.match(/<pattern id="([^"]+)"/)[1];
  const second=render(geography,dataset,config,{namespace:'second'});
  assert.ok(!second.includes(`id="${patternId}"`));
});

test('stripe composition keeps missing totals, absent components, excess totals and zero distinct',()=>{
  for(const status of ['incomplete-total','incomplete-component','conflict','zero']){
    const {geography,dataset}=sample();
    if(status==='incomplete-total')dataset.observations=dataset.observations.filter(o=>o.id!=='a-2');
    if(status==='incomplete-component')dataset.observations=dataset.observations.filter(o=>o.id!=='a-1');
    if(status==='conflict')dataset.observations.find(o=>o.id==='a-2').value=20;
    if(status==='zero')dataset.observations.filter(o=>o.region_id==='a').forEach(o=>o.value=0);
    const config=layer('stripeComposition',{totalSeriesId:'total'});
    const svg=render(geography,dataset,config);
    const area=svg.match(/<path data-region-id="a"[^>]*>/)[0];
    assert.match(area,new RegExp(`data-composition-status="${status.startsWith('incomplete')?'incomplete':status}"`));
    assert.doesNotMatch(area,/url\(#/);
    const legend=buildLegend(config,new DatasetView(dataset,geography),'t');
    assert.equal(legend.missing,status.startsWith('incomplete'));
    assert.equal(legend.zero,status==='zero');
    assert.equal(legend.conflict,status==='conflict');
    if(status==='incomplete-total')assert.equal(new DatasetView(dataset,geography).composition(['one','two'],'a','t',{totalSeriesId:'total'}).canNormalize,false);
  }
});

test('stripe patterns follow square, hexagonal and Dorling region shapes',()=>{
  const {geography,dataset}=sample(),config=layer('stripeComposition');
  const positions=new Map([['a',{x:50,y:50,size:30,radius:15,shape:'hexagon'}],['b',{x:100,y:50,size:30,radius:15,shape:'hexagon'}]]);
  for(const [layoutType,tag] of [['grid-square','rect'],['grid-hex','polygon'],['dorling','circle']]){
    for(const position of positions.values())position.shape=layoutType==='grid-square'?'square':'hexagon';
    const svg=render(geography,dataset,config,{layoutPositions:positions,layoutType});
    assert.match(svg,new RegExp(`<${tag} data-region-id="a"[^>]+fill="url\\(#[^)]+\\)"`));
    assert.equal((svg.match(/<pattern /g)??[]).length,2);
  }
});

test('public MapSpec accepts multi-series encodings and aliases and checks series references',()=>{
  const {geography,dataset}=sample();
  for(const type of ['mushroom','stripe','scomp','stripeComposition']){
    const config={...layer(type),encoding:{dataset_id:dataset.id,series_ids:['one','two']}};
    const spec={schema_version:1,kind:'stats-map/spec',id:'view',revision:'r1',geography_ref:dataset.geography_ref,dataset_refs:[{id:dataset.id,revision:dataset.revision}],view:{period_id:'t'},layers:[config]};
    const map=createMap(null,{geography,dataset,spec});
    assert.match(map.export('svg'),type==='mushroom'?/data-symbol-region-id/:/<pattern /);
    map.destroy();
    spec.layers[0].encoding.series_ids=['one','unknown'];
    assert.throws(()=>createMap(null,{geography,dataset,spec}),/unknown series/);
  }
});

test('bivariate maps render either absent axis as missing',()=>{
  for(const id of ['a-0','a-1']){
    const {geography,dataset}=sample();
    dataset.observations=dataset.observations.filter(o=>o.id!==id);
    assert.match(render(geography,dataset,layer('bivariateChoropleth')),/<path data-region-id="a"[^>]+fill="#e5e7eb"/);
  }
});

test('sparklines render line, area and bar modes in declared time order with missing breaks',()=>{
  const {geography,dataset}=sample();
  dataset.periods=[{id:'late',label:'Late',order:4},{id:'early',label:'Early',order:1},{id:'gap',label:'Gap',order:3},{id:'middle',label:'Middle',order:2}];
  dataset.observations=dataset.observations.filter(o=>o.series_id==='one').flatMap(o=>[
    {...o,id:`${o.region_id}-late`,period_id:'late',value:8},
    {...o,id:`${o.region_id}-early`,period_id:'early',value:2},
    {...o,id:`${o.region_id}-middle`,period_id:'middle',value:4}
  ]);
  for(const mode of ['line','area','bar']){
    const svg=render(geography,dataset,{...layer('sparkline',{mode,scale:'shared'}),encoding:{series_id:'one'}});
    assert.match(svg,new RegExp(`data-sparkline-mode="${mode}"`));
    assert.match(svg,/data-period-id="early" data-value="2"/);
    assert.match(svg,/data-period-id="middle" data-value="4"/);
    assert.match(svg,/data-period-id="late" data-value="8"/);
    assert.doesNotMatch(svg,/<(?:circle|rect)[^>]*data-period-id="gap"[^>]*data-value=/);
    assert.match(svg,/<rect[^>]*data-sparkline-point="true" data-period-id="gap"[^>]*fill="transparent"/);
    assert.match(svg,/Early: 2/);
    if(mode==='area')assert.match(svg,/fill="#2563eb"/);
    if(mode==='bar')assert.match(svg,/<rect data-region-id=/);
  }
});
