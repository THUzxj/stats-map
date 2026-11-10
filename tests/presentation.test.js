import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, projectPoint, resolveProfile, validateMapSpec, buildRanking, chinaBundle, euroBundle } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

const instance=()=>{const {geography,dataset}=sample();return createMap(null,{geography,dataset,width:800,height:500});};
test('presentation profiles merge defaults under explicit fields without changing statistical semantics',()=>{
  const map=instance(),spec={...map.spec,profile:{title:'Profile title',layout:{type:'geographic',padding:42},decorations:{labels:true,source:'Profile source'}},title:'Explicit title',decorations:{labels:false}};
  const resolved=resolveProfile(spec);assert.equal(resolved.title,'Explicit title');assert.equal(resolved.layout.padding,42);assert.equal(resolved.decorations.labels,false);assert.equal(resolved.decorations.source,'Profile source');
  map.setSpec(spec);assert.equal(map.spec.decorations.source,'Profile source');assert.match(map.export('svg'),/Explicit title/);assert.doesNotMatch(map.export('svg'),/data-map-label/);
  const exported=map.exportSpec({resolved:true});assert.equal(exported.profile.title,'Profile title');assert.equal(exported.decorations.source,'Profile source');
  assert.throws(()=>map.setSpec({...spec,profile:{aggregation:{display_value:'rollup'}}}),/profile cannot/);map.destroy();
});
test('labels, references, annotations and selected outlines follow common drawing order and escape text',()=>{
  const map=instance(),geography=structuredClone(map.geography);
  geography.anchors=[{region_id:'a',role:'label',point:[1.5,1.5],method:'supplied'}];
  geography.features.features.push({type:'Feature',id:'reference',properties:{role:'reference'},geometry:{type:'GeometryCollection',geometries:[{type:'LineString',coordinates:[[0,0],[5,2]]},{type:'Point',coordinates:[2.5,1]}]}});
  map.setData([...map.datasets.values()][0],geography);
  map.setSpec({...map.spec,title:'Title & context',subtitle:'Subtitle',decorations:{labels:true,source:'Synthetic source',unit:true,watermark:'Synthetic',annotations:[{region_id:'a',text:'A < B',offset:[10,-10],leader:true}],places:[{point:[2,1],text:'Place'}]}});
  map.setSelection(['a','a']);const svg=map.render().svg;
  assert.match(svg,/A &lt; B/);assert.match(svg,/Title &amp; context/);assert.match(svg,/data-feature-role="reference"/);assert.match(svg,/data-map-watermark/);assert.match(svg,/data-map-source/);
  const point=projectPoint([1.5,1.5],map.projection);assert.match(svg,new RegExp(`data-map-label="a" aria-label="A" x="${point[0]}" y="${point[1]}"`));
  assert.ok(svg.indexOf('data-layer-id')<svg.indexOf('data-map-label'));assert.ok(svg.indexOf('data-map-label')<svg.indexOf('data-map-selection'));assert.equal((svg.match(/data-selection-region-id="a"/g)??[]).length,1);assert.deepEqual(map.getState().selection,['a']);map.destroy();
});
test('uniform geographic backgrounds follow map layout and remain absent from plain choropleths',()=>{
  const map=instance(),dataset=[...map.datasets.values()][0],layer={id:'symbols',type:'proportionalSymbol',role:'overlay',encoding:{dataset_id:dataset.id,size:{series_id:'one'}},options:{fill:'#287ca3'}};
  try{
    assert.doesNotMatch(map.render().svg,/data-geographic-background/);
    const decorations={geographicBackground:{fill:'#eef2f5',stroke:'#a7b0b8',strokeWidth:.6}};
    for(const [layout,tag] of [['geographic','path'],['grid-square','rect'],['grid-hex','polygon'],['dorling','path']]){
      map.setSpec({...map.spec,layout:{type:layout},layers:[layer],decorations});
      const svg=map.render().svg,backgrounds=[...svg.matchAll(/data-region-background="([^"]+)"/g)].map(match=>match[1]);
      assert.equal(backgrounds.length,map.geography.regions.length,layout);
      assert.equal(new Set(backgrounds).size,backgrounds.length,layout);
      assert.match(svg,new RegExp(`<${tag} data-region-background=`),layout);
      assert.ok(svg.indexOf('data-geographic-background')<svg.indexOf('data-layer-id="symbols"'),layout);
      assert.match(svg,/data-region-background="[^"]+"[^>]+fill="#eef2f5"/);
      if(layout==='dorling'){
        assert.equal((svg.match(/<path data-region-background=/g)??[]).length,map.geography.regions.length,'Dorling keeps geographic paths behind symbols');
        assert.match(svg,/data-symbol-region-id="[^"]+"/,'Dorling proportional symbols are rendered');
      }
    }
    map.setSpec({...map.spec,decorations,insets:[{id:'detail',x:500,y:280,width:240,height:180,layout:{type:'dorling',radius:8}}]});
    assert.equal((map.render().svg.match(/data-region-background=/g)??[]).length,map.geography.regions.length*2,'the inset inherits the same background');
    map.setSpec({...map.spec,layers:[{id:'theme',type:'choropleth',role:'base',encoding:{dataset_id:dataset.id,series_id:'one'}}],decorations:{}});
    assert.doesNotMatch(map.render().svg,/data-geographic-background/);
  }finally{map.destroy();}
});
test('physical scalebars and geographic graticules expose applicability and track zoom',()=>{
  const map=instance();map.setSpec({...map.spec,decorations:{scalebar:{distance:1000},graticule:true}});
  assert.equal(map.render().diagnostics[0].code,'SCALEBAR_UNAVAILABLE');assert.doesNotMatch(map.export('svg'),/data-map-scalebar|data-map-graticule/);
  const geo=structuredClone(map.geography);geo.coordinate_space.units='m';map.setData([...map.datasets.values()][0],geo);
  assert.match(map.export('svg'),/data-map-scalebar/);assert.match(map.export('svg'),/>1 km</);
  map.setLayout({type:'grid-square'});assert.doesNotMatch(map.export('svg'),/data-map-scalebar/);
  geo.coordinate_space={type:'geographic',units:'degree'};map.setData([...map.datasets.values()][0],geo);map.setLayout({type:'geographic',projection:{id:'mercator'}});map.setSpec({...map.spec,decorations:{graticule:{step:[1,1]},scalebar:true}});
  assert.match(map.export('svg'),/data-map-graticule/);assert.match(map.export('svg'),/Approximate scale at/);
  const before=map.export('svg');map.setViewTransform({zoom:2,pan:[0,0]});assert.notEqual(map.export('svg'),before);
  assert.throws(()=>map.setSpec({...map.spec,decorations:{graticule:{step:[0,1]}}}),/graticule step/);map.destroy();
});
test('insets have independent projection, clipping, hit testing and shared deduplicated selection',()=>{
  const map=instance();map.setSpec({...map.spec,view:{...map.spec.view,region_ids:['a']},insets:[{id:'detail',title:'Detail',x:550,y:270,width:220,height:160,region_ids:['b'],decorations:{labels:true}}]});
  const detail=map.render().insets[0],point=projectPoint([4.5,1.5],detail.projection);
  assert.equal(map.hitTest([point[0]+550,point[1]+290]).regionId,'b');assert.equal(map.hitTest([point[0]+550,point[1]+290]).insetId,'detail');
  const hidden=projectPoint([4.5,1.5],map.projection);assert.equal(map.hitTest(hidden),null);
  const main=structuredClone(map.projection);map.setInsetTransform('detail',{zoom:2,pan:[.1,-.1]});assert.deepEqual(map.projection,main);assert.equal(map.render().insets[0].projection.scale/detail.projection.scale,2);
  map.setSelection(['b','b']);assert.deepEqual(map.getState().selection,['b']);assert.match(map.export('svg'),/data-selection-region-id="b"/);
  map.toggleInset('detail');assert.equal(map.render().insets.length,0);assert.match(map.export('svg'),/aria-expanded="false"/);map.toggleInset('detail');
  assert.equal(map.render().insets.length,1);const before=map.spec;assert.throws(()=>map.setSpec({...map.spec,insets:[{...before.insets[0],layout:{type:'geographic',projection:{id:'cartesian',center:[NaN,0]}}}]}),error=>error.code==='INVALID_ARGUMENT');assert.equal(map.spec,before);map.destroy();
});
test('inset patterns do not collide with main view or other instances and minimap recenters the main view',()=>{
  const map=instance();map.setLayers([{id:'stripe',role:'base',type:'stripeComposition',encoding:{dataset_id:'amounts',series_ids:['one','two']}}]);
  map.setSpec({...map.spec,insets:[{id:'overview',x:550,y:270,width:220,height:160,minimap:true}]});
  const result=map.render(),ids=[...result.svg.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);assert.equal(ids.length,new Set(ids).size);
  assert.match(result.svg,/data-minimap-viewport/);const view=result.insets[0],point=projectPoint([4,1],view.projection);
  map.recenterFromMinimap('overview',[point[0]+550,point[1]+290]);const center=projectPoint([4,1],map.projection);assert.ok(Math.abs(center[0]-400)<1e-8);assert.ok(Math.abs(center[1]-250)<1e-8);
  map.setLayout({type:'grid-square'});assert.doesNotMatch(map.render().svg,/data-minimap-viewport/);map.destroy();
});
test('presentation validation rejects unknown regions and invalid inset or decoration coordinates',()=>{
  const map=instance();
  for(const patch of [{view:{region_ids:['unknown']}},{insets:[{id:'bad',x:0,y:0,width:-1,height:20}]},{decorations:{annotations:[{text:'bad',position:[0,Infinity]}]}},{decorations:{geographicBackground:{strokeWidth:-1}}},{ranking:{width:0}}])assert.throws(()=>validateMapSpec({...map.spec,...patch},map.geography,map.datasets));
  map.destroy();
});
test('rankings sort original values, retain ties, negatives, zero and missing status without aggregating',()=>{
  const {geography,dataset}=sample();dataset.observations.find(value=>value.region_id==='a'&&value.series_id==='one').value=-5;dataset.observations.find(value=>value.region_id==='b'&&value.series_id==='one').value=0;
  const map=createMap(null,{geography,dataset});let ranking=buildRanking(map);assert.deepEqual(ranking.rows.map(row=>row.value),[0,-5]);assert.deepEqual(ranking.rows.map(row=>row.rank),[1,2]);assert.equal(ranking.unit.label,'items');assert.equal(buildRanking(map,{direction:'ascending'}).rows[0].value,-5);
  const next=structuredClone(dataset);next.observations.find(value=>value.region_id==='a'&&value.series_id==='one').value=0;map.setData(next);assert.deepEqual(buildRanking(map).rows.map(row=>row.rank),[1,1]);
  next.observations.find(value=>value.region_id==='a'&&value.series_id==='one').status='suppressed';next.observations.find(value=>value.region_id==='a'&&value.series_id==='one').value=null;map.setData(next);ranking=buildRanking(map);assert.equal(ranking.missing[0].status,'suppressed');assert.deepEqual(ranking.rows.map(row=>row.region_id),['b']);
  map.setSpec({...map.spec,ranking:{width:220,limit:1}});map.setSelection(['b']);assert.match(map.export('svg'),/data-ranking-row="true"[^>]+aria-pressed="true"/);assert.match(map.export('svg'),/Missing: 1/);
  map.hover('b');assert.match(map.export('svg'),/data-map-hover/);assert.deepEqual(map.getState().selection,['b']);map.destroy();
});
test('category rankings explain inapplicability and invalid ranking updates are transactional',()=>{
  const {geography,dataset}=sample();dataset.dimensions=[{id:'classes',values:[{id:'x',label:'X'}]}];dataset.metrics[0]={...dataset.metrics[0],value_type:'category',aggregation:'none',category_dimension_id:'classes'};dataset.observations.forEach(value=>value.value='x');
  const map=createMap(null,{geography,dataset});map.setRenderer('categorical',{dataset_id:dataset.id,series_id:'one'});map.setSpec({...map.spec,ranking:{}});assert.equal(map.render().ranking.available,false);assert.match(map.export('svg'),/Categories have no numeric ranking/);
  const spec=map.spec;assert.throws(()=>map.setSpec({...spec,ranking:{seriesId:'unknown'}}));assert.equal(map.spec,spec);map.destroy();
});

test('both source adapters use the same inset, decoration, ranking and shared selection implementation',()=>{
  const {geography}=sample(),features=geography.features;
  const euro=euroBundle({geography:features,dataset:{records:[{region_id:'a',period_id:'t',value:10},{region_id:'b',period_id:'t',value:40}]}},{coordinateSpace:geography.coordinate_space});
  const china=chinaBundle({schema_version:1,id:'synthetic-adapter',title:'Synthetic adapter',scope_note:'Synthetic',periods:['t'],regions:[{code:'a',name:'A',level:'area'},{code:'b',name:'B',level:'area'}],features,metrics:[{id:'one',name:'Amount',unit:'items',aggregation:'sum'}],records:[{region_code:'a',period:'t',values:{one:10}},{region_code:'b',period:'t',values:{one:40}}]});
  for(const bundle of [euro,china]){
    const map=createMap(bundle);map.setSpec({...map.spec,decorations:{labels:true},ranking:{},insets:[{id:'detail',x:500,y:300,width:200,height:160,region_ids:['b']}]});map.setSelection(['b','b']);
    assert.deepEqual(map.getState().selection,['b']);assert.equal(map.render().ranking.rows[0].value,40);assert.equal(map.render().insets.length,1);assert.equal((map.export('svg').match(/data-selection-region-id="b"/g)??[]).length,2);map.destroy();
  }
});
