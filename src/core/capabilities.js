import { viewRegionIds } from './view.js';
import { geometryStatus, geometryHasArea } from './anchors.js';
import { getRenderer } from '../renderers/registry.js';
import { StatsMapError } from './errors.js';
import { DatasetView } from './dataset.js';
import { assertComparablePair, symbolScale } from '../renderers/symbols.js';
import { symbolColorModel } from '../renderers/symbol-color.js';
import { validateFlowOptions } from '../renderers/flow-layout.js';
import { compositionModel } from '../renderers/composition-symbols.js';
import { channelBindings, channelView } from './channels.js';

function channel(encoding={}) { if (encoding.dataset_id || encoding.series_id) return encoding; return Object.values(encoding).find(x=>x&&typeof x==='object'&&!Array.isArray(x))??{}; }
export function layerCapabilities(layer, datasetView, geography, layout='geographic',options={}) {
  const renderer=getRenderer(layer.type), missing=[], reasons=[], ch=renderer.type==='proportionalSymbol'?channelBindings(layer.encoding,{includeException:false})[0]??{}:channel(layer.encoding); const series=ch.series_id?datasetView?.series.get(ch.series_id):null; const metric=series?datasetView.metrics.get(series.metric_id):null;
  const scoped=options.regionIds==null?null:new Set(options.regionIds);
  const hasAreas=geography?.features?.features?.some(feature=>feature.properties?.role==='region'&&(!scoped||scoped.has(feature.properties.region_id))&&geometryHasArea(feature.geometry));
  if((layer.role??renderer.defaultRole)!==renderer.defaultRole)reasons.push(`${renderer.type} requires the ${renderer.defaultRole} role`);
  if (!datasetView) missing.push('dataset');
  if (ch.series_id && !series) missing.push(`series:${ch.series_id}`);
  if (['proportionalSymbol','mushroom'].includes(renderer.type) && datasetView && geography) {
    const ids=layer.encoding?.series_ids??(layer.encoding?.series_id?[layer.encoding.series_id]:Object.values(layer.encoding??{}).filter(x=>x&&typeof x==='object').map(x=>x.series_id).filter(Boolean));
    for(const id of renderer.type==='mushroom'?ids:[])if(!datasetView.series.has(id))missing.push(`series:${id}`);
    if(renderer.type==='mushroom'&&ids.length<2)missing.push('second numeric series');
    for(const id of renderer.type==='mushroom'?ids:[]){const s=datasetView.series.get(id),m=s&&datasetView.metrics.get(s.metric_id);if(m&&m.value_type!=='number')reasons.push(`series ${id} must be numeric`);}
    try {
      if(renderer.type==='mushroom') {
        assertComparablePair(datasetView,ids);
        if(!['horizontal','vertical'].includes(layer.options?.orientation??'horizontal'))reasons.push('unsupported mushroom orientation');
      } else {symbolScale([],layer.options);symbolColorModel(layer,datasetView,options.datasetViews,options.spec??{view:{period_id:datasetView.data.periods[0]?.id}});}
    } catch(error) { reasons.push(error.message); }
  }
  if (renderer.type==='stripeComposition') {
    const ids=layer.encoding?.series_ids??[];
    if(!ids.length)missing.push('component series');
    if(layout==='geographic'&&!hasAreas)missing.push('region polygon geometry');
    if(datasetView&&ids.length&&geography?.regions.length)try {
      datasetView.composition(ids,geography.regions[0].id,datasetView.data.periods[0]?.id,{totalSeriesId:layer.options?.totalSeriesId});
    } catch(error) { reasons.push(error.message); }
  }
  if(['pieChart','waffle','bar','coxcomb'].includes(renderer.type)){
    const ids=layer.encoding?.series_ids??[];
    if(!ids.length)missing.push('component series');
    if(datasetView&&ids.length)try {
      compositionModel(renderer.type,ids,datasetView,{view:{period_id:datasetView.data.periods[0]?.id}},layer.options);
    } catch(error) { reasons.push(error.message); }
  }
  if (layout==='geographic' && ['choropleth','bivariateChoropleth','trivariateChoropleth','categorical','alpha'].includes(renderer.type) && !hasAreas) missing.push('region polygon geometry');
  if (renderer.type==='flow') { try {validateFlowOptions(layer.options);}catch(error){reasons.push(error.message);} const relationSeries=layer.encoding?.relation_series_id??ch.series_id; if(!relationSeries||!datasetView?.relations(relationSeries,datasetView.data.periods[0]?.id).length) missing.push('relations'); }
  if (renderer.type==='categorical' && metric && metric.value_type!=='category') reasons.push('categorical renderer requires a category metric');
  if (renderer.type==='trivariateChoropleth' && channelBindings(layer.encoding).length!==3) missing.push('three component series');
  if (renderer.type==='bivariateChoropleth' && channelBindings(layer.encoding).length!==2) missing.push('two component series');
  if (['sparkline','coxcomb'].includes(renderer.type) && (datasetView?.data.periods.length??0)<2) missing.push('two or more periods');
  if(renderer.type==='sparkline'&&!['line','area','bar'].includes(layer.options?.mode??layer.options?.type??'line'))reasons.push(`unsupported sparkline mode: ${layer.options?.mode??layer.options?.type}`);
  if(renderer.type==='sparkline'&&!['shared','local',undefined].includes(layer.options?.scale))reasons.push(`unsupported sparkline scale: ${layer.options?.scale}`);
  if (layout && !renderer.capabilities.layouts.includes(layout)) reasons.push(`layout ${layout} is unsupported`);
  const geometry=geography?geometryStatus(geography,{policy:options.anchorPolicy,regionIds:options.regionIds}):null;
  const regionsWithoutAnchor=geometry?.regions.filter(row=>!row.has_symbol_anchor).map(row=>row.region_id)??[];
  if((layout==='geographic'&&['proportionalSymbol','mushroom','pieChart','waffle','bar','coxcomb','sparkline','flow'].includes(renderer.type)||layout==='dorling')&&geometry?.regions.length&&regionsWithoutAnchor.length===geometry.regions.length)missing.push('symbol anchors');
  return {type:renderer.type,role:layer.role??renderer.defaultRole,roles:[renderer.defaultRole],regions_without_geometry:geometry?.regions.filter(row=>!row.has_geometry).map(row=>row.region_id)??[],regions_without_anchor:regionsWithoutAnchor,supported:missing.length===0&&reasons.length===0,missing,reasons,modes:renderer.modes??[]};
}
export function capabilities(spec, geography, datasets) {
  const layers=spec.layers??[],bases=layers.filter(layer=>(layer.role??getRenderer(layer.type).defaultRole)==='base').length;
  const views=new Map([...datasets??[]].map(([id,dataset])=>[id,dataset instanceof DatasetView?dataset:new DatasetView(dataset,geography)]));
  return layers.map(layer=>{
    const binding=channelBindings(layer.encoding,{includeException:false})[0],view=views.get(binding?.dataset_id)??null;
    const report=layerCapabilities(layer,view&&binding?channelView(binding,view,views,spec):view,geography,spec.layout?.type??'geographic',{anchorPolicy:spec.anchor_policy,regionIds:viewRegionIds(geography,spec),datasetViews:views,spec});
    if(bases>1&&report.role==='base'){report.reasons.push('a map spec may contain at most one base layer');report.supported=false;}
    return report;
  });
}
