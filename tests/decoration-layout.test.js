import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, projectPoint } from '../src/index.js';
import { freeRectangle, layoutDecorationBoxes } from '../src/components/decoration-layout.js';
import { intersects } from '../src/components/text-layout.js';
import { sample } from './fixtures/encoding.js';

const logo={id:'mark',alt:'Synthetic mark',href:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9HkAAAAASUVORK5CYII=',position:[12,12],width:44,height:44};
function instance(){const {geography,dataset}=sample();geography.coordinate_space.units='m';return createMap(null,{geography,dataset,width:800,height:650});}
const placed=map=>map.lastRender.decorations.layout.items.filter(item=>item.reserve!==false);
function disjoint(items){for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)assert.equal(intersects(items[i].bounds,items[j].bounds),false,`${items[i].id} / ${items[j].id}`);}

test('free rectangle search matches exhaustive integer placement and never changes dimensions',()=>{
  let seed=3;const random=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
  for(let run=0;run<120;run++){
    const width=30,height=24,padding=2,gap=2,preferred={x:random(30),y:random(24),width:3+random(9),height:3+random(9)};
    const obstacles=Array.from({length:6},()=>({x:random(30),y:random(24),width:3+random(9),height:3+random(9)}));
    const result=freeRectangle(preferred,{width,height,obstacles,padding,gap});
    const candidates=[];
    for(let x=padding;x<=width-padding-preferred.width;x++)for(let y=padding;y<=height-padding-preferred.height;y++){
      const box={...preferred,x,y};if(!obstacles.some(other=>intersects(box,other,gap)))candidates.push(box);
    }
    assert.equal(Boolean(result),candidates.length>0);
    if(result){assert.equal(result.width,preferred.width);assert.equal(result.height,preferred.height);assert.ok(!obstacles.some(other=>intersects(result,other,gap)));}
  }
});

test('headers, footers, logos, scales and annotations share deterministic placement with fixed panels',()=>{
  const map=instance();
  try{
    const title='Complete long synthetic title with translated labels 虚构标题',subtitle='A full subtitle with additional context';
    map.setSpec({...map.spec,title,subtitle,layers:map.spec.layers.map(layer=>({...layer,legend:{x:20,y:150,width:160}})),ranking:{x:540,y:40,width:230},insets:[{id:'detail',x:540,y:300,width:240,height:180}],decorations:{logos:[logo],source:'Complete synthetic source document with a long citation and provenance',unit:true,scalebar:{distance:1},labels:true,annotations:[{id:'note',region_id:'a',text:'Complete anchored annotation',marker:true}]}});
    assert.deepEqual(map.lastRender.decorations.layout.diagnostics,[]);disjoint(placed(map));
    const {layout}=map.lastRender.decorations;
    for(const item of placed(map)){
      for(const panel of map.lastRender.legendLayout.panels)assert.equal(intersects(item.bounds,panel.bounds),false,item.id);
      assert.ok(item.bounds.x>=0&&item.bounds.y>=0&&item.bounds.x+item.bounds.width<=800&&item.bounds.y+item.bounds.height<=650,item.id);
    }
    const annotation=layout.items.find(item=>item.id==='annotations:note');
    const anchor=projectPoint(map.lastRender.decorations.anchors.find(item=>item.region_id==='a').point,map.projection);assert.deepEqual(annotation.point,anchor);
    assert.ok(annotation.displaced);assert.match(map.export('svg'),/data-decoration-leader="annotations:note"/);
    assert.match(map.export('svg'),/Complete anchored annotation/);assert.match(map.export('svg'),/虚构标题/);
    const before=JSON.stringify(layout),spec=JSON.stringify(map.spec);map.render();assert.equal(JSON.stringify(map.lastRender.decorations.layout),before);assert.equal(JSON.stringify(map.spec),spec);
    const reopened=createMap(null,{geography:map.geography,dataset:[...map.datasets.values()][0],spec:map.exportSpec({resolved:true}),...map.viewport});try{reopened.render();assert.deepEqual(placed(reopened),placed(map));}finally{reopened.destroy();}
  }finally{map.destroy();}
});

test('fixed conflicts and impossible viewports report geometry without shrinking or dropping content',()=>{
  const map=instance();
  try{
    map.setSpec({...map.spec,legend:{visible:false},decorations:{title:{text:'Fixed title',position:[12,26]},subtitle:{text:'Fixed subtitle',position:[12,26]},logos:[logo],annotations:[{id:'large',text:'Unabridged enormous annotation',position:[-10,10],fontSize:80,collision:'avoid',maxWidth:500}]}});
    const title=placed(map).find(item=>item.id==='title');assert.equal(title.x+title.dx,12);assert.equal(title.y+title.dy,26);
    const subtitle=placed(map).find(item=>item.id==='subtitle');assert.equal(subtitle.dx,0);assert.equal(subtitle.dy,0);
    assert.ok(map.lastRender.diagnostics.some(item=>item.code==='DECORATION_COLLISION'));
    map.setViewport({width:100,height:80});
    assert.ok(map.lastRender.diagnostics.some(item=>item.code==='DECORATION_OVERFLOW'));
    const large=placed(map).find(item=>item.id==='annotations:large');assert.equal(large.style.fontSize,80);assert.equal(large.value,'Unabridged enormous annotation');assert.match(map.export('svg'),/Unabridged enormous annotation/);
    map.setSpec({...map.spec,decorations:{...map.spec.decorations,layout:{collision:'none'}}});
    assert.ok(placed(map).every(item=>!item.displaced));assert.deepEqual(map.lastRender.decorations.diagnostics,[]);
  }finally{map.destroy();}
});

test('moving a physical scalebar retains its distance and length while zoom changes the physical scale',()=>{
  const map=instance();
  try{
    map.setSpec({...map.spec,legend:{visible:false},decorations:{scalebar:{distance:1}}});
    const before=placed(map).find(item=>item.id==='scalebar');
    map.setSpec({...map.spec,decorations:{...map.spec.decorations,source:{text:'Synthetic source',position:[before.x,before.y]},scalebar:{distance:1,position:[before.x,before.y],collision:'avoid'}}});
    const moved=placed(map).find(item=>item.id==='scalebar');assert.ok(moved.displaced);assert.equal(moved.length,before.length);assert.equal(moved.distance,1);assert.equal(moved.distancePerPixel,before.distancePerPixel);
    map.setViewTransform({zoom:2,pan:[0,0]});assert.equal(placed(map).find(item=>item.id==='scalebar').length,2*before.length);
  }finally{map.destroy();}
});

test('inset decoration placement survives transforms, reopen and data changes and screen points work in grids',()=>{
  const map=instance();
  try{
    map.setSpec({...map.spec,decorations:{annotations:[{id:'point',text:'Geographic annotation',point:[2,1]}]},insets:[{id:'detail',x:460,y:240,width:300,height:300,decorations:{title:'Inset title',subtitle:'Inset subtitle',logos:[logo],scalebar:{distance:.5},annotations:[{id:'note',text:'Inset anchored annotation',region_id:'a',marker:true}]}}]});
    disjoint(map.lastRender.insets[0].decorations.layout.items);assert.deepEqual(map.lastRender.insets[0].decorations.diagnostics,[]);
    map.setInsetTransform('detail',{zoom:1.3,pan:[0,0]});disjoint(map.lastRender.insets[0].decorations.layout.items);
    map.toggleInset('detail',false);map.toggleInset('detail',true);disjoint(map.lastRender.insets[0].decorations.layout.items);
    map.setData(structuredClone([...map.datasets.values()][0]));disjoint(map.lastRender.insets[0].decorations.layout.items);
    map.setLayout({type:'grid-square'});assert.ok(map.lastRender.diagnostics.some(item=>item.code==='DECORATION_POINT_UNAVAILABLE'));
    map.setSpec({...map.spec,decorations:{annotations:[{id:'point',text:'Screen annotation',point:[2,1],position:[100,180]}]}});
    assert.equal(placed(map).find(item=>item.id==='annotations:point').x,100);assert.ok(!map.lastRender.decorations.diagnostics.some(item=>item.code==='DECORATION_POINT_UNAVAILABLE'));
  }finally{map.destroy();}
});

test('decoration options are validated transactionally, including nested insets and duplicate ids',()=>{
  const map=instance();
  try{
    for(const decorations of [{layout:{width:1}},{layout:{gap:-1}},{layout:{padding:Infinity}},{layout:{collision:'hide'}},{title:{text:4}},{title:{anchor:'left'}},{title:{opacity:2}},{scalebar:{priority:NaN}},{logos:[{...logo,collision:'hide'}]},...['fontSize','maxWidth','priority'].map(key=>({annotations:[{text:'Invalid',position:[2,3],[key]:NaN}]})),{annotations:[{text:'Invalid',position:[2,3],marker:2}]},{annotations:[{id:'x',text:'One',position:[2,3]},{id:'x',text:'Two',position:[3,4]}]},{places:[{id:'1',text:'One',position:[2,3]},{text:'Two',position:[3,4]}]}]){
      const before=map.spec;assert.throws(()=>map.setSpec({...before,decorations}));assert.equal(map.spec,before);
    }
    assert.throws(()=>map.setSpec({...map.spec,insets:[{id:'bad',x:10,y:10,width:100,height:100,decorations:{layout:{obstacles:[]}}}]}));
  }finally{map.destroy();}
});

test('fixed items are reserved before higher priority automatic items and watermarks do not reserve space',()=>{
  const result=layoutDecorationBoxes([{id:'auto',order:0,priority:100,collision:'avoid',bounds:{x:6,y:6,width:80,height:30}},{id:'fixed',order:1,priority:0,collision:'fixed',bounds:{x:6,y:6,width:80,height:30}},{id:'watermark',order:2,reserve:false,collision:'avoid',bounds:{x:0,y:0,width:200,height:200}}],{width:200,height:200});
  assert.deepEqual(result.diagnostics,[]);assert.equal(result.items[1].displaced,false);assert.equal(intersects(result.items[0].bounds,result.items[1].bounds),false);assert.equal(result.obstacles.length,2);
});

test('RTL inset toggle text retains the same screen anchor as its button rectangle',()=>{
  const map=instance();
  try{
    map.setSpec({...map.spec,locale:'ar',insets:[{id:'detail',x:420,y:300,width:220,height:180}]});
    assert.match(map.export('svg'),/data-inset-toggle="detail" direction="ltr"/);
    assert.match(map.export('svg'),/x="426" y="312"/);
  }finally{map.destroy();}
});

