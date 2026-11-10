import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, euroBundle, resolveRegionSet, applyRankingRegionSet, validateRegionSetCatalog, validateRankingRegionSet, buildRanking, RankingChart } from '../src/index.js';
import { rankingFixture } from './fixtures/ranking.js';
import { regionSetFixture } from './fixtures/region-sets.js';

const make=()=>{const input=rankingFixture(80),map=createMap(null,input);return {...input,map,catalog:regionSetFixture()};};
const invalid=fn=>assert.throws(fn,error=>error.code==='INVALID_REGION_SET');

test('exact membership excludes descendants and records unavailable geography separately from missing observations',()=>{
  const {map,catalog}=make();
  try{
    map.setSpec(applyRankingRegionSet(map.spec,map.geography,catalog,'small'));
    const model=buildRanking(map);
    assert.equal(model.mode,'bars');assert.equal(model.rows.length,17);assert.equal(model.missing.length,2);
    assert.deepEqual(model.regionSet.unavailable_region_ids,['not-on-map']);
    assert.equal(model.diagnostics[0].code,'REGION_SET_UNAVAILABLE_MEMBERS');
    assert.ok(map.lastRender.diagnostics.some(row=>row.code==='REGION_SET_UNAVAILABLE_MEMBERS'));
    assert.ok(!model.rows.some(row=>row.region_id==='area-0020'));
    assert.equal(model.regionSet.catalog_ref.revision,'snapshot-1');
    assert.equal(model.regionSet.sources.length,2);
    model.regionSet.region_ids.push('changed');assert.ok(!map.spec.ranking.regionSet.region_ids.includes('changed'));
  }finally{map.destroy();}
});

test('explicit ranking scope intersects each new group using the original requested ids',()=>{
  const {map,catalog}=make();
  try{
    const original={...map.spec,ranking:{regionIds:['area-0001','area-0030'],limit:1}};
    const small=applyRankingRegionSet(original,map.geography,catalog,'small');
    assert.deepEqual(small.ranking.regionIds,['area-0001']);
    const large=applyRankingRegionSet(small,map.geography,catalog,'large');
    assert.deepEqual(large.ranking.regionIds,['area-0001','area-0030']);
    assert.deepEqual(large.ranking.regionSet.requested_region_ids,original.ranking.regionIds);
    const unrestricted=applyRankingRegionSet(applyRankingRegionSet(map.spec,map.geography,catalog,'small'),map.geography,catalog,'large');
    assert.equal(unrestricted.ranking.regionIds.length,80);
    assert.deepEqual(original.ranking.regionIds,['area-0001','area-0030']);
    assert.equal(original.ranking.regionSet,undefined);
  }finally{map.destroy();}
});

test('selection precedes histogram threshold and limit; empty sets retain zero missing and no invented rows',()=>{
  const {map,catalog}=make();
  try{
    map.setSpec(applyRankingRegionSet(map.spec,map.geography,catalog,'large'));
    assert.equal(buildRanking(map).mode,'histogram');
    assert.equal(buildRanking(map,{limit:5}).mode,'bars');
    const selected=buildRanking(map,{limit:5});assert.equal(selected.hidden,selected.total-5);
    map.setSpec(applyRankingRegionSet(map.spec,map.geography,catalog,'empty'));
    const model=buildRanking(map);assert.equal(model.mode,'bars');assert.equal(model.total,0);assert.deepEqual(model.missing,[]);assert.deepEqual(model.bins,[]);
    const chart=new RankingChart(map);assert.equal(chart.pageCount,1);chart.destroy();
    const allAbsent=resolveRegionSet({...catalog,groups:[{id:'absent',region_ids:['nowhere']}]},'absent',map.geography);assert.deepEqual(allAbsent.regionIds,[]);assert.deepEqual(allAbsent.regionSet.unavailable_region_ids,['nowhere']);
  }finally{map.destroy();}
});

test('Euro aliases resolve with explicit configuration and never silently fall back for missing or unknown groups',()=>{
  const {map,catalog,geography,dataset}=make();
  try{
    const input={geography,dataset},before=JSON.stringify({input,catalog});
    for(const options of [{countryGroup:'small',regionSets:catalog},{spec:{...map.spec,ranking:{countryGroup:'small'}},regionSets:catalog}]){
      const bundle=euroBundle(input,options),spec=bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource;
      assert.equal(spec.ranking.regionIds.length,19);assert.ok(!Object.hasOwn(spec.ranking,'countryGroup'));
      const reopened=createMap(bundle);assert.equal(buildRanking(reopened).rows.length,17);reopened.destroy();
    }
    invalid(()=>euroBundle(input,{countryGroup:'small'}));
    invalid(()=>euroBundle(input,{countryGroup:'unknown',regionSets:catalog}));
    invalid(()=>euroBundle(input,{countryGroup:'small',spec:{...map.spec,ranking:{countryGroup:'large'}},regionSets:catalog}));
    assert.throws(()=>map.setSpec({...map.spec,ranking:{countryGroup:'small'}}),/resolve ranking.countryGroup/);
    assert.equal(JSON.stringify({input,catalog}),before);
  }finally{map.destroy();}
});

test('catalog validation rejects duplicate identities, ambiguous membership, invalid sources and unknown requested regions',()=>{
  const {map,catalog}=make();
  try{
    for(const change of [c=>c.schema_version=2,c=>c.revision='',c=>c.groups.push(c.groups[0]),c=>c.groups[0].region_ids.push(c.groups[0].region_ids[0]),c=>c.groups[0].region_ids=[1],c=>c.sources=[{title:'x',url:'file:///local'}],c=>c.sources=[{title:'x',sha256:'bad'}],c=>c.groups[0].labels={x:1}]){
      const copy=structuredClone(catalog);change(copy);invalid(()=>validateRegionSetCatalog(copy));
    }
    invalid(()=>resolveRegionSet(catalog,'small',map.geography,{regionIds:['unknown']}));
    invalid(()=>resolveRegionSet(catalog,'small',map.geography,{regionIds:['area-0001','area-0001']}));
    const resolved=resolveRegionSet(catalog,'small',map.geography);resolved.regionSet.sources[0].title='changed';resolved.regionSet.region_ids.push('extra');
    assert.notEqual(catalog.sources[0].title,'changed');assert.ok(!catalog.groups[0].region_ids.includes('extra'));
    const withChild=structuredClone(map.geography);withChild.regions.push({id:'area-0001-child',label:'Child',level_id:'area'});
    assert.ok(!resolveRegionSet(catalog,'small',withChild).regionIds.includes('area-0001-child'));
  }finally{map.destroy();}
});

test('saved snapshots reject edited membership, stale revisions and inconsistent availability transactionally',()=>{
  const {map,catalog}=make();
  try{
    map.setSpec(applyRankingRegionSet(map.spec,map.geography,catalog,'small'));
    for(const change of [s=>s.ranking.regionIds.pop(),s=>s.ranking.regionSet.unavailable_region_ids=[],s=>s.ranking.regionSet.geography_ref.revision='other',s=>s.ranking.regionSet.requested_region_ids=[]]){
      const before=map.spec,next=structuredClone(before);change(next);invalid(()=>map.setSpec(next));assert.equal(map.spec,before);
    }
    const before=map.geography,next=structuredClone(before);next.revision='other';
    assert.throws(()=>map.setGeography(next));assert.equal(map.geography,before);
    const data=structuredClone([...map.datasets.values()][0]);data.geography_ref={id:next.id,revision:next.revision};
    invalid(()=>map.setData(data,next));assert.equal(map.geography,before);
    const snapshot=map.spec.ranking.regionSet;
    invalid(()=>validateRankingRegionSet(snapshot,[],map.geography));
    const reselected=applyRankingRegionSet(map.spec,next,catalog,'small');assert.equal(reselected.ranking.regionSet.geography_ref.revision,'other');
  }finally{map.destroy();}
});

test('offline reopen requires only snapshot, same-geography data updates preserve membership and raw CSV scope',()=>{
  const {map,catalog}=make();let reopened;
  try{
    const csv=map.export('csv');
    map.setSpec(applyRankingRegionSet(map.spec,map.geography,catalog,'small'));
    assert.equal(map.export('csv'),csv);
    const spec=JSON.parse(JSON.stringify(map.exportSpec({resolved:true})));
    reopened=createMap(null,{geography:map.geography,dataset:[...map.datasets.values()][0],spec});
    assert.deepEqual(buildRanking(reopened),buildRanking(map));
    const data=structuredClone([...map.datasets.values()][0]);data.observations.find(row=>row.region_id==='area-0001'&&row.series_id==='one').value=1234;
    reopened.setData(data);assert.equal(buildRanking(reopened).rows[0].value,1234);
    const chart=new RankingChart(reopened,{pageSize:4});assert.equal(chart.model.rows.length,17);assert.equal(chart.pageCount,5);chart.destroy();
  }finally{reopened?.destroy();map.destroy();}
});
