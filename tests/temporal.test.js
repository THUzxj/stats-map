import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, buildLegend, legendSvg } from '../src/index.js';
import { sparklineModel, sparklineSvg, timeDomain } from '../src/renderers/temporal.js';
import { sample } from './fixtures/encoding.js';

function timeline(){
  const {geography,dataset}=sample();
  dataset.periods=[{id:'t3',label:'Third',order:3,start:'2024-01-11'},{id:'t1',label:'First',order:1,start:'2024-01-01'},{id:'t2',label:'Second',order:2,start:'2024-01-02'}];
  dataset.observations=[];
  for(const [region,values] of [['a',[0,5,10]],['b',[-20,25,50]]])values.forEach((value,i)=>dataset.observations.push({id:`${region}-${i}`,series_id:'one',region_id:region,period_id:`t${i+1}`,status:'value',value}));
  return new DatasetView(dataset,geography);
}

test('sparkline axes use actual declared intervals and one common numeric range',()=>{
  const view=timeline(),model=sparklineModel(view,'one');
  assert.equal(model.scale,'shared');
  assert.deepEqual(model.periods.map(period=>period.id),['t1','t2','t3']);
  assert.deepEqual(model.positions,[0,.1,1]);
  assert.deepEqual(model.domain,[-20,50]);
  assert.deepEqual(model.regionDomain('a'),model.regionDomain('b'));
  const local=sparklineModel(view,'one',{}, {scale:'local'});
  assert.deepEqual(local.regionDomain('a'),[0,10]);
  assert.deepEqual(local.regionDomain('b'),[-20,50]);
  const explicit=sparklineModel(view,'one',{}, {yDomain:[-100,100]});
  assert.deepEqual(explicit.regionDomain('a'),[-100,100]);
  const legend=buildLegend({type:'spark',encoding:{series_id:'one'}},view,'t1');
  assert.equal(legend.type,'time');
  assert.match(legendSvg(legend),/Shared vertical axis: -20 – 50 items/);
  assert.match(legendSvg(legend),/Actual time intervals/);
});

test('time windows constrain points, scale and legend and reject invalid period ranges',()=>{
  const view=timeline(),spec={view:{time_window:['t1','t2']}},model=sparklineModel(view,'one',spec);
  assert.deepEqual(model.periods.map(period=>period.id),['t1','t2']);
  assert.deepEqual(model.domain,[-20,25]);
  assert.doesNotMatch(sparklineSvg(model,'a',50,50,40),/data-period-id="t3"/);
  const legend=buildLegend({type:'sparkline',encoding:{series_id:'one'}},view,'t1',{spec});
  assert.match(legendSvg(legend),/First – Second/);
  assert.doesNotMatch(legendSvg(legend),/Third/);
  assert.throws(()=>timeDomain(view,{view:{time_window:['t3','t1']}}),error=>error.code==='INVALID_ENCODING');
  assert.throws(()=>timeDomain(view,{view:{time_window:['missing','t1']}}),error=>error.code==='INVALID_ENCODING');
});

test('time-series bars retain negative and zero values and use shared baselines',()=>{
  const model=sparklineModel(timeline(),'one',{}, {mode:'bar'});
  const a=sparklineSvg(model,'a',50,50,70),b=sparklineSvg(model,'b',50,50,70);
  assert.match(a,/data-value="0"[^>]+height="0"/);
  assert.match(b,/data-value="-20"[^>]+height="20"/);
  assert.match(b,/data-value="50"[^>]+height="50"/);
  assert.match(a,/<title>Second: 5 items<\/title>/);
});
