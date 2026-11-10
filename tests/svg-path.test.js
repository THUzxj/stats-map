import test from 'node:test';
import assert from 'node:assert/strict';
import { svgPathBounds, compileSvgPath, createMap, buildLegend, createPresentation, DatasetView } from '../src/index.js';
import { symbolCollisionRadius, symbolScale } from '../src/renderers/symbols.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { sample } from './fixtures/encoding.js';
import { customPathFixtures } from './fixtures/svg-path.js';

const near=(actual,expected,tolerance=1e-7)=>{for(const key of Object.keys(expected))assert.ok(Math.abs(actual[key]-expected[key])<=tolerance*Math.max(1,Math.abs(expected[key])),`${key}: ${actual[key]} != ${expected[key]}`);};
const arcNear=(actual,expected)=>{near(actual,expected,3.1e-4);for(const key of ['minX','minY'])assert.ok(actual[key]<=expected[key]+1e-7);for(const key of ['maxX','maxY'])assert.ok(actual[key]>=expected[key]-1e-7);};

test('SVG bounds find analytic quadratic, cubic and reflected smooth extrema without using the control hull',()=>{
  near(svgPathBounds('M0 0 Q10 20 20 0 T40 0 Z',{closed:true}),{minX:0,minY:-10,maxX:40,maxY:10});
  near(svgPathBounds('M0 0 C0 30 30 30 30 0 S60 -30 60 0 Z'),{minX:0,minY:-22.5,maxX:60,maxY:22.5});
  near(svgPathBounds('M0 0 q10 20 20 0 t20 0 z'),{minX:0,minY:-10,maxX:40,maxY:10});
  near(svgPathBounds('M0 0 c0 30 30 30 30 0 s30 -30 30 0 z'),{minX:0,minY:-22.5,maxX:60,maxY:22.5});
  near(svgPathBounds('M0 0Q10 20 20 0L30 0T50 0Z'),{minX:0,minY:0,maxX:50,maxY:10});
  near(svgPathBounds('M0 0C0 30 30 30 30 0L40 0S50 0 60 0Z'),{minX:0,minY:0,maxX:60,maxY:22.5});
  near(svgPathBounds('M0 0 C10 10 20 20 30 30Z'),{minX:0,minY:0,maxX:30,maxY:30});
});

test('SVG arcs include rotation, corrected radii, sweep/large flags and degenerate straight segments',()=>{
  arcNear(svgPathBounds('M10 0A10 10 0 1 1 0-10Z'),{minX:-10,minY:-10,maxX:10,maxY:10});
  arcNear(svgPathBounds('M10 0A10 10 0 110-10Z'),{minX:-10,minY:-10,maxX:10,maxY:10});
  near(svgPathBounds('M10 0a10 10 0 0 1-10 10z'),{minX:0,minY:0,maxX:10,maxY:10});
  near(svgPathBounds('M10 0A1 1 0 0 1-10 0Z'),{minX:-10,minY:0,maxX:10,maxY:10});
  near(svgPathBounds('M10 0A0 10 0 0 1-10 0Z'),{minX:-10,minY:0,maxX:10,maxY:0});
  near(svgPathBounds('M10 0A10 10 0 0 1 10 0Z'),{minX:10,minY:0,maxX:10,maxY:0});
  arcNear(svgPathBounds('M8.660254037844386 5A10 4 30 0 1-8.660254037844386-5A10 4 30 0 1 8.660254037844386 5Z'),{minX:-Math.sqrt(79),minY:-Math.sqrt(37),maxX:Math.sqrt(79),maxY:Math.sqrt(37)});
});

test('SVG parsing follows relative and repeated commands, subpath closure, compact numeric and arc syntax',()=>{
  near(svgPathBounds('m1e1,1e1 10,0h10v10l-20,0z m40 0h5v5h-5z',{closed:true}),{minX:10,minY:10,maxX:55,maxY:20});
  near(svgPathBounds('M.5.6L1.5-.4 2.5.6z'),{minX:.5,minY:-.4,maxX:2.5,maxY:.6});
  near(svgPathBounds('M0 0zL10 10z',{closed:true}),{minX:0,minY:0,maxX:10,maxY:10});
  near(svgPathBounds('M0 0L10 10 M20 20L30 30'),{minX:0,minY:0,maxX:30,maxY:30});
  const cached=svgPathBounds('M0 0H10V10Z');cached.maxX=999;
  assert.equal(svgPathBounds('M0 0H10V10Z').maxX,10);
  const compiled=compileSvgPath('M10 0A10 10 0 1 1 0-10Z',{closed:true});
  assert.ok(!/[Aa]/.test(compiled.path));assert.match(compiled.path,/C/);
  near(svgPathBounds(compiled.path,{closed:true}),compiled.bounds);
  compiled.bounds.maxX=999;assert.notEqual(compileSvgPath('M10 0A10 10 0 1 1 0-10Z',{closed:true}).bounds.maxX,999);
});

test('invalid path grammar, open custom subpaths, markup, flags and nonfinite geometry fail explicitly',()=>{
  const bad=['','L0 0Z','M0 0LZ','M,0 0Z','M0 0L1 1,,2 2Z','M0 0L1 1,Z','M0 0Z2 2','M0 0R1 2Z','M0 0A1 1 0 2 0 1 1Z','M0 0A1 1 0 0.5 0 1 1Z','M0 0L1e309 0Z','M0 0l1e308 0 1e308 0Z','<path d="M0 0Z" onload="bad()"/>','M0 0L1 1','M0 0L1 1M2 2Z','M0 0'+'L1 1'.repeat(2500)+'Z'];
  for(const path of bad)assert.throws(()=>svgPathBounds(path,{closed:true}),error=>error.code==='INVALID_ENCODING',path);
});

test('path extrema remain finite at small and large magnitudes and preserve negative coordinates',()=>{
  for(const magnitude of [1e-150,1,1e150]){
    const path=`M0 0Q${magnitude} ${2*magnitude} ${2*magnitude} 0T${4*magnitude} 0Z`,bounds=svgPathBounds(path);
    near({minX:bounds.minX/magnitude,minY:bounds.minY/magnitude,maxX:bounds.maxX/magnitude,maxY:bounds.maxY/magnitude},{minX:0,minY:-1,maxX:4,maxY:1});
    const arc=svgPathBounds(`M${magnitude} 0A${magnitude} ${magnitude} 0 1 1 0 ${-magnitude}Z`);
    arcNear({minX:arc.minX/magnitude,minY:arc.minY/magnitude,maxX:arc.maxX/magnitude,maxY:arc.maxY/magnitude},{minX:-1,minY:-1,maxX:1,maxY:1});
  }
});

test('custom symbols outside viewBox reserve actual transformed extents in Dorling and size legends',()=>{
  for(const fixture of customPathFixtures()){
    const options={shape:'custom',maxRadius:12,customShape:{viewBox:fixture.viewBox,path:fixture.path}},scale=symbolScale([1,4],options),radius=symbolCollisionRadius('custom',scale.radius(4),options);
    const bounds=svgPathBounds(fixture.path,{closed:true}),[x,y,w,h]=fixture.viewBox,s=24/Math.max(w,h);
    for(const px of [bounds.minX,bounds.maxX])for(const py of [bounds.minY,bounds.maxY])assert.ok(Math.hypot((px-x-w/2)*s,(py-y-h/2)*s)<=radius+1e-8,fixture.id);
    const {geography,dataset}=sample(),view=new DatasetView(dataset,geography),layer={id:'custom',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'},options};
    const legend=buildLegend(layer,view,'t'),plan=specializedLegendLayout(legend,100,createPresentation({},geography));
    assert.ok(plan.width>=100);
    for(const box of plan.boxes)assert.ok(box.x>=-1e-8&&box.y>=-1e-8&&box.x+box.width<=plan.width+1e-8&&box.y+box.height<=plan.height+1e-8,fixture.id);
    const map=createMap(null,{geography,dataset});
    try{
      map.setSpec({...map.spec,layers:[layer],layout:{type:'dorling',worker:false,iterations:300}});
      assert.ok(map.capabilities()[0].supported);assert.equal(map.lastRender.layout.collision_pairs,0);
      assert.match(map.export('svg'),/vector-effect="non-scaling-stroke"/);
      const before=map.spec;assert.throws(()=>map.setLayers([{...layer,options:{...options,customShape:{...options.customShape,path:'M0 0LZ'}}}]));assert.equal(map.spec,before);
    }finally{map.destroy();}
  }
});
