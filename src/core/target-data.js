import { resolveView } from './view.js';
import { channelBindings, channelView } from './channels.js';
import { getRenderer } from '../renderers/registry.js';
import { flowModel } from '../renderers/flow.js';
import { registeredRouteRelations } from '../renderers/flow-routes.js';
import { createPresentation, presentedLayer } from './presentation.js';

// Read the same value as the renderer, retaining the reported observation and
// the contributing observations when a declared aggregation basis is used.
export function targetChannels(map,target) {
  const spec=resolveView(map.insetViews?.find(view=>view.id===target.inset_id)?.spec??map.spec,map.geography);
  const layer=spec.layers?.find(layer=>layer.id===target.layer_id),period=target.period_id??spec.view?.period_id;
  let bindings=channelBindings(layer?.encoding,{includeException:target.series_id!=='__other__'});
  if(target.ranking)bindings=[bindings.find(binding=>binding.series_id===target.series_id&&binding.dataset_id===target.dataset_id)??{dataset_id:target.dataset_id,series_id:target.series_id}];
  const aggregation=target.ranking?null:layer?.aggregation??spec.aggregation,isFlow=!target.ranking&&layer&&getRenderer(layer.type).type==='flow',flowNode=isFlow&&!target.relation_id&&!target.route_id;
  if(layer&&!target.series_id)for(const id of [layer.options?.totalSeriesId,layer.options?.widthSeriesId])if(id&&!bindings.some(binding=>binding.series_id===id))bindings.push({...bindings[0],series_id:id});
  if(layer&&target.series_id==='__other__'&&layer.options?.totalSeriesId&&!bindings.some(binding=>binding.series_id===layer.options.totalSeriesId))bindings.push({...bindings[0],series_id:layer.options.totalSeriesId,auxiliary:true});
  return bindings.filter(binding=>!target.series_id||target.series_id==='__other__'||target.series_id===binding.series_id).map(binding=>{
    const view=channelView(binding,null,map._views,spec),series=view?.series.get(binding.series_id);
    if(!series)return {...binding,dataset_ref:null,observation:null,sources:[]};
    let route=null,flow_breakdown=null,relations=[],registered_relations=[];
    if(flowNode&&target.flow_channel){
      const model=flowModel(view,series.id,period,presentedLayer(layer,createPresentation(spec,map.geography)).options,spec.view?.region_ids),group=model.breakdowns.get(target.region_id)?.find(group=>group.channel===target.flow_channel&&group.key===target.flow_category&&group.value>0);
      if(group){flow_breakdown={type:'flow-node-breakdown',...group,region_id:target.region_id,category_region_id:group.region_id??null,source_relation_ids:[...group.source_relation_ids]};relations=group.source_relation_ids.map(id=>model.edgeIndex.get(id));}
    }
    if(isFlow&&target.route_id){
      const model=flowModel(view,series.id,period,layer.options,spec.view?.region_ids),display=model.displayEdges.find(edge=>edge.route_id===target.route_id);
      if(display){route={type:'flow-route-sum',route_id:display.route_id,endpoint_region_ids:[...display.endpoint_region_ids],value:display.value,source_relation_ids:[...display.source_relation_ids]};const selected=new Set(route.source_relation_ids);registered_relations=registeredRouteRelations(model.observations,route);relations=registered_relations.filter(edge=>selected.has(edge.id));}
    }
    const reported=target.route_id?null:target.relation_id?view.relations(series.id,period).find(edge=>edge.id===target.relation_id):target.region_id&&!flowNode?view.observation(series.id,target.region_id,period):null;
    const coverage=!target.route_id&&!target.relation_id&&!flowNode&&target.region_id&&aggregation?.basis_id&&(!aggregation.dataset_id||aggregation.dataset_id===view.data.id)?view.summary([target.region_id],series.id,period,{basisId:aggregation.basis_id,displayValue:aggregation.display_value??'rollup'}):null;
    const observation=coverage?{series_id:series.id,region_id:target.region_id,period_id:period,status:coverage.value==null?'missing':'value',value:coverage.value,coverage}:reported&&!view.relationSliceOptions&&view.metricForSeries(series.id).aggregation==='ratio'?{...reported,coverage:view.summary([target.region_id],series.id,period)}:reported;
    const relation_slice=observation?.relation_slice??null;
    if(relation_slice)relations=relation_slice.source_relation_ids.map(id=>view.relations(series.id,period).find(edge=>edge.id===id));
    const statisticalCoverage=target.route_id?(route?{present:registered_relations.filter(edge=>edge.status==='value').length,expected:registered_relations.length}:null):observation?.coverage??(!flowNode&&view.periods.has(period)?{present:observation?.status==='value'?1:0,expected:1}:null);
    return {...binding,...(binding.relation_slice?{relation_slice_options:binding.relation_slice}:{}),...(relation_slice?{relation_slice,relations}:{}),...(target.route_id?{route,relations,registered_relations}:{}),...(target.flow_channel?{flow_breakdown,relations}:{}),dataset_ref:{id:view.data.id,revision:view.data.revision},series,metric:view.metricForSeries(series.id),unit:view.data.units.find(unit=>unit.id===series.unit_id),scope_id:series.scope_id,scope:view.data.scopes?.find(scope=>scope.id===series.scope_id),measure_type:series.measure_type,review_status:series.review_status,period:view.periods.get(period),observation,reported_observation:relation_slice?relations[0]??null:reported,coverage:statisticalCoverage,sources:series.source_refs?.length?(view.data.sources??[]).filter(source=>series.source_refs.includes(source.id)):view.data.sources??[]};
  });
}
