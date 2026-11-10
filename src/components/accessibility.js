import { resolveView } from '../core/view.js';
import { createPresentation } from '../core/presentation.js';
import { channelBindings, channelView, channelValues } from '../core/channels.js';
import { escapeSvg as esc } from '../renderers/composition.js';
import { flowModel } from '../renderers/flow.js';
import { registeredRouteRelations } from '../renderers/flow-routes.js';

export function accessibleTargets(svg,geography,layer,spec,view,views) {
  spec=resolveView(spec,geography);
  const p=createPresentation(spec,geography);
  const bindings=channelBindings(layer.encoding),period=spec.view?.period_id;
  const regions=new Map(geography.regions.map(region=>[region.id,region]));
  const flow=layer.type==='flow'&&period?flowModel(view,bindings[0]?.series_id,period,layer.options,spec.view?.region_ids):null;
  const flowSeries=flow?view.series.get(flow.seriesId):null,flowSources=flow?(flowSeries.source_refs?.length?(view.data.sources??[]).filter(source=>flowSeries.source_refs.includes(source.id)):view.data.sources??[]).map(source=>p.label(source,source.id??'')):[];
  const flowNotes=flow?[p.label(flowSeries,p.label(view.metricForSeries(flow.seriesId))),p.label(view.periods.get(period),period),...flowSources]:[];
  const flowEdges=new Map((flow?.observations??[]).map(edge=>[edge.id,edge]));
  const flowRoutes=new Map((flow?.displayEdges??[]).filter(edge=>edge.route_id).map(edge=>[edge.route_id,edge]));
  const routeLabel=id=>{
    const route=flowRoutes.get(id);if(!route)return '';
    const region=id=>p.label(regions.get(id),id),selected=new Set(route.source_relation_ids);
    const records=registeredRouteRelations(flow.observations,route).map(edge=>`${region(edge.origin_region_id)} → ${region(edge.destination_region_id)} / ${edge.id} / ${p.t(selected.has(edge.id)?'displayed':'excluded')}: ${edge.status==='value'?p.number(edge.value)+' '+flow.unit:p.t(edge.status)}${edge.evidence?' / '+JSON.stringify(edge.evidence):''}${edge.source_flag?' / '+edge.source_flag:''}`);
    return `${route.endpoint_region_ids.map(region).join(' ↔ ')} / ${p.t('routeTotal')}: ${p.number(route.value)} ${flow.unit} / ${records.join(' / ')} / ${flowNotes.join(' / ')}`;
  };
  const values=bindings.map(binding=>{
    const source=channelView(binding,view,views,spec);
    return {binding,view:source,values:new Map(channelValues(source,binding.series_id,period,layer.aggregation??spec.aggregation).map(observation=>[observation.region_id,observation]))};
  });
  const labels=new Map();
  const label=(id,seriesId,periodId)=>{
    const key=JSON.stringify([id,seriesId,periodId]);if(labels.has(key))return labels.get(key);
    const fields=[p.label(regions.get(id),id)];
    if(flow){for(const [heading,node] of [[p.t('beforeFilter'),flow.before.nodes.get(id)],[p.t('afterFilter'),flow.filtered.nodes.get(id)]])for(const name of ['incoming','outgoing','internal'])fields.push(`${heading} / ${p.t(name)}: ${p.number(node?.[name]??0)} ${flow.unit}`);fields.push(...flowNotes);const result=fields.filter(Boolean).join(' / ');labels.set(key,result);return result;}
    for(const entry of values){
      if(seriesId&&entry.binding.series_id!==seriesId)continue;
      const series=entry.view?.series.get(entry.binding.series_id);if(!series)continue;
      const observation=periodId&&periodId!==period?entry.view.observation(series.id,id,periodId):entry.values.get(id);
      const unit=p.label(entry.view.data.units.find(unit=>unit.id===series.unit_id));
      const metric=entry.view.metricForSeries(series.id),category=metric.value_type==='category'?entry.view.data.dimensions?.find(dimension=>dimension.id===metric.category_dimension_id)?.values.find(item=>item.id===observation?.value):null;
      fields.push(`${entry.binding.channel?p.t(entry.binding.channel)+' / ':''}${p.label(series,p.label(metric))}: ${observation?.status==='value'?(category?p.label(category,observation.value):p.number(observation.value))+' '+unit:p.t(observation?.status??'missing')}`);
      if(observation?.relation_slice){const slice=observation.relation_slice;fields.push(`${p.label(regions.get(slice.origin_region_id),slice.origin_region_id)} → ${p.label(regions.get(slice.destination_region_id),slice.destination_region_id)}`,slice.source_relation_ids.join(', '));if(slice.excluded_reason)fields.push(`${p.t('excluded')} / ${slice.excluded_reason}: ${slice.reported_status==='value'?p.number(slice.reported_value):p.t(slice.reported_status??'missing')}`);}
      if(observation?.coverage)fields.push(`${p.t('coverage')}: ${p.number(observation.coverage.present)}/${p.number(observation.coverage.expected)}`);
      fields.push(p.label(entry.view.periods.get(periodId??period),periodId??period??''));
      const sources=series.source_refs?.length?entry.view.data.sources?.filter(source=>series.source_refs.includes(source.id)):entry.view.data.sources;
      for(const source of sources??[])fields.push(p.label(source,source.id??''));
      const evidence=observation?.evidence;
      if(evidence?.source_id)fields.push(`${p.t('source')}: ${evidence.source_id}`);
      if(evidence?.sha256)fields.push(`SHA-256: ${evidence.sha256}`);
    }
    const result=fields.filter(Boolean).join(' / ');labels.set(key,result);return result;
  };
  return svg.replace(/<(path|circle|rect|polygon)(\s[^<>]*?)(\/?)>/g,(match,tag,attributes,closed)=>{
    const attribute=name=>attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
    if(attribute('data-flow-outline')||attribute('data-flow-stem'))return match;
    const id=attribute('data-region-id')??attribute('data-symbol-region-id'),relation=attribute('data-relation-id'),route=attribute('data-flow-route-id');
    if(!id&&!relation&&!route)return match;
    const decode=value=>value?.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,item=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[item]));
    const edge=flowEdges.get(decode(relation));
    let title=route?routeLabel(decode(route)):relation?`${p.label(regions.get(decode(attribute('data-origin-region-id'))),decode(attribute('data-origin-region-id')))} → ${p.label(regions.get(decode(attribute('data-destination-region-id'))),decode(attribute('data-destination-region-id')))}: ${attribute('data-value')==null?p.t('missing'):p.number(Number(attribute('data-value')))} ${flow?.unit??''} / ${flowNotes.join(' / ')}${edge?.evidence?' / '+JSON.stringify(edge.evidence):''}${edge?.source_flag?' / '+edge.source_flag:''}`:label(decode(id),decode(attribute('data-series-id')),decode(attribute('data-period-id')));
    if(flow&&attribute('data-flow-channel')){
      const group=flow.breakdowns.get(decode(id))?.find(group=>group.channel===attribute('data-flow-channel')&&group.key===decode(attribute('data-flow-category')));
      if(group)title+=` / ${p.t(group.channel)} / ${group.label}: ${p.number(group.value)} ${flow.unit} / `+group.source_relation_ids.map(id=>{const edge=flow.edgeIndex.get(id);return `${id}: ${p.number(edge.value)}${edge.evidence?' / '+JSON.stringify(edge.evidence):''}${edge.source_flag?' / '+edge.source_flag:''}`;}).join(' / ');
    }
    const inactive=attribute('data-filtered')==='true';
    return `<${tag}${attributes} role="button" tabindex="${inactive?-1:0}" aria-label="${esc(title)}"${inactive?' aria-disabled="true"':''}><title>${esc(title)}</title>${closed?`</${tag}>`:''}`;
  });
}
