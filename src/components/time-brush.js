import { createPresentation } from '../core/presentation.js';
import { channelBindings } from '../core/channels.js';
import { StatsMapError } from '../core/errors.js';
import { timeDomain } from '../renderers/temporal.js';
import { styleControl } from './control-style.js';

// The full declared domain is always retained by the brush, including periods
// without observations. Changing the window never rewrites the active period.
export class TimeBrush {
  constructor(map,options={}){
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    this.map=map;this.options=options;this.destroyed=false;this.periods=[];this.range=null;
    this.disposers=['specchange','bundlechange','datachange'].map(event=>map.on(event,()=>{this.cancel();this.sync();}));this.disposers.push(map.on('destroy',()=>this.destroy()));this.sync();
  }
  sync(){
    const id=this.options.datasetId??channelBindings(this.map.spec.layers[0]?.encoding)[0]?.dataset_id??this.map.spec.dataset_refs[0]?.id,view=this.map._views.get(id);
    this.datasetId=id;this.periods=[];this.positions=[];this.range=null;this.error=null;this.commitError=null;
    try{
      if(!view)throw new StatsMapError('time brush dataset is unavailable','UNKNOWN_DATASET');
      const domain=timeDomain(view,{view:{}});this.periods=domain.periods;this.positions=domain.positions;this.spacing=domain.spacing;
      const window=this.map.spec.view?.time_window;
      if(window){const bounds=Array.isArray(window)?window:[window.start_period_id,window.end_period_id];const indices=bounds.map(id=>this.periods.findIndex(period=>period.id===id));if(indices[0]<0||indices[1]<indices[0])throw new StatsMapError('time brush window is outside its dataset','INVALID_ENCODING');this.range=indices;}
      else if(this.periods.length)this.range=[0,this.periods.length-1];
    }catch(error){this.error={code:error.code??'INVALID_ARGUMENT',message:error.message};}
    this.update?.();return this;
  }
  setRange(startPeriodId,endPeriodId,options={}){
    if(this.destroyed||this.map.destroyed)throw new StatsMapError('time brush is destroyed','LIFECYCLE');
    const first=this.periods.findIndex(period=>period.id===startPeriodId),last=this.periods.findIndex(period=>period.id===endPeriodId);
    if(first<0||last<first)throw new StatsMapError('time brush requires ordered registered period ids','INVALID_ARGUMENT');
    this.map.setView({time_window:[startPeriodId,endPeriodId]});
    this.map.events.emit('timebrushchange',{dataset_id:this.datasetId,time_window:[startPeriodId,endPeriodId],source:options.source??'time-brush'});return this;
  }
  reset(){if(this.destroyed||this.map.destroyed)throw new StatsMapError('time brush is destroyed','LIFECYCLE');this.map.setView({time_window:null});this.map.events.emit('timebrushchange',{time_window:null,source:'time-brush'});return this;}
  mount(container){
    if(this.destroyed)throw new StatsMapError('time brush is destroyed','LIFECYCLE');this.unmount();this.container=container;
    const document=container.ownerDocument,section=document.createElement('section'),heading=document.createElement('div'),track=document.createElementNS('http://www.w3.org/2000/svg','svg'),start=document.createElement('input'),end=document.createElement('input'),output=document.createElement('output'),reset=document.createElement('button');
    section.setAttribute('data-time-brush','');track.setAttribute('viewBox','0 0 600 58');track.setAttribute('width','100%');track.setAttribute('height','58');track.style.touchAction='none';track.style.cursor='crosshair';track.setAttribute('aria-hidden','true');
    for(const input of [start,end]){input.type='range';input.min='0';input.step='1';input.style.width='100%';}reset.type='button';output.setAttribute('aria-live','polite');
    section.append(heading,track,start,end,output,reset);container.replaceChildren(section);
    const node=(name,attributes)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));return element;};
    this.update=()=>{
      const p=createPresentation(this.map.spec,this.map.geography),range=this.preview??this.range;
      for(const element of [section,heading,start,end,output,reset])styleControl(element,p);
      heading.textContent=this.options.title??p.t('timeWindow');reset.textContent=p.t('resetWindow');
      start.setAttribute('aria-label',p.t('startPeriod'));end.setAttribute('aria-label',p.t('endPeriod'));
      for(const input of [start,end]){input.max=String(Math.max(0,this.periods.length-1));input.disabled=!!this.error||!range;}
      reset.disabled=!this.map.spec.view?.time_window;start.value=String(range?.[0]??0);end.value=String(range?.[1]??0);
      start.setAttribute('aria-valuetext',p.label(this.periods[range?.[0]]));end.setAttribute('aria-valuetext',p.label(this.periods[range?.[1]]));
      output.textContent=this.error?.message??this.commitError?.message??(range?`${p.label(this.periods[range[0]])} – ${p.label(this.periods[range[1]])}`:p.t('missing'));
      track.replaceChildren(node('line',{x1:12,y1:24,x2:588,y2:24,stroke:p.theme.border}));
      if(range){const x=index=>12+this.positions[index]*576;track.append(node('rect',{'data-brush-window':'',x:x(range[0]),y:8,width:Math.max(2,x(range[1])-x(range[0])),height:30,fill:p.theme.selectedBackground,stroke:p.theme.accent}));this.periods.forEach((period,index)=>track.append(node('line',{x1:x(index),x2:x(index),y1:20,y2:28,stroke:p.theme.text})));for(const index of range)track.append(node('line',{x1:x(index),x2:x(index),y1:6,y2:40,stroke:p.theme.accent,'stroke-width':3}));}
    };
    const apply=action=>{try{action();}catch(error){if(this.destroyed||this.map.destroyed)return;this.commitError={code:error.code??'INVALID_ARGUMENT',message:error.message};this.update?.();this.map.events.emit('error',{error,source:'time-brush'});}};
    const changeStart=()=>apply(()=>{const first=Number(start.value),last=Math.max(first,this.range?.[1]??first);this.setRange(this.periods[first].id,this.periods[last].id,{source:'time-brush-keyboard'});});
    const changeEnd=()=>apply(()=>{const last=Number(end.value),first=Math.min(last,this.range?.[0]??last);this.setRange(this.periods[first].id,this.periods[last].id,{source:'time-brush-keyboard'});});
    const nearest=event=>{const rect=track.getBoundingClientRect(),position=((event.clientX-rect.left)/rect.width*600-12)/576;return this.positions.reduce((best,value,index)=>Math.abs(value-position)<Math.abs(this.positions[best]-position)?index:best,0);};
    const down=event=>{if(this.error||!this.periods.length||event.button!==0)return;event.preventDefault();this.drag={pointerId:event.pointerId,first:nearest(event)};this.preview=[this.drag.first,this.drag.first];track.setPointerCapture?.(event.pointerId);this.update();};
    const move=event=>{if(this.drag?.pointerId!==event.pointerId)return;const last=nearest(event);this.preview=[Math.min(last,this.drag.first),Math.max(last,this.drag.first)];this.update();this.map.events.emit('timebrushinput',{time_window:this.preview.map(index=>this.periods[index].id),source:'time-brush'});};
    const up=event=>{if(this.drag?.pointerId!==event.pointerId)return;move(event);if(this.destroyed||!this.preview||this.drag?.pointerId!==event.pointerId)return;const range=[...this.preview];this.cancel();apply(()=>this.setRange(this.periods[range[0]].id,this.periods[range[1]].id));};
    const cancel=()=>this.cancel(),resetWindow=()=>apply(()=>this.reset()),key=event=>{if(event.key==='Escape')this.cancel();};
    start.addEventListener('input',changeStart);end.addEventListener('input',changeEnd);reset.addEventListener('click',resetWindow);
    for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel],['keydown',key]])track.addEventListener(name,handler);
    document.defaultView?.addEventListener('blur',cancel);document.addEventListener('keydown',key);
    this.release=pointerId=>{if(track.hasPointerCapture?.(pointerId))track.releasePointerCapture(pointerId);};
    this.cleanup=()=>{start.removeEventListener('input',changeStart);end.removeEventListener('input',changeEnd);reset.removeEventListener('click',resetWindow);for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel],['keydown',key]])track.removeEventListener(name,handler);document.defaultView?.removeEventListener('blur',cancel);document.removeEventListener('keydown',key);};
    this.update();return this;
  }
  cancel(){const pointerId=this.drag?.pointerId;this.drag=null;this.preview=null;if(pointerId!=null)this.release?.(pointerId);this.update?.();}
  unmount(){this.cancel();this.cleanup?.();this.cleanup=null;this.update=null;this.release=null;this.container?.replaceChildren();this.container=null;return this;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.unmount();for(const dispose of this.disposers)dispose();this.disposers=[];}
}
