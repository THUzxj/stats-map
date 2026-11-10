import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, buildLegend, DatasetView } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

function resources(){
  const {geography,dataset}=sample();
  dataset.metrics.push({id:'exception',label:'Exception',value_type:'category',aggregation:'none',category_dimension_id:'exception'});
  dataset.dimensions=[{id:'exception',values:[{id:'closed',label:'Closed',order:0},{id:'unpublished',label:'Unpublished',order:1}]}];
  dataset.series.push({...dataset.series[0],id:'exception',metric_id:'exception'});
  dataset.observations=dataset.observations.filter(observation=>observation.id!=='b-0').map(observation=>observation.id==='a-0'?{...observation,value:0}:observation);
  dataset.observations.push(...['a','b'].map(id=>({id:id+'-exception',region_id:id,series_id:'exception',period_id:'t',status:'value',value:'closed'})));
  return {geography,dataset};
}
const layer=type=>({id:'base',type,encoding:{dataset_id:'amounts',series_id:'one',exception:{series_id:'exception'}},options:{exceptions:{categoryColors:{closed:'#123456',unpublished:'#abcdef'}}}});

test('numeric zero stays numeric while an explicit missing-value exception has a separate dictionary and legend',()=>{
  const {geography,dataset}=resources(),map=createMap(null,{geography,dataset});map.setLayers([layer('choropleth')]);
  const svg=map.render().svg,a=svg.match(/<path data-region-id="a"[^>]+>/)[0],b=svg.match(/<path data-region-id="b"[^>]+>/)[0];
  assert.doesNotMatch(a,/data-exception/);assert.match(b,/data-exception="closed"/);assert.match(b,/fill="#123456"/);
  const legend=buildLegend(layer('choropleth'),new DatasetView(dataset,geography),'t');assert.equal(legend.items[0].label,'0');assert.deepEqual(legend.exceptions.map(item=>item.label),['Closed','Unpublished']);
  assert.match(svg,/data-legend-key="exception:closed"[^>]+aria-label="Closed"/);
  map.setLegendFilter('base',['exception:closed']);assert.match(map.render().svg,/<path data-region-id="a"[^>]+data-filtered="true"/);assert.doesNotMatch(map.render().svg.match(/<path data-region-id="b"[^>]+>/)[0],/data-filtered/);map.destroy();
});

test('proportional symbols and incomplete compositions display explicit fixed-size exception markers',()=>{
  const {geography,dataset}=resources(),map=createMap(null,{geography,dataset});
  map.setLayers([layer('proportionalSymbol')]);let svg=map.render().svg;
  assert.match(svg,/<circle data-symbol-region-id="a"[^>]+r="0"/);assert.match(svg,/<rect data-region-id="b" data-exception="closed"/);
  map.setLegendFilter('base',['exception:closed']);assert.match(map.render().svg,/<circle data-symbol-region-id="a"[^>]+data-filtered="true"/);
  map.setLegendFilter('base',null);map.setLayers([{...layer('pieChart'),encoding:{dataset_id:'amounts',series_ids:['one','two'],exception:{series_id:'exception'}}}]);svg=map.render().svg;
  assert.match(svg,/<rect data-region-id="b" data-exception="closed"/);assert.match(svg,/<path data-component-index="1" data-region-id="a"/);map.destroy();
});
