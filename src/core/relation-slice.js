import { resolveView } from './view.js';
import { StatsMapError } from './errors.js';

const compare=(a,b)=>a<b?-1:a>b?1:0;
const invalid=message=>{throw new StatsMapError(message,'INVALID_ENCODING');};
export function validateRelationSlice(slice,geography,spec={}) {
  if(!slice||typeof slice!=='object'||Array.isArray(slice))invalid('relation_slice must be an object');
  for(const key of Object.keys(slice))if(!['axis','region_id','include_internal','top'].includes(key))invalid(`unknown relation_slice setting: ${key}`);
  if(!['origin','destination'].includes(slice.axis))invalid('relation_slice.axis must be origin or destination');
  if(slice.include_internal!==undefined&&typeof slice.include_internal!=='boolean')invalid('relation_slice.include_internal must be boolean');
  if(slice.top!==undefined&&(!Number.isInteger(slice.top)||slice.top<1))invalid('relation_slice.top must be a positive integer');
  const id=slice.region_id??spec.view?.relation_region_id;
  if(typeof id!=='string'||!id)invalid('relation_slice needs region_id or view.relation_region_id');
  if(geography&&!geography.regions.some(region=>region.id===id))invalid(`relation_slice references unknown region: ${id}`);
  return {...slice,region_id:id};
}

// One record per partner, with its actual direction. No opposite direction,
// regional observation or computed ratio may substitute for a missing OD pair.
export function relationSlice(view,seriesId,periodId,slice,spec={}) {
  if(!view.geography)invalid('relation_slice requires a geography');
  spec=resolveView(spec,view.geography);
  const settings=validateRelationSlice(slice,view.geography,spec),metric=view.metricForSeries(seriesId);
  if(!view.periods.has(periodId))invalid(`relation_slice references unknown period: ${periodId}`);
  if(metric.value_type!=='number')invalid('relation_slice requires a numeric relation series');
  const anchor=settings.region_id,origin=settings.axis==='origin',regions=spec.view?.region_ids?new Set(spec.view.region_ids):null;
  const records=view.relations(seriesId,periodId).filter(edge=>(origin?edge.origin_region_id:edge.destination_region_id)===anchor).sort((a,b)=>compare(a.id,b.id));
  const partner=edge=>origin?edge.destination_region_id:edge.origin_region_id;
  const available=records.filter(edge=>(settings.include_internal!==false||partner(edge)!==anchor)&&(!regions||regions.has(partner(edge))));
  const ranked=available.filter(edge=>edge.status==='value').sort((a,b)=>b.value-a.value||compare(partner(a),partner(b)));
  const top=settings.top?new Set(ranked.slice(0,settings.top).map(partner)):null,byPartner=new Map(records.map(edge=>[partner(edge),edge]));
  const ids=[...view.regions.keys()],values=ids.map(region_id=>{
    const record=byPartner.get(region_id),reason=settings.include_internal===false&&region_id===anchor?'internal':regions&&!regions.has(region_id)?'scope':record?.status==='value'&&top&&!top.has(region_id)?'top':null;
    const status=reason?'out_of_scope':record?.status??'missing',value=status==='value'?record.value:null;
    const derived={type:'relation-region-slice',axis:settings.axis,anchor_region_id:anchor,region_id,origin_region_id:origin?anchor:region_id,destination_region_id:origin?region_id:anchor,status,value,reported_status:record?.status??null,reported_value:record?.value??null,excluded_reason:reason,source_relation_ids:record?[record.id]:[]};
    return {series_id:seriesId,period_id:periodId,region_id,status,value,relation_slice:derived,...(record?.evidence?{evidence:record.evidence}:{}),...(record?.source_flag!=null?{source_flag:record.source_flag}:{})};
  });
  return {type:'relation-region-slice',series_id:seriesId,period_id:periodId,settings,records,values,top:top?[...top]:[],byRegion:new Map(values.map(value=>[value.region_id,value]))};
}

// A read-only projection over a DatasetView snapshot. Standard renderers consume
// values/observation; the original data and relations remain the source of truth.
export function relationSliceView(view,slice,spec={}) {
  spec=resolveView(spec,view.geography);
  const settings=validateRelationSlice(slice,view.geography,spec),source=view.sourceView??view,cache=new Map(),projected=Object.create(source);
  projected.sourceView=source;projected.relationSliceOptions=settings;
  projected.sliceModel=(series,period)=>{const key=JSON.stringify([series,period]);if(!cache.has(key))cache.set(key,relationSlice(source,series,period,settings,spec));return cache.get(key);};
  projected.observation=(series,region,period)=>projected.sliceModel(series,period).byRegion.get(region)??{series_id:series,region_id:region,period_id:period,status:'missing',value:null};
  projected.summary=(ids,series,period,options={})=>{
    if(options.basisId||options.displayValue==='rollup')invalid('relation slices cannot use a regional aggregation basis');
    const regions=[...new Set(ids)],observations=regions.map(id=>projected.observation(series,id,period)),present=observations.filter(value=>value.status==='value');
    const missingIds=observations.filter(value=>value.status!=='value').map(value=>value.region_id);
    return {missingIds,missingCodes:missingIds,leafCodes:regions,value:regions.length===1?present[0]?.value??null:null,present:present.length,expected:regions.length,missing:regions.length-present.length,regionIds:regions,observations,aggregationAvailable:regions.length<=1,displayValue:'reported',completeness:'complete'};
  };
  return projected;
}
