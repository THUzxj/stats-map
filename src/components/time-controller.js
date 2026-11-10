import { createPresentation } from '../core/presentation.js';
import { channelBindings } from '../core/channels.js';
import { StatsMapError } from '../core/errors.js';
import { styleControl } from './control-style.js';

let sequence=0;
const require=(condition,message)=>{if(!condition)throw new StatsMapError(message,'INVALID_ARGUMENT');};
function optionsFor(options){
  require(options&&typeof options==='object'&&!Array.isArray(options),'time controller options must be an object');
  if(options.datasetId!=null)require(typeof options.datasetId==='string'&&options.datasetId.length>0,'time datasetId must be a nonempty string');
  if(options.interval!=null)require(Number.isFinite(options.interval)&&options.interval>=16,'playback interval must be at least 16ms');
  if(options.loop!=null)require(typeof options.loop==='boolean','time loop must be boolean');
  if(options.labels!=null)require(options.labels&&typeof options.labels==='object'&&!Array.isArray(options.labels)&&Object.values(options.labels).every(value=>typeof value==='string'),'time labels must contain plain text');
  if(options.setInterval!=null||options.clearInterval!=null)require(typeof options.setInterval==='function'&&typeof options.clearInterval==='function','provide both time scheduler functions');
  return {...options,...(options.labels?{labels:{...options.labels}}:{})};
}

export class TimeController {
  constructor(map,options={}){
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    this.map=map;this.options=optionsFor(options);this.id=`time-controller-${++sequence}`;
    this.periods=[];this.index=-1;this.timer=null;this.playing=false;this.generation=0;this.destroyed=false;this.error=null;this.controlError=null;
    this.sync(true);
    this.unsubscribers=[map.on('destroy',()=>this.destroy()),map.on('specchange',()=>this.sync()),...['bundlechange','datachange'].map(event=>map.on(event,()=>{this.pause();this.sync();}))];
    this.sync();
  }
  assertLive(){if(this.destroyed||this.map.destroyed)throw new StatsMapError('time controller is destroyed','LIFECYCLE');}
  sync(initial=false){
    this.assertLive();
    const datasetId=this.options.datasetId??channelBindings(this.map.spec.layers[0]?.encoding,{includeException:false})[0]?.dataset_id??this.map.spec.dataset_refs[0]?.id;
    const dataset=this.map.datasets.get(datasetId),periods=dataset?.periods.slice().sort((a,b)=>a.order-b.order)??[];
    const key=JSON.stringify([datasetId,dataset?.revision,periods.map(period=>[period.id,period.order])]);
    if(!dataset&&initial)throw new StatsMapError(`time dataset is unavailable: ${datasetId}`,'UNKNOWN_DATASET');
    if(this.domainKey!==undefined&&key!==this.domainKey)this.pause();
    const previousError=this.error;
    this.domainKey=key;this.datasetId=datasetId;this.datasetRevision=dataset?.revision;this.periods=periods;this.index=periods.findIndex(period=>period.id===this.map.spec.view?.period_id);
    this.error=dataset?null:{code:'UNKNOWN_DATASET',message:`time dataset is unavailable: ${datasetId}`};
    this.controlError=null;this.updateControls?.();
    const periodId=this.map.spec.view?.period_id??null,referenced=new Set(this.map.spec.layers.flatMap(layer=>channelBindings(layer.encoding)).map(binding=>binding.dataset_id));
    const unavailable=[...referenced].filter(id=>periodId!=null&&!this.map.datasets.get(id)?.periods.some(period=>period.id===periodId));
    const payload={period_id:periodId,index:this.index,dataset_id:datasetId,dataset_revision:dataset?.revision,period_ids:periods.map(period=>period.id),unavailable_dataset_ids:unavailable,controller_id:this.id,source:'time-controller'};
    const signature=JSON.stringify(payload);
    if(!initial&&signature!==this.timeSignature){this.timeSignature=signature;this.map.events.emit('timechange',payload);}
    if(this.error&&this.error.message!==previousError?.message)this.map.events.emit('error',{error:new StatsMapError(this.error.message,this.error.code),controller_id:this.id,source:'time-controller'});
    return this;
  }
  seek(index){
    this.assertLive();
    if(this.error)throw new StatsMapError(this.error.message,this.error.code);
    require(Number.isInteger(index)&&index>=0&&index<this.periods.length,'time index out of range');
    const period=this.periods[index];this.map.setView({period_id:period.id});return period;
  }
  next(){this.assertLive();if(this.index+1<this.periods.length)return this.seek(this.index+1);if(this.options.loop&&this.periods.length)return this.seek(0);this.pause();return null;}
  previous(){this.assertLive();return this.periods.length?this.seek(Math.max(0,this.index-1)):null;}
  play(){
    this.assertLive();if(this.error)throw new StatsMapError(this.error.message,this.error.code);
    if(this.playing||this.periods.length<2)return this;
    const generation=++this.generation;this.playing=true;
    const tick=()=>{
      if(!this.playing||this.generation!==generation||this.destroyed||this.map.destroyed)return;
      try{this.next();}
      catch(cause){this.pause();const error=new StatsMapError('time playback failed','PLAYBACK_FAILED');error.cause=cause;this.map.events.emit('error',{error,controller_id:this.id,source:'time-controller',period_id:this.map.spec.view?.period_id});}
    };
    try{
      const handle=(this.options.setInterval??globalThis.setInterval)(tick,this.options.interval??1000);
      if(handle==null)throw new StatsMapError('time scheduler did not return a handle','INVALID_ARGUMENT');
      if(this.playing&&this.generation===generation)this.timer=handle;
      else (this.options.clearInterval??globalThis.clearInterval)(handle);
    }catch(error){if(this.generation===generation){this.playing=false;this.generation++;this.timer=null;}this.updateControls?.();throw error;}
    this.updateControls?.();return this;
  }
  pause(){
    this.generation++;this.playing=false;const timer=this.timer;this.timer=null;
    try{if(timer!=null)(this.options.clearInterval??globalThis.clearInterval)(timer);}
    finally{this.updateControls?.();}return this;
  }
  mount(container){
    this.assertLive();this.unmount();this.container=container;
    const document=container.ownerDocument,labels=this.options.labels??{},previous=document.createElement('button'),play=document.createElement('button'),next=document.createElement('button'),input=document.createElement('input'),output=document.createElement('output');
    for(const button of [previous,play,next])button.type='button';
    previous.textContent=labels.previous??'◀';play.textContent=labels.play??'▶ / ‖';next.textContent=labels.next??'▶';
    for(const [element,name] of [[previous,'previous'],[play,'play'],[next,'next'],[input,'time'],[output,'output']])element.setAttribute('data-time-control',name);
    input.type='range';input.min='0';input.step='1';output.setAttribute('aria-live','polite');
    this.updateControls=()=>{
      const p=createPresentation(this.map.spec,this.map.geography),label=p.label(this.periods[this.index],this.map.spec.view?.period_id??p.t('missing'));
      previous.setAttribute('aria-label',labels.previous??p.t('previousPeriod'));next.setAttribute('aria-label',labels.next??p.t('nextPeriod'));play.setAttribute('aria-label',labels.play??p.t('playPause'));input.setAttribute('aria-label',labels.time??p.t('time'));
      for(const element of [previous,next,play,input,output])styleControl(element,p);
      input.max=String(Math.max(0,this.periods.length-1));input.value=String(Math.max(0,this.index));input.disabled=!!this.error||!this.periods.length;input.setAttribute('aria-valuetext',label);
      output.textContent=this.error?.message??this.controlError?.message??label;
      previous.disabled=!!this.error||!this.periods.length||this.index<=0;next.disabled=!!this.error||!this.periods.length||(!this.options.loop&&this.index===this.periods.length-1);play.disabled=!!this.error||this.periods.length<2;play.setAttribute('aria-pressed',String(this.playing));
    };
    const apply=action=>{try{action();}catch(error){if(this.destroyed||this.map.destroyed)return;this.controlError={code:error.code??'INVALID_ARGUMENT',message:error.message};this.updateControls?.();this.map.events.emit('error',{error,controller_id:this.id,source:'time-controller'});}};
    const back=()=>apply(()=>this.previous()),advance=()=>apply(()=>this.next()),toggle=()=>apply(()=>this.playing?this.pause():this.play()),seek=()=>apply(()=>this.seek(Number(input.value)));
    previous.addEventListener('click',back);next.addEventListener('click',advance);play.addEventListener('click',toggle);input.addEventListener('input',seek);
    container.replaceChildren(previous,play,next,input,output);
    this.cleanup=()=>{previous.removeEventListener('click',back);next.removeEventListener('click',advance);play.removeEventListener('click',toggle);input.removeEventListener('input',seek);container.replaceChildren();};
    this.updateControls();return this;
  }
  unmount(){this.cleanup?.();this.cleanup=null;this.updateControls=null;this.container=null;return this;}
  destroy(){if(this.destroyed)return;this.destroyed=true;try{this.pause();}finally{this.unmount();for(const unsubscribe of this.unsubscribers??[])unsubscribe();this.unsubscribers=[];}}
}
