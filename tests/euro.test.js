import test from 'node:test';
import assert from 'node:assert/strict';
import { euroGeography, euroDataset, euroBundle, unflattenStat, decodeTopology, DatasetView, createMap, bounds } from '../src/index.js';

const geometry=()=>euroGeography({title:'Synthetic Euro-shaped input',regions:[{id:'A',label:'Alpha',level:'zone'},{id:'B',label:'Beta',level:'zone'}],features:{type:'FeatureCollection',features:[]}});
function stat(){return {id:['unit','geo','time'],size:[2,2,2],dimension:{unit:{category:{index:{count:0,rate:1},label:{count:'Items',rate:'Percent'}}},geo:{category:{index:['A','B']}},time:{category:{index:['t0','t1'],label:{t0:'First period',t1:'Second period'}}}},value:{0:0,3:4,4:12.5,7:20},status:{1:'c',2:':',5:'p',6:'-'},source:'Synthetic provider'};}

test('sparse and dense JSON-stat decode identically while retaining zero, null states and source flags',()=>{
  const sparse=stat(),dense={...sparse,value:[0,null,null,4,12.5,null,null,20]};
  assert.deepEqual(unflattenStat(sparse),unflattenStat(dense));
  const decoded=unflattenStat(sparse);assert.equal(decoded[0].value,0);assert.equal(decoded[1].status,'suppressed');assert.equal(decoded[2].status,'not_available');assert.equal(decoded[6].status,'not_applicable');
  assert.equal(decoded[5].flag,'p');assert.equal(decoded[5].status,'missing');
  const uniform=unflattenStat({...sparse,status:'p'});assert.ok(uniform.every(record=>record.flag==='p'));
});

test('Euro series preserve individual units and conservative aggregation and structured sources',()=>{
  const geography=geometry(),input=stat(),dataset=euroDataset(input,geography),view=new DatasetView(dataset,geography);
  assert.deepEqual(dataset.periods.map(period=>period.label),['First period','Second period']);
  assert.deepEqual(dataset.series.map(series=>series.unit_id),['count','rate']);
  assert.deepEqual(dataset.units.map(unit=>unit.label),['Items','Percent']);
  assert.ok(dataset.metrics.every(metric=>metric.aggregation==='none'));
  assert.equal(view.summary(['A','B'],dataset.series[1].id,'t1').value,null);
  assert.equal(dataset.sources[0].title,'Synthetic provider');assert.ok(dataset.sources[0].id);
  assert.equal(dataset.source_metadata.dimension.unit.category.label.rate,'Percent');
  const additive=euroDataset(input,geography,{units:{count:{aggregation:'sum',dimension:'count'},rate:{aggregation:'none',dimension:'ratio'}},aggregationBases:[{id:'units',unit_region_ids:['A','B'],disjoint:true,rollups:[]}]});
  const additiveView=new DatasetView(additive,geography);
  assert.equal(additiveView.summary(['A','B'],additive.series[0].id,'t1',{basisId:'units'}).value,4);
  assert.equal(additiveView.summary(['A','B'],additive.series[1].id,'t1',{basisId:'units'}).value,null);
});

test('JSON-stat series ids cannot collide after punctuation normalization',()=>{
  const input={id:['kind','geo'],size:[2,2],dimension:{kind:{category:{index:['a/b','a b']}},geo:{category:{index:['A','B']}}},value:[1,2,3,4]};
  const dataset=euroDataset(input,geometry());assert.notEqual(dataset.series[0].id,dataset.series[1].id);
  assert.deepEqual(dataset.series.map(series=>series.dimension_values.kind),['a/b','a b']);
  assert.deepEqual(dataset.observations.map(observation=>observation.series_id),[dataset.series[0].id,dataset.series[0].id,dataset.series[1].id,dataset.series[1].id]);
});

test('JSON-stat rejects malformed dimension indexes, cell indexes and invalid numeric cells',()=>{
  const cases=[];
  let input=stat();input.dimension.geo.category.index={A:0,B:0};cases.push(input);
  input=stat();input.dimension.geo.category.index={A:0,B:2};cases.push(input);
  input=stat();input.id=['geo','geo','time'];cases.push(input);
  input=stat();input.value={8:3};cases.push(input);
  input=stat();input.value={'01':3};cases.push(input);
  input=stat();input.value=[1];cases.push(input);
  input=stat();input.value={0:'12'};cases.push(input);
  for(const malformed of cases)assert.throws(()=>unflattenStat(malformed),error=>error.code==='INVALID_JSON_STAT');
  assert.throws(()=>unflattenStat(stat(),{maxCells:7}),error=>error.code==='INVALID_JSON_STAT');
});

function topology(){return {type:'Topology',transform:{scale:[2,3],translate:[10,20]},objects:{zones:{type:'GeometryCollection',geometries:[{type:'Polygon',id:'A',properties:{NAME_LATN:'Alpha',LEVL_CODE:'zone'},arcs:[[0]]},{type:'Polygon',id:'B',properties:{NAME_LATN:'Beta',LEVL_CODE:'zone'},arcs:[[-1]]}]},points:{type:'MultiPoint',id:'sites',properties:{role:'reference'},coordinates:[[1,2],[3,4]]}},arcs:[[[0,0],[2,0],[0,2],[-2,0],[0,-2]]]};}

test('TopoJSON delta transforms and reversed shared arcs preserve coordinates and identities',()=>{
  const input=topology(),before=structuredClone(input),features=decodeTopology(input).features;
  assert.deepEqual(features[0].geometry.coordinates[0],[[10,20],[14,20],[14,26],[10,26],[10,20]]);
  assert.deepEqual(features[1].geometry.coordinates[0],[...features[0].geometry.coordinates[0]].reverse());
  assert.deepEqual(features[2].geometry.coordinates,[[12,26],[16,32]]);assert.deepEqual(input,before);
  const geography=euroGeography(input);assert.deepEqual(geography.regions.map(region=>region.id),['A','B']);
  assert.equal(geography.features.features[2].properties.role,'reference');
  assert.deepEqual(bounds(geography),[[10,20],[14,26]]);
  const map=createMap(euroBundle({geography:input,dataset:{records:[{region_id:'A',value:0},{region_id:'B',value:4}]}}));
  assert.match(map.render().svg,/data-region-id="A"/);assert.equal(map.summary('euro-dataset',['A'],'value','period-1').value,0);map.destroy();
  assert.equal(decodeTopology(input,{objects:['points']}).features.length,1);
});

test('TopoJSON rejects absent arcs and disconnected or unclosed rings without mutating input',()=>{
  let input=topology();input.objects.zones.geometries[0].arcs=[[99]];assert.throws(()=>decodeTopology(input),error=>error.code==='INVALID_GEOMETRY');
  input=topology();input.arcs[0].pop();assert.throws(()=>decodeTopology(input),/closed/);
  input=topology();input.arcs.push([[7,7],[1,0]]);input.objects.zones.geometries[0].arcs=[[0,1]];assert.throws(()=>decodeTopology(input),/do not join/);
  assert.throws(()=>decodeTopology(topology(),{objects:['absent']}),/absent/);
});

test('Euro geography retains explicit hierarchy and projected coordinates and never infers parents from ids',()=>{
  const input={type:'FeatureCollection',crs:{type:'name',properties:{name:'EPSG:9999'}},features:[{type:'Feature',id:'feature-a',properties:{NUTS_ID:'A',NAME_LATN:'Alpha'},geometry:{type:'Point',coordinates:[1000,2000]}},{type:'Feature',id:'feature-b',properties:{NUTS_ID:'A1',NAME_LATN:'Child'},geometry:{type:'Point',coordinates:[2000,3000]}}]};
  assert.throws(()=>euroGeography(input),error=>error.code==='UNSUPPORTED_CRS');
  const options={coordinateSpace:{type:'cartesian',crs:'EPSG:9999',units:'m',y_direction:'up'}};
  let geography=euroGeography(input,options);assert.equal(geography.regions[1].parent_id,undefined);assert.equal(geography.regions[0].id,'A');
  geography=euroGeography(input,{...options,parents:{A1:'A'}});assert.equal(geography.regions[1].parent_id,'A');assert.equal(geography.coordinate_space.crs,'EPSG:9999');
});
