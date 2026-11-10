import { resolveView } from '../core/view.js';
import { wrapText } from './text-layout.js';
import { specializedLegendLayout, specializedLegendSvg } from './specialized-legend.js';
import { StatsMapError } from '../core/errors.js';
import { createPresentation, presentedLayer } from '../core/presentation.js';
import { ternaryModel } from '../renderers/ternary.js';
import { getRenderer } from '../renderers/registry.js';
import { symbolScale, symbolShapeSvg, assertComparablePair, mushroomShapeSvg } from '../renderers/symbols.js';
import { symbolColorModel } from '../renderers/symbol-color.js';
import { compositionItems, compositionFor } from '../renderers/composition.js';
import { classifyDomain } from '../core/classification.js';
import { sparklineModel } from '../renderers/temporal.js';
import { compositionModel, compositionSizeLegend, compositionGlyphSize } from '../renderers/composition-symbols.js';
import { flowWidth, flowNodeRadius } from '../renderers/flow-layout.js';
import { flowModel } from '../renderers/flow.js';
import { flowCategoryStyle, flowDisplayCategory } from '../renderers/flow-categories.js';
import { categoryStyles, numericColor, classificationTexture, colorExtent, bivariateClassification } from '../renderers/color.js';
import { channelBindings, channelView, channelValues } from '../core/channels.js';
import { legendItemKey } from '../core/legend-filter.js';
import { exceptionModel } from '../renderers/exceptions.js';
import { alphaScale, ternaryColor, ternaryPosition } from '../renderers/math.js';

const palette=['#2166ac','#67a9cf','#d1e5f0','#f7f7f7','#ef8a62','#b2182b','#74add1','#fdae61','#d73027'];
const categoryPalette=['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function seriesIds(encoding={}) {
  if(Array.isArray(encoding.series_ids))return encoding.series_ids;
  if(encoding.series_id)return [encoding.series_id];
  return Object.values(encoding).filter(x=>x&&typeof x==='object').map(x=>x.series_id).filter(Boolean);
}
function valuesFor(view,id,period,aggregation,spec={}) {
  const allowed=spec.view?.region_ids?new Set(spec.view.region_ids):null;
  const filter=values=>allowed?values.filter(value=>allowed.has(value.region_id)):values;
  if(aggregation?.basis_id&&(!aggregation.dataset_id||aggregation.dataset_id===view.data.id))return filter(view.geography.regions.map(region=>{
    const summary=view.summary([region.id],id,period,{basisId:aggregation.basis_id,displayValue:aggregation.display_value??'rollup'});
    return {region_id:region.id,status:summary.value==null?'missing':'value',value:summary.value};
  }));
  return filter(view.values(id,period));
}
function valueLabel(value,presentation){return (presentation??createPresentation()).number(value);}
function numericLegend(values,layer,view,seriesId){
  const p=layer.presentation??createPresentation({},view.geography),valueLabel=p.number;
  const domain=classifyDomain(values.filter(o=>o.status==='value'&&typeof o.value==='number').map(o=>o.value),layer.classification??{});
  const displayDomain=layer.classification?.resolvedDomain??domain.domain;
  const items=displayDomain.length||domain.breaks.length?Array.from({length:domain.classes},(_,i)=>({label:domain.classes===1?displayDomain[0]===displayDomain.at(-1)?valueLabel(displayDomain[0]):`${valueLabel(displayDomain[0])} – ${valueLabel(displayDomain.at(-1))}`:i===0?`< ${valueLabel(domain.breaks[0]??displayDomain[0]??0)}`:i===domain.classes-1?`≥ ${valueLabel(domain.breaks[i-1]??displayDomain.at(-1)??0)}`:`${valueLabel(domain.breaks[i-1])} – ${valueLabel(domain.breaks[i])}`,color:palette[i%palette.length],index:i})):[];
  const unitId=view.series.get(seriesId)?.unit_id;
  for(const item of items)item.color=numericColor(domain.breaks[item.index-1]??displayDomain[0]??domain.breaks[0],{...domain,classify:()=>item.index},layer.options);
  return {domain,items,unit:p.label(view.data.units.find(u=>u.id===unitId)),missing:values.some(o=>o.status!=='value')};
}
function bivariateLegend(ids,layer,view,period,aggregation,views,spec){
  if(ids.length<2)return {type:'empty',items:[]};
  const biLayer={...layer,classification:{...layer.classification,classes:3}};
  const axes=ids.slice(0,2).map((id,index)=>({...numericLegend(valuesFor(views[index],id,period,aggregation,spec),{...biLayer,classification:bivariateClassification(layer,index)},views[index],id),label:layer.presentation.label(views[index].series.get(id),layer.presentation.label(views[index].metricForSeries(id)))}));
  const cells=[];
  for(let x=0;x<axes[0].items.length;x++)for(let y=0;y<axes[1].items.length;y++)cells.push({x,y,color:(layer.options?.bivariateColors??palette)[(x*3+y)%palette.length]});
  return {type:'bivariate',axes,cells,missing:axes.some(axis=>axis.missing)};
}
function ternaryLegend(ids,layer,view,period,aggregation,spec){
  const model=ternaryModel(ids,view,{...spec,view:{...spec?.view,period_id:period}},layer.options);
  if(ids.length<3)return {type:'empty',items:[]};
  const components=ids.slice(0,3).map(id=>({id,label:layer.presentation.label(view.series.get(id),layer.presentation.label(view.metricForSeries(id))),unit:layer.presentation.label(view.data.units.find(u=>u.id===view.series.get(id)?.unit_id))}));
  const samples=[];const divisions=5;
  for(let a=0;a<=divisions;a++)for(let b=0;b<=divisions-a;b++){
    const c=divisions-a-b,position=ternaryPosition([a,b,c]);
    samples.push({a,b,c,...position,color:model.color([a,b,c])});
  }
  const missing=ids.slice(0,3).some(id=>valuesFor(view,id,period,aggregation,spec).some(o=>o.status!=='value'));
  return {type:'ternary',components,samples,mode:model.mode,center:model.center,scale:model,missing:model.missing};
}
function alphaLegend(ids,layer,view,period,aggregation,views,spec){
  if(ids.length<2)return {type:'empty',items:[]};
  const base=numericLegend(valuesFor(views[0],ids[0],period,aggregation,spec),layer,views[0],ids[0]);
  const opacityObservations=valuesFor(views[1],ids[1],period,aggregation,spec);
  const opacityValues=opacityObservations.filter(o=>o.status==='value'&&Number.isFinite(o.value)).map(o=>o.value);
  if(!opacityValues.length&&!layer.options?.opacity?.domain)return {type:'alpha',base,opacity:[],missing:true};
  const [min,max]=layer.options?.opacity?.domain??[Math.min(...opacityValues),Math.max(...opacityValues)],bands=Array.from({length:5},(_,i)=>{
    const value=min+(max-min)*i/4;
    return {value,opacity:alphaScale(value,min,max,layer.options?.opacity),label:valueLabel(value,layer.presentation)};
  });
  return {type:'alpha',base,bands,unit:layer.presentation.label(views[1].data.units.find(u=>u.id===views[1].series.get(ids[1])?.unit_id)),missing:base.missing||opacityObservations.some(o=>o.status!=='value')};
}
function sizeLegend(ids,layer,view,period,aggregation,spec){
  const mushroom=layer.type==='mushroom';
  if(mushroom)assertComparablePair(view,ids);
  const values=(mushroom?ids:[ids[0]]).flatMap(id=>valuesFor(view,id,period,aggregation,spec));
  const options=mushroom?{...layer.options,shape:'circle',scaleMode:'area'}:layer.options;
  const scale=symbolScale(values.filter(o=>o.status==='value').map(o=>o.value),options);
  const examples=scale.maximum===0?[0]:[scale.maximum/4,scale.maximum/2,scale.maximum];
  const marks=examples.map(value=>({value,radius:scale.radius(value)}));
  const components=mushroom?ids.map((id,i)=>({id,label:layer.presentation.label(view.series.get(id),layer.presentation.label(view.metricForSeries(id))),color:layer.options?.colors?.[i]??['#2166ac','#ef8a62'][i]})):[];
  return {type:mushroom?'mushroom':'size',shape:scale.shape,options,mode:scale.mode,minRadius:scale.minRadius,unit:layer.presentation.label(view.data.units.find(u=>u.id===view.series.get(ids[0])?.unit_id)),marks,components,missing:values.some(o=>o.status!=='value')};
}
function compositionLegend(ids,layer,view,period,aggregation,spec={}){
  const items=compositionItems(ids,view,layer.options).map(item=>({...item,value:item.id}));
  const compositions=(spec.view?.region_ids??view.geography.regions.map(region=>region.id)).map(id=>compositionFor(ids,view,id,period,layer.options,aggregation));
  return {type:'composition',items,missing:compositions.some(item=>item.status==='incomplete'),zero:compositions.some(item=>item.status==='zero'),conflict:compositions.some(item=>item.status==='conflict'),unit:layer.presentation.label(view.data.units.find(u=>u.id===view.series.get(ids[0])?.unit_id))};
}
export function buildLegend(layer,datasetView,periodId,options={}) {
  options={...options,spec:resolveView(options.spec??{},datasetView?.geography)};
  const presentation=createPresentation(options.spec??{},datasetView?.geography);
  layer=presentedLayer({...layer,type:getRenderer(layer.type).type},presentation);
  const spec={...options.spec,view:{...options.spec?.view,period_id:periodId}};
  const exceptions=exceptionModel(layer,datasetView,options.datasetViews,spec);
  const legend=buildMainLegend(layer,datasetView,periodId,options);
  if(legend.type==='composition')legend.notes=compositionNotes(legend,presentation);
  if(exceptions)legend.exceptions=exceptions.items;
  return {...legend,presentation,statusColors:{missing:layer.options.noDataColor,zero:layer.options.zeroColor,conflict:layer.options.conflictColor}};
}
function buildMainLegend(layer,datasetView,periodId,options={}) {
  options={...options,aggregation:layer.aggregation??options.aggregation};options.spec={...options.spec,aggregation:options.aggregation};
  layer={...layer,type:getRenderer(layer.type).type};
  const bindings=channelBindings(layer.encoding,{includeException:false}),ids=bindings.map(binding=>binding.series_id),views=bindings.map(binding=>channelView(binding,datasetView,options.datasetViews,options.spec));
  datasetView=views[0]??datasetView;
  if(!datasetView||!ids.length)return {type:'empty',items:[]};
  if(layer.type==='bivariateChoropleth')return bivariateLegend(ids,layer,datasetView,periodId,options.aggregation,views,options.spec);
  if(layer.type==='trivariateChoropleth')return ternaryLegend(ids,layer,datasetView,periodId,options.aggregation,options.spec);
  if(layer.type==='alpha')return alphaLegend(ids,layer,datasetView,periodId,options.aggregation,views,options.spec);
  if(layer.type==='proportionalSymbol'||layer.type==='mushroom'){
    const legend=sizeLegend(ids,layer,datasetView,periodId,options.aggregation,options.spec);
    if(layer.type==='proportionalSymbol'){
      const model=symbolColorModel(layer,datasetView,options.datasetViews,{...options.spec,view:{...options.spec?.view,period_id:periodId}});
      if(model){
        const p=layer.presentation,series=model.view.series.get(model.binding.series_id),continuous=['continuous','diverging'].includes(layer.options.colorMode);
        const result=model.category?{items:model.styles}:numericLegend(model.observations,{...layer,options:model.options},model.view,series.id);
        if(continuous){const range=colorExtent(model.domain,model.options);result.items=range.length?Array.from({length:9},(_,index)=>{const value=range[0]+(range[1]-range[0])*index/8;return {label:p.number(value),color:numericColor(value,model.domain,model.options),value,index};}):[];}
        legend.color={type:model.category?'categorical':continuous?'color-ramp':'continuous',items:result.items,label:p.label(series,p.label(model.metric)),unit:p.label(model.view.data.units.find(unit=>unit.id===series.unit_id)),missing:model.missing,missingColor:layer.options.noDataColor};
        legend.label=p.label(datasetView.series.get(ids[0]),p.label(datasetView.metricForSeries(ids[0])));
      }
    }
    return legend;
  }
  if(layer.type==='stripeComposition')return compositionLegend(ids,layer,datasetView,periodId,options.aggregation,options.spec);
  if(['pieChart','waffle','bar','coxcomb'].includes(layer.type)){
    const spec={...options.spec,view:{...options.spec?.view,period_id:periodId},aggregation:options.aggregation};
    const model=compositionModel(layer.type,ids,datasetView,spec,layer.options);
    return {type:'composition',items:model.items,missing:model.missing,zero:model.zero,conflict:model.conflict,mode:model.mode,renderer:layer.type,radarMode:model.radarMode,unit:model.unit,periods:layer.type==='coxcomb'?model.periods:[],maximum:layer.type==='bar'?(layer.options?.maxValue??(model.mode==='stacked'?model.totalMaximum:model.componentMaximum)):layer.type==='coxcomb'?(layer.options?.maxValue??model.totalMaximum):model.totalMaximum,widthMaximum:model.widthMaximum,widthUnit:model.widthUnit,scaleMode:layer.options?.scaleMode??'area',sizeBy:layer.options?.sizeBy,approximate:layer.type==='waffle',sizeLegend:compositionSizeLegend(model,compositionGlyphSize(layer.options,spec.layout))};
  }
  if(layer.type==='sparkline'){
    const model=sparklineModel(datasetView,ids[0],options.spec??{},layer.options);
    return {type:'time',items:[],mode:model.mode,scale:model.scale,domain:model.domain,periods:model.periods,spacing:model.spacing,unit:model.unit,missing:model.missing};
  }
  if(layer.type==='flow'){
    const model=flowModel(datasetView,ids[0],periodId,layer.options,options.spec?.view?.region_ids);
    const keys=new Set([...model.displayEdges.map(edge=>flowDisplayCategory(model,edge)),...(layer.options?.nodeShape==='donut'?[...model.breakdowns.values()].flat().map(group=>group.key):[])]),items=model.top.map(id=>flowCategoryStyle(model,JSON.stringify(['region',id])));
    if(keys.has('other')&&(model.top.length||layer.options?.nodeShape==='donut'))items.push(flowCategoryStyle(model,'other'));
    if(keys.has('mixed'))items.push(flowCategoryStyle(model,'mixed'));
    if(layer.options?.nodeShape==='donut'&&model.filtered.internal>0)items.push(flowCategoryStyle(model,'internal'));
    if(layer.options?.regionColors!==false)for(const [i,key] of ['netExporter','netImporter'].entries())items.push({key,color:(layer.options?.regionColors??['#bbd7ee','#c7e3c6'])[i],label:layer.options?.regionLabels?.[i]??model.presentation.t(key)});
    const nodeMaximum=layer.options?.maxNodeValue??[...model.filtered.nodes.values()].reduce((max,node)=>Math.max(max,node.incoming+node.outgoing+node.internal),0);
    return {type:'flow',reciprocalMode:layer.options?.reciprocalMode??'separate',items,total:model.before.total,filteredTotal:model.filtered.total,internal:model.filtered.internal,crossBoundary:model.filtered.crossBoundary,maximum:model.maximum,minWidth:layer.options?.minWidth??0,maxWidth:layer.options?.maxWidth??12,color:layer.options?.color??'#526b8e',unit:model.unit,missing:model.missing,nodeMaximum,nodeOptions:layer.options??{},showNodes:layer.options?.showNodes!==false};
  }
  const id=ids[0],values=valuesFor(datasetView,id,periodId,options.aggregation,options.spec),metric=datasetView.metricForSeries(id);
  if(metric.value_type==='category'){
    const items=categoryStyles(datasetView,id,layer.options);
    return {type:'categorical',items,missing:values.some(o=>o.status!=='value')};
  }
  const result=numericLegend(values,layer,datasetView,id);
  const continuous=['continuous','diverging'].includes(layer.options?.colorMode);
  if(continuous){const [min,max]=colorExtent(result.domain,layer.options);if(Number.isFinite(min)&&Number.isFinite(max))result.items=Array.from({length:9},(_,index)=>{const value=min+(max-min)*index/8;return {label:valueLabel(value,layer.presentation),color:numericColor(value,result.domain,layer.options),value,index};});}
  return {type:continuous?'color-ramp':'continuous',method:result.domain.method,breaks:result.domain.breaks,items:result.items,texture:layer.options?.texture,missing:result.missing,unit:result.unit};
}
let legendSequence=0;
function compositionNotes(legend,presentation=legend.presentation??createPresentation()){
  const {t,number:n}=presentation;
  return [legend.mode==='radar'?`${t('radar')}: ${t(legend.radarMode==='absolute'?'absoluteScale':'share')}`:null,
    legend.renderer==='bar'?`${t('commonHeight')}: 0 – ${n(legend.maximum)} ${legend.unit??''}`:null,
    legend.widthUnit?`${t('commonWidth')}: 0 – ${n(legend.widthMaximum)} ${legend.widthUnit}`:null,
    legend.renderer==='coxcomb'?`${t(legend.scaleMode==='radius'?'radius':'area')}: 0 – ${n(legend.maximum)} ${legend.unit??''}`:null,
    legend.sizeBy==='total'?`${t('nominalSize')}: ${t('totalMaximum')} ${n(legend.maximum)}`:null,
    legend.approximate?t('approximate'):null,
    (legend.periods?.length??0)>0?legend.periods.map(period=>presentation.label(period,period.id)).join(' → '):null].filter(Boolean);
}
const multiline=(lines,x,y,size=11)=>`<text x="${x}" y="${y}" font-size="${size}" aria-label="${escape(lines.join(' '))}">${lines.map((line,i)=>i?`<tspan x="${x}" dy="${size*1.25}">${escape(line)}</tspan>`:escape(line)).join('')}</text>`;
function legendRows(legend,width=210){
  let y=0;
  const items=(legend.items??[]).map(item=>{const lines=wrapText(item.label,width-30,11),row={item,lines,y};y+=Math.max(18,lines.length*13.75+4);return row;});
  const notes=(legend.type==='composition'?(legend.notes??compositionNotes(legend)):[]).map(note=>{const lines=wrapText(note,width-12,10),row={lines,y};y+=Math.max(18,lines.length*12.5+4);return row;});
  return {items,notes,height:y};
}
function flowLegendLayout(legend,width=210,p=legend.presentation??createPresentation()){
  const values=legend.showNodes?[.25,1].map(ratio=>({value:ratio*legend.nodeMaximum,radius:flowNodeRadius(ratio*legend.nodeMaximum,legend.nodeMaximum,legend.nodeOptions)})):[];
  width=Math.max(width,12+2*Math.max(0,...values.map(value=>value.radius)));
  const texts=[];let y=0;
  const text=(value,size=10)=>{const lines=wrapText(value,width-12,size);texts.push({lines,size,y:y+size});y+=lines.length*size*1.25+5;};
  text(`${p.t(legend.reciprocalMode==='merged'?'routeTotal':'flow')} / ${legend.unit??''}`);
  const widths=[.25,.5,1].map(ratio=>{const value=ratio*legend.maximum,strokeWidth=flowWidth(value,legend.maximum,legend),lines=wrapText(p.number(value),width-57,10),height=Math.max(20,strokeWidth+5,lines.length*12.5+8),row={value,width:strokeWidth,lines,y:y+height/2,labelY:y+(height-lines.length*12.5)/2+10};y+=height;return row;});
  text(`${p.t('beforeFilter')} ${p.number(legend.total)} / ${p.t('afterFilter')} ${p.number(legend.filteredTotal)}`);
  text(`${p.t('crossBoundary')} ${p.number(legend.crossBoundary)} / ${p.t('internal')} ${p.number(legend.internal)}`);
  const nodes=[];
  if(legend.showNodes){
    text(`${p.t('flowNodeSize')} / ${p.t(legend.nodeOptions.nodeSizeScale??'area')}`);
    const maxRadius=Math.max(...values.map(value=>value.radius)),available=width-12;
    if(4*maxRadius+24<=available){
      const rows=values.map(value=>({...value,lines:wrapText(p.number(value.value),available/2-12,10)}));
      rows.forEach((value,i)=>nodes.push({...value,x:(i+.5)*available/2,y:y+maxRadius+4,labelY:y+maxRadius*2+18}));y+=maxRadius*2+24+Math.max(...rows.map(row=>row.lines.length))*12.5;
    }else for(const value of values){const lines=wrapText(p.number(value.value),available,10);nodes.push({...value,lines,x:available/2,y:y+value.radius+4,labelY:y+value.radius*2+18});y+=value.radius*2+24+lines.length*12.5;}
  }
  const categories=legendRows(legend,width);return {width,texts,widths,nodes,categories,categoryY:y,height:y+categories.height};
}
function specialized(legend,options={}){return specializedLegendLayout(legend,options.width??210,options.spec?createPresentation(options.spec):legend.presentation??createPresentation());}
function effectiveWidth(legend,options={}){
  const width=options.width??210;if(!Number.isFinite(width)||width<64)throw new StatsMapError('legend width must be at least 64 pixels','INVALID_LEGEND');
  return specialized(legend,{...options,width})?.width??(legend.type==='flow'?flowLegendLayout(legend,width).width:width);
}
function legendBodyHeight(legend,options={}){return specialized(legend,options)?.height??(legend.type==='flow'?flowLegendLayout(legend,options.width,options.spec?createPresentation(options.spec):undefined).height:legendRows(legend,options.width).height);}
function statusRows(legend,options={}){
  const p=options.spec?createPresentation(options.spec):legend.presentation??createPresentation(options),theme=p.theme;
  let y=legendBodyHeight(legend,options);
  return [legend.missing&&{key:legend.color?null:'missing',label:legend.color?`${p.t('size')}: ${p.t('missing')}`:p.t('missing'),color:legend.statusColors?.missing??theme.noData},legend.zero&&{key:'zero',label:p.t('zero'),color:legend.statusColors?.zero??theme.zero},legend.conflict&&{key:'conflict',label:p.t('conflict'),color:legend.statusColors?.conflict??theme.conflict},...(legend.exceptions??[]).map(item=>({...item,key:`exception:${item.value}`}))].filter(Boolean).map(item=>{const lines=wrapText(item.label,(options.width??210)-30,10),height=Math.max(18,lines.length*12.5+4),row={...item,lines,y,height};y+=height;return row;});
}
export function legendHeight(legend,options={}){options={...options,width:effectiveWidth(legend,options)};return legendBodyHeight(legend,options)+statusRows(legend,options).reduce((sum,row)=>sum+row.height,0);}
export function measureLegend(legend,options={}){
  const width=effectiveWidth(legend,options),plan=specialized(legend,{...options,width});
  const titleHeight=options.title?wrapText(options.title,width-12,12).length*15+3:0;
  const contentHeight=legendHeight(legend,{...options,width});
  return {width,height:contentHeight+titleHeight+18,contentHeight,titleHeight,bodyHeight:plan?.height??legendBodyHeight(legend,{...options,width}),boxes:plan?.boxes??[]};
}
export function legendSvg(legend,x=12,y=20,namespace,options={}){
  const p=options.spec?createPresentation(options.spec):legend?.presentation??createPresentation(options),{t,theme}=p,valueLabel=p.number;
  const prefix=Array.from(String(namespace??`legend-${++legendSequence}`),c=>c.codePointAt(0).toString(16)).join('-');
  if(!legend||legend.type==='empty')return '';
  const wrap=(key,label,svg)=>key&&options.layerId&&options.interactive!==false&&(['continuous','categorical','bivariate','alpha','composition'].includes(legend.type)||legend.color||key.startsWith('exception:'))?`<g role="button" tabindex="0" data-legend-key="${escape(key)}" aria-label="${escape(label)}" aria-pressed="${options.filter?.includes(key)??false}" style="cursor:pointer">${svg}</g>`:svg;
  const measured=measureLegend(legend,options),width=measured.width,titleLines=options.title?wrapText(options.title,width-12,12):[],titleHeight=measured.titleHeight;
  options={...options,width};const plan=specialized(legend,options);
  let out=`<g class="stats-map-legend" direction="ltr" role="group" aria-label="${escape(options.title??t('legend'))}"${options.layerId?` data-legend-layer-id="${escape(options.layerId)}"`:''} transform="translate(${x} ${y})" font-family="${escape(theme.fontFamily)}" fill="${theme.text}">${options.background===false?'':`<rect data-legend-background="true" x="-6" y="-14" width="${width}" height="${legendHeight(legend,options)+titleHeight+18}" rx="3" fill="${theme.background}" fill-opacity="0.94" pointer-events="none"/>`}${options.title?`<g font-weight="600">${multiline(titleLines,0,0,12)}</g><g transform="translate(0 ${titleHeight})">`:'<g>'}`;
  if(plan){
    out+=specializedLegendSvg(plan,legend,p,wrap);
  }else if(legend.type==='flow'){
    const layout=flowLegendLayout(legend,width,p);
    for(const row of layout.texts)out+=multiline(row.lines,0,row.y,row.size);
    for(const row of layout.widths)out+=`<line x1="0" x2="35" y1="${row.y}" y2="${row.y}" stroke="${escape(legend.color??theme.accent)}" stroke-width="${row.width}"/>${multiline(row.lines,45,row.labelY,10)}`;
    for(const node of layout.nodes)out+=`<circle cx="${node.x}" cy="${node.y}" r="${node.radius}" fill="none" stroke="${escape(legend.color)}"/><g text-anchor="middle">${multiline(node.lines,node.x,node.labelY,10)}</g>`;
    for(const row of layout.categories.items)out+=`<rect x="0" y="${layout.categoryY+row.y}" width="12" height="12" fill="${escape(row.item.color)}"/>`+multiline(row.lines,18,layout.categoryY+row.y+10,11);
  }else{
    const rows=legendRows(legend,width);
    for(const [i,{item,lines,y}] of rows.items.entries()){const pattern=classificationTexture(`legend-texture-${prefix}-${i}`,i,rows.items.length,{texture:legend.texture});if(pattern)out+=`<defs>${pattern.definition}</defs>`;out+=wrap(legendItemKey(legend,item),item.label,`<rect x="0" y="${y}" width="12" height="12" fill="${pattern?.fill??item.color}"/>${multiline(lines,18,y+10)}`);}
    for(const row of rows.notes)out+=multiline(row.lines,0,row.y+10,10);
  }
  for(const row of statusRows(legend,options))out+=wrap(row.key,row.label,`<rect x="0" y="${row.y}" width="12" height="12" fill="${escape(row.color)}" stroke="${theme.border}"/>${multiline(row.lines,18,row.y+10,10)}`);
  return out+'</g></g>';
}
