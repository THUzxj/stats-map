import { validateDataset, validateGeography, validateMapSpec, validateBundle } from '../core/validate.js';
const hashId=s=>String(s).replace(/[^\w.-]+/g,'_');
const validPoint=value=>Array.isArray(value)&&value.length>=2&&value.slice(0,2).every(point=>typeof point==='number'&&Number.isFinite(point));
const pointValue=value=>validPoint(value)?value.slice(0,2):null;
function featureForRegion(r){if(!r.geometry)return null;const center=pointValue(r.center);return {type:'Feature',id:`region-${hashId(r.code??r.id)}`,properties:{role:'region',region_id:r.code??r.id,...(center?{center}: {})},geometry:r.geometry}}
export function chinaGeography(input, options={}) {
  if(input?.kind==='stats-map/geography'){validateGeography(input);return input;}
  const regions=(input.regions??[]).map(r=>({id:String(r.code??r.id),label:String(r.name??r.label??r.code),level_id:r.level??r.level_id??'region',...(r.labels?{labels:r.labels}:{}),...(r.parent_code||r.parent_id?{parent_id:String(r.parent_code??r.parent_id)}:{}),...(r.code?{code:String(r.code)}:{}),...(pointValue(r.center)?{center:pointValue(r.center)}:{})}));
  const levels=[...new Map(regions.map(r=>[r.level_id,{id:r.level_id,label:r.level_id}])).values()];
  const inputFeatures=input.features?.type==='FeatureCollection'?input.features:null;
  const features=inputFeatures?{...inputFeatures,features:inputFeatures.features.map(f=>{const code=String(f.properties?.region_id??f.properties?.adcode??f.properties?.code??f.id??'');const region=regions.find(r=>r.id===code),role=f.properties?.role??(region?'region':'boundary');return {...f,id:String(f.id??`region-${code}`),properties:{...f.properties,role,...(role==='region'?{region_id:region?.id??code}:{})}};})}:{type:'FeatureCollection',features:(input.regions??[]).map(featureForRegion).filter(Boolean)};
  const explicitSymbols=new Set([
    ...(input.anchors??[]).filter(anchor=>anchor.role==='symbol').map(anchor=>String(anchor.region_id)),
    ...(input.regions??[]).filter(region=>Array.isArray(region.point)||Array.isArray(region.coordinate)).map(region=>String(region.code??region.id)),
  ]);
  const centerAnchors=new Map();
  for(const feature of features.features??[]){
    if(feature.properties?.role!=='region')continue;
    const regionId=String(feature.properties.region_id??'');
    const center=pointValue(feature.properties.center);
    if(regionId&&center&&!centerAnchors.has(regionId))centerAnchors.set(regionId,{region_id:regionId,point:center,role:'symbol',method:'center',version:1});
  }
  for(const region of regions){
    const center=pointValue(region.center);
    if(center&&!centerAnchors.has(region.id))centerAnchors.set(region.id,{region_id:region.id,point:center,role:'symbol',method:'center',version:1});
  }
  const declaredAnchors=[...(input.anchors??[]),...(input.regions??[]).filter(r=>!explicitSymbols.has(String(r.code??r.id))&&(Array.isArray(r.point)||Array.isArray(r.coordinate))).map(r=>({region_id:String(r.code??r.id),point:r.point??r.coordinate,role:'symbol',method:'declared'})),...regions.map(region=>centerAnchors.get(region.id)).filter(anchor=>anchor&&!explicitSymbols.has(anchor.region_id))];
  const g={schema_version:1,kind:'stats-map/geography',id:options.id??`${input.id??'china'}-geography`,revision:options.revision??'r1',title:input.title??'China geography',...(options.anchorPolicy??input.anchor_policy?{anchor_policy:options.anchorPolicy??input.anchor_policy}:{}),...(options.locale??input.default_locale?{default_locale:options.locale??input.default_locale}:{}),levels,regions,coordinate_space:options.coordinate_space??{type:'geographic',crs:'OGC:CRS84',units:'degree'},features,anchors:declaredAnchors,...(input.grid_layouts?{grid_layouts:input.grid_layouts}:{})};validateGeography(g);return g;
}
export function chinaDataset(input, geography, options={}) {
  if(input?.kind==='stats-map/dataset'){validateDataset(input,geography);return input;}
  const metrics=(input.metrics??[]).map(m=>({id:String(m.id),label:m.label??m.name??m.id,...(m.labels?{labels:m.labels}:{}),value_type:m.value_type??'number',aggregation:m.aggregation==='ratio'?'ratio':(m.aggregation??'sum'),unit:m.unit??'unit',...(m.numerator?{numerator:m.numerator}:{}),...(m.denominator?{denominator:m.denominator}:{}),...(m.scale!=null?{scale:m.scale}:{}),...(m.category_dimension_id?{category_dimension_id:m.category_dimension_id}:{})}));
  const units=[...new Map(metrics.map(m=>[m.unit,{id:m.unit,label:m.unit,dimension:'value',...(input.units?.find(unit=>unit.id===m.unit)??{})}])).values()];
  const scopes=[{id:'default',description:input.scope_note??'source scope'}];
  const periods=(input.periods??[]).map((p,i)=>typeof p==='string'?{id:p,label:input.period_labels?.[p]??p,order:i}:{id:p.id,label:p.label??p.id,...(p.labels?{labels:p.labels}:{}),order:p.order??i,...(p.start!=null?{start:p.start}:{}),...(p.end!=null?{end:p.end}:{})});
  const series=[];for(const m of metrics){if(m.aggregation==='ratio')series.push({id:m.id,label:m.label,...(m.labels?{labels:m.labels}:{}),metric_id:m.id,unit_id:m.unit,scope_id:'default',measure_type:'unspecified',review_status:'unspecified'});else series.push({id:m.id,label:m.label,...(m.labels?{labels:m.labels}:{}),metric_id:m.id,unit_id:m.unit,scope_id:'default',measure_type:'unspecified',review_status:'unspecified'});}
  for(const m of metrics)if(m.aggregation==='ratio')m.derivation={type:'ratio',numerator_series_id:m.numerator,denominator_series_id:m.denominator,scale:m.scale??1};
  const observations=[];for(const row of input.records??[])for(const [metricId,value] of Object.entries(row.values??{})){const m=metrics.find(x=>x.id===metricId);if(!m||m.aggregation==='ratio')continue;const valid=m.value_type==='category'?typeof value==='string':typeof value==='number'&&Number.isFinite(value);observations.push({id:`${hashId(row.region_code)}-${hashId(row.period)}-${hashId(metricId)}`,series_id:metricId,region_id:String(row.region_code),period_id:String(row.period),status:valid?'value':'missing',value:valid?value:null,evidence:row.evidence});}
  const regionMap=new Map(geography.regions.map(r=>[r.id,r])), childMap=new Map(geography.regions.map(r=>[r.id,[]]));for(const r of geography.regions)if(r.parent_id&&childMap.has(r.parent_id))childMap.get(r.parent_id).push(r.id);const leaves=geography.regions.filter(r=>(childMap.get(r.id)??[]).length===0).map(r=>r.id);const descendants=id=>{const children=childMap.get(id)??[];return children.length?children.flatMap(descendants):[id];};const aggregation_bases=[{id:'leaves',unit_region_ids:leaves,disjoint:true,rollups:geography.regions.filter(r=>(childMap.get(r.id)??[]).length).map(r=>({region_id:r.id,member_region_ids:descendants(r.id),completeness:'complete'}))}];
  const d={schema_version:1,kind:'stats-map/dataset',id:options.id??input.id??'china-dataset',revision:options.revision??'r1',title:input.title??'China dataset',scope_note:input.scope_note??'source',geography_ref:{id:geography.id,revision:geography.revision},periods,units,metrics,scopes,dimensions:input.dimensions??[],series,observations,aggregation_bases,sources:input.source?[input.source]:[]};validateDataset(d,geography);return d;
}
export function chinaBundle(input, options={}) {
  const geography=chinaGeography(input,options),dataset=chinaDataset(input,geography,options);
  const spec=options.spec??{schema_version:1,kind:'stats-map/spec',id:options.specId??'china-view',revision:'r1',geography_ref:{id:geography.id,revision:geography.revision},dataset_refs:[{id:dataset.id,revision:dataset.revision}],view:{level_ids:geography.levels.map(x=>x.id),period_id:dataset.periods[0]?.id},...(options.aggregation?{aggregation:options.aggregation}:{}),layout:{type:'geographic'},layers:[{id:'base',type:'choropleth',role:'base',encoding:{dataset_id:dataset.id,series_id:dataset.series[0].id}}]};
  validateMapSpec(spec,geography,new Map([[`stats-map/dataset:${dataset.id}@${dataset.revision}`,dataset]]));const b={schema_version:1,kind:'stats-map/bundle',id:options.bundleId??'china-bundle',revision:'r1',resources:[{storage:'inline',resource:geography},{storage:'inline',resource:dataset},{storage:'inline',resource:spec}],spec_ref:{id:spec.id,revision:spec.revision}};validateBundle(b);return b;
}
export const createChinaBundle=chinaBundle;
