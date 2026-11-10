import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, DatasetView, buildLegend, legendSvg, validateMapSpec } from '../src/index.js';
import { compositionModel, compositionSymbolSvg, compositionCollisionRadius } from '../src/renderers/composition-symbols.js';
import { svgPathBounds } from '../src/renderers/svg-path.js';
import { sample } from './fixtures/encoding.js';

const modes=['pie','ring','flag','segment','radar','agepyramid','halftone'];
const make=(fixture,type,options)=>compositionModel(type,['one','two'],new DatasetView(fixture.dataset,fixture.geography),{view:{period_id:'t'}},options);
const attr=(text,key)=>Number(text.match(new RegExp(`(?:^| )${key}="([^"]+)"`))[1]);
function bounds(svg){
  return [...svg.matchAll(/<(rect|circle|path)\b([^>]+)>/g)].map(([,tag,a])=>{
    if(tag==='circle'){const r=attr(a,'r'),x=attr(a,'cx'),y=attr(a,'cy');return {minX:x-r,maxX:x+r,minY:y-r,maxY:y+r};}
    if(tag==='rect'){const x=attr(a,'x'),y=attr(a,'y');return {minX:x,maxX:x+attr(a,'width'),minY:y,maxY:y+attr(a,'height')};}
    return svgPathBounds(a.match(/ d="([^"]+)"/)[1]);
  });
}

test('all seven composition modes and waffle scale both axes by the square root of total',()=>{
  const fixture=sample();
  // Identical shares isolate total sizing from the per-mode share geometry.
  for(const observation of fixture.dataset.observations)observation.value=(observation.region_id==='a'?.25:1)*({one:20,two:60,total:100}[observation.series_id]);
  for(const [type,mode] of [...modes.map(mode=>['pieChart',mode]),['waffle',undefined]]){
    const model=make(fixture,type,{mode,totalSeriesId:'total',sizeBy:'total',agePyramidHeightFactor:1.7,cells:25,columns:5});
    const a=bounds(compositionSymbolSvg(model,'a',0,0,40)),b=bounds(compositionSymbolSvg(model,'b',0,0,40));
    assert.equal(a.length,b.length);
    for(let i=0;i<a.length;i++)for(const key of ['minX','maxX','minY','maxY'])assert.ok(Math.abs(a[i][key]*2-b[i][key])<1e-7,`${type}/${mode}/${key}`);
    const stroke=type==='pieChart'&&['pie','ring','radar'].includes(mode)?.25:0;
    assert.ok(Math.abs((compositionCollisionRadius(model,'a',40)-stroke)*2-(compositionCollisionRadius(model,'b',40)-stroke))<1e-8);
    assert.equal(model.compositions.get('a').get('t').denominator,25);
  }
});

test('every composition stroke is reserved by the collision envelope, including missing markers and reference rings',()=>{
  const fixture=sample();
  for(const [type,mode] of [...modes.map(mode=>['pieChart',mode]),['waffle',undefined],['bar','grouped'],['bar','stacked'],['coxcomb','stacked']]){
    const options={mode,stroke:'#123456',strokeWidth:12,strokeOpacity:.4,fillOpacity:.3,agePyramidHeightFactor:1.7,cells:17,columns:5};
    const model=make(fixture,type,options),radius=compositionCollisionRadius(model,'a',40),svg=compositionSymbolSvg(model,'a',0,0,40);
    assert.match(svg,/stroke="#123456" stroke-width="12" stroke-opacity="0.4" stroke-linejoin="round" fill-opacity="0.3"/);
    const bare=make(fixture,type,{...options,stroke:'none',rings:false});
    if(type!=='coxcomb')assert.ok(Math.abs(radius-compositionCollisionRadius(bare,'a',40)-6)<1e-8);
    // Every actual path/rect corner or circle extent fits the common reserved
    // circle (circle corners aren't points on its outline).
    for(const match of svg.matchAll(/<(rect|circle|path)\b([^>]+)>/g)){
      const [,tag,a]=match,box=bounds(match[0])[0],stroke=attr(a,'stroke-width')/2;
      if(tag==='circle')assert.ok(Math.hypot(attr(a,'cx'),attr(a,'cy'))+attr(a,'r')+stroke<=radius+1e-6);
      else if(tag==='rect')for(const x of [box.minX,box.maxX])for(const y of [box.minY,box.maxY])assert.ok(Math.hypot(x,y)+stroke<=radius+1e-6);
      else assert.ok(Math.max(Math.abs(box.minX),Math.abs(box.maxX),Math.abs(box.minY),Math.abs(box.maxY))+stroke<=radius+1e-6);
    }
  }
  fixture.dataset.observations=[];
  for(const type of ['pieChart','waffle','bar','coxcomb']){
    const model=make(fixture,type,{}),svg=compositionSymbolSvg(model,'a',0,0,40),radius=compositionCollisionRadius(model,'a',40);
    assert.doesNotMatch(svg,/NaN|Infinity/);assert.ok(radius>=4.8+.5);
  }
});

test('waffle padding is a scale-independent cell fraction and rounded cells conserve allocation',()=>{
  const fixture=sample(),model=make(fixture,'waffle',{cells:17,columns:5,cellPadding:.25,cornerRadius:100,totalSeriesId:'total',showOther:false,stroke:'#222222',strokeWidth:2});
  const svg=compositionSymbolSvg(model,'a',0,0,40),rects=[...svg.matchAll(/<rect\b([^>]+)>/g)].map(match=>match[1]);
  assert.equal(rects.length,17);assert.equal(attr(rects[0],'width'),6);assert.equal(attr(rects[0],'rx'),3);
  assert.equal(attr(rects[1],'x')-attr(rects[0],'x'),8);
  assert.match(svg,/data-series-id="__remainder__"/);assert.match(svg,/<title>one: 10 items/);
});

test('invalid composition styles fail before committing even in an empty period or empty scope',()=>{
  const {geography,dataset}=sample();dataset.periods.push({id:'empty',label:'Empty',order:1});
  const map=createMap(null,{geography,dataset});
  try{
    map.setSpec({...map.spec,view:{period_id:'empty',region_ids:[]},layers:[{id:'theme',type:'waffle',encoding:{dataset_id:dataset.id,series_ids:['one','two']}}]});
    const before=map.spec,svg=map.export('svg'),source=JSON.stringify(dataset);
    for(const options of [{size:-1},{radius:NaN},{maxRadius:Infinity},{width:-1},{agePyramidHeightFactor:-1},{strokeWidth:-1},{strokeOpacity:2},{fillOpacity:'1'},{gap:-1},{cornerRadius:-1},{offsetAngle:NaN},{orientation:'diagonal'},{orientation:45},{cells:0},{cells:10001},{columns:0},{columns:10001},{cellPadding:1},{cellPadding:-.1},{cellPadding:NaN},{maxValue:-1},{sort:'bogus'},{sizeBy:'bogus'},{rings:0}]){
      const spec={...before,layers:[{...before.layers[0],options}]};
      assert.throws(()=>validateMapSpec(spec),error=>error.code==='INVALID_ENCODING');
      assert.throws(()=>map.setSpec(spec),error=>error.code==='INVALID_ENCODING');
      assert.equal(map.spec,before);assert.equal(map.export('svg'),svg);assert.equal(JSON.stringify(dataset),source);
    }
    for(const type of ['bar','coxcomb'])assert.throws(()=>map.setLayers([{...before.layers[0],type,options:{sizeBy:'total'}}]),/sizeBy total/);
  }finally{map.destroy();}
});

test('positive values reject zero scale domains while empty and zero periods remain renderable',()=>{
  const fixture=sample();
  for(const [type,options] of [['pieChart',{sizeBy:'total',totalMaximum:0}],['pieChart',{mode:'radar',radarValueMode:'absolute',componentMaximum:0}],['bar',{maxValue:0}],['bar',{widthSeriesId:'total',maxWidthValue:0}],['coxcomb',{maxValue:0}]])assert.throws(()=>make(fixture,type,options),error=>error.code==='INVALID_ENCODING');
  for(const observation of fixture.dataset.observations)observation.value=0;
  for(const type of ['pieChart','waffle','bar','coxcomb']){
    const model=make(fixture,type,{maxValue:0,totalMaximum:0});
    assert.doesNotMatch(compositionSymbolSvg(model,'a',0,0,40),/NaN|Infinity/);
  }
});

test('manual bar and Coxcomb maxima label the actual plotted scale and resolved exports reopen',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography);
  for(const type of ['bar','coxcomb']){
    const legend=buildLegend({type,encoding:{series_ids:['one','two']},options:{maxValue:500}},view,'t');
    assert.equal(legend.maximum,500);assert.match(legendSvg(legend),/500 items/);
  }
  const map=createMap(null,{geography,dataset});
  try{
    map.setLayers([{id:'theme',type:'pieChart',encoding:{dataset_id:dataset.id,series_ids:['one','two']},options:{mode:'agepyramid',sizeBy:'total',stroke:'#123456',strokeWidth:8}}]);
    const reopened=createMap(null,{geography,dataset,spec:JSON.parse(map.export('json')).spec});
    try{const normalize=svg=>svg.replace(/stats-map-\d+/g,'instance');assert.equal(normalize(reopened.render().renders[0].svg),normalize(map.render().renders[0].svg));assert.equal(reopened.export('csv'),map.export('csv'));}finally{reopened.destroy();}
  }finally{map.destroy();}
});

test('a positive explicit denominator with hidden remainder retains zero components on a zero component scale',()=>{
  const fixture=sample();for(const observation of fixture.dataset.observations)if(observation.series_id!=='total')observation.value=0;
  for(const [type,mode] of [['bar','grouped'],['bar','stacked'],['pieChart','radar']]){
    const model=make(fixture,type,{mode,totalSeriesId:'total',showOther:false,radarValueMode:'absolute',...(type==='bar'?{maxValue:0}:{})});
    assert.equal(model.compositions.get('a').get('t').denominator,100);
    const svg=compositionSymbolSvg(model,'a',0,0,40);assert.doesNotMatch(svg,/NaN|Infinity|data-status=/);assert.match(svg,/data-value="0" data-share="0"/);
    assert.ok(Number.isFinite(compositionCollisionRadius(model,'a',40)));
  }
});
