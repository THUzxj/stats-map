import { createPresentation } from '../core/presentation.js';
import { resolveProfile } from '../core/profile.js';
import { styleControl } from './control-style.js';
import { createMap, inlineResources } from '../core/map.js';
import { StatsMapError } from '../core/errors.js';
import { validateMapSpec } from '../core/validate.js';
import { comparisonDomains } from './comparison.js';

let sequence=0;
const clone=value=>{try{return structuredClone(value);}catch{throw new StatsMapError('controller declarations must contain cloneable data','INVALID_ARGUMENT');}};
const require=(condition,message)=>{if(!condition)throw new StatsMapError(message,'INVALID_ARGUMENT');};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function controllerOptions(options,booleans=[]){
  require(object(options),'controller options must be an object');
  for(const key of booleans)if(options[key]!=null)require(typeof options[key]==='boolean',`${key} must be boolean`);
  if(options.labels!=null)require(object(options.labels)&&Object.values(options.labels).every(value=>typeof value==='string'),'controller labels must be plain text');
  return {...options,...(options.labels?{labels:{...options.labels}}:{})};
}
const sameGeography=(a,b)=>a.geography.id===b.geography.id&&a.geography.revision===b.geography.revision;
// A transaction follows synchronous forwarding across overlapping links. Weak
// event keys also let later listeners on the original event share its visited
// set. Keep the original identity through intermediate maps with fewer IDs.
const transmissions=new WeakMap();let forwarding=null;

export class MapLink {
  constructor(maps,options={}) {
    require(Array.isArray(maps)&&maps.every(map=>map&&typeof map.on==='function'&&!map.destroyed),'links require live maps');
    options=controllerOptions(options,['selection','hover','zoom']);
    this.id=`map-link-${++sequence}`;this.maps=[...new Set(maps)];this.subscriptions=new Map();this.destroyed=false;
    const broadcast=(origin,payload,channel,apply)=>{
      if(this.destroyed||origin.destroyed||payload.source===this.id)return;
      let transaction=transmissions.get(payload);
      if(!transaction){
        const propagated=forwarding?.target===origin&&forwarding.channel===channel&&payload.source===forwarding.source;
        if(!propagated&&forwarding?.channel===channel&&sameGeography(forwarding.transaction.origin,origin))forwarding.transaction.cancelled=true;
        transaction=propagated?forwarding.transaction:{origin,payload,visited:new Set([origin])};
      }
      transmissions.set(payload,transaction);
      for(const target of [...this.maps]){
        if(this.destroyed||transaction.origin.destroyed||transaction.cancelled)break;
        if(target.destroyed||transaction.visited.has(target)||!sameGeography(transaction.origin,target))continue;
        if(channel==='zoom'&&((transaction.origin.spec.layout?.type??'geographic')!=='geographic'||(target.spec.layout?.type??'geographic')!=='geographic'))continue;
        transaction.visited.add(target);const previous=forwarding;forwarding={transaction,target,channel,source:this.id};
        try{apply(target,transaction.payload);}
        catch(cause){const error=new StatsMapError('linked map update failed','LINK_FAILED');error.cause=cause;target.events.emit('error',{error,source:'map-link',controller_id:this.id,channel,origin_instance_id:transaction.origin.instanceId,target_instance_id:target.instanceId});}
        finally{forwarding=previous;}
      }
    };
    for(const map of this.maps){
      const subscriptions=[];this.subscriptions.set(map,subscriptions);
      if(options.selection!==false)subscriptions.push(map.on('selectionchange',payload=>broadcast(map,payload,'selection',(target,event)=>target.setSelection(event.ids.filter(id=>target.geography.regions.some(region=>region.id===id)),{source:this.id}))));
      if(options.hover!==false)subscriptions.push(map.on('regionhover',payload=>broadcast(map,payload,'hover',(target,event)=>target.hover(target.geography.regions.some(region=>region.id===event.region_id)?event.region_id:null,this.id))));
      if(options.zoom===true)subscriptions.push(map.on('transformchange',payload=>broadcast(map,payload,'zoom',(target,event)=>target.setViewTransform(event.transform,{source:this.id}))));
      subscriptions.push(map.on('destroy',()=>{for(const unsubscribe of subscriptions)unsubscribe();this.subscriptions.delete(map);this.maps=this.maps.filter(value=>value!==map);if(!this.maps.length)this.destroy();}));
    }
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;for(const subscriptions of this.subscriptions.values())for(const unsubscribe of subscriptions)unsubscribe();this.subscriptions.clear();this.maps=[];}
}

export { TimeController } from './time-controller.js';

function panelSpec(base,panel,domains) {
  const spec=clone(base);
  spec.id=`${base.id}-${panel.id}`;
  spec.view={...spec.view,...panel.view,...(panel.period_id?{period_id:panel.period_id}:{})};
  spec.title=panel.title??base.title;
  spec.layers=spec.layers.map(layer=>{
    const next=clone(layer);
    if(panel.series_id)next.encoding={dataset_id:next.encoding.dataset_id,series_id:panel.series_id};
    if(panel.encodings?.[layer.id])next.encoding=clone(panel.encodings[layer.id]);
    if(domains.has(layer.id)){const patch=domains.get(layer.id);if(patch.classification)next.classification=clone(patch.classification);next.options={...next.options,...clone(patch.options)};}
    return next;
  });
  return spec;
}

export class SmallMultiples {
  constructor(container,bundle,panels,options={}) {
    require(Array.isArray(panels)&&panels.every(panel=>object(panel)&&typeof panel.id==='string'&&panel.id.length>0)&&new Set(panels.map(panel=>panel.id)).size===panels.length,'small multiple panels require unique ids');
    for(const panel of panels)if(panel.title!=null)require(typeof panel.title==='string','panel title must be plain text');
    options=controllerOptions(options,['sharedDomain','controls']);
    if(options.pageSize!=null)require(Number.isInteger(options.pageSize)&&options.pageSize>0,'pageSize must be a positive integer');
    for(const key of ['width','height'])if(options[key]!=null)require(Number.isFinite(options[key])&&options[key]>0,`${key} must be positive`);
    this.container=container;this.bundle=clone(bundle);this.panels=clone(panels);this.options=options;this.page=0;this.maps=[];this.destroyed=false;this.generation=0;
    const loaded=inlineResources(this.bundle),spec=resolveProfile(loaded.spec),{geography,datasets}=loaded;this.base=spec;this.geography=geography;this.datasets=datasets;this.domains=new Map();
    const specs=panels.map(panel=>panelSpec(spec,panel,new Map()));
    for(const candidate of specs)validateMapSpec(candidate,geography,datasets);
    if(options.sharedDomain!==false)this.domains=comparisonDomains(spec,specs,datasets,geography);
    this.showPage(0);
  }
  showPage(page){
    if(this.destroyed)throw new StatsMapError('small multiples are destroyed','LIFECYCLE');
    const size=this.options.pageSize??6,pages=Math.max(1,Math.ceil(this.panels.length/size));
    if(!Number.isInteger(size)||size<1||!Number.isInteger(page)||page<0||page>=pages)throw new StatsMapError('invalid small multiple page','INVALID_ARGUMENT');
    const generation=++this.generation,staged=[],cards=[];let nextLink,cleanup;
    const active=this.container?.ownerDocument?.activeElement,focus=this.container?.contains?.(active)?active?.getAttribute?.('data-multiples-control'):null;
    try{for(const panel of this.panels.slice(page*size,(page+1)*size)){
      let target=null;
      if(this.container){const document=this.container.ownerDocument,card=document.createElement('section'),heading=document.createElement('h3');card.setAttribute('data-map-panel',panel.id);heading.textContent=panel.title??panel.id;styleControl(heading,createPresentation(this.base,this.geography));card.appendChild(heading);target=document.createElement('div');card.appendChild(target);cards.push(card);}
      const spec=panelSpec(this.base,panel,this.domains),resources=this.bundle.resources.filter(entry=>entry.resource?.kind!=='stats-map/spec');
      const bundle={...this.bundle,spec_ref:{id:spec.id,revision:spec.revision},resources:[...resources,{storage:'inline',resource:spec}]};
      const map=createMap(bundle,{...this.options,container:null});staged.push(map);if(target)map.mount(target);else map.render();
    }
    nextLink=new MapLink(staged,{selection:true,hover:true});
    if(this.container&&pages>1&&this.options.controls!==false){
      const document=this.container.ownerDocument,nav=document.createElement('nav'),previous=document.createElement('button'),next=document.createElement('button'),output=document.createElement('output'),labels=this.options.labels??{};
      previous.type=next.type='button';
      const p=createPresentation(this.base,this.geography);nav.setAttribute('aria-label',labels.pages??p.t('pages'));previous.textContent=labels.previous??p.t('previous');next.textContent=labels.next??p.t('next');output.textContent=`${p.number(page+1)} / ${p.number(pages)}`;for(const element of [nav,previous,next,output])styleControl(element,p);output.setAttribute('aria-live','polite');previous.disabled=page===0;next.disabled=page===pages-1;
      previous.setAttribute('data-multiples-control','previous');next.setAttribute('data-multiples-control','next');nav.setAttribute('data-multiples-control','pages');nav.tabIndex=-1;
      const apply=target=>{try{this.showPage(target);}catch(error){output.textContent=error.message;this.maps[0]?.events.emit('error',{error,source:'small-multiples',page:target});}};
      const back=()=>apply(this.page-1),advance=()=>apply(this.page+1);previous.addEventListener('click',back);next.addEventListener('click',advance);nav.appendChild(previous);nav.appendChild(output);nav.appendChild(next);cards.push(nav);
      cleanup=()=>{previous.removeEventListener('click',back);next.removeEventListener('click',advance);};
    }
    if(this.destroyed||this.generation!==generation){cleanup?.();nextLink.destroy();staged.forEach(map=>map.destroy());return this.maps;}
    this.container?.replaceChildren?.(...cards);
    }catch(error){cleanup?.();nextLink?.destroy();staged.forEach(map=>map.destroy());throw error;}
    const oldMaps=this.maps,oldLink=this.link,oldCleanup=this.paginationCleanup;
    this.maps=staged;this.link=nextLink;this.paginationCleanup=cleanup;this.page=page;this.pageCount=pages;
    oldCleanup?.();oldLink?.destroy();oldMaps.forEach(map=>map.destroy());
    if(!this.destroyed&&this.generation===generation&&focus){const controls=[...(this.container.querySelectorAll?.('[data-multiples-control]')??[])],target=controls.find(element=>element.getAttribute('data-multiples-control')===focus&&!element.disabled)??controls.find(element=>element.tagName==='BUTTON'&&!element.disabled)??controls[0];target?.focus?.();}
    return this.maps;
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.generation++;this.paginationCleanup?.();this.paginationCleanup=null;this.link?.destroy();const maps=this.maps;this.maps=[];maps.forEach(map=>map.destroy());this.container?.replaceChildren?.();}
}

export class StoryMap {
  constructor(map,chapters,options={}) {
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    require(Array.isArray(chapters)&&chapters.length&&chapters.every(chapter=>object(chapter)&&typeof chapter.id==='string'&&chapter.id.length>0)&&new Set(chapters.map(chapter=>chapter.id)).size===chapters.length,'story requires uniquely identified chapters');
    this.map=map;this.chapters=clone(chapters);this.options=controllerOptions(options);this.base=clone(map.spec);this.index=0;this.destroyed=false;this.generation=0;this.controlError=null;this.id=`story-map-${++sequence}`;
    for(const chapter of this.chapters){
      for(const field of ['title','caption'])if(chapter[field]!=null&&typeof chapter[field]!=='string')throw new StatsMapError(`chapter ${field} must be plain text`,'INVALID_ARGUMENT');
      if(chapter.selection!=null&&(!Array.isArray(chapter.selection)||chapter.selection.some(id=>!map.geography.regions.some(region=>region.id===id))))throw new StatsMapError('chapter selection must contain registered regions','INVALID_ARGUMENT');
      if(chapter.sources!=null&&(!Array.isArray(chapter.sources)||chapter.sources.some(source=>typeof source!=='string'&&(!source||typeof source!=='object'||Array.isArray(source)))))throw new StatsMapError('chapter sources must be text or source objects','INVALID_ARGUMENT');
      validateMapSpec(this.chapterSpec(chapter),map.geography,map.datasets);
    }
    this.unsubscribe=map.on('destroy',()=>this.destroy());this.presentationCleanup=map.on('specchange',()=>this.updateControls?.());
    try{this.goTo(0);}catch(error){this.destroy();throw error;}
  }
  chapterSpec(chapter){const current=this.map.spec;return {...clone(this.base),locale:current.locale,messages:current.messages,theme:current.theme,number_format:current.number_format,view:{...this.base.view,...(current.view?.locale?{locale:current.view.locale}:{}),...chapter.view},...(chapter.layers?{layers:chapter.layers}:{}),...(chapter.layout?{layout:chapter.layout}:{})};}
  goTo(index){
    if(this.destroyed||this.map.destroyed)throw new StatsMapError('story is destroyed','LIFECYCLE');
    if(!Number.isInteger(index)||index<0||index>=this.chapters.length)throw new StatsMapError('chapter index out of range','INVALID_ARGUMENT');
    const generation=++this.generation,chapter=this.chapters[index],spec=this.chapterSpec(chapter);
    require(chapter.selection==null||chapter.selection.every(id=>this.map.geography.regions.some(region=>region.id===id)),'chapter selection must contain registered regions');
    try{this.map.setSpec(spec);}catch(error){if(!this.destroyed&&!this.map.destroyed&&generation===this.generation)throw error;}
    if(this.destroyed||this.map.destroyed||generation!==this.generation)return chapter;
    this.index=index;this.controlError=null;
    try{this.map.setSelection(chapter.selection??[],{source:'story'});}catch(error){if(!this.destroyed&&!this.map.destroyed&&generation===this.generation)throw error;}
    if(this.destroyed||this.map.destroyed||generation!==this.generation)return chapter;
    if(this.options.captionElement)this.options.captionElement.textContent=chapter.caption??chapter.title??'';
    this.updateControls?.();
    this.map.events.emit('storychange',{chapter_id:chapter.id,index,title:chapter.title,caption:chapter.caption,sources:clone(chapter.sources??[]),source:'story',controller_id:this.id});
    return chapter;
  }
  next(){return this.goTo(Math.min(this.chapters.length-1,this.index+1));}
  previous(){return this.goTo(Math.max(0,this.index-1));}
  mount(container){
    if(this.destroyed||this.map.destroyed)throw new StatsMapError('story is destroyed','LIFECYCLE');this.unmount();
    const document=container.ownerDocument,labels=this.options.labels??{},previous=document.createElement('button'),next=document.createElement('button'),select=document.createElement('select'),caption=document.createElement('p'),sources=document.createElement('ul'),errorOutput=document.createElement('output');
    previous.type=next.type='button';
    previous.textContent=labels.previous??'Previous';next.textContent=labels.next??'Next';select.setAttribute('aria-label',labels.chapter??'Chapter');caption.setAttribute('aria-live','polite');
    errorOutput.setAttribute('aria-live','polite');for(const [element,name] of [[previous,'previous'],[next,'next'],[select,'chapter'],[caption,'caption'],[sources,'sources'],[errorOutput,'error']])element.setAttribute('data-story-control',name);
    for(const [index,chapter] of this.chapters.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=chapter.title??chapter.id;select.appendChild(option);}
    const apply=index=>{try{this.goTo(index);}catch(error){if(this.destroyed||this.map.destroyed)return;this.controlError={code:error.code??'INVALID_ARGUMENT',message:error.message};this.updateControls?.();this.map.events.emit('error',{error,source:'story',controller_id:this.id,chapter_id:this.chapters[index]?.id});}};
    const back=()=>apply(Math.max(0,this.index-1)),advance=()=>apply(Math.min(this.chapters.length-1,this.index+1)),change=()=>apply(Number(select.value));
    previous.addEventListener('click',back);next.addEventListener('click',advance);select.addEventListener('change',change);container.replaceChildren(previous,select,next,caption,sources,errorOutput);
    this.updateControls=()=>{
      const p=createPresentation(this.map.spec,this.map.geography),chapter=this.chapters[this.index];previous.textContent=labels.previous??p.t('previous');next.textContent=labels.next??p.t('next');select.setAttribute('aria-label',labels.chapter??p.t('chapter'));for(const element of [previous,next,select,caption,sources,errorOutput])styleControl(element,p);select.value=String(this.index);previous.disabled=this.index===0;next.disabled=this.index===this.chapters.length-1;caption.textContent=chapter.caption??'';errorOutput.textContent=this.controlError?.message??'';sources.replaceChildren();
      for(const source of chapter.sources??[]){const item=document.createElement('li');item.textContent=typeof source==='string'?source:source.title??source.label??source.id??'';if(typeof source==='object'&&typeof source.url==='string'&&/^https?:\/\//i.test(source.url)){const link=document.createElement('a');link.href=source.url;link.textContent=source.url;link.rel='noopener noreferrer';item.appendChild(link);}sources.appendChild(item);}
    };
    this.cleanup=()=>{previous.removeEventListener('click',back);next.removeEventListener('click',advance);select.removeEventListener('change',change);container.replaceChildren();};
    this.updateControls();return this;
  }
  unmount(){this.cleanup?.();this.cleanup=null;this.updateControls=null;return this;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.generation++;this.unmount();this.unsubscribe?.();this.presentationCleanup?.();}
}
