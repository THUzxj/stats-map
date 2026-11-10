import { resolveView } from '../core/view.js';
import { channelView } from '../core/channels.js';
import { mapTarget } from '../core/interaction-events.js';
import { targetChannels } from '../core/target-data.js';
import { createPresentation, presentedLayer } from '../core/presentation.js';
import { getRenderer } from '../renderers/registry.js';
import { sparklineModel, sparklineSvg } from '../renderers/temporal.js';
import { flowModel } from '../renderers/flow.js';
import { compositionFor, escapeSvg } from '../renderers/composition.js';
import { StatsMapError } from '../core/errors.js';
import { styleControl } from './control-style.js';

let sequence=0;
export function buildTooltip(map,target) {
  if(!target)return null;
  const spec=resolveView(map.insetViews?.find(view=>view.id===target.inset_id)?.spec??map.spec,map.geography);
  const layer=spec.layers.find(layer=>layer.id===target.layer_id);
  if(!layer||layer.tooltip===false||spec.interaction?.tooltip===false)return null;
  const p=createPresentation(spec,map.geography),period_id=target.period_id??spec.view?.period_id;
  let identity={...target,period_id};const channels=targetChannels(map,identity),route=channels.find(channel=>channel.route)?.route;
  const description=map.describe?.(identity);
  if(description)return {target:identity,title:description.title,rows:description.rows??[],channels,derived:description.derived,chart:description.chart};
  const breakdown=channels.find(channel=>channel.flow_breakdown)?.flow_breakdown;
  if(target.flow_channel&&!breakdown)return null;
  if(breakdown)identity={...identity,value:breakdown.value,source_relation_ids:[...breakdown.source_relation_ids]};
  if(target.route_id){if(!route)return null;identity={...identity,endpoint_region_ids:[...route.endpoint_region_ids],source_relation_ids:[...route.source_relation_ids],value:route.value};}
  const region=id=>p.label(map.geography.regions.find(region=>region.id===id),id??'');
  const title=route?route.endpoint_region_ids.map(region).join(' ↔ '):target.relation_id?`${region(target.origin_region_id)} → ${region(target.destination_region_id)}`:region(target.region_id);
  const rows=[],flowNode=!target.ranking&&getRenderer(layer.type).type==='flow'&&!target.relation_id&&!target.route_id;
  for(const channel of channels){
    if(!channel.series)continue;
    const {observation,metric,unit,series}=channel,status=observation?.status??'missing';
    const view=channelView(channel,null,map._views,spec),category=metric.value_type==='category'?view.data.dimensions?.find(d=>d.id===metric.category_dimension_id)?.values.find(item=>item.id===observation?.value):null;
    const value=status==='value'?(category?p.label(category,String(observation.value)):p.number(observation.value)):p.t(status);
    if(channel.route){
      const selected=new Set(channel.route.source_relation_ids);
      rows.push({label:p.t('routeTotal'),value:p.number(channel.route.value)+' '+p.label(unit)});
      for(const relation of channel.registered_relations)rows.push({label:`${region(relation.origin_region_id)} → ${region(relation.destination_region_id)} / ${relation.id} / ${p.t(selected.has(relation.id)?'displayed':'excluded')}`,value:relation.status==='value'?p.number(relation.value)+' '+p.label(unit):p.t(relation.status)});
    }else if(flowNode){
      const model=flowModel(view,series.id,period_id,presentedLayer(layer,p).options,spec.view?.region_ids),before=model.before.nodes.get(target.region_id),after=model.filtered.nodes.get(target.region_id);
      for(const [label,node] of [[p.t('beforeFilter'),before],[p.t('afterFilter'),after]])for(const name of ['incoming','outgoing','internal'])rows.push({label:`${p.label(series,p.label(metric,series.id))} / ${label} / ${p.t(name)}`,value:p.number(node?.[name]??0)+' '+p.label(unit)});
      const registered=model.observations.filter(edge=>edge.origin_region_id===target.region_id||edge.destination_region_id===target.region_id);rows.push({label:p.t('coverage'),value:p.number(registered.filter(edge=>edge.status==='value').length)+' / '+p.number(registered.length)});
      for(const group of model.breakdowns.get(target.region_id)??[])rows.push({label:`${p.t('afterFilter')} / ${p.t(group.channel)} / ${group.label}`,value:p.number(group.value)+' '+p.label(unit)});
      if(channel.flow_breakdown)for(const edge of channel.relations)rows.push({label:`${region(edge.origin_region_id)} → ${region(edge.destination_region_id)} / ${edge.id}`,value:p.number(edge.value)+' '+p.label(unit)});
    }else if(channel.relation_slice){
      const slice=channel.relation_slice;
      rows.push({label:`${region(slice.origin_region_id)} → ${region(slice.destination_region_id)} / ${slice.source_relation_ids.join(', ')}`,value:status==='value'?value+' '+p.label(unit):value});
      if(slice.excluded_reason)rows.push({label:p.t('excluded')+' / '+slice.excluded_reason,value:slice.reported_status==='value'?p.number(slice.reported_value):p.t(slice.reported_status??'missing')});
    }else rows.push({label:(channel.channel?p.t(channel.channel)+': ':'')+p.label(series,p.label(metric,series.id)),value:status==='value'?`${value}${p.label(unit)?' '+p.label(unit):''}`:value});
    rows.push({label:p.t('unit'),value:p.label(unit,series.unit_id)});
    rows.push({label:p.t('time'),value:p.label(channel.period,period_id??'')});
    rows.push({label:p.t('scope'),value:p.label(channel.scope,channel.scope?.description??channel.scope_id??'')});
    rows.push({label:p.t('measureType'),value:p.t(channel.measure_type??'unspecified')},{label:p.t('reviewStatus'),value:p.t(channel.review_status??'unspecified')});
    const coverage=channel.coverage;
    if(coverage)rows.push({label:p.t('coverage'),value:`${p.number(coverage.present)} / ${p.number(coverage.expected)}${coverage.completeness==='partial'?' / '+p.t('partial'):''}`});
    if(observation?.numerator!=null||coverage?.commonCoverage!=null){const ratio=coverage??observation;rows.push({label:p.t('numerator'),value:ratio.numerator==null?p.t('missing'):p.number(ratio.numerator)},{label:p.t('denominator'),value:ratio.denominator==null?p.t('missing'):p.number(ratio.denominator)});}
    if(observation?.source_flag!=null)rows.push({label:p.t('sourceFlag'),value:String(observation.source_flag)});
    if(series.source_status!=null)rows.push({label:p.t('sourceFlag'),value:typeof series.source_status==='string'?series.source_status:JSON.stringify(series.source_status)});
    for(const source of channel.sources)rows.push({label:p.t('source'),value:p.label(source,source.id??'')});
    const evidence=channel.route?channel.registered_relations:channel.flow_breakdown?channel.relations:flowNode?view.relations(series.id,period_id).filter(edge=>edge.origin_region_id===target.region_id||edge.destination_region_id===target.region_id):coverage?.observations??[observation];
    for(const item of evidence){
      if(item?.evidence)rows.push({label:p.t('evidence')+(channel.route||flowNode?' / '+item.id:''),value:JSON.stringify(item.evidence)});
      if(item?.source_flag!=null&&item!==observation)rows.push({label:p.t('sourceFlag')+(channel.route||flowNode?' / '+item.id:''),value:String(item.source_flag)});
    }
    rows.push({label:p.t('dataset'),value:`${channel.dataset_ref.id} @ ${channel.dataset_ref.revision}`});
  }
  let derived=route??breakdown??channels.find(channel=>channel.relation_slice)?.relation_slice??null;
  if(target.series_id==='__other__'&&channels.length){
    const view=channelView(channels[0],null,map._views,spec),ids=channels.filter(channel=>!channel.auxiliary).map(channel=>channel.series_id),composition=compositionFor(ids,view,target.region_id,period_id,layer.options,layer.aggregation??spec.aggregation);
    derived={type:'remainder',value:composition.other,total:composition.total,components:composition.values};
    rows.unshift({label:p.t('other'),value:composition.other==null?p.t('missing'):p.number(composition.other)+' '+p.label(channels[0].unit)});
  }
  if(Number.isFinite(target.share))rows.push({label:p.t('share'),value:p.number(target.share,{style:'percent',maximumFractionDigits:2})});
  let chart=null;
  if(!target.ranking&&getRenderer(layer.type).type==='sparkline'&&channels[0]){
    const view=channelView(channels[0],null,map._views,spec),model=sparklineModel(view,channels[0].series_id,{...spec,aggregation:layer.aggregation??spec.aggregation},{...layer.options,interactive:false});
    rows.push({label:p.t(model.scale==='local'?'localAxis':'sharedAxis'),value:model.regionDomain(target.region_id).map(value=>p.number(value)).join(' – ')+' '+model.unit},{label:p.t('time'),value:p.t(model.spacing==='time'?'timeSpacing':'orderedSpacing')});
    chart={svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 160" width="280" height="160" role="img" aria-label="${escapeSvg(p.t('time'))}"><g transform="translate(-140 0) scale(2 1)">${sparklineSvg(model,target.region_id,140,80,130)}</g></svg>`,periods:model.periods.map((period,index)=>({period_id:period.id,label:p.label(period),value:model.values.get(target.region_id)?.[index]??null,position:model.positions[index]})),domain:model.regionDomain(target.region_id),spacing:model.spacing,unit:model.unit};
  }
  return {target:identity,title,rows:rows.filter(row=>row.value!==''&&row.value!=null),channels,derived,chart};
}

// Owned overlay is attached outside the SVG so re-rendering the map cannot
// destroy the panel, steal focus, or put transient UI into exported images.
export class Tooltip {
  constructor(map){
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    this.map=map;this.id=`stats-map-tooltip-${++sequence}`;this.destroyed=false;this.model=null;
    this.disposers=[map.on('render',()=>this.refresh()),map.on('destroy',()=>this.destroy())];
  }
  mount(container){
    if(this.destroyed)throw new StatsMapError('tooltip is destroyed','LIFECYCLE');
    this.unmount();const document=container.ownerDocument;if(!document?.createElement||!document.body)return this;
    this.container=container;this.element=document.createElement('div');this.element.id=this.id;this.element.setAttribute('data-stats-map-tooltip',this.map.instanceId);this.element.setAttribute('role','tooltip');this.element.hidden=true;document.body.appendChild(this.element);
    this.move=event=>{if(event.pointerType==='touch'||this.pinned||this.map.drag||this.map.touchGestures?.active)return;this.showTarget(event.target,event);};
    // Native touch focus precedes click. Opening an overlay during focus can
    // cover the finger position and retarget that click to BODY in Chrome.
    this.focus=event=>{if(Date.now()<(this.touchFocusUntil??0))return;this.pinned=false;this.showTarget(event.target);};
    this.click=event=>{this.touchFocusUntil=0;if(this.map.touchGestures?.suppressClick())return this.hide();this.pinned=event.pointerType==='touch'||event.sourceCapabilities?.firesTouchEvents===true;this.showTarget(event.target,event);};
    this.down=event=>{this.touchFocusUntil=event.pointerType==='touch'?Date.now()+600:0;this.hide();};
    this.leave=event=>{this.dismissedTarget=null;if(this.pinned||this.element.contains(event.relatedTarget))return;this.scheduleHide();};
    this.blur=()=>queueMicrotask(()=>{if(!this.destroyed&&!this.container?.contains(document.activeElement)&&!this.element?.contains(document.activeElement))this.hide();});
    this.escape=event=>{this.touchFocusUntil=0;if(event.key==='Escape'&&this.model&&(container.contains(event.target)||this.element.contains(event.target))){this.dismissedTarget=JSON.stringify(this.identity);this.hide();event.stopPropagation();event.preventDefault();}};
    this.dismiss=event=>{if(!container.contains(event.target)&&!this.element.contains(event.target))this.hide();};
    this.panelLeave=event=>{if(!this.pinned&&!container.contains(event.relatedTarget))this.hide();};
    this.scroll=event=>{if(event.target?.nodeType&&this.element.contains(event.target))return;if(this.focused&&document.activeElement===this.active&&this.model){this.focusPosition();this.draw();}else this.hide();};
    this.panelEnter=()=>{clearTimeout(this.hideTimer);this.hideTimer=null;};
    for(const [name,handler] of [['pointerdown',this.down],['pointermove',this.move],['focusin',this.focus],['click',this.click],['pointerleave',this.leave],['focusout',this.blur]])container.addEventListener(name,handler);
    this.element.addEventListener('pointerenter',this.panelEnter);this.element.addEventListener('pointerleave',this.panelLeave);document.addEventListener('keydown',this.escape,true);document.addEventListener('pointerdown',this.dismiss,true);document.defaultView?.addEventListener('resize',this.scroll);document.addEventListener('scroll',this.scroll,true);
    return this;
  }
  showTarget(element,event){
    clearTimeout(this.hideTimer);this.hideTimer=null;
    if(element?.closest?.('[data-filtered="true"],[data-legend-layer-id]'))return this.hide();
    const target=mapTarget(element);if(!target){this.dismissedTarget=null;return event?.type==='pointermove'?this.scheduleHide():this.hide();}
    target.inset_id=element.closest?.('[data-inset-id]')?.getAttribute('data-inset-id')??null;
    if(event?.type==='pointermove'&&this.dismissedTarget===JSON.stringify(target))return;this.dismissedTarget=null;
    this.identity=target;
    const node=element.closest('[data-flow-route-id],[data-relation-id],[data-component-index],[data-region-id],[data-symbol-region-id]');
    this.active?.removeAttribute('aria-describedby');this.active=node;
    this.focused=!event;this.focusPosition();if(event&&Number.isFinite(event.clientX))this.position={x:event.clientX,y:event.clientY};
    this.model=buildTooltip(this.map,target);this.draw();this.refresh();
  }
  refresh(){
    if(!this.model||!this.container)return;
    const identity=this.identity;
    const match=[...this.container.querySelectorAll('[data-flow-route-id],[data-relation-id],[data-region-id],[data-symbol-region-id]')].find(node=>{
      const target=mapTarget(node);return target&&['kind','layer_id','region_id','relation_id','route_id','series_id','component_index','period_id','flow_channel','flow_category','ranking','dataset_id'].every(key=>(target[key]??null)===(identity[key]??null))&&(node.closest('[data-inset-id]')?.getAttribute('data-inset-id')??null)===(identity.inset_id??null)&&!node.closest('[data-filtered="true"]');
    });
    if(!match)return this.hide();
    this.active=match;if(this.focused)this.focusPosition();this.model=buildTooltip(this.map,{...mapTarget(match),inset_id:identity.inset_id,period_id:match.getAttribute('data-period-id')??this.map.spec.view?.period_id});this.draw();
  }
  focusPosition(){const rect=this.active?.getBoundingClientRect();if(rect)this.position={x:rect.left+rect.width/2,y:rect.top+rect.height/2};}
  draw(){
    if(!this.element)return;if(!this.model)return this.hide();
    const p=createPresentation(this.map.spec,this.map.geography),document=this.element.ownerDocument;
    this.element.replaceChildren();styleControl(this.element,p);Object.assign(this.element.style,{position:'fixed',zIndex:'10000',boxSizing:'border-box',width:'320px',maxWidth:'calc(100vw - 16px)',maxHeight:'calc(100vh - 16px)',overflow:'auto',padding:'12px',border:'1px solid '+p.theme.border,borderRadius:'4px',fontSize:'13px',lineHeight:'1.5',overflowWrap:'anywhere',boxShadow:'0 3px 12px #0004'});
    const heading=document.createElement('strong');heading.textContent=this.model.title;this.element.appendChild(heading);
    for(const row of this.model.rows){const line=document.createElement('div');line.textContent=`${row.label}: ${row.value}`;this.element.appendChild(line);}
    if(this.model.chart){const chart=document.createElement('div');chart.innerHTML=this.model.chart.svg;this.element.appendChild(chart);const table=document.createElement('div');for(const point of this.model.chart.periods){const row=document.createElement('div');row.setAttribute('data-tooltip-period',point.period_id);if(point.period_id===this.model.target.period_id)row.style.fontWeight='bold';row.textContent=`${point.label}: ${point.value==null?p.t('missing'):p.number(point.value)}`;table.appendChild(row);}this.element.appendChild(table);}
    this.element.hidden=false;this.active?.setAttribute('aria-describedby',this.id);
    const view=document.defaultView,rect=this.element.getBoundingClientRect(),position=this.position??{x:8,y:8};
    this.element.style.left=Math.max(8,Math.min(position.x+12,view.innerWidth-rect.width-8))+'px';
    this.element.style.top=Math.max(8,Math.min(position.y+12,view.innerHeight-rect.height-8))+'px';
  }
  scheduleHide(){clearTimeout(this.hideTimer);this.hideTimer=setTimeout(()=>this.hide(),160);}
  hide(){clearTimeout(this.hideTimer);this.hideTimer=null;this.active?.removeAttribute('aria-describedby');this.active=null;this.model=null;this.pinned=false;if(this.element)this.element.hidden=true;}
  unmount(){
    this.hide();if(this.container){const document=this.container.ownerDocument;for(const [name,handler] of [['pointerdown',this.down],['pointermove',this.move],['focusin',this.focus],['click',this.click],['pointerleave',this.leave],['focusout',this.blur]])this.container.removeEventListener(name,handler);document.removeEventListener('keydown',this.escape,true);document.removeEventListener('pointerdown',this.dismiss,true);document.defaultView?.removeEventListener('resize',this.scroll);document.removeEventListener('scroll',this.scroll,true);this.element.removeEventListener('pointerenter',this.panelEnter);this.element.removeEventListener('pointerleave',this.panelLeave);this.element.remove();}this.container=null;this.element=null;return this;
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.unmount();for(const dispose of this.disposers)dispose();this.disposers=[];}
}
