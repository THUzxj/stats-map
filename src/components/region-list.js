import { viewRegionIds } from '../core/view.js';
import { geometryStatus } from '../core/geometry.js';
import { channelBindings, channelView } from '../core/channels.js';
import { createPresentation } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { styleControl } from './control-style.js';

// The list includes statistical identities even when their shapes or anchors
// are unavailable. Geometry availability never substitutes for value status.
export function buildRegionList(map,options={}) {
  const p=createPresentation(map.spec,map.geography),ids=[...new Set(options.regionIds??viewRegionIds(map.geography,map.spec))],regions=new Map(map.geography.regions.map(region=>[region.id,region]));
  const layers=options.layerId?map.spec.layers.filter(layer=>layer.id===options.layerId):map.spec.layers;
  if(!layers.length)throw new StatsMapError('region list references an unknown layer','INVALID_ARGUMENT');
  const bindings=[...new Map(layers.flatMap(layer=>channelBindings(layer.encoding,{includeException:false})).map(binding=>[JSON.stringify([binding.dataset_id,binding.series_id,binding.relation_slice]),binding])).values()];
  const geometry=new Map(geometryStatus(map.geography,{policy:map.spec.anchor_policy,regionIds:ids}).regions.map(row=>[row.region_id,row])),periodId=options.periodId??map.spec.view?.period_id;
  return {period_id:periodId,rows:ids.map(id=>{
    if(!regions.has(id))throw new StatsMapError(`region list references unknown region: ${id}`,'INVALID_ARGUMENT');
    const availability=geometry.get(id),notes=[!availability.has_boundary?p.t('noBoundary'):null,!availability.has_symbol_anchor?p.t('noAnchor'):null].filter(Boolean);
    const channels=bindings.map(binding=>{
      const view=channelView(binding,null,map._views,map.spec),series=view?.series.get(binding.series_id),metric=series?view.metricForSeries(series.id):null;
      const observation=series?view.observation(series.id,id,periodId):null,unit=view?.data.units.find(unit=>unit.id===series?.unit_id),category=metric?.value_type==='category'?view.data.dimensions?.find(d=>d.id===metric.category_dimension_id)?.values.find(item=>item.id===observation?.value):null;
      const status=observation?.status??'missing',value=status==='value'?(category?p.label(category,String(observation.value)):p.number(observation.value)):p.t(status),sources=series?.source_refs?.length?(view.data.sources??[]).filter(source=>series.source_refs.includes(source.id)):view?.data.sources??[];
      return {...binding,dataset_ref:view?{id:view.data.id,revision:view.data.revision}:null,observation,unit,scope_id:series?.scope_id,measure_type:series?.measure_type,review_status:series?.review_status,sources,text:[p.label(series,p.label(metric)),...(observation?.relation_slice?[`${p.label(regions.get(observation.relation_slice.origin_region_id))} → ${p.label(regions.get(observation.relation_slice.destination_region_id))}`,observation.relation_slice.source_relation_ids.join(', ')]:[]),`${value}${status==='value'?' '+p.label(unit):''}`,p.label(view?.periods.get(periodId),periodId??''),...sources.map(source=>p.label(source,source.id??''))].filter(Boolean).join(' / ')};
    });
    return {region_id:id,label:p.label(regions.get(id),id),geometry:availability,channels,notes};
  })};
}

export class RegionList {
  constructor(map,options={}) {
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    this.map=map;this.options=options;this.destroyed=false;this.model=buildRegionList(map,options);
    this.disposers=[map.on('render',()=>this.render()),map.on('destroy',()=>this.destroy())];
  }
  mount(container) {
    if(this.destroyed)throw new StatsMapError('region list is destroyed','LIFECYCLE');this.unmount();this.container=container;
    this.click=event=>{const row=event.target?.closest?.('[data-list-region]');if(row)this.map.activateRegion(row.getAttribute('data-list-region'),{source:'region-list'});};
    this.focus=event=>{if(this.rendering)return;const row=event.target?.closest?.('[data-list-region]');if(row)this.map.hover(row.getAttribute('data-list-region'),'region-list');};
    this.leave=()=>{if(this.rendering)return;queueMicrotask(()=>{if(!this.destroyed&&!this.container?.contains(this.container.ownerDocument.activeElement))this.map.hover(null,'region-list');});};
    for(const [name,handler] of [['click',this.click],['focusin',this.focus],['pointerover',this.focus],['focusout',this.leave],['pointerleave',this.leave]])container.addEventListener(name,handler);
    this.render();return this;
  }
  render() {
    if(this.destroyed||this.rendering)return this.model;
    try{this.model=buildRegionList(this.map,this.options);}catch(error){this.model={rows:[],error:{code:error.code??'INVALID_ARGUMENT',message:error.message}};}if(!this.container)return this.model;
    const p=createPresentation(this.map.spec,this.map.geography),document=this.container.ownerDocument,focused=this.container.contains(document.activeElement)?document.activeElement.getAttribute?.('data-list-region'):null;
    const signature=JSON.stringify([this.model,p.locale,p.theme,[...this.map.selection]]);
    if(this.signature===signature){
      for(const button of this.container.querySelectorAll('[data-list-region]')){const id=button.getAttribute('data-list-region');button.style.background=this.map.selection.has(id)?p.theme.selectedBackground:this.map.hoveredRegionId===id?p.theme.hoverBackground:p.theme.background;}
      return this.model;
    }
    this.signature=signature;
    this.rendering=true;
    try {
      const list=document.createElement('ul');list.setAttribute('aria-label',this.options.title??p.t('regionList'));list.setAttribute('lang',p.locale);list.setAttribute('dir',p.direction);list.style.listStyle='none';list.style.padding='0';
      for(const row of this.model.rows){
        const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.setAttribute('data-list-region',row.region_id);button.setAttribute('aria-pressed',String(this.map.selection.has(row.region_id)));button.textContent=[row.label,...row.channels.map(channel=>channel.text),...row.notes].join(' / ');styleControl(button,p);
        button.style.textAlign='start';button.style.background=this.map.selection.has(row.region_id)?p.theme.selectedBackground:this.map.hoveredRegionId===row.region_id?p.theme.hoverBackground:p.theme.background;
        item.appendChild(button);list.appendChild(item);
      }
      if(this.model.error){const note=document.createElement('li');note.textContent=this.model.error.message;list.appendChild(note);}
      this.container.replaceChildren(list);
      if(focused)for(const button of list.querySelectorAll('[data-list-region]'))if(button.getAttribute('data-list-region')===focused){button.focus();break;}
    } finally {this.rendering=false;}
    return this.model;
  }
  unmount(){if(this.container){for(const [name,handler] of [['click',this.click],['focusin',this.focus],['pointerover',this.focus],['focusout',this.leave],['pointerleave',this.leave]])this.container.removeEventListener(name,handler);this.container.replaceChildren();}this.container=null;this.signature=null;return this;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.unmount();for(const dispose of this.disposers)dispose();this.disposers=[];}
}
