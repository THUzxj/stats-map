import test from 'node:test';
import assert from 'node:assert/strict';
import { fitProjection, projectPoint, registerProjection, createMap, validateGeography } from '../src/index.js';
import { sample } from './fixtures/encoding.js';
import { hitTest } from '../src/index.js';

test('Mercator preserves north-up orientation and fits the projected extent into the viewport',()=>{
  const {geography}=sample();geography.coordinate_space={type:'geographic',crs:'OGC:CRS84',units:'degree'};
  geography.features.features[0].geometry={type:'Polygon',coordinates:[[[0,10],[20,10],[20,70],[0,70],[0,10]]]};geography.features.features.splice(1);
  const projection=fitProjection(geography,{width:400,height:300},{projection:{id:'mercator'}});
  const southwest=projectPoint([0,10],projection),northeast=projectPoint([20,70],projection);
  assert.ok(northeast[1]<southwest[1]);assert.ok(northeast[0]>southwest[0]);
  assert.ok(Math.abs(northeast[1]-20)<1e-9);assert.ok(Math.abs(southwest[1]-280)<1e-9);
  assert.ok(Math.abs((southwest[0]+northeast[0])/2-200)<1e-9);
});

test('registered projections keep parameters instance scoped and unknown names fail explicitly',()=>{
  const {geography,dataset}=sample();geography.coordinate_space={type:'geographic',crs:'OGC:CRS84',units:'degree'};
  const unregister=registerProjection('synthetic-affine',([x,y],projection)=>[x*(projection.factor??1),-y]);
  const projection=fitProjection(geography,{width:400,height:300},{projection:{id:'synthetic-affine',factor:2}});
  assert.equal(projection.factor,2);assert.ok(projectPoint([1,0],projection)[0]>projectPoint([0,0],projection)[0]);
  const instance=createMap(null,{geography,dataset});instance.setLayout({type:'geographic',projection:{id:'synthetic-affine',factor:3}});assert.match(instance.render().svg,/data-region-id="a"/);instance.destroy();
  unregister();assert.throws(()=>fitProjection(geography,undefined,{projection:{id:'synthetic-affine'}}),error=>error.code==='UNSUPPORTED_PROJECTION');
});

test('geometry validation rejects nonfinite positions, unclosed rings and unknown geometry types',()=>{
  for(const geometry of [{type:'Point',coordinates:[0,Infinity]},{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]},{type:'Unknown',coordinates:[]}]){
    const {geography}=sample();geography.features.features[0].geometry=geometry;assert.throws(()=>validateGeography(geography));
  }
});

test('collection hit testing respects polygon holes and visible region filters without an anchor fallback inside holes',()=>{
  const {geography}=sample();const geometry=geography.features.features[0].geometry;
  geography.features.features[0].geometry={type:'GeometryCollection',geometries:[geometry]};
  geography.anchors=[{region_id:'a',role:'symbol',point:[.75,.75],method:'supplied'}];
  const projection=fitProjection(geography,{width:400,height:300});
  assert.equal(hitTest(projectPoint([1.5,1.5],projection),geography,projection).regionId,'a');
  assert.equal(hitTest(projectPoint([.75,.75],projection),geography,projection),null);
  assert.equal(hitTest(projectPoint([1.5,1.5],projection),geography,projection,{regionIds:['b']}),null);
});
