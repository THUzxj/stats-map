import test from 'node:test';
import assert from 'node:assert/strict';
import { DatasetView, renderSvg, buildLegend, legendSvg, classifyDomain } from '../src/index.js';
import { numericColor } from '../src/renderers/color.js';
import { sample } from './fixtures/encoding.js';

test('continuous and diverging colors map endpoints, center and constants to the legend domain',()=>{
  const domain=classifyDomain([-10,0,10]),options={colorMode:'diverging',colors:['#0000ff','#ffffff','#ff0000'],center:0};
  assert.equal(numericColor(-10,domain,options),'#0000ff');assert.equal(numericColor(0,domain,options),'#ffffff');assert.equal(numericColor(10,domain,options),'#ff0000');
  assert.equal(numericColor(5,domain,options),'#ff8080');
  assert.equal(numericColor(1,classifyDomain([1,1]),{colorMode:'continuous',colors:['#000000','#ffffff']}),'#808080');
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography),layer={type:'choropleth',encoding:{series_id:'one'},options:{colorMode:'continuous',colors:['#0000ff','#ff0000']}};
  const legend=buildLegend(layer,view,'t');assert.equal(legend.type,'color-ramp');assert.equal(legend.items[0].color,'#0000ff');assert.equal(legend.items.at(-1).color,'#ff0000');
});

test('categorical renderer and legend share the complete registered dictionary and stable colors',()=>{
  const {geography,dataset}=sample();
  dataset.dimensions=[{id:'kind',label:'Kind',values:[{id:'blue',label:'Blue group',order:0},{id:'red',label:'Red group',order:1}]}];
  dataset.metrics=[{id:'category',label:'Category',value_type:'category',aggregation:'none',category_dimension_id:'kind'}];
  dataset.series=[{...dataset.series[0],metric_id:'category'}];
  dataset.observations=[{id:'category-a',series_id:'one',region_id:'a',period_id:'t',status:'value',value:'red'}];
  const view=new DatasetView(dataset,geography),layer={id:'base',type:'categorical',encoding:{series_id:'one'},options:{categoryColors:{blue:'#123456',red:'#abcdef'}}};
  const legend=buildLegend(layer,view,'t');
  assert.deepEqual(legend.items.map(item=>item.label),['Blue group','Red group']);assert.equal(legend.items[1].color,'#abcdef');
  const svg=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer}).svg;
  assert.match(svg,/<path data-region-id="a"[^>]+fill="#abcdef"/);assert.match(svg,/<path data-region-id="b"[^>]+fill="#e5e7eb"/);
  assert.match(legendSvg(legend),/Red group/);
});

test('classification dot and square textures use shared classes without implying point counts',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography);
  for(const texture of ['dot','square']){
    const layer={id:'base',type:'choropleth',encoding:{series_id:'one'},options:{texture},classification:{method:'threshold',thresholds:[20]}};
    const svg=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer,namespace:texture}).svg;
    assert.equal((svg.match(/<pattern /g)??[]).length,2);assert.match(svg,/<path data-region-id="a"[^>]+fill="url\(#[^)]+\)"/);
    const legend=buildLegend(layer,view,'t');assert.equal(legend.items.length,2);assert.match(legendSvg(legend),/<pattern /);
    if(texture==='dot')assert.match(svg,/<circle cx="5" cy="5"/);else assert.match(svg,/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#1f2937"/);
  }
});

test('all-missing and constant numeric legends do not invent zero thresholds',()=>{
  const {geography,dataset}=sample();dataset.observations=[];
  const layer={type:'choropleth',encoding:{series_id:'one'}},view=new DatasetView(dataset,geography),missing=buildLegend(layer,view,'t');assert.deepEqual(missing.items,[]);assert.equal(missing.missing,true);
  dataset.observations=[{id:'a',series_id:'one',region_id:'a',period_id:'t',status:'value',value:5},{id:'b',series_id:'one',region_id:'b',period_id:'t',status:'value',value:5}];
  const constant=buildLegend(layer,new DatasetView(dataset,geography),'t');assert.equal(constant.items[0].label,'5');
});

test('implicit diverging domains include the center while explicit incompatible domains fail',()=>{
  const domain=classifyDomain([10,20]),options={colorMode:'diverging',colors:['#0000ff','#ffffff','#ff0000']};
  assert.equal(numericColor(10,domain,options),'#ff8080');
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography),legend=buildLegend({type:'choropleth',encoding:{series_id:'one'},options},view,'t');
  assert.equal(legend.items[0].value,0);assert.equal(legend.items[0].color,'#ffffff');assert.equal(legend.items.at(-1).value,40);
  assert.throws(()=>numericColor(10,domain,{...options,colorDomain:[10,20]}),error=>error.code==='INVALID_ENCODING');
});

test('bivariate threshold axes reject palettes beyond three classes in map and legend',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography),layer={type:'bivariateChoropleth',encoding:{series_ids:['one','two']},classification:{method:'threshold',axes:[{thresholds:[1,2,3]}]}};
  assert.throws(()=>renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer}),error=>error.code==='INVALID_ENCODING');
  assert.throws(()=>buildLegend(layer,view,'t'),error=>error.code==='INVALID_ENCODING');
});
