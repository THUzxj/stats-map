import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, buildLegend, legendSvg, legendHeight, DatasetView } from '../src/index.js';
import { wrapText, textWidth, intersects, placeLabels } from '../src/components/text-layout.js';
import { sample } from './fixtures/encoding.js';

const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('wrapping preserves unspaced Unicode and paragraphs without exceeding conservative text width',()=>{
  for(const value of ['Long annotation with several ordinary words','虚构地图标签没有空格','ab\n\ncd','ÁB́ĆD́','averylongunspacedidentifier']){
    const lines=wrapText(value,48,12);
    assert.equal(lines.join('').replace(/\s/g,''),value.replace(/\s/g,''));
    assert.ok(lines.every(line=>textWidth(line,12)<=48));
  }
});
test('label placement respects obstacles and viewport, displaces deterministically and prioritizes selected identity',()=>{
  const candidates=['a','b'].map(id=>({id,x:100,y:100,lines:['Synthetic'],fontSize:12,anchor:'middle',priority:id==='b'?1000:0}));
  const options={width:200,height:200,obstacles:[{x:50,y:85,width:100,height:20}],maxOffset:60};
  const placed=placeLabels(candidates,options);
  assert.equal(placed.get('b').visible,true);assert.equal(placed.get('b').displaced,true);
  for(const label of placed.values())if(label.visible)assert.equal(intersects(label.box,options.obstacles[0]),false);
  assert.deepEqual([...placedLabels(candidates,options)], [...placed.values()]);
  const hidden=placeLabels(candidates,{width:200,height:200,mode:'hide'});assert.equal(hidden.get('b').visible,true);assert.equal(hidden.get('a').visible,false);
  assert.throws(()=>placeLabels(candidates,{...options,step:0}),RangeError);
});
function placedLabels(candidates,options){return placeLabels([...candidates].reverse(),options).values();}
test('map labels avoid legend, ranking and inset rectangles and expose collisions without altering selection',()=>{
  const {geography,dataset}=sample();geography.anchors=['a','b'].map(region_id=>({region_id,role:'label',point:[1,1],method:'supplied'}));
  const map=createMap(null,{geography,dataset,width:500,height:300});
  map.setSpec({...map.spec,decorations:{labels:{maxOffset:100}},ranking:{x:50,y:100,width:200},insets:[{id:'detail',x:350,y:100,width:100,height:100}]});
  map.setSelection(['b']);const rendered=map.render();assert.deepEqual(map.getState().selection,['b']);
  const boxes=[...rendered.legendLayout.panels.map(panel=>panel.bounds),{x:50,y:85,width:200,height:82},{x:350,y:96,width:100,height:124}];
  for(const label of rendered.decorations.labels)if(label.visible)for(const box of boxes)assert.equal(intersects(label.box,box),false);
  map.setSpec({...map.spec,legend:{visible:false},ranking:undefined,insets:[],decorations:{labels:{collision:'hide',maxOffset:0}}});
  const labels=map.render().decorations.labels;assert.equal(labels.find(item=>item.id==='b').visible,true);assert.equal(labels.find(item=>item.id==='a').visible,false);
  assert.ok(map.lastRender.diagnostics.some(item=>item.code==='LABEL_COLLISION'&&item.region_id==='a'));
  map.destroy();
});
test('embedded logos are accessible, self-contained, escaped and checked before replacing current spec',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  const image={id:'mark',alt:'Synthetic <organization>',href:logo,position:[20,250],width:40,height:40};
  map.setSpec({...map.spec,decorations:{logos:[image],source:{text:'Source '.repeat(60),maxWidth:300}}});
  const svg=map.export('svg');assert.match(svg,/aria-label="Synthetic &lt;organization&gt;"/);assert.ok(svg.includes(logo));assert.match(svg,/<tspan/);
  const spec=map.spec;
  for(const href of ['https://invalid.example/logo.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,R0lGODlh'])assert.throws(()=>map.setSpec({...map.spec,decorations:{logos:[{...image,href}]}}));
  assert.equal(map.spec,spec);map.destroy();
});
test('common legend rows, notes, title and exception labels wrap with matching measured height',()=>{
  const {geography,dataset}=sample();dataset.series[0].label='Synthetic component with a deliberately long translated name';
  const legend=buildLegend({type:'waffle',encoding:{series_ids:['one','two']}},new DatasetView(dataset,geography),'t',{spec:{locale:'fr'}});
  const narrow=legendSvg(legend,12,20,'wrapped',{width:140,title:'Synthetic multiline legend title',layerId:'base'}),wide=legendSvg(legend,12,20,'wide',{width:400});
  assert.ok(legendHeight(legend,{width:140})>legendHeight(legend,{width:400}));assert.ok((narrow.match(/<tspan/g)??[]).length>4);
  assert.match(narrow,/aria-label="Synthetic component with a deliberately long translated name"/);assert.match(wide,/Synthetic component/);
  const backgroundHeight=Number(narrow.match(/data-legend-background="true"[^>]+height="([^"]+)"/)[1]);
  assert.ok(backgroundHeight>legendHeight(legend,{width:140}));
});
