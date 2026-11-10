import { getRenderer } from './registry.js';
import { StatsMapError } from '../core/errors.js';
import { resolveView } from '../core/view.js';
import { createPresentation, presentedLayer } from '../core/presentation.js';
import { fitProjection, projectPoint, resolveAnchors } from '../core/geometry.js';
import { classifyDomain } from '../core/classification.js';
import { channelBindings, channelView } from '../core/channels.js';
import { accessibleTargets } from '../components/accessibility.js';

function sync(value,hook) {
  if(value&&typeof value.then==='function'){
    Promise.resolve(value).catch(()=>{});
    throw new StatsMapError(`renderer ${hook} must be synchronous`,'ASYNC_RENDERER');
  }
  return value;
}
function result(value,context) {
  if(!value||typeof value.svg!=='string'||!/^<svg\b[^>]*>[\s\S]*<\/svg>\s*$/.test(value.svg))throw new StatsMapError('renderer must return an SVG document','INVALID_RENDER_RESULT');
  const diagnostics=value.diagnostics??[],collisionRadii=value.collisionRadii??new Map();
  if(!Array.isArray(diagnostics)||!(collisionRadii instanceof Map)||[...collisionRadii.values()].some(radius=>!Number.isFinite(radius)||radius<0))throw new StatsMapError('invalid renderer diagnostics or collision radii','INVALID_RENDER_RESULT');
  const svg=context.definition.builtin?value.svg:accessibleTargets(value.svg,context.geography,context.layer,context.spec,context.datasetView,context.datasetViews);
  return {...value,svg,projection:value.projection??context.projection,diagnostics,collisionRadii,anchors:value.anchors??[]};
}

// Each frame owns a freshly prepared candidate. update receives the previous
// output for comparison, never ownership of the previous prepared resources.
// The map commits all main/inset frames together, or disposes only candidates.
export class RendererFrame {
  constructor(options,renderBuiltin,previous) {
    this.definition=getRenderer(options.layer.type);this.disposers=[];this.disposed=false;
    if(!this.definition.capabilities.layouts.includes(options.layoutType??options.spec.layout?.type??'geographic'))throw new StatsMapError(`unsupported layout for ${this.definition.type}`,'UNSUPPORTED_LAYOUT');
    const spec=resolveView(options.spec,options.geography),presentation=createPresentation(spec,options.geography);
    const layer=presentedLayer({...options.layer,type:this.definition.type},presentation),viewport=options.viewport??{width:800,height:600};
    const bindings=channelBindings(layer.encoding,{includeException:false}),datasetViews=options.datasetViews??new Map(options.datasetView?[[options.datasetView.data.id,options.datasetView]]:[]);
    const channelViews=bindings.map(binding=>channelView(binding,options.datasetView,datasetViews,spec));
    const projection=options.projection??fitProjection(options.geography,viewport,{...spec.layout,regionIds:spec.view?.region_ids});
    const resolution=options.anchorResolution??resolveAnchors(options.geography,{policy:spec.anchor_policy,regionIds:spec.view?.region_ids});
    const anchors=options.layoutPositions?new Map([...options.layoutPositions].map(([id,node])=>[id,[node.x,node.y]])):new Map([...resolution.anchors].map(([id,anchor])=>[id,projectPoint(anchor.point,projection)]));
    this.context=Object.freeze({...options,definition:this.definition,spec:{...spec,aggregation:layer.aggregation??spec.aggregation},layer,datasetView:channelViews[0]??options.datasetView,datasetViews,bindings,channelViews,viewport,projection,presentation,anchors,selection:[...(options.selection??[])],layoutType:options.layoutType??'geographic',phase:options.measureCollisions?'measure':options.phase??'render',insetId:options.insetId??null,services:Object.freeze({project:point=>projectPoint(point,projection),classify:classifyDomain,renderBuiltin,onDispose:dispose=>{if(typeof dispose!=='function')throw new StatsMapError('onDispose requires a function','INVALID_ARGUMENT');this.disposers.push(dispose);}})});
    try{
      if(sync(this.definition.validateEncoding(this.context),'validateEncoding')===false)throw new StatsMapError(`invalid encoding for ${this.definition.type}`,'INVALID_ENCODING');
      this.preparing=true;this.prepared=sync(this.definition.prepare(this.context),'prepare');
      const update=previous?.definition===this.definition&&this.definition.update;
      this.result=result(sync(update?this.definition.update(this.context,this.prepared,previous.result):this.definition.render(this.context,this.prepared),update?'update':'render'),this.context);
    }catch(error){this.dispose();throw error;}
  }
  hitTest(point) {
    if(this.disposed)return null;
    const hit=sync(this.definition.hitTest(this.context,this.prepared,point,this.result),'hitTest');
    if(hit==null)return null;
    if(typeof hit.regionId!=='string'||!this.context.geography.regions.some(region=>region.id===hit.regionId)||this.context.spec.view?.region_ids&&!this.context.spec.view.region_ids.includes(hit.regionId))throw new StatsMapError('renderer hit references an unavailable region','INVALID_RENDER_RESULT');
    return {...hit,layerId:this.context.layer.id,...(this.context.insetId?{insetId:this.context.insetId}:{})};
  }
  describe(target) {
    const value=this.disposed?null:sync(this.definition.describe(this.context,this.prepared,target,this.result),'describe');
    if(value!=null&&(typeof value.title!=='string'||!Array.isArray(value.rows??[])||(value.rows??[]).some(row=>typeof row.label!=='string'||typeof row.value!=='string')))throw new StatsMapError('invalid renderer description','INVALID_RENDER_RESULT');
    return value;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    // Cleanup errors cannot strand other instances or replace a successful
    // candidate with an already destroyed old frame.
    try{if(this.preparing)sync(this.definition.destroy(this.context,this.prepared,this.result),'destroy');}catch{}
    for(const dispose of this.disposers.splice(0).reverse())try{dispose();}catch{}
  }
}
export class RendererTransaction {
  constructor(previous=new Map()){this.previous=previous;this.frames=new Map();}
  stage(options,renderBuiltin) {
    const key=JSON.stringify([options.insetId??null,options.layer.id]);
    const frame=new RendererFrame(options,renderBuiltin,this.previous.get(key));
    this.frames.set(key,frame);return frame.result;
  }
  commit(){for(const frame of this.previous.values())frame.dispose();return this.frames;}
  rollback(){for(const frame of this.frames.values())frame.dispose();this.frames.clear();}
}
