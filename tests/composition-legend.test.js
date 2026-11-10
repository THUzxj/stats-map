import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, DatasetView, buildLegend, legendSvg, measureLegend, SmallMultiples, validateMapSpec } from '../src/index.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { intersects } from '../src/components/text-layout.js';
import { compositionModel, compositionSymbolSvg } from '../src/renderers/composition-symbols.js';
import { sample } from './fixtures/encoding.js';

const configurations=[...['pie','ring','flag','segment','radar','agepyramid','halftone'].map(mode=>({type:'pieChart',mode})),{type:'waffle'}];
const layerFor=(dataset,{type='pieChart',...options}={})=>({id:'theme',type,encoding:{dataset_id:dataset.id,series_ids:['one','two']},options:{sizeBy:'total',...options}});
const noIdentity=svg=>assert.doesNotMatch(svg,/data-(?:region-id|series-id|component-index|period-id|value|share|legend-key|legend-filter)|<title>/);
const strip=svg=>svg.replace(/\sdata-(?:region-id|series-id|component-index|value|share|legend-key)="[^"]*"/g,'').replace(/<title>[\s\S]*?<\/title>/g,'').replace(/\s+/g,' ');

test('composition size references match actual equal-share map glyphs in all seven modes and waffle',()=>{
  for(const config of configurations){
    const {geography,dataset}=sample();
    for(const observation of dataset.observations)observation.value=observation.series_id==='total'?observation.region_id==='a'?25:100:observation.region_id==='a'?12.5:50;
    const layer=layerFor(dataset,{...config,totalSeriesId:'total',showOther:false,colors:['#94a3b8','#94a3b8'],cells:16,columns:4,stroke:'#123456',strokeWidth:4,innerRadius:8,agePyramidHeightFactor:1.7});
    const map=createMap(null,{geography,dataset,width:1000,height:1000});
    try{
      map.setSpec({...map.spec,layout:{type:'dorling',radius:24},layers:[layer]});
      const result=map.render(),legend=result.legends[0],marks=legend.sizeLegend.marks;
      assert.deepEqual(marks.map(mark=>mark.value),[25,50,100]);
      const model=compositionModel(layer.type,['one','two'],new DatasetView(dataset,geography),{view:{period_id:'t'}},layer.options);
      // The map's actual renderer uses a 48px nominal glyph for radius 24.
      assert.equal(strip(compositionSymbolSvg(model,'a',0,0,48)),strip(marks[0].svg));
      assert.equal(strip(compositionSymbolSvg(model,'b',0,0,48)),strip(marks[2].svg));
      assert.ok(marks[2].radius<=map.layoutPositions.get('b').radius+1e-8);
      for(const mark of marks)noIdentity(mark.svg);
      assert.match(legendSvg(legend,0,0,'test',{layerId:'theme'}),/data-legend-key="component:one"/);
    }finally{map.destroy();}
  }
});

test('large size references reserve disjoint glyph and label bounds and preserve configured dimensions',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography);
  dataset.series.forEach(series=>series.label='Long fictional component 虚构分量名称');
  for(const config of configurations){
    const legend=buildLegend(layerFor(dataset,{...config,size:110,agePyramidHeightFactor:2,strokeWidth:12,stroke:'#111',sizeLegend:{title:'Long nominal size reference 虚构尺寸参照',values:[25,100]}}),view,'t');
    const plan=specializedLegendLayout(legend,110,legend.presentation),measure=measureLegend(legend,{width:110,title:'Full title'});
    assert.equal(measure.width,plan.width);assert.ok(measure.width>110);
    for(const box of plan.boxes){assert.ok(box.x>=0);assert.ok(box.x+box.width<=measure.width-12+1e-7);assert.ok(box.y>=0);assert.ok(box.y+box.height<=plan.height);}
    for(let i=0;i<plan.boxes.length;i++)for(let j=i+1;j<plan.boxes.length;j++)assert.equal(intersects(plan.boxes[i],plan.boxes[j]),false,JSON.stringify({config,i,j}));
    const svg=legendSvg(legend,0,0,'test',{width:110,layerId:'theme'});
    assert.match(svg,/Equal-share size references/);assert.doesNotMatch(svg,/data-region-id=/);
  }
});

test('zero and empty periods have no invented total marks while shared domains survive empty panels and reopening',()=>{
  const {geography,dataset}=sample();dataset.periods.push({id:'empty',label:'Empty',order:1});
  const map=createMap(null,{geography,dataset});
  try{
    map.setLayers([layerFor(dataset)]);
    const bundle=structuredClone(map.bundle);bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource=map.exportSpec();
    const multiples=new SmallMultiples(null,bundle,[{id:'full',period_id:'t'},{id:'empty',period_id:'empty'}]);
    try{
      const full=multiples.maps[0].render().legends[0],empty=multiples.maps[1].render().legends[0];
      assert.deepEqual(empty.sizeLegend,full.sizeLegend);assert.equal(empty.missing,true);
      const reopened=createMap(null,{geography,dataset,spec:multiples.maps[1].exportSpec({resolved:true})});
      try{assert.deepEqual(reopened.render().legends[0].sizeLegend,full.sizeLegend);}finally{reopened.destroy();}
    }finally{multiples.destroy();}
    map.setView({period_id:'empty'});assert.equal(map.render().legends[0].sizeLegend,null);
    for(const observation of dataset.observations)observation.value=0;
    const zero=buildLegend(layerFor(dataset),new DatasetView(dataset,geography),'t');
    assert.equal(zero.sizeLegend,null);assert.equal(zero.zero,true);assert.doesNotMatch(legendSvg(zero),/data-composition-size-value/);
  }finally{map.destroy();}
});

test('size legend controls preserve category filters, statuses, source values and resolved exports',()=>{
  const {geography,dataset}=sample(),source=JSON.stringify(dataset),map=createMap(null,{geography,dataset});
  try{
    map.setLayers([layerFor(dataset,{mode:'radar',radarValueMode:'absolute',sizeLegend:{title:'Reference totals',values:[10,100,200]}})]);
    const before=map.render().legends[0].sizeLegend,csv=map.export('csv');
    map.setSelection(['a']);map.setLegendFilter('theme',['component:one']);
    assert.deepEqual(map.render().legends[0].sizeLegend,before);assert.deepEqual(map.getState().selection,['a']);assert.equal(map.export('csv'),csv);
    const saved=map.exportSpec({resolved:true}),reopened=createMap(null,{geography,dataset,spec:saved});
    try{assert.deepEqual(reopened.render().legends[0].sizeLegend,before);assert.deepEqual(reopened.spec.view.legend_filters.theme,['component:one']);}finally{reopened.destroy();}
    map.setLayers([layerFor(dataset,{sizeLegend:false})]);assert.equal(map.render().legends[0].sizeLegend,null);assert.match(map.lastRender.legend,/component:one/);
    map.setLayers([{...layerFor(dataset),options:{}}]);assert.equal(map.render().legends[0].sizeLegend,null);
    assert.equal(JSON.stringify(dataset),source);
  }finally{map.destroy();}
});

test('invalid size reference options fail transactionally even with empty views and hidden legends',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  try{
    map.setSpec({...map.spec,view:{period_id:'t',region_ids:[]},layers:[{...layerFor(dataset),legend:false}]});
    const before=map.spec;
    for(const sizeLegend of [null,true,[],0,{title:1},{unknown:1},{values:[]},{values:[0]},{values:[-1]},{values:[1,1]},{values:[2,1]},{values:[NaN]},{values:['10']}]){
      const layer={...before.layers[0],options:{sizeBy:'total',sizeLegend}},spec={...before,layers:[layer]};
      assert.throws(()=>validateMapSpec(spec),error=>error.code==='INVALID_ENCODING');assert.throws(()=>map.setSpec(spec));assert.equal(map.spec,before);
    }
    for(const type of ['bar','coxcomb','pieChart'])assert.throws(()=>map.setLayers([{...before.layers[0],type,options:{sizeLegend:{}}}]));
  }finally{map.destroy();}
});
