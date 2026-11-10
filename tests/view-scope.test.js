import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, viewRegionIds, buildRanking, buildRegionList, fitProjection, projectPoint, buildTooltip, DatasetView, buildLegend, renderSvg, SmallMultiples, validateMapSpec } from '../src/index.js';
import { mixed } from './fixtures/mixed.js';
import { chinaGeography, euroGeography } from '../src/index.js';

test('level and region scopes intersect without rewriting declarations, hierarchy, selection or observations',()=>{
  const {geography,dataset}=mixed(),map=createMap(null,{geography,dataset}),original=structuredClone(dataset);
  map.setSelection(['parent','a']);map.setSpec({...map.spec,view:{period_id:'t',level_ids:['area']},decorations:{labels:true}});
  assert.deepEqual(viewRegionIds(geography,map.spec),['a','b']);assert.equal(map.spec.view.region_ids,undefined);
  let result=map.render();assert.deepEqual(result.geometry.regions.map(row=>row.region_id),['a','b']);
  assert.doesNotMatch(result.svg,/data-region-id="(?:parent|site|unlocated)"/);
  assert.match(result.svg,/data-selection-region-id="a"/);assert.doesNotMatch(result.svg,/data-selection-region-id="parent"/);
  assert.deepEqual(buildRanking(map).rows.map(row=>row.region_id),['b','a']);assert.deepEqual(buildRegionList(map).rows.map(row=>row.region_id),['a','b']);
  assert.deepEqual(map.projection,fitProjection(geography,map.viewport,{type:'geographic',regionIds:['a','b']}));
  assert.equal(map.hitTest(projectPoint([22,2],map.projection)),null);
  assert.deepEqual(map.getState().selection,['parent','a']);assert.deepEqual(dataset,original);
  assert.equal(map.summary(dataset.id,['parent','a'],'one','t',{basisId:'units',displayValue:'rollup'}).value,50);
  assert.match(map.export('csv'),/parent,t,one,value,10000/);
  map.setView({region_ids:['b','parent']});assert.deepEqual(viewRegionIds(geography,map.spec),['b']);
  map.setView({level_ids:[]});assert.deepEqual(map.render().geometry.regions,[]);assert.deepEqual(buildRegionList(map).rows,[]);assert.equal(map.hitTest([400,300]),null);
  map.setView({level_ids:['group'],region_ids:undefined});assert.deepEqual(buildRanking(map).rows.map(row=>row.region_id),['parent']);assert.deepEqual(map.getState().selection,['parent','a']);map.destroy();
});

test('scoped scalar, symbol, composition and time domains agree with legends and independent render entrypoints',()=>{
  const {geography,dataset}=mixed(),view=new DatasetView(dataset,geography),map=createMap(null,{geography,dataset});
  map.setView({level_ids:['area']});
  const layer=map.spec.layers[0],svg=renderSvg({geography,datasetView:view,spec:map.spec,layer}).svg;
  assert.doesNotMatch(svg,/data-region-id="parent"/);
  const legend=buildLegend(layer,view,'t',{spec:map.spec});assert.deepEqual(legend.breaks,map.render().renders[0].domain.breaks);
  assert.deepEqual(map.render().renders[0].domain.domain,[10,40]);
  map.setRenderer('proportionalSymbol',{dataset_id:dataset.id,series_id:'one'});assert.equal(map.render().legends[0].marks.at(-1).value,40);
  map.setRenderer('pieChart',{dataset_id:dataset.id,series_ids:['one','two']});assert.equal(map.render().legends[0].maximum,100);
  map.setRenderer('sparkline',{dataset_id:dataset.id,series_id:'one'});assert.deepEqual(map.render().legends[0].domain,[0,40]);
  const resolved=map.exportSpec({resolved:true});assert.deepEqual(resolved.layers[0].options.yDomain,[0,40]);assert.equal(resolved.view.region_ids,undefined);
  const reopened=createMap(null,{geography,dataset,spec:resolved});assert.deepEqual(reopened.render().legends[0].domain,[0,40]);reopened.destroy();map.destroy();
});

test('grid and Dorling scope retain point and missing geometry identities with separate capability diagnostics',()=>{
  const {geography,dataset}=mixed(),map=createMap(null,{geography,dataset});
  map.setView({level_ids:['site']});assert.deepEqual(buildRegionList(map).rows.map(row=>[row.region_id,row.channels[0].observation.value]),[['site',50],['unlocated',0]]);
  assert.equal(map.capabilities()[0].supported,false);assert.ok(map.capabilities()[0].missing.includes('region polygon geometry'));
  for(const type of ['grid-square','grid-hex']){
    map.setLayout({type});const result=map.render();assert.deepEqual([...map.layoutPositions.keys()],['site','unlocated']);assert.doesNotMatch(result.svg,/data-region-id="parent"/);
    assert.equal(map.capabilities()[0].supported,true);
    for(const [id,node] of map.layoutPositions)assert.equal(map.hitTest([node.x,node.y]).regionId,id);
  }
  map.setLayout({type:'dorling',iterations:1});assert.deepEqual([...map.layoutPositions.keys()],['site']);assert.deepEqual(map.capabilities()[0].regions_without_anchor,['unlocated']);
  assert.deepEqual(buildRegionList(map).rows.map(row=>row.region_id),['site','unlocated']);map.destroy();
});

test('insets explicitly override main level scope while omitted scope inherits it and tooltips retain raw parent values',()=>{
  const {geography,dataset}=mixed(),map=createMap(null,{geography,dataset});
  map.setSpec({...map.spec,view:{period_id:'t',level_ids:['area']},insets:[{id:'inherited',x:10,y:10,width:160,height:150},{id:'other',x:200,y:10,width:160,height:150,region_ids:['parent','site']}]});
  const result=map.render();assert.deepEqual(result.insets[0].geometry.regions.map(row=>row.region_id),['a','b']);assert.deepEqual(result.insets[1].geometry.regions.map(row=>row.region_id),['parent','site']);
  const tooltip=buildTooltip(map,{region_id:'parent',layer_id:'base',inset_id:'other'});assert.equal(tooltip.channels[0].observation.value,10000);
  const inset=result.insets[1],local=projectPoint([22,2],inset.projection),hit=map.hitTest([local[0]+inset.inset.x,local[1]+inset.inset.y+20]);assert.equal(hit.regionId,'parent');assert.equal(hit.insetId,'other');map.destroy();
});

test('OD level scope filters top partners without changing direction or falling back to observations',()=>{
  const {geography,dataset}=mixed();dataset.relations=[['a',10],['b',0],['parent',10000]].map(([destination_region_id,value],i)=>({id:'od-'+i,origin_region_id:'site',destination_region_id,series_id:'one',period_id:'t',status:'value',value}));
  const map=createMap(null,{geography,dataset});map.setSpec({...map.spec,view:{period_id:'t',level_ids:['area'],relation_region_id:'site'},layers:[{id:'partners',type:'choropleth',encoding:{dataset_id:dataset.id,relation_series_id:'one',relation_slice:{axis:'origin',top:1}}}]});
  assert.deepEqual(buildRanking(map).rows.map(row=>[row.region_id,row.value]),[['a',10]]);
  const model=buildTooltip(map,{region_id:'parent',layer_id:'partners'});assert.equal(model.channels[0].observation.status,'out_of_scope');assert.equal(model.channels[0].reported_observation.value,10000);
  assert.match(map.export('csv',{relationSlice:true}),/parent,site,parent,od-2,t,one,out_of_scope,,value,10000,scope/);map.destroy();
});

test('small multiple scopes share domains over declared panels and invalid level updates are transactional',()=>{
  const {geography,dataset}=mixed(),map=createMap(null,{geography,dataset});map.setView({level_ids:['area']});
  const bundle=structuredClone(map.bundle);bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource=map.exportSpec();
  const multiples=new SmallMultiples(null,bundle,[{id:'a',view:{level_ids:['area']}},{id:'s',view:{level_ids:['site']}}]);
  assert.equal(multiples.maps[0].render().legends[0].breaks.at(-1)<=50,true);
  assert.deepEqual(buildRegionList(multiples.maps[1]).rows.map(row=>row.region_id),['site','unlocated']);multiples.destroy();
  for(const level_ids of [['absent'],['area','area'],'area',[null]]){
    const before=map.spec,svg=map.render().svg;assert.throws(()=>map.setView({level_ids}),/level_ids/);assert.equal(map.spec,before);assert.equal(map.render().svg,svg);
  }
  const next=structuredClone(geography);next.regions.find(region=>region.id==='site').level_id='area';
  map.setData(dataset,next);assert.deepEqual(viewRegionIds(next,map.spec),['a','b','site']);assert.deepEqual(map.projection,fitProjection(next,map.viewport,{type:'geographic',regionIds:['a','b','site']}));
  validateMapSpec(map.spec,next,new Map([[dataset.id,dataset]]));map.destroy();
});

test('China and Euro decoded geography retain the same explicit mixed-level scopes and parent identity',()=>{
  const {geography,dataset}=mixed(),input={...structuredClone(geography)};delete input.kind;
  const china=chinaGeography({...input,regions:input.regions.map(region=>({code:region.id,name:region.label,level:region.level_id,parent_code:region.parent_id}))},{coordinate_space:geography.coordinate_space});
  const euro=euroGeography(input);
  for(const adapted of [china,euro]){
    const data={...structuredClone(dataset),geography_ref:{id:adapted.id,revision:adapted.revision}},map=createMap(null,{geography:adapted,dataset:data});
    map.setView({level_ids:['area','site'],region_ids:['a','parent','site','unlocated']});
    assert.deepEqual(viewRegionIds(adapted,map.spec),['a','site','unlocated']);
    assert.equal(adapted.regions.find(region=>region.id==='a').parent_id,'parent');
    assert.deepEqual(buildRegionList(map).rows.map(row=>row.region_id),['a','site','unlocated']);
    assert.equal(buildTooltip(map,{region_id:'parent',layer_id:'base'}).channels[0].reported_observation.value,10000);map.destroy();
  }
});

test('geography updates validate scoped levels before commit and refresh dataset geography views',()=>{
  const {geography,dataset}=mixed(),map=createMap(null,{geography,dataset});map.setView({level_ids:['area']});
  const invalid=structuredClone(geography);invalid.levels=invalid.levels.filter(level=>level.id!=='area');invalid.regions.forEach(region=>{if(region.level_id==='area')region.level_id='site';});
  const spec=map.spec,views=map._views,projection=map.projection,svg=map.render().svg;
  assert.throws(()=>map.setGeography(invalid),/level_ids/);assert.equal(map.spec,spec);assert.equal(map._views,views);assert.equal(map.projection,projection);assert.equal(map.render().svg,svg);
  const next=structuredClone(geography);next.regions.find(region=>region.id==='site').level_id='area';map.setGeography(next);
  assert.deepEqual(buildRegionList(map).rows.map(row=>row.region_id),['a','b','site']);assert.equal(map._views.get(dataset.id).regions.get('site').level_id,'area');
  assert.deepEqual(map.projection,fitProjection(next,map.viewport,{type:'geographic',regionIds:['a','b','site']}));map.destroy();
  assert.throws(()=>map.setGeography(geography),error=>error.code==='LIFECYCLE');
});
