import { StatsMapError } from './errors.js';
import { relationSliceView } from './relation-slice.js';

export function channelBindings(encoding={},options={}) {
  const channels=[];
  if(encoding.series_id||encoding.series_ids||encoding.relation_series_id)channels.push(encoding);
  const entries=Object.entries(encoding).sort(([a],[b])=>({size:0,color:1}[a]??2)-({size:0,color:1}[b]??2));
  for(const [name,value] of entries)if((options.includeException!==false||name!=='exception')&&value&&typeof value==='object'&&!Array.isArray(value)&&(value.series_id||value.series_ids||value.relation_series_id))channels.push({...value,dataset_id:value.dataset_id??encoding.dataset_id,relation_slice:name==='exception'?value.relation_slice:value.relation_slice??encoding.relation_slice,_exception:name==='exception',_channel:['size','color'].includes(name)?name:null});
  return channels.flatMap(channel=>{
    const slice=channel._exception?channel.relation_slice:channel.relation_slice??encoding.relation_slice;
    return (channel.series_ids??[channel.relation_series_id??channel.series_id]).map(series_id=>({dataset_id:channel.dataset_id,series_id,...(slice?{relation_slice:slice}:{}),...(channel._channel?{channel:channel._channel}:channel===encoding&&encoding.color?{channel:'size'}:{})}));
  });
}

// A size/color declaration must never depend on object insertion order or
// silently discard extra magnitude channels.
export function symbolBindings(encoding={}) {
  const bindings=channelBindings(encoding,{includeException:false});
  const single=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!value.series_ids&&Number(!!value.series_id)+Number(!!value.relation_series_id)===1;
  const top=encoding.series_id||encoding.series_ids||encoding.relation_series_id;
  const hasColor=encoding.color!==undefined;
  const hasSize=encoding.size!==undefined;
  if([encoding.series_id,encoding.series_ids,encoding.relation_series_id].filter(Boolean).length>1||hasColor&&!single(encoding.color)||hasSize&&!single(encoding.size)||hasSize&&top||!hasSize&&!top||bindings.length!==(hasColor?2:1)||bindings.some(binding=>binding.channel&&!['size','color'].includes(binding.channel))||bindings.some((binding,index)=>index===1&&binding.channel!=='color'))throw new StatsMapError('proportionalSymbol requires one size series and an optional single color series','INVALID_ENCODING');
  return bindings;
}

export function channelView(binding,fallback,views,spec={}) {
  const view=binding?.dataset_id?(views?.get(binding.dataset_id)??(fallback?.data.id===binding.dataset_id?fallback:null)):fallback?.sourceView??fallback;
  if(!view&&!binding?.dataset_id)return view;
  if(!view)throw new StatsMapError(`dataset channel is unavailable: ${binding.dataset_id}`,'UNKNOWN_DATASET');
  const slice=binding?.relation_slice_options??binding?.relation_slice;
  return slice?relationSliceView(view,slice,spec):view?.sourceView??view;
}

export function channelValues(view,seriesId,period,aggregation) {
  if(!view||!seriesId||!period)return [];
  if(view.relationSliceOptions&&aggregation?.basis_id)throw new StatsMapError('relation slices cannot use a regional aggregation basis','UNSUPPORTED_ENCODING');
  if(aggregation?.basis_id&&(!aggregation.dataset_id||aggregation.dataset_id===view.data.id))return view.geography.regions.map(region=>{
    const summary=view.summary([region.id],seriesId,period,{basisId:aggregation.basis_id,displayValue:aggregation.display_value??'rollup'});
    return {region_id:region.id,status:summary.value==null?'missing':'value',value:summary.value,coverage:summary};
  });
  return view.values(seriesId,period);
}
