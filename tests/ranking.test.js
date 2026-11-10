import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, buildRanking, RankingChart, createPresentation } from '../src/index.js';
import { rankingLayout } from '../src/components/ranking-layout.js';
import { rankingDistribution, rankingScale } from '../src/components/ranking-options.js';
import { targetChannels } from '../src/core/target-data.js';
import { mapTarget } from '../src/core/interaction-events.js';
import { rankingFixture } from './fixtures/ranking.js';
const instance=count=>createMap(null,{...rankingFixture(count),width:850,height:850});

test('large rankings use a distribution while retaining raw rows, stable ties, missing statuses and bin membership',()=>{
  const map=instance(100);
  try{
    const model=buildRanking(map);assert.equal(model.mode,'histogram');assert.equal(model.rows.length+model.missing.length,100);assert.equal(model.bins.reduce((n,bin)=>n+bin.count,0),model.rows.length);
    assert.deepEqual(new Set(model.bins.flatMap(bin=>bin.region_ids)),new Set(model.rows.map(row=>row.region_id)));
    for(const bin of model.bins)for(const id of bin.region_ids){const row=model.rows.find(row=>row.region_id===id);assert.ok(row.value>=bin.lower&&(row.value<bin.upper||bin.upperInclusive&&row.value<=bin.upper));assert.equal(row.observation.source_flag,'synthetic');}
    assert.ok(model.missing.every(row=>row.status==='suppressed'&&row.value===null));assert.ok(model.rows.some(row=>row.value===0));assert.ok(model.rows.some(row=>row.value<0));
    const ascending=buildRanking(map,{ascending:true,limit:15});assert.equal(ascending.mode,'bars');assert.ok(ascending.hidden>0);assert.ok(ascending.rows[0].value<=ascending.rows.at(-1).value);
    assert.equal(buildRanking(map,{mode:'bars'}).rows.length,model.rows.length);assert.equal(buildRanking(map,{mode:'histogram',limit:3}).mode,'histogram');
    const equal=buildRanking(map).rows.filter(row=>row.value===0);assert.ok(equal.every(row=>row.rank===equal[0].rank));assert.deepEqual(equal.map(row=>row.region_id),equal.map(row=>row.region_id).sort());
  }finally{map.destroy();}
});

test('distribution partitions constants, exact interval boundaries, adjacent floats and large signed values',()=>{
  for(const values of [[0,0,0],[-8,-4,0,4,8],[Number.MIN_VALUE,2*Number.MIN_VALUE,3*Number.MIN_VALUE],[-1e308,0,1e308],[1e16,1e16+2,1e16+4]]){
    const rows=values.map((value,i)=>({region_id:String(i),value})),bins=rankingDistribution(rows,4),scale=rankingScale(rows);
    assert.equal(bins.reduce((n,bin)=>n+bin.count,0),values.length);assert.equal(new Set(bins.flatMap(bin=>bin.region_ids)).size,values.length);
    for(const row of rows){assert.ok(Number.isFinite(scale.position(row.value)));assert.ok(scale.position(row.value)>=0&&scale.position(row.value)<=1);const bin=bins.find(bin=>bin.region_ids.includes(row.region_id));assert.ok(row.value>=bin.lower&&(row.value<bin.upper||bin.upperInclusive&&row.value<=bin.upper));}
    if(values.every(value=>value===values[0]))assert.equal(bins.length,1);
  }
  const rows=Array.from({length:150000},(_,index)=>({region_id:String(index),value:index%31}));
  assert.equal(rankingDistribution(rows).reduce((n,bin)=>n+bin.count,0),rows.length);
  assert.equal(rankingScale(rows).maximum,30);
});

test('measured ranking plans preserve complete names, formatted values, zero baselines and finite rectangles',()=>{
  const map=instance(8);
  try{
    const model=buildRanking(map),options={width:180,title:'A complete long translated ranking title 虚构标题',subtitle:'Complete explanatory subtitle',decimals:2,labelFontSize:12};
    const p=createPresentation(map.spec,map.geography),plan=rankingLayout(model,options,p);
    assert.ok(plan.height>model.rows.length*24);
    assert.equal(plan.elements.find(el=>el.kind==='title').value,options.title);
    for(const row of plan.rows){assert.equal(row.label.value,`${p.number(row.entry.rank)}. ${row.entry.label}`);assert.match(row.numeric.value,/\.00$/);assert.ok(row.bar.y>=row.label.y);assert.ok(row.bar.y>=row.numeric.y);assert.ok(row.bar.width>=0);assert.ok(row.bar.x>=plan.padding);assert.ok(row.bar.x+row.bar.width<=plan.width-plan.padding+1e-8);}
    const compressed=rankingLayout(model,{...options,height:200},p);assert.equal(compressed.height,200);assert.ok(compressed.scale<1);assert.equal(compressed.rows.length,plan.rows.length);assert.deepEqual(compressed.rows.map(row=>row.entry.value),plan.rows.map(row=>row.entry.value));
    map.setSpec({...map.spec,ranking:options});assert.deepEqual(map.lastRender.rankingLayout,plan);assert.ok(map.lastRender.diagnostics.some(item=>item.code==='RANKING_OVERFLOW'));
    assert.match(map.export('svg'),/data-ranking-title/);assert.match(map.export('svg'),/data-ranking-background/);
  }finally{map.destroy();}
});

test('corner placement, explicit overrides, opacity while zoomed and resized exports share measured bounds',()=>{
  const map=instance(4);
  try{
    map.setSpec({...map.spec,ranking:{position:'bottom right',width:200,height:240,boxOpacity:.4,onlyApplyOpacityWhileZoomed:true}});
    const layout=map.lastRender.rankingLayout;assert.ok(map.export('svg').includes(`translate(${850-layout.width-12} ${850-layout.height-12})`));assert.match(map.export('svg'),/fill-opacity="1"/);
    map.setViewTransform({zoom:2,pan:[0,0]});assert.match(map.export('svg'),/fill-opacity="0.4"/);
    map.setSpec({...map.spec,ranking:{...map.spec.ranking,x:50,y:90}});assert.match(map.export('svg'),/data-map-ranking="true" direction="ltr" transform="translate\(50 75\)"/);
    map.setViewport({width:390,height:600});assert.equal(map.lastRender.rankingLayout.height,layout.height);assert.equal(map.lastRender.ranking.rows[0].value,buildRanking(map).rows[0].value);
  }finally{map.destroy();}
});

test('SVG ranking focus identity differs from map regions and event channels retain chosen original period and series',()=>{
  const map=instance(6);
  try{
    map.setSpec({...map.spec,ranking:{seriesId:'two',periodId:'later',mode:'bars'}});
    const row=map.lastRender.ranking.rows[0],attrs={'data-ranking-row':'true','data-ranking-dataset':map.lastRender.ranking.datasetId,'data-region-id':row.region_id,'data-series-id':'two','data-period-id':'later'};
    const element={getAttribute:name=>attrs[name]??null,closest:()=>({getAttribute:()=>map.spec.layers[0].id})};
    const target=mapTarget({closest:()=>element});assert.equal(target.ranking,true);assert.equal(target.period_id,'later');
    const channels=targetChannels(map,target);assert.equal(channels.length,1);assert.equal(channels[0].series.id,'two');assert.equal(channels[0].observation.value,row.value);assert.equal(channels[0].reported_observation,row.observation);
  }finally{map.destroy();}
});

test('ranking options and component controls reject invalid input before changing current state',()=>{
  const map=instance(7);
  try{
    for(const ranking of [{width:63},{height:0},{boxPadding:-1},{boxOpacity:2},{shapeHeight:NaN},{labelFontSize:0},{bins:0},{barLimit:1.5},{pageSize:10001},{position:'middle'},{mode:'pie'},{ascending:1},{decimals:21},{title:5},{labelFormatter:()=>''},{limit:-1},{regionIds:['area-0001','area-0001']}]){
      const before=map.spec;assert.throws(()=>map.setSpec({...before,ranking}));assert.equal(map.spec,before);assert.throws(()=>buildRanking(map,ranking));
    }
    const chart=new RankingChart(map,{pageSize:2,mode:'bars'});assert.equal(chart.pageCount,3);chart.render();assert.equal(chart.pageCount,3);chart.showPage(100);assert.equal(chart.page,2);chart.setMode('histogram');assert.equal(chart.model.mode,'histogram');assert.equal(chart.page,0);
    assert.throws(()=>chart.showPage(-1));assert.throws(()=>chart.setMode('pie'));chart.destroy();assert.equal(chart.destroyed,true);assert.throws(()=>chart.showPage(0),error=>error.code==='LIFECYCLE');assert.throws(()=>chart.setMode('bars'),error=>error.code==='LIFECYCLE');
  }finally{map.destroy();}
});

test('ranking bars share classified and continuous map colors while explicit colors override presentation only',()=>{
  const map=instance(8);
  try{
    for(const colorMode of ['classes','continuous','diverging']){
      map.setSpec({...map.spec,layers:map.spec.layers.map(layer=>({...layer,options:{colorMode,colors:['#112233','#ddeeff']}})),ranking:{mode:'bars'}});
      const result=map.lastRender;
      for(const row of result.ranking.rows){assert.ok(result.renders[0].svg.includes(`data-region-id="${row.region_id}"`));const path=result.renders[0].svg.split(`data-region-id="${row.region_id}"`)[1].split('/>')[0];assert.ok(path.includes(`fill="${row.color}"`),row.region_id);}
    }
    const before=buildRanking(map).rows.map(row=>row.value),overridden=buildRanking(map,{color:'#abcdef'});assert.deepEqual(overridden.rows.map(row=>row.value),before);assert.ok(overridden.rows.every(row=>row.color==='#abcdef'));
  }finally{map.destroy();}
});
