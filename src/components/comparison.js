import { resolveView } from '../core/view.js';
import { DatasetView } from '../core/dataset.js';
import { channelBindings, channelValues, channelView } from '../core/channels.js';
import { classifyDomain } from '../core/classification.js';
import { getRenderer } from '../renderers/registry.js';
import { bivariateClassification, colorExtent } from '../renderers/color.js';
import { compositionModel } from '../renderers/composition-symbols.js';
import { sparklineModel } from '../renderers/temporal.js';
import { flowModel } from '../renderers/flow.js';
import { ternaryModel, ternaryScale } from '../renderers/ternary.js';
import { StatsMapError } from '../core/errors.js';

const maximum=values=>values.reduce((max,value)=>Math.max(max,value),0);
const extent=values=>values.reduce((range,value)=>[Math.min(range[0],value),Math.max(range[1],value)],[Infinity,-Infinity]);
const fixedClassification=(values,options={})=>({method:'threshold',thresholds:classifyDomain(values,options).breaks,...(options.resolvedDomain||values.length?{resolvedDomain:options.resolvedDomain??extent(values)}:{})});

export function comparisonDomains(base,specs,datasets,geography) {
  const views=new Map([...datasets].map(([id,dataset])=>[id,new DatasetView(dataset,geography)])),domains=new Map();
  for(const layer of base.layers){
    const type=getRenderer(layer.type).type,axes=[],models=[],semantics=[],valueTypes=[];let symbolChannelCount;
    for(const declaration of specs){
      const spec=resolveView(declaration,geography);
      const panelLayer=spec.layers.find(item=>item.id===layer.id),bindings=channelBindings(panelLayer.encoding,{includeException:false}),period=spec.view?.period_id;
      const aggregation=panelLayer.aggregation??spec.aggregation;
      if(type==='proportionalSymbol'){
        if(symbolChannelCount!==undefined&&symbolChannelCount!==bindings.length)throw new StatsMapError('shared symbol panels require the same size/color roles','INCOMPARABLE_PANELS');
        symbolChannelCount=bindings.length;
      }
      const visible=spec.view?.region_ids?new Set(spec.view.region_ids):null;
      bindings.forEach((binding,index)=>{
        const view=channelView(binding,null,views,spec),series=view.series.get(binding.series_id),metric=view.metricForSeries(binding.series_id),unit=view.data.units.find(unit=>unit.id===series.unit_id),scope=view.data.scopes.find(scope=>scope.id===series.scope_id);
        if(metric.value_type!=='number'&&type!=='proportionalSymbol')return;
        valueTypes[index]=metric.value_type;
        const dictionary=metric.value_type==='category'?view.data.dimensions.find(dimension=>dimension.id===metric.category_dimension_id)?.values:null;
        const signature=JSON.stringify([metric.value_type,unit.id,unit.dimension,scope.id,scope.description,series.measure_type??'unspecified',series.review_status??'unspecified',metric.aggregation,dictionary]);
        if(semantics[index]!==undefined&&semantics[index]!==signature)throw new StatsMapError(`shared comparison axis ${index} in layer ${layer.id} requires common units, scope and measure/review semantics`,'INCOMPARABLE_PANELS');
        semantics[index]=signature;
      });
      bindings.forEach((binding,index)=>{axes[index]??=[];for(const value of channelValues(channelView(binding,null,views,spec),binding.series_id,period,aggregation))if((!visible||visible.has(value.region_id))&&value.status==='value'&&typeof value.value==='number')axes[index].push(value.value);});
      const view=channelView(bindings[0],null,views,spec),ids=bindings.map(binding=>binding.series_id),context={...spec,aggregation};
      if(['pieChart','waffle','bar','coxcomb'].includes(type))models.push(compositionModel(type,ids,view,context,panelLayer.options));
      if(type==='sparkline')models.push(sparklineModel(view,ids[0],context,panelLayer.options));
      if(type==='flow')models.push(flowModel(view,ids[0],period,panelLayer.options,spec.view?.region_ids));
      if(type==='trivariateChoropleth')models.push(ternaryModel(ids,view,context,panelLayer.options));
    }
    const patch={options:{}};
    if(['choropleth','alpha','bivariateChoropleth'].includes(type)){
      if(type==='bivariateChoropleth')patch.classification={...layer.classification,axes:axes.slice(0,2).map((values,index)=>fixedClassification(values,bivariateClassification(layer,index)))};
      else patch.classification={...layer.classification,...fixedClassification(axes[0]??[],layer.classification)};
      if(['continuous','diverging'].includes(layer.options?.colorMode)){const domain=classifyDomain(axes[0]??[]),range=colorExtent(domain,layer.options);if(range.length)patch.options.colorDomain=range;}
      if(type==='alpha'&&axes[1]?.length)patch.options.opacity={...layer.options?.opacity,domain:layer.options?.opacity?.domain??extent(axes[1])};
    }
    if(['proportionalSymbol','mushroom'].includes(type))patch.options.maxValue=layer.options?.maxValue??maximum(type==='mushroom'?axes.flat():axes[0]??[]);
    if(type==='proportionalSymbol'&&symbolChannelCount===2&&valueTypes[1]==='number'){
      patch.classification={...layer.classification,...fixedClassification(axes[1]??[],layer.classification)};
      if(['continuous','diverging'].includes(layer.options?.colorMode)){
        const range=colorExtent(classifyDomain(axes[1]??[]),layer.options);if(range.length)patch.options.colorDomain=range;
      }
    }
    if(['pieChart','waffle','bar','coxcomb'].includes(type)){
      patch.options.totalMaximum=layer.options?.totalMaximum??maximum(models.map(model=>model.totalMaximum));
      patch.options.componentMaximum=layer.options?.componentMaximum??maximum(models.map(model=>model.componentMaximum));
      if(type==='bar'||type==='coxcomb')patch.options.maxValue=layer.options?.maxValue??(type==='bar'&&(layer.options?.mode??'grouped')==='grouped'?patch.options.componentMaximum:patch.options.totalMaximum);
      if(type==='bar'&&layer.options?.widthSeriesId)patch.options.maxWidthValue=layer.options?.maxWidthValue??maximum(models.map(model=>model.widthMaximum));
    }
    if(type==='sparkline'&&layer.options?.scale!=='local')patch.options.yDomain=layer.options?.yDomain??[Math.min(0,...models.map(model=>model.domain[0])),Math.max(0,...models.map(model=>model.domain[1]))];
    if(type==='flow'){
      patch.options.maxValue=layer.options?.maxValue??maximum(models.map(model=>model.maximum));
      patch.options.maxNodeValue=layer.options?.maxNodeValue??maximum(models.flatMap(model=>[...model.filtered.nodes.values()].map(node=>node.incoming+node.outgoing+node.internal)));
    }
    if(type==='trivariateChoropleth')patch.options.resolvedCenter=layer.options?.resolvedCenter??ternaryScale(models.flatMap(model=>[...model.values.values()].filter(Boolean)),layer.options).center;
    domains.set(layer.id,patch);
  }
  return domains;
}
