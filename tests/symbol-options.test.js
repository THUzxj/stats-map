import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, DatasetView, buildLegend, legendSvg, createPresentation } from '../src/index.js';
import { symbolScale, symbolShapeSvg, symbolCollisionRadius, SYMBOL_SHAPES } from '../src/renderers/symbols.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { sample } from './fixtures/encoding.js';

test('positive symbol minimum clamps visibility without changing zero, missing or the maximum',()=>{
  for(const shape of SYMBOL_SHAPES.filter(shape=>shape!=='custom')){
    const options={shape,minRadius:6,maxRadius:20,maxValue:100},scale=symbolScale([0,1,25,100],options);
    assert.equal(scale.radius(0),0);assert.equal(scale.radius(null),null);assert.equal(scale.radius(NaN),null);
    assert.equal(scale.radius(1),6);assert.equal(scale.radius(100),20);assert.equal(scale.radius(200),20);
    assert.equal(scale.radius(25),['bar','spike'].includes(shape)?6:10);
    assert.throws(()=>scale.radius(-1),error=>error.code==='UNSUPPORTED_VALUE');
  }
  assert.equal(symbolScale([0],{minRadius:6}).radius(0),0);
  assert.equal(symbolScale([1],{minRadius:6,maxValue:0}).radius(1),0);
});

test('symbol offset, spike base and round stroke envelope use the same screen geometry',()=>{
  const options={offset:{x:1.5,y:-2},strokeWidth:8,strokeOpacity:.3,fillOpacity:.2};
  const circle=symbolShapeSvg('circle',50,60,10,options);
  assert.match(circle,/cx="65" cy="40" r="10"/);assert.match(circle,/stroke-width="8" stroke-opacity="0.3" stroke-linejoin="round"/);
  assert.match(circle,/fill-opacity="0.2"/);
  assert.equal(symbolCollisionRadius('circle',10,options),39);
  assert.equal(symbolCollisionRadius('circle',10,{...options,stroke:'none'}),35);
  assert.equal(symbolCollisionRadius('circle',10,{...options,strokeOpacity:0}),35);
  assert.match(symbolShapeSvg('spike',50,60,10,{...options,spikeWidth:30}),/points="65,30 80,50 50,50"/);
  assert.equal(symbolCollisionRadius('spike',10,{...options,spikeWidth:30}),Math.hypot(15,10)+29);
  const custom={...options,customShape:{viewBox:[0,0,10,10],path:'M-5 0L15 0L15 10L-5 10Z'}};
  assert.match(symbolShapeSvg('custom',50,60,10,custom),/translate\(65 40\) scale\(2\)/);
  assert.match(symbolShapeSvg('custom',50,60,10,custom),/vector-effect="non-scaling-stroke"/);
  assert.equal(symbolCollisionRadius('custom',10,custom),Math.hypot(20,10)+29);
});

test('styled symbol legend reserves offset and stroke and explains a positive minimum in every locale',()=>{
  const {geography,dataset}=sample(),view=new DatasetView(dataset,geography);
  for(const shape of SYMBOL_SHAPES){
    const options={shape,minRadius:7,maxRadius:20,offset:{x:2,y:-1},strokeWidth:9,spikeWidth:36,...(shape==='custom'?{customShape:{viewBox:[0,0,10,10],path:'M-3 0L12 0L12 10L-3 10Z'}}:{})};
    const layer={id:'styled',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'},options};
    for(const locale of ['en','zh','fr','de']){
      const spec={locale},legend=buildLegend(layer,view,'t',{spec}),plan=specializedLegendLayout(legend,100,createPresentation(spec,geography));
      assert.ok(!legendSvg(legend).includes('minimumSymbolSize'));
      assert.ok(plan.elements.some(item=>item.type==='text'&&item.value.includes('7 px')));
      for(const box of plan.boxes)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=plan.width+1e-8&&box.y+box.height<=plan.height+1e-8,shape);
      for(const mark of legend.marks)assert.equal(mark.radius,symbolScale([10,40],options).radius(mark.value));
    }
  }
});

test('invalid symbol style fails transactionally before state, layout or source replacement',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  try{
    map.setLayers([{id:'symbol',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'}}]);
    const before=map.spec,svg=map.export('svg'),source=JSON.stringify(dataset);
    for(const options of [{minRadius:-1},{minRadius:21},{minRadius:NaN},{strokeWidth:-1},{strokeWidth:Infinity},{strokeOpacity:1.01},{fillOpacity:'0.5'},{fillOpacity:-.01},{offset:[1,2]},{offset:{x:1}},{offset:{x:1,y:Infinity}},{offset:{x:1e308,y:0}},{spikeWidth:-1}]){
      assert.throws(()=>map.setLayers([{...before.layers[0],options}]),error=>error.code==='INVALID_ENCODING');
      assert.equal(map.spec,before);assert.equal(map.export('svg'),svg);assert.equal(JSON.stringify(dataset),source);
    }
  }finally{map.destroy();}
});

test('styled symbols reserve displaced envelopes in Dorling and reopen with identical sizes and original values',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset,width:800,height:600});
  const source=JSON.stringify(dataset);
  try{
    map.setSpec({...map.spec,layers:[{id:'styled',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'},options:{minRadius:10,maxRadius:15,offset:{x:1.5,y:-.5},strokeWidth:12,strokeOpacity:.4}}],layout:{type:'dorling',worker:false,iterations:500}});
    const result=map.render();assert.equal(result.layout.collision_pairs,0);
    const circle=[...result.renders[0].svg.matchAll(/data-symbol-region-id="([^"]+)"[^>]* cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)];
    assert.equal(circle.length,2);
    for(const [,id,x,y,r] of circle){const node=map.layoutPositions.get(id);assert.ok(Math.hypot(Number(x)-node.x,Number(y)-node.y)+Number(r)+6<=node.radius+1e-8);}
    const reopened=createMap(null,{geography,dataset,spec:JSON.parse(map.export('json')).spec,width:800,height:600});
    try{assert.equal(reopened.export('csv'),map.export('csv'));assert.equal(legendSvg(reopened.render().legends[0],0,0,'fixed'),legendSvg(result.legends[0],0,0,'fixed'));}finally{reopened.destroy();}
    assert.equal(JSON.stringify(dataset),source);
  }finally{map.destroy();}
});
