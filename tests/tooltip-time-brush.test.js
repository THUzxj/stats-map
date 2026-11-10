import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, buildTooltip, TimeBrush, validateMapSpec, euroBundle, chinaBundle } from '../src/index.js';
import { dispatchMapTarget } from '../src/core/interaction-events.js';
import { sample } from './fixtures/encoding.js';

function makeMap(){const {geography,dataset}=sample();return createMap(null,{geography,dataset,locale:'en'});}
function timeline(){
  const {geography,dataset}=sample();
  dataset.periods=[{id:'early',label:'Early',order:0,start:'2024-01-01'},{id:'empty',label:'Empty',order:1,start:'2024-01-02'},{id:'late',label:'Late',order:2,start:'2024-01-11'}];
  dataset.observations=dataset.observations.flatMap(o=>[{...o,id:o.id+'early',period_id:'early',value:0},{...o,id:o.id+'late',period_id:'late',value:o.value*2}]);
  const map=createMap(null,{geography,dataset});map.setView({period_id:'early'});map.setLayers([{id:'spark',type:'sparkline',encoding:{dataset_id:dataset.id,series_id:'one'},options:{mode:'line'}}]);return map;
}

test('tooltip values retain reported zero, status, source binding, flags and evidence without HTML interpretation',()=>{
  const map=makeMap(),dataset=structuredClone(map.datasets.get('amounts'));
  dataset.sources=[{id:'kept',title:'Synthetic <em>source</em>'},{id:'other',title:'Unrelated source'}];dataset.series[0].source_refs=['kept'];
  Object.assign(dataset.observations[0],{value:0,source_flag:'p',evidence:{source_id:'kept',sha256:'a'.repeat(64),page:2}});map.setData(dataset);
  const target={layer_id:'base',region_id:'a'},model=buildTooltip(map,target);
  assert.equal(model.channels[0].observation.value,0);assert.equal(model.channels[0].dataset_ref.revision,'r1');
  assert.ok(model.rows.some(row=>row.value==='0 items'));assert.equal(model.rows.filter(row=>row.value==='p').length,1);assert.ok(model.rows.some(row=>row.value.includes('a'.repeat(64))));
  assert.ok(model.rows.some(row=>row.value==='Synthetic <em>source</em>'));assert.ok(!model.rows.some(row=>row.value==='Unrelated source'));
  dataset.observations[0]={...dataset.observations[0],status:'suppressed',value:null};map.setData(dataset);
  assert.ok(buildTooltip(map,target).rows.some(row=>row.value==='Suppressed'));assert.ok(buildTooltip(map,target).rows.some(row=>row.label==='Coverage'&&row.value==='0 / 1'));assert.ok(buildTooltip(map,target).rows.some(row=>row.label==='Unit'&&row.value==='items'));assert.equal(map.selection.size,0);
  map.setInteraction({tooltip:false});assert.equal(buildTooltip(map,target),null);map.destroy();
});

test('tooltip and focus event values agree with declared rollups, retaining reported values and contributor evidence',()=>{
  const map=makeMap(),dataset=structuredClone(map.datasets.get('amounts')),geography=structuredClone(map.geography);
  geography.regions.push({id:'ab',label:'Combined areas',level_id:'area'});
  dataset.observations.push({id:'reported',series_id:'one',region_id:'ab',period_id:'t',status:'value',value:999});
  dataset.observations[0].evidence={source_id:'synthetic',sha256:'b'.repeat(64)};
  dataset.aggregation_bases=[{id:'basis',unit_region_ids:['a','b'],disjoint:true,rollups:[{region_id:'ab',member_region_ids:['a','b'],completeness:'partial'}]}];
  map.setData(dataset,geography);map.setSpec({...map.spec,aggregation:{dataset_id:'amounts',basis_id:'basis',display_value:'rollup'}});
  const model=buildTooltip(map,{layer_id:'base',region_id:'ab'});
  assert.equal(model.channels[0].observation.value,50);assert.equal(model.channels[0].observation.coverage.expected,2);assert.equal(model.channels[0].reported_observation.value,999);
  assert.ok(model.rows.some(row=>row.value.includes('b'.repeat(64))));assert.ok(model.rows.some(row=>row.value==='2 / 2 / Partial'));
  const element={getAttribute:name=>name==='data-region-id'?'ab':null,closest:()=>({getAttribute:name=>name==='data-layer-id'?'base':null})};
  let event;map.on('regionfocus',payload=>event=payload);dispatchMapTarget(map,{target:{closest:selector=>selector.startsWith('[data-relation-id]')?element:null}},'focus');
  assert.deepEqual(event.channels[0].observation,model.channels[0].observation);map.destroy();
});

test('ratio tooltips disclose paired coverage, numerator and denominator including zero-denominator missing',()=>{
  const map=makeMap(),data=structuredClone(map.datasets.get('amounts'));
  data.metrics.push({id:'ratio',label:'Ratio',value_type:'number',aggregation:'ratio',derivation:{type:'ratio',numerator_series_id:'one',denominator_series_id:'two',scale:100}});data.series.push({id:'ratio',label:'Ratio',metric_id:'ratio',unit_id:'u',scope_id:'all',measure_type:'actual',review_status:'reviewed'});
  map.setData(data);map.setLayers([{id:'ratio',type:'choropleth',encoding:{dataset_id:'amounts',series_id:'ratio'}}]);
  const target={layer_id:'ratio',region_id:'a'},model=buildTooltip(map,target);
  assert.ok(model.rows.some(row=>row.label==='Coverage'&&row.value==='1 / 1'));assert.ok(model.rows.some(row=>row.label==='Numerator'&&row.value==='10'));assert.ok(model.rows.some(row=>row.label==='Denominator'&&row.value==='30'));
  data.observations.find(o=>o.id==='a-1').value=0;map.setData(data);assert.ok(buildTooltip(map,target).rows.some(row=>row.value==='No data'));map.destroy();
});

test('composition remainder, mushroom halves, relation edges and flow nodes keep their own semantics',()=>{
  const map=makeMap();map.setLayers([{id:'parts',type:'pieChart',encoding:{dataset_id:'amounts',series_ids:['one','two']},options:{totalSeriesId:'total'}}]);
  const remainder=buildTooltip(map,{kind:'component',layer_id:'parts',region_id:'a',series_id:'__other__',share:.6});assert.equal(remainder.derived.value,60);assert.equal(remainder.derived.total,100);assert.equal(remainder.channels.length,3);
  map.setLayers([{id:'halves',type:'mushroom',encoding:{dataset_id:'amounts',series_ids:['one','two']}}]);assert.equal(buildTooltip(map,{kind:'component',layer_id:'halves',region_id:'b',series_id:'two'}).channels[0].observation.value,60);
  const data=structuredClone(map.datasets.get('amounts'));data.relations=[{id:'out',series_id:'one',period_id:'t',origin_region_id:'a',destination_region_id:'b',value:7,status:'value'},{id:'in',series_id:'one',period_id:'t',origin_region_id:'b',destination_region_id:'a',value:2,status:'value'},{id:'self',series_id:'one',period_id:'t',origin_region_id:'a',destination_region_id:'a',value:3,status:'value'}];map.setData(data);map.setLayers([{id:'flows',type:'flow',encoding:{dataset_id:'amounts',relation_series_id:'one'},options:{minValue:3}}]);
  const edge=buildTooltip(map,{kind:'relation',layer_id:'flows',relation_id:'out',origin_region_id:'a',destination_region_id:'b'});assert.equal(edge.title,'A → B');assert.equal(edge.channels[0].observation.value,7);
  const node=buildTooltip(map,{kind:'region',layer_id:'flows',region_id:'a'});assert.equal(node.channels[0].observation,null);assert.ok(node.rows.some(row=>row.label.endsWith('Before filtering / Incoming')&&row.value==='2 items'));assert.ok(node.rows.some(row=>row.label.endsWith('After filtering / Incoming')&&row.value==='0 items'));assert.ok(node.rows.some(row=>row.label.endsWith('After filtering / Internal')&&row.value==='3 items'));assert.match(map.render().svg, /aria-label="A \/ Before filtering \/ Incoming: 2 items/);map.destroy();
});

test('sparkline tooltip enlarges the declared window with actual spacing, missing points and correct selected period',()=>{
  const map=timeline(),target={layer_id:'spark',region_id:'a',series_id:'one',period_id:'empty'},model=buildTooltip(map,target);
  assert.equal(model.channels[0].observation.status,'missing');assert.deepEqual(model.chart.periods.map(p=>p.value),[0,null,20]);assert.deepEqual(model.chart.periods.map(p=>p.position),[0,.1,1]);assert.deepEqual(model.chart.domain,[0,80]);
  assert.match(map.render().svg,/data-sparkline-point="true" data-period-id="empty"/);
  map.setView({time_window:['empty','late']});const next=buildTooltip(map,target);assert.deepEqual(next.chart.periods.map(p=>p.period_id),['empty','late']);assert.doesNotMatch(next.chart.svg,/data-period-id="early"/);map.destroy();
});

test('time brush commits ordered ids, retains empty periods and active period, resets and synchronizes data changes',()=>{
  const map=timeline(),brush=new TimeBrush(map),events=[];map.on('timebrushchange',event=>events.push(event));
  assert.deepEqual(brush.positions,[0,.1,1]);assert.deepEqual(brush.range,[0,2]);brush.setRange('empty','late');
  assert.deepEqual(brush.range,[1,2]);assert.equal(map.spec.view.period_id,'early');assert.deepEqual(map.exportSpec({resolved:true}).view.time_window,['empty','late']);assert.equal(events[0].dataset_id,'amounts');
  assert.throws(()=>brush.setRange('late','early'),error=>error.code==='INVALID_ARGUMENT');assert.deepEqual(brush.range,[1,2]);brush.reset();assert.equal(map.spec.view.time_window,null);assert.deepEqual(brush.range,[0,2]);
  const spec=map.spec;assert.throws(()=>map.setView({time_window:['late','early']}),error=>error.code==='INVALID_ENCODING');assert.equal(map.spec,spec);
  assert.throws(()=>validateMapSpec({...spec,view:{time_window:['early']}}));assert.throws(()=>validateMapSpec({...spec,interaction:{tooltip:'true'}}));
  map.setView({time_window:{start_period_id:'early',end_period_id:'empty'}});assert.deepEqual(brush.range,[0,1]);map.destroy();assert.equal(brush.destroyed,true);assert.throws(()=>brush.reset(),error=>error.code==='LIFECYCLE');
});

test('Euro and China adapters preserve actual time coordinates for the shared brush and tooltip',()=>{
  const periods=[{id:'early',label:'Early',order:0,start:'2024-01-01',end:'2024-01-01'},{id:'empty',label:'Empty',order:1,start:'2024-01-02'},{id:'late',label:'Late',order:2,start:'2024-01-11'}],evidence={source_id:'synthetic',sha256:'c'.repeat(64)};
  const euro=euroBundle({geography:{type:'FeatureCollection',features:[{type:'Feature',id:'a',properties:{name:'A'},geometry:{type:'Point',coordinates:[0,0]}}]},dataset:{source:{id:'synthetic',title:'Synthetic'},records:[{region_id:'a',period_id:'early',value:0,evidence},{region_id:'a',period_id:'late',value:10,evidence}]}},{periods,unitLabel:'items'});
  const china=chinaBundle({id:'synthetic',title:'Synthetic',periods,regions:[{code:'a',name:'A',level:'area',point:[0,0]}],source:{id:'synthetic',title:'Synthetic'},metrics:[{id:'one',name:'Amount',unit:'items'}],records:[{region_code:'a',period:'early',values:{one:0},evidence},{region_code:'a',period:'late',values:{one:10},evidence}]});
  for(const bundle of [euro,china]){
    const map=createMap(bundle),dataset=[...map.datasets.values()][0];assert.equal(dataset.periods[0].end,'2024-01-01');
    map.setLayers([{id:'spark',type:'sparkline',encoding:{dataset_id:dataset.id,series_id:dataset.series[0].id}}]);
    const brush=new TimeBrush(map);assert.deepEqual(brush.positions,[0,.1,1]);brush.setRange('early','empty');
    const tooltip=buildTooltip(map,{layer_id:'spark',region_id:'a',period_id:'early'});assert.equal(tooltip.channels[0].observation.value,0);assert.equal(tooltip.channels[0].observation.evidence.sha256,'c'.repeat(64));assert.deepEqual(tooltip.chart.periods.map(period=>period.value),[0,null]);map.destroy();
  }
});
