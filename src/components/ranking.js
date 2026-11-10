import { viewRegionIds } from '../core/view.js';
import { channelBindings, channelView, channelValues } from '../core/channels.js';
import { createPresentation, presentedLayer } from '../core/presentation.js';
import { escapeSvg } from './decorations.js';
import { StatsMapError } from '../core/errors.js';
import { classifyDomain } from '../core/classification.js';
import { getRenderer } from '../renderers/registry.js';
import { numericColor } from '../renderers/color.js';
import { symbolColorModel } from '../renderers/symbol-color.js';
import { rankingLayout } from './ranking-layout.js';
import { rankingDistribution, rankingNumber, rankingScale, validateRankingOptions } from './ranking-options.js';
import { validateRankingRegionSet } from '../core/region-sets.js';

export function buildRanking(map,options={}) {
  options={...map.spec.ranking,...options};
  validateRankingOptions(options);
  validateRankingRegionSet(options.regionSet,options.regionIds,map.geography);
  const regionSet=options.regionSet?structuredClone(options.regionSet):undefined;
  const diagnostics=regionSet?.unavailable_region_ids.length?[{code:'REGION_SET_UNAVAILABLE_MEMBERS',region_set_id:regionSet.id,region_ids:[...regionSet.unavailable_region_ids]}]:[];
  const p=createPresentation(map.spec,map.geography);
  if(options.layerId&&!map.spec.layers.some(layer=>layer.id===options.layerId))throw new StatsMapError('ranking references an unknown layer','INVALID_ARGUMENT');
  if(options.direction&&!['ascending','descending'].includes(options.direction))throw new StatsMapError('invalid ranking direction','INVALID_ARGUMENT');
  const layer=map.spec.layers.find(layer=>layer.id===options.layerId)??map.spec.layers[0],encoding=layer?.encoding??{};
  const channel=channelBindings(encoding,{includeException:false}).find(binding=>(!options.seriesId||binding.series_id===options.seriesId)&&(!options.datasetId||binding.dataset_id===options.datasetId))??{};
  const datasetId=options.datasetId??channel.dataset_id??encoding.dataset_id??map.spec.dataset_refs[0]?.id;
  const seriesId=options.seriesId??channel.series_id,periodId=options.periodId??map.spec.view?.period_id,view=channelView({...channel,dataset_id:datasetId},null,map._views,map.spec);
  if(!view||!seriesId||!view.series.has(seriesId)||!view.periods.has(periodId))throw new StatsMapError('ranking requires an existing dataset, series and period','INVALID_ARGUMENT');
  const series=view.series.get(seriesId),metric=view.metricForSeries(seriesId),unit=view.data.units.find(unit=>unit.id===series.unit_id);
  if(metric.value_type!=='number')return {available:false,reason:options.categoryLabel??p.t('categoryRanking'),datasetId,seriesId,periodId,rows:[],missing:[],unit,regionSet,diagnostics};
  const ids=new Set(options.regionIds??viewRegionIds(map.geography,map.spec)),labels=new Map(map.geography.regions.map(region=>[region.id,p.label(region,region.id)]));
  // Ranking never replaces reported values with rollups, shares or rounded labels.
  const values=new Map(view.values(seriesId,periodId,[...ids]).map(value=>[value.region_id,value]));
  const rows=[],missing=[];
  for(const id of ids){if(!labels.has(id))throw new StatsMapError(`ranking references unknown region: ${id}`,'INVALID_ARGUMENT');const observation=values.get(id);const row={region_id:id,label:labels.get(id),value:observation?.value??null,status:observation?.status??'missing',observation};
    if(row.status==='value'&&typeof row.value==='number')rows.push(row);else missing.push(row);
  }
  // Reuse the map's declared numeric classifier and palette; bar lengths still
  // encode the original ranked value. A distribution count is never recolored
  // as if it were a numeric observation in the map's unit.
  const rendered=layer?presentedLayer({...layer,type:getRenderer(layer.type).type},p):null;
  let colorFor=()=>options.color??rendered?.options.fill??p.theme.accent;
  if(rendered&&['choropleth','alpha'].includes(rendered.type)&&!options.color){
    const binding=channelBindings(encoding,{includeException:false})[0],colorView=channelView(binding,null,map._views,map.spec);
    const scoped=new Set(viewRegionIds(map.geography,map.spec)),values=channelValues(colorView,binding.series_id,periodId,layer.aggregation??map.spec.aggregation).filter(row=>scoped.has(row.region_id));
    const domain=classifyDomain(values.filter(row=>row.status==='value'&&typeof row.value==='number').map(row=>row.value),layer.classification?.axes?.[0]??layer.classification??{}),index=new Map(values.map(row=>[row.region_id,row]));
    colorFor=id=>{const row=index.get(id);return row?.status==='value'?numericColor(row.value,domain,rendered.options):rendered.options.noDataColor;};
  }
  if(rendered?.type==='proportionalSymbol'&&rendered.encoding.color&&!options.color){
    const model=symbolColorModel(rendered,null,map._views,{...map.spec,view:{...map.spec.view,period_id:periodId}});
    colorFor=id=>model.style(id).color;
  }
  for(const row of rows)row.color=colorFor(row.region_id);
  const direction=(options.direction??(options.ascending===true?'ascending':'descending'))==='ascending'?1:-1;
  rows.sort((a,b)=>direction*(a.value-b.value)||(a.region_id<b.region_id?-1:a.region_id>b.region_id?1:0));
  let rank=0,last;for(let index=0;index<rows.length;index++){if(index===0||rows[index].value!==last)rank=index+1;rows[index].rank=rank;last=rows[index].value;}
  const limit=options.limit??rows.length;if(!Number.isInteger(limit)||limit<0)throw new StatsMapError('ranking limit must be a non-negative integer','INVALID_ARGUMENT');
  const visible=rows.slice(0,limit),mode=options.mode==='histogram'||(options.mode??'auto')==='auto'&&visible.length>(options.barLimit??40)?'histogram':'bars';
  return {available:true,datasetId,seriesId,periodId,layerId:layer?.id,periodLabel:p.label(view.periods.get(periodId),periodId),unit,rows:visible,missing,total:rows.length,hidden:Math.max(0,rows.length-limit),mode,bins:rankingDistribution(visible,options.bins),regionSet,diagnostics};
}
export function rankingSvg(map,options={}) {
  options={...map.spec.ranking,...options};
  const p=createPresentation(map.spec,map.geography),{theme}=p,model=buildRanking(map,options),layout=rankingLayout(model,options,p),{width,height,scale}=layout;
  const corner=options.position,defaultX=corner?.endsWith('right')?map.viewport.width-width-12:12,defaultY=corner?.startsWith('bottom')?map.viewport.height-height-12:corner?12:65;
  const x=options.x??defaultX,top=options.y!=null?options.y-15:defaultY;
  const text=el=>`<text data-ranking-${el.kind??'text'}="true" aria-label="${escapeSvg(el.value)}" x="${el.x}" y="${el.y*scale}" font-family="${escapeSvg(theme.fontFamily)}" font-size="${el.fontSize*scale}" fill="${theme.text}">${el.lines.map((line,index)=>index===0?escapeSvg(line):`<tspan x="${el.x}" y="${(el.y+index*el.fontSize*1.25)*scale}">${escapeSvg(line)}</tspan>`).join('')}</text>`;
  const rowText=new Set(layout.rows.flatMap(row=>[row.label,row.numeric]));
  let svg=layout.elements.filter(el=>!rowText.has(el)).map(text).join('');
  for(const row of layout.rows){
    const {entry,bar,bounds}=row,selected=!row.bin&&map.selection.has(entry.region_id),highlighted=!row.bin&&map.hoveredRegionId===entry.region_id;
    const attrs=row.bin?`data-ranking-bin="${entry.index}" role="img" aria-label="${escapeSvg(`${row.name}: ${p.number(entry.count)} ${p.t('rankingRegions')}`)}"`:`data-region-id="${escapeSvg(entry.region_id)}" data-ranking-row="true" data-ranking-dataset="${escapeSvg(model.datasetId)}" data-series-id="${escapeSvg(model.seriesId)}" data-period-id="${escapeSvg(model.periodId)}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${escapeSvg(`${p.number(entry.rank)}. ${entry.label}: ${rankingNumber(p,entry.value,options)} ${p.label(model.unit)}`)}"`;
    svg+=`<g ${attrs}><rect data-ranking-row-background="true" x="${bounds.x}" y="${bounds.y*scale}" width="${bounds.width}" height="${bounds.height*scale}" fill="${selected?theme.selectedBackground:highlighted?theme.hoverBackground:theme.background}"/>${text(row.label)}${text(row.numeric)}<rect data-ranking-bar="true" x="${bar.x}" y="${bar.y*scale}" width="${bar.width}" height="${bar.height*scale}" fill="${escapeSvg(options.color??entry.color??theme.accent)}"/><path data-ranking-zero="true" d="M${bar.zero},${(bar.y-1)*scale}v${(bar.height+2)*scale}" stroke="${theme.text}"/></g>`;
  }
  const zoomed=Math.abs((map.getViewTransform?.().zoom??1)-1)>1e-9,opacity=options.onlyApplyOpacityWhileZoomed&&!zoomed?1:options.boxOpacity??.9;
  const diagnostics=[...model.diagnostics];if(x<0||top<0||x+width>map.viewport.width||top+height>map.viewport.height)diagnostics.push({code:'RANKING_OVERFLOW',bounds:{x,y:top,width,height},viewport:{...map.viewport}});
  return {model,layout,bounds:{x,y:top,width,height},diagnostics,svg:`<g data-map-ranking="true" direction="ltr" transform="translate(${x} ${top})" data-layer-id="${escapeSvg(model.layerId??options.layerId??map.spec.layers[0]?.id)}"><rect data-ranking-background="true" width="${width}" height="${height}" fill="${theme.panelBackground}" fill-opacity="${opacity}" stroke="${theme.border}"/>${svg}</g>`};
}

export class RankingChart {
  constructor(map,options={}) {
    if(map.destroyed)throw new StatsMapError('map is destroyed','LIFECYCLE');
    this.map=map;this.options=options;this.page=0;this.mode=null;this.destroyed=false;this.model=buildRanking(map,options);this.disposers=['render','regionhover','selectionchange'].map(name=>map.on(name,()=>this.render()));
    this.pageCount=Math.max(1,Math.ceil(this.model.rows.length/(options.pageSize??map.spec.ranking?.pageSize??40)));
    this.disposers.push(map.on('destroy',()=>this.destroy()));
  }
  setMode(mode){if(this.destroyed)throw new StatsMapError('ranking chart is destroyed','LIFECYCLE');if(!['auto','bars','histogram'].includes(mode))throw new StatsMapError('invalid ranking mode','INVALID_ARGUMENT');this.mode=mode;this.page=0;this.render();return this;}
  showPage(page){if(this.destroyed)throw new StatsMapError('ranking chart is destroyed','LIFECYCLE');if(!Number.isInteger(page)||page<0)throw new StatsMapError('ranking page must be a nonnegative integer','INVALID_ARGUMENT');this.page=page;this.render();return this;}
  mount(container){if(this.destroyed)throw new StatsMapError('ranking chart is destroyed','LIFECYCLE');this.unmount();this.container=container;
    this.click=event=>{
      const control=event.target?.closest?.('[data-ranking-control]');
      if(control){const name=control.getAttribute('data-ranking-control');if(name==='bars'||name==='histogram')this.setMode(name);else this.showPage(this.page+(name==='next'?1:-1));return;}
      const row=event.target?.closest?.('[data-ranking-region]');if(row)this.map.activateRegion(row.getAttribute('data-ranking-region'),{source:'ranking'});
    };
    this.focus=event=>{const row=event.target?.closest?.('[data-ranking-region]');if(row&&!this.rendering&&this.map.hoveredRegionId!==row.getAttribute('data-ranking-region'))this.map.hover(row.getAttribute('data-ranking-region'),'ranking');};
    this.leave=()=>{if(this.rendering)return;queueMicrotask(()=>{if(!this.destroyed&&!this.container?.contains(this.container.ownerDocument.activeElement))this.map.hover(null,'ranking');});};
    for(const [name,handler] of [['click',this.click],['pointerover',this.focus],['focusin',this.focus],['pointerleave',this.leave],['focusout',this.leave]])container.addEventListener(name,handler);
    this.render();return this;
  }
  render(){
    if(this.destroyed||this.rendering)return this.model;
    const options={...this.map.spec.ranking,...this.options,...(this.mode?{mode:this.mode}:{})};
    try{this.model=buildRanking(this.map,options);}catch(error){this.model={available:false,reason:error.message,rows:[],missing:[],bins:[]};}
    const pageSize=options.pageSize??40;this.pageCount=Math.max(1,Math.ceil(this.model.rows.length/pageSize));this.page=Math.min(this.page,this.pageCount-1);
    if(!this.container)return this.model;
    this.rendering=true;
    try {
      const p=createPresentation(this.map.spec,this.map.geography),{theme}=p;
      const signature=JSON.stringify([this.model,p.locale,theme,[...this.map.selection],this.page,options]);
      if(this.signature===signature){
        for(const button of this.container.querySelectorAll('[data-ranking-region]')){const id=button.getAttribute('data-ranking-region');button.setAttribute('data-highlighted',String(this.map.hoveredRegionId===id));button.style.background=this.map.selection.has(id)?theme.selectedBackground:this.map.hoveredRegionId===id?theme.hoverBackground:theme.background;}
        return this.model;
      }
      this.signature=signature;
      const document=this.container.ownerDocument,active=this.container.contains(document.activeElement)?document.activeElement:null,focused=active?.getAttribute?.('data-ranking-region'),controlFocus=active?.getAttribute?.('data-ranking-control');
      const panel=document.createElement('section');panel.setAttribute('data-ranking-chart','true');panel.setAttribute('lang',p.locale);panel.setAttribute('dir',p.direction);
      Object.assign(panel.style,{fontFamily:theme.fontFamily,color:theme.text,background:theme.panelBackground,boxSizing:'border-box',padding:`${options.boxPadding??7}px`,width:options.width==null?'100%':`${options.width}px`,maxWidth:'100%',overflowWrap:'anywhere'});
      if(options.height!=null)Object.assign(panel.style,{maxHeight:`${options.height}px`,overflowY:'auto'});
      const appendText=(tag,value,attribute)=>{const element=document.createElement(tag);element.textContent=value;if(attribute)element.setAttribute(attribute,'true');panel.appendChild(element);return element;};
      const button=(label,name)=>{const element=document.createElement('button');element.type='button';element.textContent=label;element.setAttribute('data-ranking-control',name);Object.assign(element.style,{fontFamily:theme.fontFamily,color:theme.text,background:theme.background,border:`1px solid ${theme.border}`,whiteSpace:'normal',overflowWrap:'anywhere',maxWidth:'100%'});return element;};
      if(options.title)appendText('h3',options.title,'data-ranking-title');if(options.subtitle)appendText('p',options.subtitle,'data-ranking-subtitle');
      if(!this.model.available)appendText('p',this.model.reason);
      else {
        appendText('p',[p.label(this.model.unit),this.model.periodLabel].filter(Boolean).join(' / '),'data-ranking-context');
        if(this.model.rows.length>(options.barLimit??40)||this.model.mode==='histogram'){
          const toolbar=document.createElement('div');toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label',p.t('ranking'));
          for(const mode of ['bars','histogram']){const toggle=button(p.t(mode==='bars'?'rankingBars':'rankingHistogram'),mode);toggle.setAttribute('aria-pressed',String(this.model.mode===mode));toolbar.appendChild(toggle);}panel.appendChild(toolbar);
        }
        const list=document.createElement(this.model.mode==='histogram'?'ul':'ol');list.setAttribute('aria-label',options.title??p.t('ranking'));Object.assign(list.style,{listStyle:'none',padding:'0',margin:'0'});
        const scale=rankingScale(this.model.rows),maxCount=this.model.bins.reduce((maximum,bin)=>Math.max(maximum,bin.count),0)||1;
        const entries=this.model.mode==='histogram'?this.model.bins:this.model.rows.slice(this.page*pageSize,(this.page+1)*pageSize);
        for(const entry of entries){
          const item=document.createElement('li'),bin=this.model.mode==='histogram',element=document.createElement(bin?'div':'button');
          if(bin){element.setAttribute('data-ranking-bin',String(entry.index));element.textContent=`${entry.lower===entry.upper?rankingNumber(p,entry.lower,options):`${rankingNumber(p,entry.lower,options)} ≤ x ${entry.upperInclusive?'≤':'<'} ${rankingNumber(p,entry.upper,options)}`}: ${p.number(entry.count)} ${p.t('rankingRegions')}`;}
          else {element.type='button';element.setAttribute('data-ranking-region',entry.region_id);element.setAttribute('aria-pressed',String(this.map.selection.has(entry.region_id)));element.setAttribute('data-highlighted',String(this.map.hoveredRegionId===entry.region_id));element.textContent=`${p.number(entry.rank)}. ${entry.label}: ${rankingNumber(p,entry.value,options)} ${p.label(this.model.unit)}`;}
          Object.assign(element.style,{display:'block',boxSizing:'border-box',width:'100%',maxWidth:'100%',minWidth:'0',whiteSpace:'normal',overflowWrap:'anywhere',textAlign:'start',fontFamily:theme.fontFamily,color:theme.text,background:!bin&&this.map.selection.has(entry.region_id)?theme.selectedBackground:!bin&&this.map.hoveredRegionId===entry.region_id?theme.hoverBackground:theme.background,border:`1px solid ${theme.border}`});
          const track=document.createElement('span');track.setAttribute('aria-hidden','true');Object.assign(track.style,{display:'block',height:'4px',width:'100%',position:'relative',background:theme.noData,direction:'ltr'});
          const zero=bin?0:scale.zero,end=bin?entry.count/maxCount:scale.position(entry.value),bar=document.createElement('span');Object.assign(bar.style,{position:'absolute',height:'4px',left:`${Math.min(zero,end)*100}%`,width:`${Math.abs(end-zero)*100}%`,background:options.color??entry.color??theme.accent});track.appendChild(bar);
          const baseline=document.createElement('span');Object.assign(baseline.style,{position:'absolute',height:'8px',width:'1px',top:'-2px',left:`${zero*100}%`,background:theme.text});track.appendChild(baseline);element.appendChild(track);item.appendChild(element);list.appendChild(item);
        }
        panel.appendChild(list);
        if(this.model.mode==='histogram')appendText('p',p.t('rankingDistribution'),'data-ranking-distribution');
        else if(this.pageCount>1){
          const nav=document.createElement('nav');nav.setAttribute('aria-label',p.t('ranking'));const previous=button(p.t('previous'),'previous'),next=button(p.t('next'),'next'),status=document.createElement('span');
          previous.disabled=this.page===0;next.disabled=this.page===this.pageCount-1;status.setAttribute('data-ranking-page','true');status.setAttribute('aria-live','polite');status.textContent=`${p.number(this.page+1)} / ${p.number(this.pageCount)}`;
          nav.appendChild(previous);nav.appendChild(status);nav.appendChild(next);panel.appendChild(nav);
        }
        appendText('p',`${options.missingLabel??p.t('rankingMissing')}: ${p.number(this.model.missing.length)}${this.model.missing.length?' ('+this.model.missing.map(row=>row.label+': '+p.t(row.status)).join('; ')+')':''}${this.model.hidden?`; ${options.hiddenLabel??p.t('hiddenRanking')}: ${p.number(this.model.hidden)}`:''}`, 'data-ranking-missing');
      }
      this.container.replaceChildren(panel);
      if(active){
        const candidate=[...panel.querySelectorAll('button')].find(el=>!el.disabled&&(focused?el.getAttribute('data-ranking-region')===focused:controlFocus&&el.getAttribute('data-ranking-control')===controlFocus))??panel.querySelector('button:not(:disabled)');
        if(candidate){candidate.focus();queueMicrotask(()=>{if(!this.destroyed&&document.activeElement===candidate){const id=candidate.getAttribute('data-ranking-region');if(this.map.hoveredRegionId!==(id??null))this.map.hover(id,'ranking');}});}else {panel.setAttribute('tabindex','-1');panel.focus();}
      }
      return this.model;
    } finally {this.rendering=false;}
  }
  unmount(){if(this.container){for(const [name,handler] of [['click',this.click],['pointerover',this.focus],['focusin',this.focus],['pointerleave',this.leave],['focusout',this.leave]])this.container.removeEventListener(name,handler);this.container.replaceChildren();}this.container=null;this.signature=null;return this;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.unmount();for(const dispose of this.disposers)dispose();this.disposers=[];}
}
