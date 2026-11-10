// Entirely fictional inputs. Each source protocol is decoded before entering
// the common renderer. JSON-stat has numeric cells only; category/OD resources
// are explicit canonical extensions, never inferred from numeric observations.
export function adapterFixture(lib, adapter) {
  const ids=['a','b','zero','gap'], kinds=['one','two','three','total'];
  const periods=[{id:'early',label:'Early',order:0,start:'2001-01-01'},{id:'late',label:'Late',order:1,start:'2003-01-01'}];
  const shapes=ids.map((id,i)=>({type:'Feature',id:'f-'+id,properties:{region_id:id,role:'region',NUTS_ID:id,LEVL_CODE:'area',NAME_LATN:id},geometry:{type:'Polygon',coordinates:[[[i*4,0],[i*4+3,0],[i*4+3,3],[i*4,3],[i*4,0]]]}}));
  const values=(region,period)=>region==='gap'?[null,null,null,null]:region==='zero'?[0,0,0,0]:region==='a'?[10,20,30,100].map(v=>v*(period==='early'?1:2)):[40,30,20,100].map(v=>v*(period==='early'?1:2));
  const source={id:'synthetic-source',title:'Fictional matrix evidence'};
  let geography,dataset,series;
  if(adapter==='china') {
    const input={id:'synthetic',title:'Fictional matrix',scope_note:'synthetic',anchor_policy:{method:'interior-point',version:1},source,
      regions:ids.map((code,i)=>({code,name:code,level:'area',geometry:shapes[i].geometry})),periods,
      metrics:kinds.map(id=>({id,unit:'items',aggregation:'sum'})),
      records:ids.flatMap(region_code=>periods.map(period=>({region_code,period:period.id,values:Object.fromEntries(kinds.map((id,i)=>[id,values(region_code,period.id)[i]])),evidence:[{source_id:source.id,locator:region_code+'/'+period.id}]})))};
    geography=lib.chinaGeography(input);dataset=lib.chinaDataset(input,geography);series=Object.fromEntries(kinds.map(id=>[id,id]));
  } else if(adapter==='euro') {
    geography=lib.euroGeography({type:'FeatureCollection',features:shapes,anchor_policy:{method:'interior-point',version:1}},{id:'synthetic-geography'});
    const input={id:['kind','geo','time'],size:[kinds.length,ids.length,periods.length],dimension:{kind:{category:{index:kinds}},geo:{category:{index:ids}},time:{category:{index:periods.map(p=>p.id)}}},
      value:kinds.flatMap((_,k)=>ids.flatMap(id=>periods.map(period=>values(id,period.id)[k]))),source};
    dataset=lib.euroDataset(input,geography,{unitId:'items',unitLabel:'items',periods,scopeNote:'synthetic',aggregation:'sum'});
    series=Object.fromEntries(dataset.series.map(s=>[s.dimension_values.kind,s.id]));
  } else {
    geography={schema_version:1,kind:'stats-map/geography',id:'synthetic-geography',revision:'r1',title:'Fictional planar map',coordinate_space:{type:'cartesian',units:'m',y_direction:'up'},anchor_policy:{method:'interior-point',version:1},levels:[{id:'area',label:'Area'}],regions:ids.map(id=>({id,label:id,level_id:'area'})),features:{type:'FeatureCollection',features:shapes}};
    dataset={schema_version:1,kind:'stats-map/dataset',id:'synthetic-data',revision:'r1',title:'Fictional matrix',scope_note:'synthetic',geography_ref:{id:geography.id,revision:geography.revision},periods,units:[{id:'items',label:'items',dimension:'value'}],metrics:[{id:'n',label:'Number',value_type:'number',aggregation:'sum'}],scopes:[{id:'default',description:'synthetic'}],series:kinds.map(id=>({id,metric_id:'n',unit_id:'items',scope_id:'default',measure_type:'unspecified',review_status:'unspecified'})),observations:ids.flatMap(region_id=>periods.flatMap(period=>kinds.map((series_id,i)=>({id:region_id+'-'+period.id+'-'+i,region_id,period_id:period.id,series_id,status:values(region_id,period.id)[i]==null?'missing':'value',value:values(region_id,period.id)[i]})))),sources:[source]};
    series=Object.fromEntries(kinds.map(id=>[id,id]));
  }
  dataset.aggregation_bases??=[{id:'units',unit_region_ids:ids,disjoint:true,rollups:[]}];
  // Canonical additions exercise protocols that have no JSON-stat/v1 cells.
  dataset.dimensions??=[];dataset.dimensions.push({id:'classes',label:'Classes',values:[{id:'first',label:'First'},{id:'second',label:'Second'}]});
  dataset.metrics.push({id:'category-metric',label:'Category',value_type:'category',aggregation:'none',category_dimension_id:'classes'});
  dataset.series.push({id:'category',metric_id:'category-metric',unit_id:'items',scope_id:'default',measure_type:'unspecified',review_status:'unspecified'});series.category='category';
  for(const period of periods)for(const [i,region_id] of ids.entries())dataset.observations.push({id:'cat-'+region_id+'-'+period.id,series_id:'category',region_id,period_id:period.id,status:region_id==='gap'?'missing':'value',value:region_id==='gap'?null:i%2?'second':'first'});
  dataset.relations=periods.flatMap(period=>[['a','b',20],['b','a',10],['a','a',5],['zero','a',0],['gap','b',null]].map(([origin_region_id,destination_region_id,value],i)=>({id:period.id+'-od-'+i,origin_region_id,destination_region_id,series_id:series.one,period_id:period.id,status:value==null?'suppressed':'value',value,evidence:[{source_id:source.id,locator:'od/'+i}],source_flag:value==null?'c':'p'})));
  lib.validateDataset(dataset,geography);
  return {geography,dataset,series};
}

export function matrixCases() {
  const rows=[];
  const add=(id,type,options={},classification,encoding)=>rows.push({id,type,options,classification,encoding});
  for(const method of ['quantile','equinter','threshold','ckmeans','jenks'])add('ch-'+method,'choropleth',{},method==='threshold'?{method,thresholds:[10,30,60]}:{method,classes:3});
  for(const texture of ['dot','square'])add('ch-'+texture,'choropleth',{texture});
  add('ch-continuous','choropleth',{colorMode:'continuous'});
  for(const shape of ['circle','bar','square','star','diamond','wye','cross','triangle','spike','custom'])add('symbol-'+shape,'proportionalSymbol',{shape,...(shape==='custom'?{customShape:{viewBox:[0,0,10,10],path:'M0 0 L10 0 L10 10 L0 10 Z'}}:{})});
  add('category','categorical');add('bivariate','bivariateChoropleth');add('alpha','alpha');
  for(const mode of ['ternary','sextant'])add(mode,'trivariateChoropleth',{mode,meanCentering:mode==='sextant'});
  add('stripe','stripeComposition');
  for(const mode of ['pie','ring','flag','segment','radar','agepyramid','halftone'])add('pie-'+mode,'pieChart',{mode,totalSeriesId:'$total',...(mode==='radar'?{radarValueMode:'absolute'}:{})});
  add('radar-share','pieChart',{mode:'radar',radarValueMode:'share'});
  for(const mode of ['line','area','bar'])add('spark-'+mode,'sparkline',{mode});
  for(const mode of ['curved','straight','sankey'])add('flow-'+mode,'flow',{mode});
  add('flow-merged','flow',{reciprocalMode:'merged',nodeShape:'donut'});
  for(const scaleMode of ['area','radius'])add('coxcomb-'+scaleMode,'coxcomb',{scaleMode,totalSeriesId:'$total'});
  for(const orientation of ['horizontal','vertical'])add('mushroom-'+orientation,'mushroom',{orientation});
  add('waffle','waffle',{totalSeriesId:'$total',cells:25,columns:5});
  for(const mode of ['grouped','stacked'])add('bar-'+mode,'bar',{mode,totalSeriesId:'$total',widthSeriesId:'$total'});
  return rows;
}

export const matrixLayouts=['geographic','grid-square','grid-hex'];
export const matrixAdapters=['euro','china','canonical'];

// Capability coverage and source decoding are separate axes. Exercise each
// renderer once, then probe each external protocol with four data families.
// The historical cross product remains available only as an explicit check.
export function representativeMatrixCases() {
  const rows=matrixCases(),types=[...new Set(rows.map(row=>row.type))];
  const layouts=[...matrixLayouts,'dorling'];
  return [
    ...types.map((type,index)=>({adapter:'canonical',layout:layouts[index%layouts.length],row:rows.find(row=>row.type===type)})),
    ...['euro','china'].flatMap(adapter=>['ch-quantile','pie-pie','spark-line','flow-curved'].map((id,index)=>({adapter,layout:matrixLayouts[index%matrixLayouts.length],row:rows.find(row=>row.id===id)})))
  ];
}

export function matrixMap(lib,fixture,row,layout,container=null) {
  const {geography,dataset,series}=fixture;
  let encoding;
  if(row.type==='flow')encoding={relation_series_id:series.one};
  else if(['bivariateChoropleth','alpha'].includes(row.type))encoding={x:{dataset_id:dataset.id,series_id:series.one},y:{dataset_id:dataset.id,series_id:series.two}};
  else if(['trivariateChoropleth','stripeComposition','pieChart','waffle','bar','coxcomb','mushroom'].includes(row.type))encoding={series_ids:(row.type==='mushroom'?['one','two']:['one','two','three']).map(id=>series[id])};
  else encoding={series_id:series[row.type==='categorical'?'category':'one']};
  const options=Object.fromEntries(Object.entries(row.options).map(([key,value])=>[key,value==='$total'?series.total:value]));
  const spec={schema_version:1,kind:'stats-map/spec',id:'matrix-'+row.id,revision:'r1',geography_ref:{id:geography.id,revision:geography.revision},dataset_refs:[{id:dataset.id,revision:dataset.revision}],locale:'en',view:{period_id:'early'},layout:{type:layout},layers:[{id:'theme',type:row.type,encoding:{dataset_id:dataset.id,...encoding},options,...(row.classification?{classification:row.classification}:{})}],decorations:{title:'Synthetic '+row.id,sources:'Fictional matrix evidence'}};
  return lib.createMap(container,{geography,dataset,spec,width:760,height:560});
}
