import { viewRegionIds } from './view.js';
import { channelBindings, channelView } from './channels.js';
import { createPresentation } from './presentation.js';
import { Tooltip } from '../components/tooltip.js';
import { savedGridPositions } from '../layouts/saved-grid.js';
import { TouchGestures } from './gestures.js';
import { rememberFocus, restoreFocus } from '../components/focus.js';
import { rankingSvg } from '../components/ranking.js';
import { resolveProfile } from './profile.js';
import { decorationSvg, geographicBackgroundSvg, graticuleSvg, referenceSvg, selectionSvg, escapeSvg } from '../components/decorations.js';
import { renderInsets, insetHitTest } from '../components/insets.js';
import { dispatchMapTarget } from './interaction-events.js';
import { svgPngBlob } from '../components/raster.js';
import { validateBundle, validateGeography, validateDataset, validateMapSpec } from './validate.js';
import { DatasetView } from './dataset.js';
import { stageSvg } from '../renderers/svg.js';
import { RendererTransaction } from '../renderers/protocol.js';
import { hitTest, fitProjection } from './geometry.js';
import { StatsMapError } from './errors.js';
import { getRenderer } from '../renderers/registry.js';
import { buildLegend, legendSvg, measureLegend } from '../components/legend.js';
import { placeLegendPanels } from '../components/legend-panels.js';
import { exportObservations, exportRelations, exportRelationSlice, exportSpec as serializeSpec, svgDocument } from '../components/export.js';
import { MapState } from './state.js';
import { capabilities as inspectCapabilities } from './capabilities.js';
import { loadBundle } from './loader.js';
import { resolveScreenLayout, prepareDorling, dorlingPositions, layoutHitTest } from '../layouts/resolve.js';
import { dorlingLayout } from '../layouts/dorling.js';
import { DorlingSimulation } from '../layouts/dorling-controller.js';
import { anchorIndex, resolveAnchors, geometryStatus, normalizeAnchorPolicy } from './geometry.js';
import { comparisonDomains } from '../components/comparison.js';

let instanceSequence = 0;
function key(r) { return `${r.kind}:${r.id}@${r.revision}`; }
function projectionOptions(spec,geography) { return {...(spec.layout??{}),regionIds:geography?viewRegionIds(geography,spec):spec.view?.region_ids}; }
function normalizeLayerRoles(spec) { return {...spec,layers:(spec.layers??[]).map(layer=>layer.role?layer:{...layer,role:getRenderer(layer.type).defaultRole})}; }
function eventBus() { const listeners=new Map(); return {on(name,fn){if(typeof fn!=='function')return()=>{};const a=listeners.get(name)??[];a.push(fn);listeners.set(name,a);return()=>{const i=a.indexOf(fn);if(i>=0)a.splice(i,1);}},off(name,fn){const a=listeners.get(name)??[];const i=a.indexOf(fn);if(i>=0)a.splice(i,1);},emit(name,p){for(const fn of [...(listeners.get(name)??[])])try{fn(p)}catch{}},clear(){listeners.clear();}}; }

export function inlineResources(bundle) { validateBundle(bundle); const map=new Map(); for(const e of bundle.resources)if(e.storage==='inline')map.set(key(e.resource),e.resource); const specRef={kind:'stats-map/spec',...bundle.spec_ref}; const spec=map.get(key(specRef))??map.get(key(bundle.spec_ref)); if(!spec)throw new StatsMapError(`missing spec ${bundle.spec_ref.id}`,'MISSING_RESOURCE'); const geo=map.get(key({kind:'stats-map/geography',...spec.geography_ref})); if(!geo)throw new StatsMapError(`missing geography ${spec.geography_ref.id}`,'MISSING_RESOURCE'); const datasets=new Map(); for(const r of spec.dataset_refs){const d=map.get(key({kind:'stats-map/dataset',...r}));if(!d)throw new StatsMapError(`missing dataset ${r.id}`,'MISSING_RESOURCE');datasets.set(r.id,d);} return {bundle,spec,geography:geo,datasets,resources:map}; }

export class MapFrame {
  constructor(bundle, options={}) { const loaded=inlineResources(bundle);loaded.spec=normalizeLayerRoles(resolveProfile({...loaded.spec,...(options.locale!=null?{locale:options.locale,view:{...loaded.spec.view,locale:options.locale}}:{}),...(options.theme!=null?{theme:options.theme}:{})})); validateGeography(loaded.geography); for(const d of loaded.datasets.values())validateDataset(d,loaded.geography); validateMapSpec(loaded.spec,loaded.geography,new Map([...loaded.datasets].map(([id,d])=>[`stats-map/dataset:${id}@${d.revision}`,d]))); this.instanceId=`stats-map-${++instanceSequence}`;this.bundle=bundle;this.spec=loaded.spec;this.geography=loaded.geography;this.datasets=loaded.datasets;this.options=options;this.viewport={width:options.width??800,height:options.height??600};this.projection=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));this.events=eventBus();this.events.on('regionhover',payload=>{const id=payload.region_id??null;if(this.hoveredRegionId===id)return;this.hoveredRegionId=id;this.render();});this.state=new MapState({bundle_ref:{id:bundle.id,revision:bundle.revision},spec_ref:{id:this.spec.id,revision:this.spec.revision},selection:[]});this.selection=new Set();this.groups=[];this.destroyed=false;this.lastRender=null;this.dorlingSimulation=new DorlingSimulation(this.spec.layout?.dorling??this.spec.layout??{});this.dorlingPositions=null;this.dorlingKey=null;this._views=new Map([...this.datasets].map(([id,d])=>[id,new DatasetView(d,this.geography)])); if(options.container)try{this.mount(options.container);}catch(error){this.destroy();throw error;} }
  mount(container){if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');if(this.container&&this.container!==container)this.unmount();this.container=container;if(this.options.touch!==false&&!this.touchGestures)this.touchGestures=new TouchGestures(this,container);if(!this.domHandlers){const onClick=e=>{if(!this.touchGestures?.suppressClick())dispatchMapTarget(this,e,'click');};const onHover=e=>{if(e.pointerType!=='touch'&&!this.touchGestures?.active)dispatchMapTarget(this,e,'hover');};const onFocus=e=>dispatchMapTarget(this,e,'focus');const onMove=e=>{if(e.pointerType==='touch'){this.touchGestures?.move(e);return;}if(!this.drag)return;this.projection={...this.projection,translate:[this.drag.translate[0]+e.clientX-this.drag.x,this.drag.translate[1]+e.clientY-this.drag.y]};this._emitTransform('gesture');this.render();};const onDown=e=>{if(e.pointerType==='touch'){this.touchGestures?.down(e);return;}if(e.target?.closest?.('[data-inset-id],[data-inset-toggle]'))return;if(e.button!==1&&!e.altKey)return;this.drag={x:e.clientX,y:e.clientY,translate:[...this.projection.translate]};e.preventDefault();};const onUp=e=>{if(e?.pointerType==='touch')this.touchGestures?.up(e);else this.touchGestures?.cancel();this.drag=null;};const onWheel=e=>{e.preventDefault();const point=this._eventPoint(e),inset=e.target?.closest?.('[data-inset-id]')?.getAttribute('data-inset-id');this.zoomAt(point,e.deltaY<0?1.15:1/1.15,inset); };const onKey=e=>{if(['Enter',' '].includes(e.key)&&e.target?.closest?.('[data-inset-toggle]')){const id=e.target.closest('[data-inset-toggle]').getAttribute('data-inset-toggle');this.toggleInset(id);e.preventDefault();for(const element of container.querySelectorAll?.('[data-inset-toggle]')??[])if(element.getAttribute('data-inset-toggle')===id)element.focus?.();return;}const legend=e.target?.closest?.('[data-legend-layer-id]'),item=e.target?.closest?.('[data-legend-key]');if(legend&&item&&['Enter',' ','Escape'].includes(e.key)){const layerId=legend.getAttribute('data-legend-layer-id'),key=item.getAttribute('data-legend-key');if(e.key==='Escape')this.setLegendFilter(layerId,null,{source:'keyboard'});else dispatchMapTarget(this,e,'click');e.preventDefault();for(const element of container.querySelectorAll?.('[data-legend-layer-id] [data-legend-key]')??[])if(element.getAttribute('data-legend-key')===key&&element.closest('[data-legend-layer-id]').getAttribute('data-legend-layer-id')===layerId){element.focus?.();break;}return;}if(['Enter',' '].includes(e.key)&&e.target?.closest?.('[data-region-id],[data-symbol-region-id],[data-relation-id],[data-flow-route-id]')){const target=e.target,regionId=target.getAttribute('data-region-id')??target.getAttribute('data-symbol-region-id'),relationId=target.getAttribute('data-relation-id');dispatchMapTarget(this,e,'click');e.preventDefault();return;}if(e.target!==container&&/input|textarea|select/i.test(e.target?.tagName??''))return;if(e.key==='Escape'){this.setSelection([],{source:'keyboard'});e.preventDefault();}if(e.key==='Home'){this.projection=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));this.render();e.preventDefault();}};this.domHandlers={onClick,onHover,onMove,onDown,onUp,onWheel,onKey,onFocus};container.setAttribute?.('tabindex','0');container.addEventListener?.('click',onClick);container.addEventListener?.('focusin',onFocus);container.addEventListener?.('pointermove',onHover);container.addEventListener?.('pointerdown',onDown);container.ownerDocument?.addEventListener?.('pointermove',onMove);container.ownerDocument?.addEventListener?.('pointerup',onUp);container.ownerDocument?.addEventListener?.('pointercancel',onUp);container.ownerDocument?.defaultView?.addEventListener?.('blur',onUp);container.addEventListener?.('wheel',onWheel,{passive:false});container.addEventListener?.('keydown',onKey);}
    if(this.options.responsive&&!this.resizeObserver){
      const Observer=this.options.ResizeObserver??container.ownerDocument?.defaultView?.ResizeObserver??globalThis.ResizeObserver;
      if(Observer){this.resizeObserver=new Observer(entries=>{if(this.destroyed||!this.container)return;const rect=entries.find(entry=>entry.target===this.container)?.contentRect;if(!rect||rect.width<=0||rect.height<=0||rect.width===this.viewport.width&&rect.height===this.viewport.height)return;const transform=this.getViewTransform();this.viewport={...this.viewport,width:rect.width,height:rect.height};this.setViewTransform(transform,{source:'resize'});});this.resizeObserver.observe(container);}
    }
    if(!this.motionQuery){const match=this.options.matchMedia??container.ownerDocument?.defaultView?.matchMedia?.bind(container.ownerDocument.defaultView)??globalThis.matchMedia;if(match){this.motionQuery=match('(prefers-reduced-motion: reduce)');this.motionHandler=()=>{if(this.spec.interaction?.reducedMotion==null||this.spec.interaction.reducedMotion==='auto')this.render();};this.motionQuery.addEventListener?.('change',this.motionHandler);}}
    if(!this.tooltip){this.tooltip=new Tooltip(this);this.tooltip.mount(container);}
    return this.render();}

  on(name,fn){return this.events.on(name,fn)}
  off(name,fn){return this.events.off?.(name,fn)}
  _change(patch,committed){
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    const previous=Object.fromEntries(Object.keys(patch).map(key=>[key,this[key]]));
    Object.assign(this,patch);let result;
    try{result=this.render({notify:false});}catch(error){Object.assign(this,previous);throw error;}
    committed?.();
    if(!this.destroyed&&this.lastRender===result)this.events.emit('render',{svg:result.svg});
    return result;
  }
  setViewport(value){const viewport={...this.viewport,...value};return this._change({viewport,projection:fitProjection(this.geography,viewport,projectionOptions(this.spec,this.geography))},()=>this.state.set({viewport:{...viewport}},'viewport'));}
  setSpec(spec){
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    spec=normalizeLayerRoles(resolveProfile(spec));
    validateMapSpec(spec,this.geography,this.datasets);
    const refit=JSON.stringify(projectionOptions(this.spec,this.geography))!==JSON.stringify(projectionOptions(spec,this.geography)),projection=refit?fitProjection(this.geography,this.viewport,projectionOptions(spec,this.geography)):this.projection;
    return this._change({drag:null,spec,projection},()=>{this.state.set({spec_ref:{id:spec.id,revision:spec.revision}},'spec');this.events.emit('specchange',spec);});
  }
  setBundle(bundle){
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    const next=new MapFrame(bundle,{width:this.viewport.width,height:this.viewport.height});
    try{return this._change({bundle:next.bundle,spec:next.spec,geography:next.geography,datasets:next.datasets,_views:new Map(next._views),projection:next.projection,selection:new Set(),groups:[]},()=>{this.state.set({bundle_ref:{id:bundle.id,revision:bundle.revision},spec_ref:{id:this.spec.id,revision:this.spec.revision},selection:[]},'bundle');this.events.emit('bundlechange',{id:bundle.id,revision:bundle.revision});});}finally{next.destroy();}
  }
  setData(dataset, geography=this.geography){
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    if(dataset?.kind!=='stats-map/dataset')throw new StatsMapError('setData expects a stats-map dataset','INVALID_RESOURCE');
    validateGeography(geography);validateDataset(dataset,geography);
    const previousId=this.datasets.has(dataset.id)?dataset.id:this.datasets.size===1?[...this.datasets.keys()][0]:null;
    if(previousId==null)throw new StatsMapError('setData must identify an existing dataset in a multi-dataset map','UNKNOWN_DATASET');
    const rebind=encoding=>Object.fromEntries(Object.entries(encoding??{}).map(([name,value])=>[name,name==='dataset_id'&&value===previousId?dataset.id:value&&typeof value==='object'&&!Array.isArray(value)?rebind(value):value]));
    const datasets=new Map([...this.datasets].map(([id,value])=>id===previousId?[dataset.id,dataset]:[id,value]));
    const spec={...this.spec,geography_ref:{id:geography.id,revision:geography.revision},dataset_refs:[...datasets.values()].map(value=>({id:value.id,revision:value.revision})),layers:this.spec.layers.map(layer=>({...layer,encoding:rebind(layer.encoding)})),...(this.spec.aggregation?{aggregation:{...this.spec.aggregation,dataset_id:this.spec.aggregation.dataset_id===previousId?dataset.id:this.spec.aggregation.dataset_id}}:{})};
    for(const value of datasets.values())validateDataset(value,geography);
    validateMapSpec(spec,geography,datasets);
    const views=new Map([...datasets].map(([id,value])=>[id,new DatasetView(value,geography)]));
    const projection=fitProjection(geography,this.viewport,projectionOptions(spec,geography));
    return this._change({drag:null,geography,datasets,_views:views,spec,projection},()=>{this.state.set({geography_ref:{id:geography.id,revision:geography.revision},spec_ref:{id:spec.id,revision:spec.revision}},'data');this.events.emit('datachange',{dataset_id:dataset.id,revision:dataset.revision});});
  }
  setGeography(geography){
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    validateGeography(geography);
    for(const dataset of this.datasets.values())validateDataset(dataset,geography);
    const spec={...this.spec,geography_ref:{id:geography.id,revision:geography.revision}};
    validateMapSpec(spec,geography,this.datasets);
    const views=new Map([...this.datasets].map(([id,dataset])=>[id,new DatasetView(dataset,geography)]));
    const projection=fitProjection(geography,this.viewport,projectionOptions(spec,geography));
    return this._change({drag:null,geography,spec,_views:views,projection},()=>this.state.set({geography_ref:{id:geography.id,revision:geography.revision}},'geography'));
  }
  setView(view={}){return this.setSpec({...this.spec,view:{...(this.spec.view??{}),...view}})}
  setRelationRegion(regionId,options={}){
    if(!this.geography.regions.some(region=>region.id===regionId))throw new StatsMapError(`unknown relation region: ${regionId}`,'INVALID_ARGUMENT');
    const previous_region_id=this.spec.view?.relation_region_id??null;
    const result=this.setView({relation_region_id:regionId});
    if(previous_region_id!==regionId)this.events.emit('relationregionchange',{region_id:regionId,previous_region_id,source:options.source??'api',inset_id:options.inset_id??null});
    return result;
  }
  activateRegion(regionId,options={}){return this.spec.interaction?.relationRegionOnClick?this.setRelationRegion(regionId,options):this.toggleSelection(regionId);}
  setLayers(layers){return this.setSpec({...this.spec,layers:[...layers]})}
  setLayout(layout){return this.setSpec({...this.spec,layout:{...layout}})}
  setRenderer(type,encoding={},options={}){const base=this.spec.layers.find(l=>l.role==='base')??this.spec.layers[0];const next={id:base?.id??'base',type,role:getRenderer(type).defaultRole,encoding,options};return this.setLayers([next,...this.spec.layers.filter(l=>l!==base)])}
  setLocale(locale,messages=this.spec.messages){return this.setSpec({...this.spec,locale,messages,view:{...this.spec.view,locale}})}
  setTheme(theme){return this.setSpec({...this.spec,theme})}
  reducedMotion(){const value=this.spec.interaction?.reducedMotion;if(typeof value==='boolean')return value;return !!(this.options.matchMedia??this.container?.ownerDocument?.defaultView?.matchMedia?.bind(this.container.ownerDocument.defaultView)??globalThis.matchMedia)?.('(prefers-reduced-motion: reduce)').matches;}
  setInteraction(interaction){return this.setSpec({...this.spec,interaction:{...(this.spec.interaction??{}),...interaction}})}
  hover(regionId,source='api'){this.events.emit('regionhover',{region_id:regionId??null,geography_ref:{id:this.geography.id,revision:this.geography.revision},source});}
  getViewTransform(){const fitted=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));return {zoom:this.projection.scale/fitted.scale,pan:[(this.projection.translate[0]-fitted.translate[0])/this.viewport.width,(this.projection.translate[1]-fitted.translate[1])/this.viewport.height]};}
  _emitTransform(source='api'){this.events.emit('transformchange',{transform:this.getViewTransform(),source});}
  setViewTransform(transform,options={}){if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');if(!Number.isFinite(transform?.zoom)||transform.zoom<=0||!Array.isArray(transform.pan)||transform.pan.length!==2||!transform.pan.every(Number.isFinite))throw new StatsMapError('invalid view transform','INVALID_ARGUMENT');const fitted=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));this.projection={...fitted,scale:fitted.scale*transform.zoom,translate:[fitted.translate[0]+transform.pan[0]*this.viewport.width,fitted.translate[1]+transform.pan[1]*this.viewport.height]};this._emitTransform(options.source);return this.render();}
  _eventPoint(event){const rect=this.container.getBoundingClientRect();return [(event.clientX-rect.left)*this.viewport.width/rect.width,(event.clientY-rect.top)*this.viewport.height/rect.height];}
  toggleInset(id,visible){const inset=this.spec.insets?.find(value=>value.id===id);if(!inset)throw new StatsMapError(`unknown inset: ${id}`,'INVALID_ARGUMENT');const next=visible??inset.visible===false;const result=this.setSpec({...this.spec,insets:this.spec.insets.map(value=>value.id===id?{...value,visible:next}:value)});this.events.emit('insetchange',{inset_id:id,visible:next});return result;}
  setInsetTransform(id,transform){if(!Number.isFinite(transform?.zoom)||transform.zoom<=0||!Array.isArray(transform.pan)||transform.pan.length!==2||!transform.pan.every(Number.isFinite))throw new StatsMapError('invalid inset transform','INVALID_ARGUMENT');if(!this.spec.insets?.some(value=>value.id===id))throw new StatsMapError(`unknown inset: ${id}`,'INVALID_ARGUMENT');return this.setSpec({...this.spec,insets:this.spec.insets.map(value=>value.id===id?{...value,transform:{zoom:transform.zoom,pan:[...transform.pan]}}:value)});}
  zoomAt(point,factor,insetId){
    if(!Array.isArray(point)||!point.every(Number.isFinite)||!Number.isFinite(factor)||factor<=0)throw new StatsMapError('invalid zoom position or factor','INVALID_ARGUMENT');
    if(insetId){const view=this.insetViews?.find(value=>value.id===insetId);if(!view)return;const fitted=fitProjection(this.geography,view.viewport,{...view.spec.layout,regionIds:view.spec.view.region_ids}),[x,y]=[point[0]-view.inset.x,point[1]-view.inset.y-20],translation=[x-(x-view.projection.translate[0])*factor,y-(y-view.projection.translate[1])*factor];return this.setInsetTransform(insetId,{zoom:view.projection.scale*factor/fitted.scale,pan:[(translation[0]-fitted.translate[0])/view.viewport.width,(translation[1]-fitted.translate[1])/view.viewport.height]});}
    const [x,y]=point;this.projection={...this.projection,scale:this.projection.scale*factor,translate:[x-(x-this.projection.translate[0])*factor,y-(y-this.projection.translate[1])*factor]};this._emitTransform('gesture');return this.render();
  }
  recenterFromMinimap(id,point){const view=this.insetViews?.find(value=>value.id===id);if(!view?.overview)return;const {scale,shift}=view.overview,x=(point[0]-view.inset.x-shift[0])/scale,y=(point[1]-view.inset.y-20-shift[1])/scale;this.projection={...this.projection,translate:[this.projection.translate[0]+this.viewport.width/2-x,this.projection.translate[1]+this.viewport.height/2-y]};this._emitTransform('minimap');return this.render();}
  resetView(){this.projection=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));this._emitTransform();return this.render();}

  setGroups(groups){return this._change({groups:[...groups]},()=>this.events.emit('groupschange',this.groups));}
  setLegendFilter(layerId,keys,options={}){
    if(!this.spec.layers.some(layer=>layer.id===layerId))throw new StatsMapError(`unknown layer: ${layerId}`,'INVALID_ARGUMENT');
    const filters={...this.spec.view?.legend_filters};if(keys==null)delete filters[layerId];else filters[layerId]=[...keys];
    const result=this.setView({legend_filters:filters});
    this.events.emit('legendfilterchange',{layer_id:layerId,keys:keys==null?null:[...keys],source:options.source??'api'});return result;
  }
  toggleLegendFilter(layerId,key,options={}){const keys=new Set(this.spec.view?.legend_filters?.[layerId]??[]);keys.has(key)?keys.delete(key):keys.add(key);return this.setLegendFilter(layerId,keys.size?[...keys]:null,options);}
  capabilities(){return inspectCapabilities(this.spec,this.geography,this.datasets);}
  setSelection(ids, options={}){const next=new Set(ids??[]);return this._change({selection:next},()=>{this.state.set({selection:[...next]},options.source??'api');this.events.emit('selectionchange',{ids:[...next],source:options.source??'api'});});}
  toggleSelection(id){const s=new Set(this.selection);s.has(id)?s.delete(id):s.add(id);return this.setSelection([...s],{source:'toggle'});}
  getState(){return {schema_version:1,spec_ref:{id:this.spec.id,revision:this.spec.revision},geography_ref:{id:this.geography.id,revision:this.geography.revision},selection:[...this.selection],legend_filters:structuredClone(this.spec.view?.legend_filters??{}),relation_region_id:this.spec.view?.relation_region_id??null,groups:this.groups.map(g=>({...g,members:[...(g.members??[])]})),viewport:{...this.viewport}};}
  loadState(state){if(!state||state.schema_version!==1)throw new StatsMapError('invalid map state','INVALID_STATE');if(state.spec_ref&&(state.spec_ref.id!==this.spec.id||state.spec_ref.revision!==this.spec.revision))throw new StatsMapError('map state belongs to another spec','REFERENCE_MISMATCH');if(state.legend_filters||state.relation_region_id!=null)this.setView({...state.legend_filters?{legend_filters:state.legend_filters}:{},...state.relation_region_id!=null?{relation_region_id:state.relation_region_id}:{}});this.groups=state.groups??[];this.viewport=state.viewport?{...this.viewport,...state.viewport}:this.viewport;this.projection=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography));return this.setSelection(state.selection??[],{source:'state'});}
  addGroup(group){this.groups=[...this.groups,group];this.events.emit('groupschange',this.groups);return this.groups;}
  summary(datasetId,regionIds,seriesId,periodId,options={}){const v=this._views.get(datasetId);if(!v)throw new StatsMapError(`unknown dataset: ${datasetId}`,'UNKNOWN_DATASET');const context=this.spec.aggregation?.dataset_id===datasetId?{basisId:this.spec.aggregation.basis_id,displayValue:this.spec.aggregation.display_value,...options}:options;return v.summary(regionIds,seriesId,periodId,context);}
  render({notify=true}={}) {
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    const transaction=new RendererTransaction(this.rendererFrames),keys=['presentation','layoutPositions','insetViews','lastRender','dorlingKey','dorlingPositions','dorlingPrepared','dorlingViews','dorlingGeography'];
    const previous=Object.fromEntries(keys.map(key=>[key,this[key]]));
    let result;
    try{result=this._render(transaction);}catch(error){
      transaction.rollback();
      if(this.dorlingPrepared!==previous.dorlingPrepared){this.dorlingSimulation.cancel();previous.dorlingKey=null;}
      Object.assign(this,previous);throw error;
    }
    if(this.destroyed){transaction.rollback();throw new StatsMapError('map is destroyed','LIFECYCLE');}
    this.rendererFrames=transaction.frames;transaction.commit();
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    if(this.container&&typeof this.container.innerHTML==='string'){const focus=rememberFocus(this.container);this.container.innerHTML=result.svg;restoreFocus(this.container,focus);}
    if(notify)this.events.emit('render',{svg:result.svg});
    return result;
  }
  _render(transaction) {
    if (this.destroyed) throw new StatsMapError('map is destroyed', 'LIFECYCLE');
    const presentation=createPresentation(this.spec,this.geography),{theme}=presentation;
    this.presentation=presentation;
    const anchorOptions={policy:this.spec.anchor_policy,regionIds:viewRegionIds(this.geography,this.spec)},symbolResolution=resolveAnchors(this.geography,anchorOptions),labelResolution=resolveAnchors(this.geography,{...anchorOptions,role:'label'});
    const geometry=geometryStatus(this.geography,{...anchorOptions,symbolResolution,labelResolution});
    const layoutType = this.spec.layout?.type ?? 'geographic';
    if (layoutType === 'dorling') this._scheduleDorling();
    else if(this.dorlingKey!=null){this.dorlingSimulation.cancel();this.dorlingKey=null;this.dorlingPositions=null;}
    let layoutPositions = resolveScreenLayout(this.geography, this.spec, this.viewport, layoutType === 'dorling' ? this.dorlingPositions : null,this._views);
    if (layoutPositions) {
      const fitted=fitProjection(this.geography,this.viewport,projectionOptions(this.spec,this.geography)), factor=this.projection.scale/fitted.scale;
      for (const p of layoutPositions.values()) {
        p.x=(p.x-fitted.translate[0])*factor+this.projection.translate[0];
        p.y=(p.y-fitted.translate[1])*factor+this.projection.translate[1];
        if (p.size!=null) p.size*=factor;
        if (p.radius!=null&&layoutType!=='dorling') p.radius*=factor;
      }
    }
    if(layoutType==='dorling'){
      const status=layoutPositions.metrics?.status??'settled';
      layoutPositions=dorlingPositions([...layoutPositions.values()],this.dorlingPrepared.options);
      layoutPositions.metrics.status=status;
    }
    this.layoutPositions = layoutPositions;
    let svg = geographicBackgroundSvg(this.geography,this.projection,this.spec,layoutPositions)+graticuleSvg(this.geography,this.projection,this.spec), legend = '';
    const legends=[],panels=[],obstacles=[];
    const renders = [];
    const layers = [...this.spec.layers].sort((a,b) => (a.role === 'base' ? 0 : 1) - (b.role === 'base' ? 0 : 1));
    for (const layer of layers) {
      getRenderer(layer.type);
      let channel = layer.encoding ?? {};
      if (!channel.dataset_id) channel = Object.values(channel).find(v => v && typeof v === 'object' && v.dataset_id) ?? channel;
      const datasetId = channel.dataset_id ?? this.spec.dataset_refs[0]?.id;
      const view = this._views.get(datasetId);
      if(view&&this.spec.view?.period_id&&layer.legend!==false&&this.spec.legend?.visible!==false){
        const model=buildLegend(layer,view,this.spec.view.period_id,{aggregation:layer.aggregation??this.spec.aggregation,spec:this.spec,datasetViews:this._views});
        if(model.type!=='empty'){
          const title=presentation.label(layer.legend,presentation.label(layer,layer.legend?.title??layer.title))||undefined,width=layer.legend?.width??this.spec.legend?.width??Math.max(64,Math.min(210,this.viewport.width-12));
          const measured=measureLegend(model,{width,title});
          panels.push({layer_id:layer.id,model,title,...measured,x:layer.legend?.x,y:layer.legend?.y});
          legends.push({layer_id:layer.id,...model});
        }
      }
    }
    const ranking=this.spec.ranking?rankingSvg(this,this.spec.ranking):null;
    if(ranking)obstacles.push(ranking.bounds);
    for(const inset of this.spec.insets??[]){
      if(inset.controls!==false)obstacles.push({x:inset.x,y:inset.y-4,width:inset.width,height:24});
      if(inset.visible!==false)obstacles.push({x:inset.x,y:inset.y+20,width:inset.width,height:inset.height});
    }
    const explicitPanels=panels.filter(panel=>panel.x!=null||panel.y!=null).map(panel=>({x:(panel.x??this.spec.legend?.x??12)-6,y:(panel.y??this.spec.legend?.y??20)-14,width:panel.width,height:panel.height}));
    const fixedDecorations=decorationSvg({geography:this.geography,spec:{...this.spec,decorations:{...this.spec.decorations,labels:false}},projection:this.projection,viewport:this.viewport,views:this._views,layoutPositions,anchorResolution:labelResolution,obstacles:[...obstacles,...explicitPanels]});
    obstacles.push(...fixedDecorations.layout.items.filter(item=>item.reserve!==false).map(item=>item.bounds),...fixedDecorations.layout.markers);
    // Displaced glyphs are the data targets in a Dorling map. Reserve their
    // complete envelopes before placing automatic legends, including a tall
    // size/color legend. Explicit placements retain collision diagnostics.
    const glyphObstacles=layoutType==='dorling'?[...layoutPositions.values()].map(node=>({x:node.x-node.radius,y:node.y-node.radius,width:node.radius*2,height:node.radius*2})):[];
    const legendLayout=placeLegendPanels(panels,{...this.spec.legend,width:this.viewport.width,height:this.viewport.height,obstacles:[...obstacles,...glyphObstacles]});
    for(const panel of legendLayout.panels){
      legend+=legendSvg(panel.model,panel.x,panel.y,`${this.instanceId}-${panel.layer_id}`,{width:panel.width,layerId:panel.layer_id,title:panel.title,filter:this.spec.view?.legend_filters?.[panel.layer_id],interactive:this.spec.interaction?.legendFiltering!==false});
      obstacles.push(panel.bounds);
    }
    for(const layer of layers){
      const binding=layer.encoding??{},channel=binding.dataset_id?binding:Object.values(binding).find(value=>value&&typeof value==='object'&&value.dataset_id)??binding;
      const view=this._views.get(channel.dataset_id??this.spec.dataset_refs[0]?.id);
      const result = stageSvg(transaction,{geography:this.geography, datasetView:view, datasetViews:this._views, spec:this.spec, layer, viewport:this.viewport, projection:this.projection, selection:[...this.selection], selectionOverlay:true, layoutPositions, layoutType, anchorResolution:symbolResolution, labelObstacles:obstacles, namespace:`${this.instanceId}-${layer.id}`});
      renders.push(result);
      svg += `<g data-layer-id="${String(layer.id).replace(/[&<>"']/g,'')}">${result.svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
      for(const label of result.flowLayout?.labels?.values()??[])if(label.visible)obstacles.push(label.box);
    }
    svg+=referenceSvg(this.geography,this.projection,this.spec);
    const insets=renderInsets(this,transaction);this.insetViews=insets.views;
    const decorations=decorationSvg({geography:this.geography,spec:this.spec,projection:this.projection,viewport:this.viewport,views:this._views,layoutPositions,obstacles,selection:this.selection,anchorResolution:labelResolution,preparedLayout:fixedDecorations.layout});
    svg+=decorations.svg;
    if(this.hoveredRegionId)svg+=selectionSvg(this.geography,this.projection,[this.hoveredRegionId],this.spec,layoutPositions,{hover:true});
    svg+=selectionSvg(this.geography,this.projection,this.selection,this.spec,layoutPositions);
    if(ranking)svg+=ranking.svg;
    svg+=insets.svg;
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" style="display:block" width="${this.viewport.width}" height="${this.viewport.height}" viewBox="0 0 ${this.viewport.width} ${this.viewport.height}" lang="${escapeSvg(presentation.locale)}" xml:lang="${escapeSvg(presentation.locale)}" direction="${presentation.direction}" font-family="${escapeSvg(theme.fontFamily)}" fill="${theme.text}" role="group" aria-label="${escapeSvg(presentation.label(this.spec,presentation.t('map')))}" data-reduced-motion="${this.reducedMotion()}"><rect data-map-background="true" width="${this.viewport.width}" height="${this.viewport.height}" fill="${theme.background}" pointer-events="none"/>${svg}${legend}</svg>`;
    this.lastRender = {svg:wrapped, renders, legend,legends,legendLayout,insets:insets.views,ranking:ranking?.model,rankingLayout:ranking?.layout,decorations,geometry,layout:layoutPositions?.metrics,diagnostics:[...(ranking?.diagnostics??[]),...legendLayout.diagnostics,...renders.flatMap((result,index)=>result.diagnostics.map(diagnostic=>({...diagnostic,layer_id:layers[index].id}))),...(layoutPositions?.diagnostics??[]),...(layoutType==='dorling'?symbolResolution.diagnostics:[]),...decorations.diagnostics,...insets.views.flatMap(view=>view.diagnostics.map(diagnostic=>({...diagnostic,inset_id:view.id})))]};
    return this.lastRender;
  }
  _scheduleDorling() {
    const {legend_filters,locale,...view}=this.spec.view??{};
    const key=JSON.stringify([this.spec.layout,this.spec.anchor_policy,view,this.spec.aggregation,this.spec.layers.map(layer=>({type:layer.type,encoding:layer.encoding,options:layer.options,aggregation:layer.aggregation})),this.viewport]);
    if(this.dorlingKey===key&&this.dorlingViews===this._views&&this.dorlingGeography===this.geography)return;
    this.dorlingSimulation.cancel();this.dorlingKey=key;this.dorlingViews=this._views;this.dorlingGeography=this.geography;
    const prepared=prepareDorling(this.geography,this.spec,this.viewport,this._views);this.dorlingPrepared=prepared;
    const {nodes,options}=prepared;
    if(typeof Worker==='undefined'||options.worker===false){this.dorlingPositions=dorlingPositions(dorlingLayout(nodes,options),options);this.dorlingPositions.metrics.status='settled';return;}
    this.dorlingPositions=dorlingPositions(dorlingLayout(nodes,{...options,iterations:0}),{...options,iterations:0});
    this.dorlingPositions.metrics.status='pending';
    this.dorlingSimulation.options=options;
    this.dorlingSimulation.start(nodes).then(result=>{
      if(this.destroyed||this.dorlingKey!==key||this.dorlingPrepared!==prepared||result.status!=='done')return;
      this.dorlingPositions=dorlingPositions(result.nodes,options);this.dorlingPositions.metrics.status='settled';
      this.render();
      this.events.emit('layoutend',{type:'dorling',...this.dorlingPositions.metrics});
    }).catch(error=>{if(!this.destroyed&&this.dorlingKey===key&&this.dorlingPrepared===prepared){this.dorlingPositions.metrics.status='failed';this.render();this.events.emit('error',{error,source:'dorling'});}});
  }
  hitTest(point) {
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    if(!this.lastRender)this.render();
    const inset=insetHitTest(point,this.insetViews??[],this.geography);
    if(inset){
      const local=[point[0]-inset.view.inset.x,point[1]-inset.view.inset.y-20];
      if(local[1]>=0)for(const frame of [...this.rendererFrames.values()].reverse())if(frame.context.insetId===inset.view.id){const hit=frame.hitTest(local);if(hit)return hit;}
      return inset.hit?{...inset.hit,insetId:inset.view.id}:null;
    }
    for(const frame of [...this.rendererFrames.values()].reverse())if(frame.context.insetId==null){const hit=frame.hitTest(point);if(hit)return hit;}
    if (!this.layoutPositions) return hitTest(point, this.geography, this.projection,{regionIds:viewRegionIds(this.geography,this.spec),policy:this.spec.anchor_policy});
    return layoutHitTest(point,this.layoutPositions,this.spec.layout.type);
  }
  describe(target) {
    if(this.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    if(!this.lastRender)this.render();
    for(const frame of this.rendererFrames.values())if(frame.context.layer.id===(target.layer_id??target.layerId)&&(frame.context.insetId??null)===(target.inset_id??target.insetId??null))return frame.describe(target);
    return null;
  }
  _exportMetadata(){const datasets=[...this.datasets.values()],p=createPresentation(this.spec,this.geography);return {title:p.label(this.spec,p.label(this.geography,p.t('map'))),description:this.spec.description??datasets.map(d=>d.title).join('; '),license:this.spec.license??this.bundle.license??null,sources:datasets.flatMap(d=>d.sources??[]),geometry:this.lastRender?.geometry??geometryStatus(this.geography,{policy:this.spec.anchor_policy,regionIds:viewRegionIds(this.geography,this.spec)}),...(this.layoutPositions||(this.insetViews??[]).some(view=>view.layoutPositions)?{layout:{type:this.spec.layout.type,positions:[...(this.layoutPositions?.values()??[])],metrics:this.lastRender?.layout,insets:(this.insetViews??[]).filter(view=>view.layoutPositions).map(view=>({id:view.id,type:view.spec.layout.type,positions:[...view.layoutPositions.values()],metrics:view.layout}))}}:{})};}
  export(format='svg',options={}){if(!this.lastRender)this.render();if(format==='svg')return svgDocument(this.lastRender.svg,this._exportMetadata());if(format==='json')return JSON.stringify({spec:this.exportSpec({resolved:true}),selection:[...this.selection],groups:this.groups});if(format==='spec')return serializeSpec(this.exportSpec({resolved:true}));if(format==='csv'){
      const layer=options.layerId?this.spec.layers.find(layer=>layer.id===options.layerId):this.spec.layers[0];
      if(!layer)throw new StatsMapError('CSV layer is unavailable','EXPORT_UNAVAILABLE');
      const encoding=layer.encoding??{},channel=channelBindings(encoding,{includeException:false}).find(binding=>(!options.datasetId||binding.dataset_id===options.datasetId)&&(!(options.seriesId??options.relationSeriesId)||binding.series_id===(options.seriesId??options.relationSeriesId)))??{};
      const datasetId=options.datasetId??channel.dataset_id??encoding.dataset_id??this.spec.dataset_refs[0]?.id,relationSeriesId=options.relationSeriesId??encoding.relation_series_id,seriesId=options.seriesId??channel.series_id??relationSeriesId,periodId=options.periodId??this.spec.view?.period_id;
      if(!datasetId||!seriesId||!periodId||!this._views.has(datasetId))throw new StatsMapError('CSV export requires dataset, series and period','EXPORT_UNAVAILABLE');
      const binding=channelBindings(encoding,{includeException:false}).find(binding=>binding.dataset_id===datasetId&&binding.series_id===seriesId);
      if(options.relationSlice===true){
        if(!binding?.relation_slice)throw new StatsMapError('CSV relationSlice requires a relation_slice channel','EXPORT_UNAVAILABLE');
        return exportRelationSlice(channelView(binding,null,this._views,this.spec),seriesId,periodId,options.regionIds);
      }
      return (relationSeriesId||binding?.relation_slice?exportRelations:exportObservations)(this._views.get(datasetId),seriesId,periodId,options.regionIds);
    }if(format==='png')throw new StatsMapError('use exportImage("png") for PNG output','EXPORT_UNAVAILABLE');throw new StatsMapError(`unsupported export format: ${format}`,'EXPORT_UNAVAILABLE');}
  async exportImage(format='svg',options={}) {
    if(format==='svg')return this.export('svg');
    if(format!=='png')return this.export(format,options);
    if(!this.lastRender)this.render();
    return svgPngBlob(this.export('svg'),this.viewport.width,this.viewport.height,options);
  }
  exportSpec(options={}){
    const spec=structuredClone(this.spec);
    if(options.resolved&&['grid-square','grid-hex'].includes(spec.layout?.type)){
      spec.layout.positions=structuredClone(savedGridPositions(this.geography,spec.layout,viewRegionIds(this.geography,spec)));
      delete spec.layout.grid_layout_id;
    }
    if(options.resolved){spec.anchor_policy=normalizeAnchorPolicy(spec.anchor_policy??this.geography.anchor_policy);const p=createPresentation(this.spec,this.geography);spec.locale=p.locale;spec.messages={...p.messages};spec.theme=structuredClone(p.theme);spec.interaction={...spec.interaction,reducedMotion:this.reducedMotion()};const domains=comparisonDomains(spec,[spec],this.datasets,this.geography);spec.layers=spec.layers.map(layer=>{const patch=domains.get(layer.id);return {...layer,...(patch.classification?{classification:patch.classification}:{}),options:{...layer.options,...patch.options}};});}
    return spec;
  }
  unmount(){
    this.tooltip?.destroy();this.tooltip=null;
    this.motionQuery?.removeEventListener?.('change',this.motionHandler);this.motionQuery=null;this.motionHandler=null;
    this.touchGestures?.destroy();this.touchGestures=null;
    this.resizeObserver?.disconnect();this.resizeObserver=null;
    if(this.container&&this.domHandlers){
      const c=this.container,h=this.domHandlers;
      for(const [event,handler] of [['focusin',h.onFocus],['click',h.onClick],['pointermove',h.onHover],['pointerdown',h.onDown],['wheel',h.onWheel],['keydown',h.onKey]])c.removeEventListener?.(event,handler);
      c.ownerDocument?.removeEventListener?.('pointermove',h.onMove);c.ownerDocument?.removeEventListener?.('pointerup',h.onUp);c.ownerDocument?.removeEventListener?.('pointercancel',h.onUp);c.ownerDocument?.defaultView?.removeEventListener?.('blur',h.onUp);
    }
    this.container?.replaceChildren?.();
    this.domHandlers=null;this.drag=null;this.container=null;return this;
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.events.emit('destroy',{instance_id:this.instanceId});for(const frame of this.rendererFrames?.values()??[])frame.dispose();this.rendererFrames?.clear();this.dorlingSimulation.destroy();this.dorlingPositions=null;this.dorlingKey=null;this.unmount();this.events.clear();this.state.destroy();this.lastRender=null;this._views.clear();}

}
export function createMap(containerOrBundle,options={}){if(containerOrBundle?.kind==='stats-map/bundle')return new MapFrame(containerOrBundle,options);if(options.bundle?.kind==='stats-map/bundle')return new MapFrame(options.bundle,{...options,container:containerOrBundle});if(options.geography?.kind==='stats-map/geography'&&options.dataset?.kind==='stats-map/dataset'){const spec=options.spec??{schema_version:1,kind:'stats-map/spec',id:'runtime-view',revision:'r1',geography_ref:{id:options.geography.id,revision:options.geography.revision},dataset_refs:[{id:options.dataset.id,revision:options.dataset.revision}],view:{period_id:options.dataset.periods[0]?.id},layout:{type:'geographic'},layers:[{id:'base',type:'choropleth',role:'base',encoding:{dataset_id:options.dataset.id,series_id:options.dataset.series[0]?.id}}]};const bundle={schema_version:1,kind:'stats-map/bundle',id:'runtime-bundle',revision:'r1',resources:[{storage:'inline',resource:options.geography},{storage:'inline',resource:options.dataset},{storage:'inline',resource:spec}],spec_ref:{id:spec.id,revision:spec.revision}};return new MapFrame(bundle,{...options,container:containerOrBundle});}throw new StatsMapError('createMap expects a MapBundle or {bundle, geography, dataset} option','INVALID_ARGUMENT');}
export async function createMapFromBundle(bundle,resolver,options={}){return new MapFrame(await loadBundle(bundle,resolver,options),options);}

