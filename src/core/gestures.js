import { viewRegionIds } from './view.js';
import { fitProjection } from './geometry.js';

// Single touches retain ordinary region taps. Two touches in the same view
// establish one gesture; document events keep it alive across SVG replacement.
export class TouchGestures {
  constructor(map,container) {
    this.map=map;this.container=container;this.pointers=new Map();this.blockedUntil=0;
    this.previousAction=container.style?.touchAction;
    if(container.style)container.style.touchAction='none';
    this.disposers=['datachange','bundlechange'].map(name=>map.on(name,()=>this.cancel()));
  }
  point(event,insetId){const point=this.map._eventPoint(event),view=this.map.insetViews?.find(value=>value.id===insetId);return view?[point[0]-view.inset.x,point[1]-view.inset.y-20]:point;}
  down(event){
    if(event.target?.closest?.('[data-inset-toggle]'))return;
    const insetId=event.target?.closest?.('[data-inset-id]')?.getAttribute('data-inset-id')??null;
    if(this.pointers.size>=2)return;
    this.pointers.set(event.pointerId,{point:this.point(event,insetId),insetId});
    const entries=[...this.pointers.values()];if(entries.length!==2||entries[0].insetId!==entries[1].insetId)return;
    const view=this.map.insetViews?.find(value=>value.id===insetId),projection=view?.projection??this.map.projection;
    const fitted=view?fitProjection(this.map.geography,view.viewport,{...view.spec.layout,regionIds:view.spec.view.region_ids}):fitProjection(this.map.geography,this.map.viewport,{...this.map.spec.layout,regionIds:viewRegionIds(this.map.geography,this.map.spec)});
    const [a,b]=entries.map(entry=>entry.point),distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
    if(distance<1)return;
    this.active={insetId,projection,fitted,viewport:view?.viewport??this.map.viewport,distance,center:[(a[0]+b[0])/2,(a[1]+b[1])/2]};
    this.blockedUntil=Infinity;event.preventDefault?.();
  }
  move(event){
    const pointer=this.pointers.get(event.pointerId);if(!pointer)return;
    pointer.point=this.point(event,pointer.insetId);if(!this.active)return;
    const {insetId,projection,fitted,viewport,distance,center}=this.active,entries=[...this.pointers.values()];if(entries.length!==2)return;
    const [a,b]=entries.map(entry=>entry.point),ratio=Math.max(.01,Math.min(100,Math.hypot(a[0]-b[0],a[1]-b[1])/distance));
    const midpoint=[(a[0]+b[0])/2,(a[1]+b[1])/2],translation=midpoint.map((value,index)=>value-(center[index]-projection.translate[index])*ratio);
    const transform={zoom:projection.scale*ratio/fitted.scale,pan:[(translation[0]-fitted.translate[0])/viewport.width,(translation[1]-fitted.translate[1])/viewport.height]};
    event.preventDefault?.();
    if(insetId)this.map.setInsetTransform(insetId,transform);else this.map.setViewTransform(transform,{source:'touch'});
  }
  up(event){if(!this.pointers.has(event.pointerId))return;this.pointers.delete(event.pointerId);if(this.active){this.active=null;this.blockedUntil=Date.now()+400;}if(!this.pointers.size&&this.blockedUntil===Infinity)this.blockedUntil=Date.now()+400;}
  suppressClick(){return Date.now()<this.blockedUntil;}
  cancel(){this.pointers.clear();if(this.active)this.blockedUntil=Date.now()+400;this.active=null;}
  destroy(){this.cancel();for(const dispose of this.disposers)dispose();this.disposers=[];if(this.container.style)this.container.style.touchAction=this.previousAction??'';}
}
