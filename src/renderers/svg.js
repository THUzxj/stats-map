import { resolveView } from '../core/view.js';
import { createPresentation, presentedLayer } from '../core/presentation.js';
import { geometryPath as pathFor } from './geometry-path.js';
import { numericColor, categoryStyles, classificationTexture, bivariateClassification } from './color.js';
import { channelBindings, channelView, channelValues } from '../core/channels.js';
import { legendFilterAttributes } from '../core/legend-filter.js';
import { accessibleTargets } from '../components/accessibility.js';
import { exceptionModel, exceptionSymbol } from './exceptions.js';
import { flowModel, flowSvg } from './flow.js';
import { flowNetStyle } from './flow-categories.js';
import { ternaryModel } from './ternary.js';
import { compositionModel, compositionSymbolSvg, compositionCollisionRadius, compositionGlyphSize } from './composition-symbols.js';
import { sparklineModel, sparklineSvg, sparklineCollisionRadius } from './temporal.js';
import { symbolScale, symbolShapeSvg, symbolCollisionRadius, assertComparablePair, mushroomShapeSvg } from './symbols.js';
import { symbolColorModel } from './symbol-color.js';
import { compositionFor, stripePattern } from './composition.js';
import { getRenderer } from './registry.js';
import { resolveAnchors, fitProjection, projectPoint } from '../core/geometry.js';
import { classifyDomain } from '../core/classification.js';
import { alphaScale } from './math.js';
import { geometryHasCoordinates } from '../core/anchors.js';
import { RendererFrame } from './protocol.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette=['#2166ac','#67a9cf','#d1e5f0','#f7f7f7','#ef8a62','#b2182b','#74add1','#fdae61','#d73027'];
export function renderSvg(options) {
 const frame=new RendererFrame(options,renderBuiltinSvg);
 try{return frame.result;}finally{frame.dispose();}
}
export function stageSvg(transaction,options) {return transaction.stage(options,renderBuiltinSvg);}
function renderBuiltinSvg({geography,datasetView,datasetViews,spec,layer,viewport={width:800,height:600},projection,selection=[],selectionOverlay=false,layoutPositions=null,layoutType='geographic',namespace='stats-map',labelObstacles=[],anchorResolution,measureCollisions=false}){
 spec=resolveView(spec,geography);
 const presentation=createPresentation(spec,geography);layer=presentedLayer({...layer,type:getRenderer(layer.type).type},presentation);
 const filter=spec.view?.legend_filters?.[layer.id];
 spec={...spec,aggregation:layer.aggregation??spec.aggregation};
 const renderer=getRenderer(layer.type),enc=layer.encoding??{},bindings=channelBindings(enc,{includeException:false}),seriesIds=bindings.map(binding=>binding.series_id),primary=seriesIds[0];
 const p=projection??fitProjection(geography,viewport,{...spec.layout,regionIds:spec.view?.region_ids}),period=spec.view?.period_id;
 const views=bindings.map(binding=>channelView(binding,datasetView,datasetViews,spec));
 datasetView=views[0]??datasetView;
 const exceptions=exceptionModel(layer,datasetView,datasetViews,spec);
 const visibleIds=new Set(spec.view?.region_ids??geography.regions.map(region=>region.id));
 const observations=index=>new Map(channelValues(views[index]??datasetView,bindings[index]?.series_id??seriesIds[index],period,spec.aggregation).filter(value=>visibleIds.has(value.region_id)).map(value=>[value.region_id,value]));
 const values=observations(0),secondary=observations(1),domain=classifyDomain([...values.values()].filter(x=>x.status==='value'&&typeof x.value==='number').map(x=>x.value),renderer.type==='bivariateChoropleth'?bivariateClassification(layer,0):layer.classification?.axes?.[0]??layer.classification??{}),ids=new Set(spec.view?.region_ids??geography.regions.map(r=>r.id)),selected=new Set(selectionOverlay?[]:selection);let body='',definitions='';
 const secondaryDomain=classifyDomain([...secondary.values()].filter(value=>value.status==='value'&&typeof value.value==='number').map(value=>value.value),renderer.type==='bivariateChoropleth'?bivariateClassification(layer,1):layer.classification?.axes?.[1]??layer.classification??{});
 const alphaValues=[...secondary.values()].filter(value=>value.status==='value'&&typeof value.value==='number').map(value=>value.value),alphaMin=alphaValues.reduce((min,value)=>Math.min(min,value),Infinity),alphaMax=alphaValues.reduce((max,value)=>Math.max(max,value),-Infinity);
 if(renderer.type==='alpha')for(const [id,value] of values)if(secondary.get(id)?.status!=='value')values.set(id,{...value,status:'missing',value:null});
 const ternary=renderer.type==='trivariateChoropleth'?ternaryModel(seriesIds,datasetView,spec,layer.options):null;
 const categories=renderer.type==='categorical'?categoryStyles(datasetView,primary,layer.options):null;
 const diagnostics=[];
 const surface=['choropleth','categorical','bivariateChoropleth','trivariateChoropleth','alpha','stripeComposition'].includes(renderer.type);
 const surfaceFeatures=layoutPositions?[...layoutPositions.keys()].map(id=>({properties:{role:'region',region_id:id}})):geography.features.features??[];
 if(surface&&!layoutPositions){const represented=new Set(surfaceFeatures.filter(f=>f.properties?.role==='region'&&geometryHasCoordinates(f.geometry)).map(f=>f.properties.region_id));for(const id of ids)if(!represented.has(id))diagnostics.push({code:'MISSING_GEOMETRY',region_id:id});}
 if(surface)for(const f of surfaceFeatures){const id=f.properties?.region_id;if(f.properties?.role!=='region'||!ids.has(id))continue;const o=values.get(id),valid=o?.status==='value',cls=valid&&typeof o.value==='number'?domain.classify(o.value):null;let legendKey=renderer.type==='categorical'&&valid?'category:'+o.value:cls==null?'missing':'class:'+cls;let fill=valid?(renderer.type==='categorical'?(categories.find(item=>item.value===o.value)?.color??'#e5e7eb'):['choropleth','alpha'].includes(renderer.type)?numericColor(o.value,domain,layer.options):palette[(cls??0)%palette.length]):layer.options.noDataColor,opacity='',statusAttribute='';if(ternary)fill=ternary.color(ternary.values.get(id))??layer.options.noDataColor;if(renderer.type==='bivariateChoropleth'){const a=cls,b=secondary.get(id)?.status==='value'?secondaryDomain.classify(secondary.get(id).value):null;fill=a==null||b==null?layer.options.noDataColor:(layer.options.bivariateColors??palette)[(a*3+b)%palette.length];legendKey=a==null||b==null?'missing':`bivariate:${a}:${b}`;}if(renderer.type==='alpha')opacity=secondary.get(id)?.status==='value'?` fill-opacity="${alphaScale(secondary.get(id).value,alphaMin,alphaMax,layer.options?.opacity)}"`:'';if(renderer.type==='stripeComposition'){const composition=compositionFor(seriesIds,datasetView,id,period,layer.options,spec.aggregation),patternId='stripe-'+[namespace,layer.id??renderer.type,id].map(value=>Array.from(String(value),c=>c.codePointAt(0).toString(16)).join('-')).join('_'),pattern=stripePattern(composition,patternId,{...layer.options,legendFilter:filter});legendKey=composition.status==='value'?null:composition.status==='incomplete'?'missing':composition.status;definitions+=pattern.definition;fill=pattern.fill;statusAttribute=` data-composition-status="${composition.status}"`;}if(renderer.type==='choropleth'&&valid&&cls!=null){const pattern=classificationTexture('texture-'+Array.from(namespace+'-'+id,c=>c.codePointAt(0).toString(16)).join('-'),cls,domain.classes,layer.options);if(pattern){definitions+=pattern.definition;fill=pattern.fill;}}if(renderer.type==='trivariateChoropleth')legendKey=null;const exception=!valid?exceptions?.style(id):null;if(exception){fill=exception.color;legendKey='exception:'+exception.value;statusAttribute+=` data-exception="${esc(exception.value)}"`;}statusAttribute+=legendFilterAttributes(legendKey,filter);const stroke=selected.has(id)?presentation.theme.selection:(layer.options?.stroke??'#555'),sw=selected.has(id)?2.5:(layer.options?.strokeWidth??0.5),lp=layoutPositions?.get(id);if(lp){if(layoutType==='dorling')body+=`<circle data-region-id="${esc(id)}" cx="${lp.x}" cy="${lp.y}" r="${lp.surfaceRadius??lp.radius}" fill="${fill}"${opacity}${statusAttribute} stroke="${stroke}" stroke-width="${sw}"/>`;else if(lp.shape==='hexagon'){const pts=Array.from({length:6},(_,i)=>`${lp.x+Math.cos(i*Math.PI/3)*lp.size/2},${lp.y+Math.sin(i*Math.PI/3)*lp.size/2}`).join(' ');body+=`<polygon data-region-id="${esc(id)}" points="${pts}" fill="${fill}"${opacity}${statusAttribute} stroke="${stroke}" stroke-width="${sw}"/>`;}else body+=`<rect data-region-id="${esc(id)}" x="${lp.x-lp.size/2}" y="${lp.y-lp.size/2}" width="${lp.size}" height="${lp.size}" fill="${fill}"${opacity}${statusAttribute} stroke="${stroke}" stroke-width="${sw}"/>`;}else if(f.geometry.type==='Point'){const q=projectPoint(f.geometry.coordinates,p);body+=`<circle data-region-id="${esc(id)}" cx="${q[0]}" cy="${q[1]}" r="${layer.options?.radius??5}" fill="${fill}"${opacity}${statusAttribute} stroke="${stroke}" stroke-width="${sw}"/>`;}else body+=`<path data-region-id="${esc(id)}" d="${pathFor(f.geometry,p)}" fill-rule="evenodd" fill="${fill}"${opacity}${statusAttribute} stroke="${stroke}" stroke-width="${sw}"/>`;}
 const resolved=anchorResolution??resolveAnchors(geography,{policy:spec.anchor_policy,regionIds:[...ids]});
 const anchors=layoutPositions?new Map([...layoutPositions].map(([id,p])=>[id,[p.x,p.y]])):new Map([...resolved.anchors].map(([id,a])=>[id,projectPoint(a.point,p)]));
 if(!layoutPositions&&['proportionalSymbol','mushroom','pieChart','coxcomb','waffle','bar','sparkline'].includes(renderer.type))diagnostics.push(...resolved.diagnostics);
 const symbolNumbers=[...values.values(),...(renderer.type==='mushroom'?[...secondary.values()]:[])].filter(o=>o?.status==='value'&&typeof o.value==='number').map(o=>o.value);
 const scale=['proportionalSymbol','mushroom'].includes(renderer.type)?symbolScale(symbolNumbers,renderer.type==='mushroom'?{...layer.options,shape:'circle',scaleMode:'area'}:layer.options):null;
 const symbolColor=renderer.type==='proportionalSymbol'?symbolColorModel(layer,datasetView,datasetViews,spec):null;
 if(renderer.type==='mushroom')assertComparablePair(datasetView,seriesIds);
 const composition=['pieChart','coxcomb','waffle','bar'].includes(renderer.type)?compositionModel(renderer.type,seriesIds,datasetView,spec,{...layer.options,legendFilter:filter}):null;
 const spark=renderer.type==='sparkline'?sparklineModel(datasetView,primary,spec,layer.options):null;
 const collisionRadii=new Map();
 const reserve=(id,radius)=>{if(measureCollisions)collisionRadii.set(id,Math.max(collisionRadii.get(id)??0,radius));};
 if(surface&&layoutPositions)for(const [id,position] of layoutPositions)reserve(id,position.surfaceRadius??position.radius??position.size/2);
 for(const [id,q] of anchors){if(!ids.has(id))continue;const x=q[0],y=q[1],size=composition?compositionGlyphSize(layer.options,spec.layout):layer.options?.size??layer.options?.radius??layoutPositions?.get(id)?.glyphSize??(layoutPositions?.get(id)?.radius??18)*2;
   const exception=exceptions?.style(id),numeric=values.get(id)?.status==='value';
   if(exception&&(renderer.type==='proportionalSymbol'&&!numeric||renderer.type==='pieChart'&&composition.compositions.get(id)?.get(composition.periods[0]?.id)?.status==='incomplete')){body+=exceptionSymbol(exception,id,x,y,layer.options?.exceptions,filter);reserve(id,Math.SQRT2*(layer.options?.exceptions?.radius??6));continue;}
   if(scale){
     const primary=values.get(id),v=primary?.status==='value'?primary.value:null,r=scale.radius(v),attributes=`data-symbol-region-id="${esc(id)}"${renderer.type==='proportionalSymbol'&&exceptions?legendFilterAttributes('numeric',filter):''}`;
     if(renderer.type==='mushroom'){
       const other=secondary.get(id),v2=other?.status==='value'?other.value:null;
       body+=mushroomShapeSvg(x,y,[r,scale.radius(v2)],{...layer.options,components:[{id:seriesIds[0],value:v,period},{id:seriesIds[1],value:v2,period}]},attributes);
       reserve(id,Math.max(r??0,scale.radius(v2)??0,v==null||v2==null?2.5:0));
     }else if(r!=null){const style=symbolColor?.style(id),symbolOptions=style?{...layer.options,fill:style.color}:layer.options;const colorAttributes=style?` data-color-status="${esc(style.status)}"${legendFilterAttributes(style.key,filter)}`:'';body+=symbolShapeSvg(scale.shape,x,y,r,symbolOptions,`data-symbol-region-id="${esc(id)}"${colorAttributes}${!style&&exceptions?legendFilterAttributes('numeric',filter):''}`);if(measureCollisions)reserve(id,symbolCollisionRadius(scale.shape,r,symbolOptions));}
   }
 if(composition){body+=compositionSymbolSvg(composition,id,x,y,size);if(measureCollisions)reserve(id,compositionCollisionRadius(composition,id,size));}
 if(spark){body+=sparklineSvg(spark,id,x,y,size);if(measureCollisions)reserve(id,sparklineCollisionRadius(spark,id,size));}
 }
 const markerId=`${String(namespace).replace(/[^A-Za-z0-9_-]/g,'-')}-arrow-${String(layer.id??renderer.type).replace(/[^A-Za-z0-9_-]/g,'-')}`;
 let flowSummary,flowLayout;
 if(renderer.type==='flow'&&datasetView&&period){
   const model=flowModel(datasetView,layer.encoding?.relation_series_id??primary,period,layer.options,spec.view?.region_ids),flow=flowSvg(model,anchors,namespace,{...viewport,obstacles:labelObstacles});
   if(measureCollisions)for(const [id,node] of flow.layout.nodes){
     reserve(id,node.radius);
     if(flow.layout.stack){
       // Displacement can move every neighbour to the same side. Reserve the
       // entire incident stack before solving, independently of anchor order.
       const ports=[...node.left,...node.right],positive=ports.filter(port=>port.edge.width>0);
       const span=positive.reduce((sum,port)=>sum+port.edge.width,0)+(model.options.stackGap??0)*Math.max(0,positive.length-1);
       if(ports.length)reserve(id,Math.hypot(node.radius+(model.options.nodeGap??1),span/2));
     }
     for(const edge of flow.layout.edges)if(edge.origin_region_id===id&&edge.destination_region_id===id){
       const width=model.options.widthGradient?Math.max(edge.width,model.options.widthGradientSettings?.minStartWidth??0):edge.width;
       const outline=model.options.outline?(model.options.outlineWidth??1):0;
       for(const point of edge.points)reserve(id,Math.hypot(point[0]-node.x,point[1]-node.y)+width/2+outline);
     }
   }
   if(layoutPositions)for(const [id,cell] of layoutPositions){
     const style=flowNetStyle(model,id);if(!ids.has(id)||!style)continue;
     reserve(id,cell.surfaceRadius??cell.radius??cell.size/2);
     const attrs=`data-region-id="${esc(id)}" data-flow-net="${style.key}" data-net-value="${style.value}" fill="${esc(style.color)}" stroke="${esc(selected.has(id)?presentation.theme.selection:presentation.theme.regionStroke)}" stroke-width="${selected.has(id)?2.5:.5}"`;
     if(layoutType==='dorling')body+=`<circle ${attrs} cx="${cell.x}" cy="${cell.y}" r="${cell.surfaceRadius??cell.radius}"/>`;
     else if(cell.shape==='hexagon')body+=`<polygon ${attrs} points="${Array.from({length:6},(_,i)=>[cell.x+Math.cos(i*Math.PI/3)*cell.size/2,cell.y+Math.sin(i*Math.PI/3)*cell.size/2].join(',')).join(' ')}"/>`;
     else body+=`<rect ${attrs} x="${cell.x-cell.size/2}" y="${cell.y-cell.size/2}" width="${cell.size}" height="${cell.size}"/>`;
   }
   if(!layoutPositions)for(const feature of geography.features.features??[]){
     const id=feature.properties?.region_id,style=flowNetStyle(model,id);
     if(feature.properties?.role!=='region'||!ids.has(id)||!style||!['Polygon','MultiPolygon'].includes(feature.geometry?.type))continue;
     body+=`<path data-region-id="${esc(id)}" data-flow-net="${style.key}" data-net-value="${style.value}" d="${pathFor(feature.geometry,p)}" fill-rule="evenodd" fill="${esc(style.color)}" stroke="${esc(selected.has(id)?presentation.theme.selection:presentation.theme.regionStroke)}" stroke-width="${selected.has(id)?2.5:.5}"/>`;
   }
   flowLayout=flow.layout;body+=flow.body;definitions+=flow.definitions;diagnostics.push(...flow.diagnostics);flowSummary={total:model.before.total,filteredTotal:model.filtered.total,renderedTotal:flow.renderedTotal,internal:model.filtered.internal,crossBoundary:model.filtered.crossBoundary};
 }
 body=accessibleTargets(body,geography,layer,spec,datasetView,datasetViews);
 // SVG's default miter limit can extend a sharp join by twice its stroke width.
 if(measureCollisions)for(const [id,radius] of collisionRadii)collisionRadii.set(id,radius+Math.max(1,layer.options?.strokeWidth??1)*2);
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}" viewBox="0 0 ${viewport.width} ${viewport.height}" data-renderer="${renderer.type}"><defs>${definitions}<marker id="${markerId}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#555"/></marker></defs>${body}</svg>`,projection:p,domain,diagnostics,flowSummary,flowLayout,collisionRadii,anchors:layoutPositions?[...anchors].map(([region_id,point])=>({region_id,role:'symbol',point,method:'layout',version:1,coordinate_space:'screen',layout_type:layoutType})):[...resolved.anchors.values()]};
}
