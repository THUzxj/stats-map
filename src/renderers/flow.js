import { createPresentation } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { escapeSvg as esc } from './composition.js';
import { sector } from './primitives.js';
import { flowLayout, flowRibbon, validateFlowOptions } from './flow-layout.js';
import { flowDisplayEdges } from './flow-routes.js';
import { compareFlowIds, flowBreakdowns, flowDisplayCategory, flowCategoryStyle } from './flow-categories.js';
import { wrapText, placeLabels } from '../components/text-layout.js';

function summarize(edges) {
  const nodes=new Map();let total=0,internal=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,incoming:0,outgoing:0,internal:0});return nodes.get(id);};
  for(const edge of edges){
    const source=node(edge.origin_region_id),target=node(edge.destination_region_id);total+=edge.value;
    if(source===target){source.internal+=edge.value;internal+=edge.value;}else {source.outgoing+=edge.value;target.incoming+=edge.value;}
  }
  return {nodes,total,internal,crossBoundary:total-internal};
}

export function flowModel(view,seriesId,periodId,options={},regionIds) {
  validateFlowOptions(options);
  const presentation=createPresentation(options,view.geography);
  const mode=options.mode??'curved';
  if(!['curved','straight','sankey'].includes(mode)||!['circle','donut',undefined].includes(options.nodeShape))throw new StatsMapError('unsupported flow mode or nodeShape','INVALID_ENCODING');
  if(view.metricForSeries(seriesId).value_type!=='number')throw new StatsMapError('flow requires a numeric relation series','INVALID_ENCODING');
  const observations=view.relations(seriesId,periodId),all=observations.filter(edge=>edge.status==='value').sort((a,b)=>compareFlowIds(a.id,b.id));
  if(all.some(edge=>!Number.isFinite(edge.value)||edge.value<0))throw new StatsMapError('flow values must be finite and non-negative','UNSUPPORTED_VALUE');
  const before=summarize(all),regions=regionIds?new Set(regionIds):null;
  const scoped=all.filter(edge=>!regions||regions.has(edge.origin_region_id)&&regions.has(edge.destination_region_id));
  const score=node=>options.topLocationsType==='origin'?node.outgoing:options.topLocationsType==='destination'?node.incoming:node.incoming+node.outgoing;
  const ranked=[...summarize(scoped).nodes.values()].sort((a,b)=>score(b)-score(a)||compareFlowIds(a.id,b.id));
  const count=options.topLocations;
  if(count!=null&&(!Number.isInteger(count)||count<0))throw new StatsMapError('topLocations must be a non-negative integer','INVALID_ENCODING');
  if(!Number.isFinite(options.minValue??0)||(options.minValue??0)<0||!Number.isFinite(options.maxValue??0)||(options.maxValue??0)<0||!Number.isFinite(options.maxWidth??12)||(options.maxWidth??12)<0||!Number.isFinite(options.maxNodeRadius??12)||(options.maxNodeRadius??12)<0)throw new StatsMapError('flow scales require non-negative finite values','INVALID_ENCODING');
  const top=count?new Set(ranked.slice(0,count).map(node=>node.id)):null;
  const edges=scoped.filter(edge=>edge.value>=(options.minValue??0)&&(!top||options.filterTopLocations===false||top.has(edge.origin_region_id)||top.has(edge.destination_region_id))&&(options.showInternal!==false||edge.origin_region_id!==edge.destination_region_id)).sort((a,b)=>compareFlowIds(a.id,b.id));
  const filtered=summarize(edges),displayEdges=flowDisplayEdges(edges,options.reciprocalMode),maximum=options.maxValue??displayEdges.reduce((maximum,edge)=>Math.max(maximum,edge.value),0);
  const model={presentation,labels:new Map([...view.regions].map(([id,region])=>[id,presentation.label(region,id)])),edges,edgeIndex:new Map(edges.map(edge=>[edge.id,edge])),displayEdges,observations,mode,before,filtered,maximum,options,seriesId,periodId,top:[...(top??[])],missing:observations.some(edge=>edge.status!=='value'),unit:presentation.label(view.data.units.find(unit=>unit.id===view.series.get(seriesId)?.unit_id))};
  model.breakdowns=flowBreakdowns(model);return model;
}

export function flowSvg(model,anchors,namespace='flow',labelLayout={}) {
  const {options,mode}=model,safe=Array.from(String(namespace),character=>character.codePointAt(0).toString(16)).join('-');
  const layout=flowLayout(model,anchors),marker=`flow-${safe}-arrow`;
  const color=esc(options.color??'#526b8e'),opacity=options.opacity??1;
  let definitions='',body='';
  const visibleNodes=[...model.filtered.nodes.values()].filter(node=>layout.nodes.has(node.id));
  for(const [index,edge] of layout.edges.entries()){
    const category=flowDisplayCategory(model,edge),routeColor=esc(flowCategoryStyle(model,category).color);
    const color=routeColor,endColor=model.top.length?routeColor:esc(options.endColor??'#de7e49');
    const gradientColor=model.top.length&&options.gradient?esc((options.regionColors===false?null:options.regionColors?.[0])??'#bbd7ee'):color;
    edge.category_key=category;
    const identity=edge.route_id?`data-flow-route-id="${esc(edge.route_id)}" data-route-endpoint-region-ids="${esc(JSON.stringify(edge.endpoint_region_ids))}" data-source-relation-ids="${esc(JSON.stringify(edge.source_relation_ids))}"`:`data-relation-id="${esc(edge.id)}" data-origin-region-id="${esc(edge.origin_region_id)}" data-destination-region-id="${esc(edge.destination_region_id)}"`;
    const a=edge.start,b=edge.end,arrowId=`${marker}-${index}`,attrs=`${identity} data-flow-category="${esc(category)}" data-value="${edge.value}" data-period-id="${esc(model.periodId)}" data-series-id="${esc(model.seriesId)}"`;
    let fill=color;
    if(edge.arrow_size>0){const size=edge.arrow_size;definitions+=`<marker id="${arrowId}" markerWidth="${size}" markerHeight="${size}" refX="0" refY="${size/2}" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L${size} ${size/2}L0 ${size}Z" fill="${options.gradient?endColor:color}"/></marker>`;}
    if(!edge.route_id&&(options.gradient||options.opacityGradient)){
      const gradient=`flow-${safe}-gradient-${index}`;
      definitions+=`<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"><stop offset="0" stop-color="${gradientColor}" stop-opacity="${options.opacityGradient?.25:1}"/><stop offset="1" stop-color="${options.gradient?endColor:color}" stop-opacity="1"/></linearGradient>`;
      fill=`url(#${gradient})`;
    }
    const pointedTip=!edge.route_id&&options.arrows!==false;
    const ribbonOptions={...options,widthGradient:!edge.route_id&&options.widthGradient,pointedTip};
    const ribbon=mode==='sankey'||options.widthGradient||((edge.self||edge.coincident)&&options.arrows!==false),path=ribbon?flowRibbon(edge.points,edge.width,ribbonOptions):edge.path;
    edge.render_path=path;edge.ribbon=Boolean(ribbon);
    if(options.outline&&edge.width>0){
      const outlineWidth=options.outlineWidth??1,outlinePath=ribbon?flowRibbon(edge.points,edge.width,{...ribbonOptions,extraPad:outlineWidth}):path;
      body+=`<path ${attrs} data-flow-outline="true" aria-hidden="true" d="${outlinePath}" fill="${ribbon?esc(options.outlineColor??'#fff'):'none'}"${ribbon?'':` stroke="${esc(options.outlineColor??'#fff')}" stroke-width="${edge.width+outlineWidth*2}"`} opacity="${opacity}" pointer-events="none"/>`;
    }
    const title=`${model.labels.get(edge.origin_region_id)??edge.origin_region_id} ${edge.route_id?'↔':'→'} ${model.labels.get(edge.destination_region_id)??edge.destination_region_id}: ${edge.route_id?model.presentation.t('routeTotal')+' / ':''}${model.presentation.number(edge.value)} ${model.unit??''}`;
    // Zero remains an empty statistical mark. Identity is retained for export;
    // no visible outline, arrow, or accidental SVG hairline represents zero.
    body+=`<path ${attrs} d="${path}" fill="${ribbon?fill:'none'}"${ribbon?'':` stroke="${fill}" stroke-width="${edge.width}"`}${!ribbon&&edge.arrow_size>0?` marker-end="url(#${arrowId})"`:''} opacity="${opacity}"${edge.width===0?' pointer-events="none"':''}><title>${esc(title)}</title></path>`;
  }
  if(options.showNodes!==false&&layout.stack)for(const node of layout.nodes.values())for(const side of ['left','right']){
    const ports=node[side].filter(port=>port.edge.width>0);if(!ports.length)continue;
    const x=node.x+(side==='left'?-1:1)*(node.radius+(options.nodeGap??1)),lo=ports.reduce((low,port)=>Math.min(low,port.interval[0]),Infinity),hi=ports.reduce((high,port)=>Math.max(high,port.interval[1]),-Infinity);
    body+=`<path data-region-id="${esc(node.id)}" data-flow-stem="${side}" aria-hidden="true" pointer-events="none" d="M${x},${lo}L${x},${hi}" stroke="${color}" fill="none"/>`;
  }
  if(options.showNodes!==false)for(const node of visibleNodes){
    const {x,y,radius:r}=layout.nodes.get(node.id),total=node.incoming+node.outgoing+node.internal;
    const title=`<title>${esc(model.labels.get(node.id)??node.id)} / ${esc(model.presentation.t('incoming'))}: ${esc(model.presentation.number(node.incoming))}; ${esc(model.presentation.t('outgoing'))}: ${esc(model.presentation.number(node.outgoing))}; ${esc(model.presentation.t('internal'))}: ${esc(model.presentation.number(node.internal))}</title>`;
    if(options.nodeShape==='donut'){
      let at=-Math.PI/2;
      for(const group of model.breakdowns.get(node.id)??[]){
        const {value,color:fill,channel}=group;
        const end=at+value/(total||1)*Math.PI*2;
        const details=group.source_relation_ids.map(id=>{const edge=model.edgeIndex.get(id);return `${id}: ${model.presentation.number(edge.value)}${edge.evidence?' / '+JSON.stringify(edge.evidence):''}${edge.source_flag?' / '+edge.source_flag:''}`;}).join('; ');
        if(value>0)body+=`<path data-region-id="${esc(node.id)}" data-flow-channel="${channel}" data-flow-category="${esc(group.key)}" data-period-id="${esc(model.periodId)}" data-series-id="${esc(model.seriesId)}" data-value="${value}" data-source-relation-ids="${esc(JSON.stringify(group.source_relation_ids))}" d="${sector(x,y,r*.5,r,at,end)}" fill-rule="evenodd" fill="${esc(fill)}"><title>${esc(model.labels.get(node.id)??node.id)} / ${esc(model.presentation.t(channel))} / ${esc(group.label)}: ${esc(model.presentation.number(value))} ${esc(model.unit)} / ${esc(details)}</title></path>`;at=end;
      }
    }else body+=`<circle data-region-id="${esc(node.id)}" data-incoming="${node.incoming}" data-outgoing="${node.outgoing}" data-internal="${node.internal}" cx="${x}" cy="${y}" r="${r}" fill="${model.presentation.theme.background}" stroke="${color}">${title}</circle>`;
  }
  const labels=new Map();
  if(options.nodeLabels){
    const config=options.nodeLabels===true?{}:options.nodeLabels,fontSize=config.fontSize??11,offset=config.offset??[3,0];
    const candidates=visibleNodes.map(node=>{const point=layout.nodes.get(node.id),value=node.incoming+node.outgoing+node.internal,text=config.content==='value'?model.presentation.number(value):config.content==='name-value'?`${model.labels.get(node.id)}: ${model.presentation.number(value)}`:model.labels.get(node.id)??node.id;return {id:node.id,x:point.x+point.radius+offset[0],y:point.y+offset[1],fontSize,anchor:'start',text,lines:wrapText(text,config.maxWidth??120,fontSize),priority:value};});
    const routeObstacles=layout.edges.filter(edge=>edge.width>0).flatMap(edge=>edge.points.slice(1).map((point,i)=>{const previous=edge.points[i],pad=edge.width/2;return {x:Math.min(point[0],previous[0])-pad,y:Math.min(point[1],previous[1])-pad,width:Math.abs(point[0]-previous[0])+pad*2,height:Math.abs(point[1]-previous[1])+pad*2};}));
    const obstacles=[...(labelLayout.obstacles??[]),...routeObstacles,...[...layout.nodes.values()].map(node=>({x:node.x-node.radius,y:node.y-Math.max(node.radius,node.span/2),width:node.radius*2,height:Math.max(node.radius*2,node.span)}))];
    const placed=placeLabels(candidates,{width:labelLayout.width??Infinity,height:labelLayout.height??Infinity,obstacles,mode:config.collision??'avoid',maxOffset:config.maxOffset??40,step:config.step??10});
    for(const [id,label] of placed){labels.set(id,label);if(!label.visible){layout.diagnostics.push({code:'FLOW_LABEL_COLLISION',region_ids:[id]});continue;}body+=`<text data-flow-label="${esc(id)}" pointer-events="none" x="${label.x}" y="${label.y}" font-size="${fontSize}" font-family="${esc(model.presentation.theme.fontFamily)}" fill="${esc(model.presentation.theme.text)}">${label.lines.map((line,i)=>`<tspan x="${label.x}" dy="${i?fontSize*1.25:0}">${esc(line)}</tspan>`).join('')}</text>`;}
  }
  layout.labels=labels;
  return {body,definitions,diagnostics:layout.diagnostics,renderedTotal:layout.edges.reduce((sum,edge)=>sum+edge.value,0),layout};
}
