import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnchors, anchorIndex, screenAnchors, geometryStatus, createMap, validateGeography, validateMapSpec, fitProjection, hitTest, chinaGeography, euroGeography, buildRegionList } from '../src/index.js';
import { pointInPolygon } from '../src/core/anchors.js';
import { sample } from './fixtures/encoding.js';

const policy={method:'interior-point',version:1};
const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
test('polygon anchors require explicit policy and never use the first feature vertex mean',()=>{
  const {geography}=sample();delete geography.anchor_policy;
  assert.equal(anchorIndex(geography).size,0);assert.equal(resolveAnchors(geography).diagnostics[0].reason,'policy-disabled');
  const result=resolveAnchors(geography,{policy});assert.equal(result.anchors.size,2);
  for(const [id,anchor] of result.anchors){
    assert.ok(pointInPolygon(anchor.point,geography.features.features.find(f=>f.properties.region_id===id).geometry.coordinates));
    assert.equal(anchor.method,'interior-point');assert.equal(anchor.version,1);assert.equal(anchor.derived,true);assert.deepEqual(anchor.geography_ref,{id:geography.id,revision:geography.revision});
  }
  assert.equal(anchorIndex(geography,{derive:false}).size,0);assert.throws(()=>anchorIndex(geography,{derive:true}),error=>error.code==='INVALID_ANCHOR_POLICY');
});
test('interior points remain in concave main faces and outside holes across winding and translations',()=>{
  const shapes=[
    [rectangle(0,0,10,10),rectangle(2,2,6,6)],
    [[[0,0],[9,0],[9,1],[1,1],[1,9],[0,9],[0,0]]],
    [rectangle(0,0,1e-5,10)],
  ];
  for(const polygon of shapes)for(const offset of [0,1e8])for(const reverse of [false,true]){
    const coordinates=polygon.map(ring=>(reverse?[...ring].reverse():ring).map(([x,y])=>[x+offset,y-offset]));
    const {geography}=sample();geography.features.features[0].geometry={type:'Polygon',coordinates};
    const point=anchorIndex(geography).get('a');assert.ok(point,JSON.stringify(coordinates));assert.equal(pointInPolygon(point,coordinates),true);
  }
});
test('main face selection spans all features and collections and subtracts holes from candidate area',()=>{
  const {geography}=sample();
  geography.features.features[0].geometry={type:'GeometryCollection',geometries:[{type:'MultiPolygon',coordinates:[[rectangle(0,0,2,2)],[rectangle(10,0,10,10),rectangle(10.1,.1,9.8,9.8)]]}]};
  geography.features.features.push({type:'Feature',id:'main-a',properties:{role:'region',region_id:'a'},geometry:{type:'Polygon',coordinates:[rectangle(30,0,4,4)]}});
  const anchor=resolveAnchors(geography).anchors.get('a');assert.deepEqual(anchor.point,[32,2]);assert.deepEqual(anchor.source_feature_ids,['main-a']);assert.equal(anchor.source_polygon_index,0);
  const reordered=structuredClone(geography);reordered.features.features.reverse();assert.deepEqual(resolveAnchors(reordered).anchors.get('a'),anchor);
});
test('declared anchors win, label roles fall back to explicit symbol roles and returned records do not mutate resources',()=>{
  const {geography}=sample();geography.anchors=[{region_id:'a',role:'symbol',point:[100,101],method:'registered-centroid',version:4},{region_id:'a',role:'label',point:[90,91],method:'registered-label'}];
  assert.deepEqual(anchorIndex(geography).get('a'),[100,101]);assert.deepEqual(anchorIndex(geography,{role:'label'}).get('a'),[90,91]);
  geography.anchors.pop();const record=resolveAnchors(geography,{role:'label'}).anchors.get('a');assert.equal(record.source_role,'symbol');assert.equal(record.derived,false);assert.equal(record.version,4);record.point[0]=-9;assert.equal(geography.anchors[0].point[0],100);
  geography.anchors.push({...geography.anchors[0]});assert.throws(()=>validateGeography(geography),/duplicate anchor/);
});
test('China adapter uses feature center metadata for all symbol anchors before interior-point fallback',()=>{
  const shape=(x)=>({type:'Polygon',coordinates:[rectangle(x,0,2,2)]});
  const input={id:'china-center',title:'China center fixture',anchor_policy:policy,
    regions:[{code:'a',name:'A',level:'area'},{code:'b',name:'B',level:'area'},{code:'c',name:'C',level:'area'}],
    features:{type:'FeatureCollection',features:[
      {type:'Feature',id:'a-feature',properties:{region_id:'a',role:'region',center:[101.25,31.5]},geometry:shape(0)},
      {type:'Feature',id:'b-feature',properties:{region_id:'b',role:'region'},geometry:shape(4)},
      {type:'Feature',id:'c-feature',properties:{region_id:'c',role:'region',center:[201,41]},geometry:shape(8)},
    ]},
    anchors:[{region_id:'c',role:'symbol',point:[202,42],method:'registered',version:2}],
  };
  const geography=chinaGeography(input),resolved=resolveAnchors(geography);
  assert.deepEqual(resolved.anchors.get('a').point,[101.25,31.5]);assert.equal(resolved.anchors.get('a').method,'center');assert.equal(resolved.anchors.get('a').derived,false);
  assert.equal(resolved.anchors.get('b').method,'interior-point');assert.deepEqual(resolved.anchors.get('c').point,[202,42]);assert.equal(resolved.anchors.get('c').method,'registered');
  assert.equal(geography.anchors.filter(anchor=>anchor.role==='symbol').length,2);
});
test('a single declared point is used directly but line and multiple point geometries require supplied anchors',()=>{
  const {geography}=sample();delete geography.anchor_policy;
  geography.features.features[0].geometry={type:'Point',coordinates:[12,34]};
  geography.features.features[1].geometry={type:'MultiPoint',coordinates:[[1,2],[3,4]]};
  assert.deepEqual(resolveAnchors(geography).anchors.get('a').point,[12,34]);assert.equal(resolveAnchors(geography).anchors.get('a').method,'geometry-point');assert.equal(anchorIndex(geography).has('b'),false);
  geography.features.features[1].geometry={type:'LineString',coordinates:[[1,2],[3,4]]};assert.equal(anchorIndex(geography,{policy}).has('b'),false);
});
test('anchor-only nodes fit into the viewport and are hit-testable without becoming polygon boundaries',()=>{
  const {geography,dataset}=sample();geography.features.features=[];geography.anchors=['a','b'].map((region_id,i)=>({region_id,role:'symbol',point:[5000+i*100,7000],method:'supplied'}));
  const projection=fitProjection(geography,{width:400,height:300}),points=screenAnchors(geography,projection);
  assert.deepEqual(points.get('a'),[20,150]);assert.deepEqual(points.get('b'),[380,150]);assert.equal(hitTest(points.get('b'),geography,projection).regionId,'b');
  assert.ok(geometryStatus(geography).regions.every(row=>!row.has_geometry&&!row.has_boundary&&row.has_symbol_anchor));
  const map=createMap(null,{geography,dataset});map.setRenderer('proportionalSymbol',{dataset_id:dataset.id,series_id:'one'});map.setSelection(['b']);assert.match(map.export('svg'),/<circle data-selection-region-id="b"[^>]+r="8"/);map.destroy();
});
test('no geometry, no anchor and absent observations remain separate in rendering, coverage and exports',()=>{
  const {geography,dataset}=sample();delete geography.anchor_policy;geography.features.features.splice(1);dataset.observations=dataset.observations.filter(row=>row.id!=='a-0');
  const original=structuredClone(dataset),map=createMap(null,{geography,dataset});map.setLayers([{id:'symbols',type:'proportionalSymbol',encoding:{dataset_id:dataset.id,series_id:'one'}}]);
  let result=map.render();assert.equal(result.geometry.regions[0].has_geometry,true);assert.equal(result.geometry.regions[0].has_symbol_anchor,false);assert.equal(result.geometry.regions[1].has_geometry,false);assert.equal(result.diagnostics.filter(row=>row.code==='MISSING_ANCHOR').length,2);
  assert.equal(map.summary(dataset.id,['a','b'],'one','t').present,1);assert.match(map.export('csv'),/b,t,one,value,40/);assert.deepEqual(dataset,original);const list=buildRegionList(map);assert.equal(list.rows.length,2);assert.equal(list.rows[1].channels[0].observation.value,40);assert.equal(list.rows[1].geometry.has_geometry,false);assert.equal(list.rows[0].channels[0].observation.status,'missing');
  map.setSpec({...map.spec,anchor_policy:policy,decorations:{labels:true}});result=map.render();assert.equal(result.geometry.symbols.length,1);assert.equal(result.geometry.regions[1].has_symbol_anchor,false);
  const exported=map.exportSpec({resolved:true});assert.deepEqual(exported.anchor_policy,policy);assert.match(map.export('svg'),/source_feature_ids/);assert.match(map.export('svg'),/interior-point/);map.destroy();
});
test('grid surfaces retain every region identity with no geography while Dorling never invents geographic anchors',async()=>{
  const {geography,dataset}=sample();geography.features.features=[];delete geography.anchor_policy;const map=createMap(null,{geography,dataset});
  map.setLayout({type:'grid-square'});assert.equal((map.export('svg').match(/<rect data-region-id=/g)??[]).length,2);assert.equal(map.capabilities()[0].supported,true);
  map.setLayout({type:'dorling',iterations:2});assert.equal(map.layoutPositions.size,0);assert.equal(map.capabilities()[0].supported,false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(map.layoutPositions.size,0);assert.equal(map.getState().selection.length,0);assert.equal(map.render().diagnostics.filter(row=>row.code==='MISSING_ANCHOR').length,2);map.destroy();
});
test('policy validation and adapter parity reject unsupported versions and preserve explicit policy only',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset}),before=map.spec;
  for(const value of [true,{method:'vertex-mean',version:1},{method:'interior-point',version:2},{method:'interior-point'}]){
    assert.throws(()=>map.setSpec({...map.spec,anchor_policy:value}),error=>error.code==='INVALID_ANCHOR_POLICY');assert.equal(map.spec,before);
    assert.throws(()=>validateMapSpec({...map.spec,anchor_policy:value}));
  }
  for(const convert of [input=>chinaGeography({id:'synthetic',title:'Synthetic',regions:[{code:'a',name:'A',level:'area'}],features:input.features,anchor_policy:input.anchor_policy}),input=>euroGeography(input,{coordinateSpace:geography.coordinate_space})]){
    const input={regions:[{id:'a',label:'A',level_id:'area'}],features:{type:'FeatureCollection',features:[geography.features.features[0]]}};
    const plain=convert(input),explicit=convert({...input,anchor_policy:policy});assert.equal(anchorIndex(plain).size,0);assert.deepEqual(explicit.anchor_policy,policy);assert.ok(anchorIndex(explicit).has('a'));
  }
  map.destroy();
});

test('empty geometries are unavailable while categorical rows retain raw identities, evidence and source flags',()=>{
  const {geography,dataset}=sample();geography.features.features[0].geometry={type:'GeometryCollection',geometries:[]};
  assert.equal(geometryStatus(geography).regions[0].has_geometry,false);assert.equal(resolveAnchors(geography).diagnostics[0].reason,'no-geometry');
  dataset.dimensions=[{id:'categories',values:[{id:'x',label:'Synthetic category'}]}];dataset.metrics[0]={...dataset.metrics[0],value_type:'category',aggregation:'none',category_dimension_id:'categories'};
  dataset.observations.forEach(row=>{row.value='x';row.source_flag='provisional';row.evidence={source_id:'source',sha256:'a'.repeat(64)};});dataset.sources=[{id:'source',title:'Synthetic source'}];
  const map=createMap(null,{geography,dataset,locale:'en'});map.setRenderer('categorical',{dataset_id:dataset.id,series_id:'one'});
  const row=buildRegionList(map).rows[0];assert.equal(row.geometry.has_boundary,false);assert.equal(row.channels[0].observation.value,'x');assert.equal(row.channels[0].observation.source_flag,'provisional');assert.equal(row.channels[0].observation.evidence.sha256,'a'.repeat(64));assert.match(row.channels[0].text,/Synthetic category/);assert.match(row.channels[0].text,/Synthetic source/);map.destroy();
});
