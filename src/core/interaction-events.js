const attribute=(target,name)=>target?.getAttribute?.(name);
const numeric=value=>value!=null&&Number.isFinite(Number(value))?Number(value):null;
const stringList=value=>{try{const parsed=JSON.parse(value);return Array.isArray(parsed)&&parsed.every(item=>typeof item==='string')?parsed:[];}catch{return [];}};

// Component/edge identity is resolved before region identity. Hosts can choose
// whether a component click should also select its enclosing region.
export function mapTarget(target) {
  const element=target?.closest?.('[data-relation-id],[data-flow-route-id],[data-component-index],[data-region-id],[data-symbol-region-id]');
  if(!element)return null;
  if(attribute(element,'data-flow-outline')==='true'||attribute(element,'data-flow-stem')!=null)return null;
  const layer=element.closest?.('[data-layer-id]');
  const common={...(attribute(element,'data-ranking-row')?{ranking:true,dataset_id:attribute(element,'data-ranking-dataset')} : {}),layer_id:attribute(layer,'data-layer-id')??null,region_id:attribute(element,'data-region-id')??attribute(element,'data-symbol-region-id')??null,period_id:attribute(element,'data-period-id')??null,series_id:attribute(element,'data-series-id')??null,...(attribute(element,'data-flow-channel')?{flow_channel:attribute(element,'data-flow-channel'),flow_category:attribute(element,'data-flow-category')??null}:{})};
  const route=attribute(element,'data-flow-route-id');
  if(route!=null)return {kind:'route',...common,route_id:route,endpoint_region_ids:stringList(attribute(element,'data-route-endpoint-region-ids')),source_relation_ids:stringList(attribute(element,'data-source-relation-ids')),value:numeric(attribute(element,'data-value'))};
  const relation=attribute(element,'data-relation-id');
  if(relation!=null)return {kind:'relation',...common,relation_id:relation,origin_region_id:attribute(element,'data-origin-region-id'),destination_region_id:attribute(element,'data-destination-region-id'),value:numeric(attribute(element,'data-value'))};
  const component=attribute(element,'data-component-index');
  if(component!=null)return {kind:'component',...common,component_index:numeric(component),series_id:attribute(element,'data-series-id'),period_id:attribute(element,'data-period-id'),value:numeric(attribute(element,'data-value')),share:numeric(attribute(element,'data-share'))};
  return {kind:'region',...common};
}

export function dispatchMapTarget(map,event,action='click') {
  const toggle=event.target?.closest?.('[data-inset-toggle]');
  if(attribute(toggle,'data-inset-toggle')!=null){if(action==='click')map.toggleInset(attribute(toggle,'data-inset-toggle'));return;}
  const insetId=attribute(event.target?.closest?.('[data-inset-id]'),'data-inset-id');
  if(action==='click'&&map.insetViews?.find(inset=>inset.id===insetId)?.overview){map.recenterFromMinimap(insetId,map._eventPoint(event));return;}
  const legend=event.target?.closest?.('[data-legend-layer-id]'),item=event.target?.closest?.('[data-legend-key]');
  if(attribute(legend,'data-legend-layer-id')!=null){
    if(!item)return;
    const layer_id=attribute(legend,'data-legend-layer-id'),key=attribute(item,'data-legend-key');
    if(action==='click'&&map.spec.interaction?.legendFiltering!==false)map.toggleLegendFilter(layer_id,key,{source:'legend'});
    const payload={layer_id,key,source:'legend'};map.events.emit(`legend${action}`,payload);return payload;
  }
  if(attribute(event.target?.closest?.('[data-filtered="true"]'),'data-filtered')==='true')return;
  const target=mapTarget(event.target);
  const reference={geography_ref:{id:map.geography.id,revision:map.geography.revision},source:'map',...(insetId?{inset_id:insetId}:{})};
  if(!target){if(action==='hover')map.events.emit('regionhover',{...reference,region_id:null});return;}
  const {kind,...identity}=target,payload={...reference,...identity};
  if(!payload.period_id)payload.period_id=map.spec.view?.period_id??null;
  payload.channels=targetChannels(map,payload);
  if(target.flow_channel&&!payload.channels.some(channel=>channel.flow_breakdown))return;
  if(target.flow_channel){const group=payload.channels.find(channel=>channel.flow_breakdown).flow_breakdown;Object.assign(payload,{value:group.value,source_relation_ids:[...group.source_relation_ids]});}
  if(kind==='route'){
    const route=payload.channels.find(channel=>channel.route)?.route;
    if(!route)return;
    Object.assign(payload,{route_id:route.route_id,endpoint_region_ids:[...route.endpoint_region_ids],source_relation_ids:[...route.source_relation_ids],value:route.value});
  }
  if(action==='click'){
    if(kind==='region'||kind==='component'&&map.spec.interaction?.componentClickSelectsRegion===true)if(target.region_id)map.spec.interaction?.relationRegionOnClick?map.setRelationRegion(target.region_id,{source:'map',inset_id:insetId??null}):map.toggleSelection(target.region_id);
    map.events.emit(`${kind}click`,payload);
  }else map.events.emit(`${kind}${action}`,payload);
  return payload;
}
import { targetChannels } from './target-data.js';

