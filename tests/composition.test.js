import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, buildLegend, legendSvg } from '../src/index.js';
import { compositionModel, compositionSymbolSvg } from '../src/renderers/composition-symbols.js';
import { sector } from '../src/renderers/primitives.js';
import { sample } from './fixtures/encoding.js';

const model=(type,dataset,geography,options={},spec={view:{period_id:'t'}})=>compositionModel(type,['one','two'],new DatasetView(dataset,geography),spec,options);

test('composition modes preserve explicit totals, Other and component values',()=>{
  const {geography,dataset}=sample();
  for(const mode of ['pie','ring','flag','segment','radar','agepyramid','halftone']){
    const chart=model('pieChart',dataset,geography,{mode,totalSeriesId:'total'}),svg=compositionSymbolSvg(chart,'a',50,50,20);
    assert.equal(chart.compositions.get('a').get('t').denominator,100);
    for(const [id,value,share] of [['one',10,.1],['two',30,.3],['__other__',60,.6]])assert.match(svg,new RegExp(`data-series-id="${id}" data-value="${value}" data-share="${share}"`));
    assert.doesNotMatch(svg,/NaN|Infinity/);
    assert.match(svg,/<title>Other: 60 items \(60.00%\)<\/title>/);
  }
});

test('complete circular sectors and rings use two outer arcs and area-proportional inner radii',()=>{
  assert.equal((sector(0,0,0,10,0,Math.PI*2).match(/A10,10/g)??[]).length,2);
  assert.equal((sector(0,0,5,10,0,Math.PI*2).match(/A5,5/g)??[]).length,2);
  const {geography,dataset}=sample(),chart=model('pieChart',dataset,geography,{mode:'ring'});
  const svg=compositionSymbolSvg(chart,'a',50,50,20);
  const radii=[...svg.matchAll(/data-inner-radius="([^"]+)" data-outer-radius="([^"]+)"/g)].map(match=>match.slice(1).map(Number));
  assert.equal(radii.length,2);
  assert.ok(Math.abs((radii[0][1]**2-radii[0][0]**2)/400-.25)<1e-12);
  assert.ok(Math.abs((radii[1][1]**2-radii[1][0]**2)/400-.75)<1e-12);
});

test('flag and segment widths and heights close exactly in each direction',()=>{
  const {geography,dataset}=sample();
  for(const mode of ['flag','segment'])for(const orientation of ['horizontal','vertical']){
    const svg=compositionSymbolSvg(model('pieChart',dataset,geography,{mode,orientation}),'a',50,50,100);
    const rects=[...svg.matchAll(/<rect [^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map(match=>match.slice(1).map(Number));
    const thickness=mode==='segment'?35:100;
    if(orientation==='vertical'){
      assert.equal(rects.reduce((sum,rect)=>sum+rect[3],0),thickness);
      assert.equal(rects[1][1],rects[0][1]+rects[0][3]);
    }else {
      assert.equal(rects.reduce((sum,rect)=>sum+rect[2],0),thickness);
      assert.equal(rects[1][0],rects[0][0]+rects[0][2]);
    }
  }
});

test('absolute radar radii use the same cross-region domain while share mode remains explicit',()=>{
  const {geography,dataset}=sample();
  for(const radarValueMode of ['absolute','share']){
    const chart=model('pieChart',dataset,geography,{mode:'radar',radarValueMode});
    const radius=id=>Number(compositionSymbolSvg(chart,id,50,50,20).match(/data-series-id="one"[^>]+data-outer-radius="([^"]+)"/)[1]);
    const ratio=(radius('a')/radius('b'))**2;
    assert.ok(Math.abs(ratio-(radarValueMode==='absolute'?.25:.5))<1e-12);
    const legend=buildLegend({type:'pieChart',encoding:{series_ids:['one','two']},options:{mode:'radar',radarValueMode}},new DatasetView(dataset,geography),'t');
    assert.match(legendSvg(legend),radarValueMode==='absolute'?/Absolute values, shared scale/:/Share within symbol/);
  }
});

test('composition families distinguish incomplete components, missing total, zero and conflicts',()=>{
  for(const type of ['pieChart','waffle','bar'])for(const status of ['incomplete','zero','conflict']){
    const {geography,dataset}=sample();
    if(status==='incomplete')dataset.observations=dataset.observations.filter(observation=>observation.id!=='a-1');
    if(status==='zero')dataset.observations.filter(observation=>observation.region_id==='a').forEach(observation=>observation.value=0);
    if(status==='conflict')dataset.observations.find(observation=>observation.id==='a-2').value=20;
    const svg=compositionSymbolSvg(model(type,dataset,geography,{totalSeriesId:'total'}),'a',50,50,20);
    assert.match(svg,new RegExp(`data-status="${status}-composition"`));
    assert.doesNotMatch(svg,/data-component-index=/);
  }
});

test('waffle rounding conserves cell count and leaves undisplayed explicit remainder visible',()=>{
  const {geography,dataset}=sample();
  const chart=model('waffle',dataset,geography,{cells:17,columns:5,totalSeriesId:'total',showOther:false}),svg=compositionSymbolSvg(chart,'a',50,50,40);
  assert.equal((svg.match(/<rect /g)??[]).length,17);
  assert.ok((svg.match(/data-series-id="__remainder__"/g)??[]).length>0);
  assert.match(svg,/data-approximation="rounded cell allocation"/);
  assert.match(svg,/<title>one: 10 items/);
  const legend=buildLegend({type:'waffle',encoding:{series_ids:['one','two']}},new DatasetView(dataset,geography),'t');
  assert.match(legendSvg(legend),/Cells are rounded/);
});

test('grouped and stacked bars use common scales across regions',()=>{
  const {geography,dataset}=sample();
  for(const mode of ['grouped','stacked']){
    const chart=model('bar',dataset,geography,{mode}),height=id=>[...compositionSymbolSvg(chart,id,50,50,60).matchAll(/height="([^"]+)"/g)].map(match=>Number(match[1]));
    const a=height('a'),b=height('b');
    assert.ok(Math.abs(a[0]/b[0]-.25)<1e-12);
    assert.ok(Math.abs(a[1]/b[1]-.5)<1e-12);
    if(mode==='stacked')assert.equal(b.reduce((sum,value)=>sum+value,0),60);
    else assert.equal(b[1],60);
  }
});

test('bar width is an independent numeric channel with a common domain and missing-state marker',()=>{
  const {geography,dataset}=sample();
  dataset.observations.find(observation=>observation.id==='a-2').value=25;
  const chart=model('bar',dataset,geography,{mode:'stacked',widthSeriesId:'total',width:80});
  assert.equal(chart.widthMaximum,100);
  assert.match(compositionSymbolSvg(chart,'a',50,50,60),/data-width-value="25"[^>]+width="20"/);
  assert.match(compositionSymbolSvg(chart,'b',50,50,60),/data-width-value="100"[^>]+width="80"/);
  dataset.observations=dataset.observations.filter(observation=>observation.id!=='a-2');
  assert.match(compositionSymbolSvg(model('bar',dataset,geography,{widthSeriesId:'total'}),'a',50,50,60),/data-status="incomplete-composition"/);
});

test('Coxcomb stacks time by category on one area scale and preserves incomplete period gaps',()=>{
  const {geography,dataset}=sample();
  dataset.periods=[{id:'late',label:'Late',order:2},{id:'early',label:'Early',order:1}];
  dataset.observations=dataset.observations.flatMap(observation=>[{...observation,id:observation.id+'-early',period_id:'early'},{...observation,id:observation.id+'-late',period_id:'late',value:observation.value*2}]);
  dataset.observations=dataset.observations.filter(observation=>observation.id!=='b-1-late');
  const chart=model('coxcomb',dataset,geography,{rings:false},{view:{period_id:'early'}}),svg=compositionSymbolSvg(chart,'a',50,50,20);
  assert.deepEqual(chart.periods.map(period=>period.id),['early','late']);
  assert.equal(chart.totalMaximum,100);
  assert.equal((svg.match(/data-component-index=/g)??[]).length,4);
  const radii=[...svg.matchAll(/data-inner-radius="([^"]+)" data-outer-radius="([^"]+)"/g)].map(match=>match.slice(1).map(Number));
  assert.ok(Math.abs((radii[0][1]**2-radii[0][0]**2)/(radii[2][1]**2-radii[2][0]**2)-.5)<1e-12);
  assert.doesNotMatch(svg,/data-reference-ring/);
  assert.match(compositionSymbolSvg(chart,'b',50,50,20),/data-period-id="late" data-status="incomplete-composition"/);
});
