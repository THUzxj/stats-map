import { validateDataset, validateGeography, validateMapSpec, validateBundle } from '../core/validate.js';
import { StatsMapError } from '../core/errors.js';
import { applyRankingRegionSet } from '../core/region-sets.js';
import { decodeTopology } from '../core/topology.js';
import { decodeJsonStat, sourceStatus } from './jsonstat.js';

const ref=(id,revision)=>({id,revision});
const regionId=feature=>feature.properties?.region_id??feature.properties?.NUTS_ID??feature.properties?.id??feature.id??feature.code;
function sources(input) {
  const values=input==null?[]:Array.isArray(input)?input:[input];
  return values.map((value,index)=>typeof value==='string'?{id:`euro-source-${index+1}`,title:value}:{...value,id:value.id??`euro-source-${index+1}`});
}
function coordinateSpace(input,options) {
  const explicit=options.coordinateSpace??input.coordinate_space;
  if(explicit)return {...explicit};
  const crs=input.crs?.properties?.name??input.crs;
  if(crs&&typeof crs!=='string')throw new StatsMapError('CRS metadata needs an explicit coordinateSpace','UNSUPPORTED_CRS');
  if(crs&&!/(?:CRS84|(?:EPSG(?::|::|\/0\/))?4326)$/i.test(crs))throw new StatsMapError(`projected CRS ${crs} needs an explicit cartesian coordinateSpace`,'UNSUPPORTED_CRS');
  return {type:'geographic',crs:crs??'OGC:CRS84',units:'degree'};
}

export function euroGeography(input,options={}) {
  if(input?.kind==='stats-map/geography'){validateGeography(input);return input;}
  if(!input||typeof input!=='object')throw new StatsMapError('Euro geography input must be an object','INVALID_GEOMETRY');
  const raw=input.type==='FeatureCollection'||input.type==='Topology'?input:input.features??input.topology;
  const collection=raw?.type==='Topology'?decodeTopology(raw,{objects:options.topologyObjects}):raw?.type==='FeatureCollection'?raw:{type:'FeatureCollection',features:[]};
  const rawFeatures=collection.features;
  const sourceRegions=input.regions??rawFeatures.filter(feature=>(feature.properties?.role??'region')==='region');
  const regions=sourceRegions.map(region=>{
    const id=region.type==='Feature'?regionId(region):region.id??region.code;
    if(id==null||String(id)==='')throw new StatsMapError('Euro region is missing its id','INVALID_GEOMETRY');
    const parent=options.parents?.[id]??region.parent_id??region.properties?.parent_id;
    return {id:String(id),label:String(region.label??region.name??region.properties?.NAME_LATN??region.properties?.name??id),...((region.labels??region.properties?.labels)?{labels:region.labels??region.properties.labels}:{}),level_id:String(region.level_id??region.level??region.properties?.LEVL_CODE??'region'),...(parent!=null?{parent_id:String(parent)}:{})};
  });
  const known=new Set(regions.map(region=>region.id));
  const features={type:'FeatureCollection',features:rawFeatures.map((feature,index)=>{
    const id=String(regionId(feature)??''),role=feature.properties?.role??(known.has(id)?'region':'boundary');
    return {...feature,id:String(feature.id??`feature-${index}`),properties:{...feature.properties,role,...(role==='region'?{region_id:id}:{})}};
  })};
  const levels=input.levels??[...new Map(regions.map(region=>[region.level_id,{id:region.level_id,label:region.level_id}])).values()];
  const geography={schema_version:1,kind:'stats-map/geography',id:options.geographyId??options.id??'euro-geography',revision:options.geographyRevision??options.revision??'r1',title:options.geographyTitle??input.title??'Euro geography',...(options.anchorPolicy??input.anchor_policy?{anchor_policy:options.anchorPolicy??input.anchor_policy}:{}),...(options.locale??input.default_locale?{default_locale:options.locale??input.default_locale}:{}),levels:levels.length?levels:[{id:'region',label:'Region'}],regions,coordinate_space:coordinateSpace({...raw,...input},options),features,anchors:input.anchors??[],...(input.grid_layouts?{grid_layouts:input.grid_layouts}:{}),sources:sources(input.sources??input.source),...(input.source_refs?{source_refs:input.source_refs}:{})};
  validateGeography(geography);return geography;
}

export function unflattenStat(stat,options={}) {
  return decodeJsonStat(stat,options).records.map(({regionId,periodId,value,flag,status,dimensionValues})=>({regionId,periodId,value:Number.isFinite(value)?value:null,flag,status,dimensionValues}));
}

export function euroDataset(input,geography,options={}) {
  if(input?.kind==='stats-map/dataset'){validateDataset(input,geography);return input;}
  let decoded,records,dimensions=[],series,periods,units;
  const metricId=options.metricId??'value',unitId=options.unitId??'unit';
  if(Array.isArray(input?.id)&&input?.size&&input?.value!=null){
    decoded=decodeJsonStat(input,options);records=decoded.records;
    series=decoded.combinations.map(combination=>({id:combination.id,dimension_values:combination.dimensionValues,unit_id:decoded.unitIndex<0?unitId:combination.dimensionValues[decoded.dims[decoded.unitIndex].id]}));
    dimensions=decoded.seriesIndexes.map(index=>({id:decoded.dims[index].id,label:input.dimension?.[decoded.dims[index].id]?.label??decoded.dims[index].id,values:decoded.dims[index].values.map(id=>({id,label:decoded.dims[index].labels[id]}))}));
    const time=decoded.dims[decoded.timeIndex];
    if(time)periods=time.values.map((id,order)=>({id,label:time.labels[id],order}));
    const unit=decoded.dims[decoded.unitIndex];
    if(unit)units=unit.values.map(id=>({id,label:options.units?.[id]?.label??unit.labels[id],dimension:options.units?.[id]?.dimension??'value',...(options.units?.[id]?.labels?{labels:options.units[id].labels}:{}),...(unit.category.unit?.[id]?{source_metadata:unit.category.unit[id]}:{})}));
  }else{
    records=(input.records??[]).map(record=>({regionId:String(record.region_id??record.regionId),periodId:String(record.period_id??record.periodId??options.periodId??'period-1'),value:record.value,flag:record.flag??record.status_flag,status:record.status??sourceStatus(record.value,record.status_flag??record.flag),dimensionValues:{},evidence:record.evidence}));
    series=[{id:options.seriesId??metricId,dimension_values:{},unit_id:unitId}];
  }
  const known=new Set(geography.regions.map(region=>region.id));
  for(const record of records)if(!known.has(record.regionId))throw new StatsMapError(`Euro observation region is absent from geography: ${record.regionId}`,'UNKNOWN_REGION');
  units??=[{id:unitId,label:options.unitLabel??input.unit??unitId,dimension:options.unitDimensionType??'value'}];
  periods??=[...new Set(records.map(record=>record.periodId))].map((id,order)=>({id,label:id,order}));
  if(options.periods)periods=options.periods;
  // No code heuristics: a percentage/rate/count becomes additive only by declaration.
  const metrics=new Map();
  series=series.map(item=>{
    const aggregation=options.units?.[item.unit_id]?.aggregation??options.aggregation??'none';
    if(!['sum','none'].includes(aggregation))throw new StatsMapError('Euro aggregation must be sum or none; ratios need an explicit canonical derivation','INVALID_AGGREGATION');
    const id=options.units?.[item.unit_id]?.aggregation?`${metricId}:${encodeURIComponent(item.unit_id)}`:metricId;
    metrics.set(id,{id,label:options.metricLabel??input.label??metricId,value_type:'number',aggregation});
    return {id:item.id,metric_id:id,unit_id:item.unit_id,scope_id:'default',measure_type:options.measureType??'unspecified',review_status:options.reviewStatus??'unspecified',...(Object.keys(item.dimension_values).length?{dimension_values:item.dimension_values}:{})};
  });
  const output={schema_version:1,kind:'stats-map/dataset',id:options.datasetId??options.id??'euro-dataset',revision:options.datasetRevision??options.revision??'r1',title:options.title??input.label??'Eurostat dataset',scope_note:options.scopeNote??'Eurostat source',geography_ref:ref(geography.id,geography.revision),periods,units,metrics:[...metrics.values()],scopes:[{id:'default',description:options.scopeNote??'Eurostat source scope'}],dimensions,series,observations:records.map((record,index)=>({id:`euro-observation-${index}`,series_id:record.seriesId??series[0].id,region_id:record.regionId,period_id:record.periodId,status:record.status,value:record.status==='value'?record.value:null,...(record.flag!=null&&record.flag!==''?{source_flag:String(record.flag)}:{}),...(record.evidence?{evidence:record.evidence}:{})})),sources:sources(input.sources??input.source),source_metadata:{class:input.class??null,updated:input.updated??null,source:input.source??null,dimension:input.dimension??null,role:input.role??null},...(options.aggregationBases?{aggregation_bases:options.aggregationBases}:{})};
  validateDataset(output,geography);return output;
}

export function euroBundle(input,options={}) {
  const geography=euroGeography(input.geography??input,options),dataset=euroDataset(input.dataset??input,geography,options);
  let spec=options.spec??{schema_version:1,kind:'stats-map/spec',id:options.specId??'euro-view',revision:'r1',geography_ref:ref(geography.id,geography.revision),dataset_refs:[ref(dataset.id,dataset.revision)],view:{period_id:dataset.periods[0]?.id},layout:{type:'geographic'},layers:[{id:'base',type:'choropleth',role:'base',encoding:{dataset_id:dataset.id,series_id:dataset.series[0].id}}]};
  const alias=spec.ranking?.countryGroup;
  if(options.countryGroup!=null&&alias!=null&&options.countryGroup!==alias)throw new StatsMapError('conflicting countryGroup selections','INVALID_REGION_SET');
  const groupId=options.countryGroup??alias;
  if(groupId!=null){
    if(!options.regionSets)throw new StatsMapError('countryGroup requires a caller-supplied regionSets catalog','INVALID_REGION_SET');
    spec=applyRankingRegionSet(spec,geography,options.regionSets,groupId);
  }
  validateMapSpec(spec,geography,new Map([[`stats-map/dataset:${dataset.id}@${dataset.revision}`,dataset]]));
  const bundle={schema_version:1,kind:'stats-map/bundle',id:options.bundleId??'euro-bundle',revision:'r1',resources:[{storage:'inline',resource:geography},{storage:'inline',resource:dataset},{storage:'inline',resource:spec}],spec_ref:ref(spec.id,spec.revision)};
  validateBundle(bundle);return bundle;
}
export const createEuroBundle=euroBundle;
