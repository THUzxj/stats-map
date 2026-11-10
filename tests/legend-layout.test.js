import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { intersects } from '../src/components/text-layout.js';
import { placeLegendPanels } from '../src/components/legend-panels.js';
import { adapterFixture, matrixCases, matrixMap } from './fixtures/adapter-matrix.js';

test('specialized legend plans wrap complete Unicode labels and contain every mark without changing the scale',()=>{
  const fixture=adapterFixture(lib,'canonical');
  fixture.dataset.series.forEach(series=>series.label='Synthetic indicator with a very long translated name 虚构长名称');
  fixture.dataset.units[0].label='Long common unit 虚构单位';
  for(const id of ['bivariate','ternary','alpha','spark-line','symbol-cross','mushroom-horizontal']){
    const row={...matrixCases().find(row=>row.id===id)};
    if(id.startsWith('symbol')||id.startsWith('mushroom'))row.options={...row.options,maxRadius:70};
    const map=matrixMap(lib,fixture,row,'geographic');
    try{
      const legend=map.lastRender?.legends[0]??map.render().legends[0],before=JSON.stringify(legend);
      const measured=lib.measureLegend(legend,{width:120,title:'Long multilingual legend title 虚构说明'}),plan=specializedLegendLayout(legend,120,legend.presentation);
      assert.ok(measured.height>0);assert.equal(measured.width,plan.width);
      for(const box of plan.boxes){assert.ok(box.x>=-6,`${id}: left`);assert.ok(box.x+box.width<=measured.width-6+1e-6,`${id}: right`);assert.ok(box.y>=-14,`${id}: top`);assert.ok(box.y+box.height<=plan.height+4,`${id}: bottom`);}
      const svg=lib.legendSvg(legend,12,20,'layout',{width:120,title:'Long multilingual legend title 虚构说明',layerId:'theme'});
      if(!legend.marks)assert.ok(svg.includes('<tspan'),id);assert.ok(svg.includes('aria-label="Long multilingual legend title 虚构说明"'));assert.equal(JSON.stringify(legend),before);
      if(legend.marks)assert.equal(legend.marks.at(-1).radius,70);
      if(id==='bivariate')assert.equal((svg.match(/data-legend-key="bivariate:/g)??[]).length,legend.cells.length);
      if(id==='ternary')for(const component of legend.components)assert.ok(svg.includes(component.label));
    }finally{map.destroy();}
  }
});

test('large size marks have disjoint text and glyph bounds and retain native radii',()=>{
  const fixture=adapterFixture(lib,'canonical'),row={...matrixCases().find(row=>row.id==='symbol-square'),options:{shape:'square',maxRadius:90}};
  const map=matrixMap(lib,fixture,row,'geographic');
  try{
    const legend=map.render().legends[0],plan=specializedLegendLayout(legend,110,legend.presentation);
    for(let i=0;i<plan.boxes.length;i++)for(let j=i+1;j<plan.boxes.length;j++)assert.equal(intersects(plan.boxes[i],plan.boxes[j]),false);
    assert.equal(plan.elements.filter(item=>item.type==='symbol').at(-1).radius,90);assert.ok(plan.width>110);assert.ok(plan.height>300);
  }finally{map.destroy();}
});

test('automatic panel placement avoids fixed decoration, ranking, inset and other legend boxes',()=>{
  const fixture=adapterFixture(lib,'canonical'),map=matrixMap(lib,fixture,matrixCases()[0],'geographic');
  try{
    map.setSpec({...map.spec,title:'Synthetic title',subtitle:'A longer subtitle that needs space',legend:{width:150},decorations:{source:true,unit:true,labels:true},ranking:{x:500,y:120,width:220},insets:[{id:'detail',x:500,y:300,width:220,height:150}],layers:[...map.spec.layers,{id:'symbols',type:'proportionalSymbol',encoding:{dataset_id:fixture.dataset.id,series_id:'one'}}]});
    const result=map.render(),panels=result.legendLayout.panels;
    assert.equal(panels.length,2);assert.deepEqual(result.legendLayout.diagnostics,[]);
    const fixed=result.decorations.obstacles.filter(box=>!panels.some(panel=>box===panel.bounds));
    for(const panel of panels){assert.ok(panel.bounds.x>=0&&panel.bounds.y>=0);assert.ok(panel.bounds.x+panel.width<=760);assert.ok(panel.bounds.y+panel.height<=560);for(const box of fixed)assert.equal(intersects(panel.bounds,box),false);}
    assert.equal(intersects(panels[0].bounds,panels[1].bounds),false);
    const before=JSON.stringify(panels.map(({model,...panel})=>panel));map.render();assert.equal(JSON.stringify(map.lastRender.legendLayout.panels.map(({model,...panel})=>panel)),before);
  }finally{map.destroy();}
});

test('impossible and explicit legend placement reports geometry without dropping content or mutating state',()=>{
  const fixture=adapterFixture(lib,'canonical'),row=matrixCases().find(row=>row.id==='symbol-circle'),map=matrixMap(lib,fixture,row,'geographic');
  try{
    map.setSpec({...map.spec,layers:[{...map.spec.layers[0],options:{maxRadius:150},legend:{x:10,y:10,width:120}}]});
    map.setViewport({width:180,height:160});
    assert.ok(map.lastRender.diagnostics.some(item=>item.code==='LEGEND_OVERFLOW'));
    assert.equal(map.lastRender.legends[0].marks.at(-1).radius,150);assert.match(map.lastRender.legend,/150|40/);
    const before=map.spec;
    for(const legend of [{width:0},{width:NaN},{x:Infinity},{gap:-1},{collision:'hide'}])assert.throws(()=>map.setSpec({...map.spec,legend}));
    assert.equal(map.spec,before);assert.throws(()=>lib.legendHeight(map.lastRender.legends[0],{width:0}));
  }finally{map.destroy();}
});

test('automatic legends reserve later explicit panels before choosing a position',()=>{
  const result=placeLegendPanels([{layer_id:'auto',width:180,height:180},{layer_id:'fixed',width:180,height:180,x:12,y:20}],{width:500,height:500});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.panels[1].x,12);assert.equal(result.panels[1].y,20);
  assert.equal(intersects(result.panels[0].bounds,result.panels[1].bounds),false);
});

test('empty bivariate axes have no invented cells and fixed thresholds remain labeled without observations',()=>{
  for(const fixed of [false,true]){
    const fixture=adapterFixture(lib,'canonical'),row={...matrixCases().find(row=>row.id==='bivariate'),...(fixed?{classification:{method:'threshold',thresholds:[15,35]}}:{})},map=matrixMap(lib,fixture,row,'geographic');
    try{
      map.setView({period_id:'unreported'});const legend=map.lastRender.legends[0],plan=specializedLegendLayout(legend,180,legend.presentation);
      assert.equal(legend.missing,true);assert.equal(legend.cells.length,fixed?9:0);assert.ok(Number.isFinite(plan.height));
      for(const axis of legend.axes)assert.equal(axis.items.length,fixed?3:0);
      const svg=lib.legendSvg(legend);assert.doesNotMatch(svg,/NaN|undefined/);if(fixed)assert.match(svg,/15/);
    }finally{map.destroy();}
  }
});

test('fixed numeric class colors use class identity even when observations occupy only a later class',()=>{
  const fixture=adapterFixture(lib,'canonical'),row={...matrixCases()[0],classification:{method:'threshold',thresholds:[-10,-5]}};
  const map=matrixMap(lib,fixture,row,'geographic');
  try{
    const colors=map.render().legends[0].items.map(item=>item.color);assert.equal(new Set(colors).size,3);
    map.setView({period_id:'unreported'});assert.deepEqual(map.lastRender.legends[0].items.map(item=>item.color),colors);assert.equal(map.lastRender.legends[0].missing,true);
  }finally{map.destroy();}
});

test('fixed alpha domains keep their opacity bands during empty periods',()=>{
  const fixture=adapterFixture(lib,'canonical'),row={...matrixCases().find(row=>row.id==='alpha'),classification:{method:'threshold',thresholds:[15,35]},options:{opacity:{domain:[0,100]}}},map=matrixMap(lib,fixture,row,'geographic');
  try{const bands=map.render().legends[0].bands;map.setView({period_id:'unreported'});assert.deepEqual(map.lastRender.legends[0].bands,bands);assert.equal(map.lastRender.legends[0].base.items.length,3);assert.equal(map.lastRender.legends[0].missing,true);}finally{map.destroy();}
});
