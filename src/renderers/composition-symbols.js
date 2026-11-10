import { resolveView } from '../core/view.js';
import { createPresentation } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { compositionFor, compositionItems, escapeSvg as esc } from './composition.js';
import { waffleAllocation } from './math.js';
import { polar, sector } from './primitives.js';
import { timeDomain } from './temporal.js';
import { legendFilterAttributes } from '../core/legend-filter.js';
import { channelValues } from '../core/channels.js';

// Validate independently of observations, so an empty period cannot hide an
// invalid style until a later update. Stripe patterns have a separate protocol.
export function validateCompositionOptions(type,options={}) {
  const fail=message=>{throw new StatsMapError(message,'INVALID_ENCODING');};
  for(const name of ['size','radius','maxRadius','innerRadius','width','agePyramidHeightFactor','strokeWidth','gap','cornerRadius','maxValue','totalMaximum','componentMaximum','maxWidthValue']){
    if(options[name]!=null&&(!Number.isFinite(options[name])||options[name]<0))fail(`${name} must be finite and non-negative`);
  }
  for(const name of ['strokeOpacity','fillOpacity'])if(options[name]!=null&&(!Number.isFinite(options[name])||options[name]<0||options[name]>1))fail(`${name} must be between zero and one`);
  if(options.offsetAngle!=null&&!Number.isFinite(options.offsetAngle))fail('offsetAngle must be finite');
  if(options.sort!=null&&!['ascending','descending','none'].includes(options.sort))fail('unsupported composition sort');
  const mode=options.mode??options.compositionType;
  if(mode!=null&&(type==='pieChart'&&!['pie','ring','flag','segment','radar','agepyramid','halftone'].includes(mode)||type==='bar'&&!['grouped','stacked'].includes(mode)||type==='coxcomb'&&mode!=='stacked'))fail('unsupported composition mode');
  if(!['share','absolute',undefined].includes(options.radarValueMode))fail('unsupported radarValueMode');
  if(!['area','radius',undefined].includes(options.scaleMode))fail('unsupported composition scaleMode');
  if(options.orientation!=null&&!['horizontal','vertical'].includes(options.orientation))fail('composition orientation must be horizontal or vertical');
  if(options.sizeBy!=null&&(options.sizeBy!=='total'||!['pieChart','waffle'].includes(type)))fail('sizeBy total requires pieChart or waffle; bars and Coxcomb use their value scale');
  if(options.sizeLegend!==undefined&&options.sizeLegend!==false){
    const legend=options.sizeLegend;
    if(!legend||typeof legend!=='object'||Array.isArray(legend)||options.sizeBy!=='total'||!['pieChart','waffle'].includes(type))fail('sizeLegend requires total-sized pieChart or waffle');
    if(Object.keys(legend).some(key=>!['title','values'].includes(key)))fail('unsupported sizeLegend option');
    if(legend.title!==undefined&&typeof legend.title!=='string')fail('sizeLegend title must be a string');
    if(legend.values!==undefined&&(!Array.isArray(legend.values)||!legend.values.length||legend.values.some((value,index)=>!Number.isFinite(value)||value<=0||index>0&&value<=legend.values[index-1])))fail('sizeLegend values must be strictly increasing positive finite numbers');
  }
  for(const name of ['rings','showOther'])if(options[name]!=null&&typeof options[name]!=='boolean')fail(`${name} must be boolean`);
  if(options.stroke!=null&&(typeof options.stroke!=='string'||!options.stroke||/[<>"'&]/.test(options.stroke)))fail('stroke must be a color string');
  if(type==='waffle'){
    const cells=options.cells??100,columns=options.columns??10;
    if(!Number.isInteger(cells)||cells<1||cells>10000||!Number.isInteger(columns)||columns<1||columns>10000)fail('waffle cells and columns must be integers between 1 and 10000');
    if(options.cellPadding!=null&&(!Number.isFinite(options.cellPadding)||options.cellPadding<0||options.cellPadding>=1))fail('cellPadding must be a fraction between zero (inclusive) and one (exclusive)');
  }
}

export function compositionModel(type,ids,view,spec={},options={}) {
  validateCompositionOptions(type,options);
  spec=resolveView(spec,view.geography);
  const presentation=createPresentation(spec,view.geography);
  const mode=options.mode??options.compositionType??(type==='bar'?'grouped':type==='coxcomb'?'stacked':'pie');
  const radarMode=options.radarValueMode??'share';
  const items=compositionItems(ids,view,options),regionIds=spec.view?.region_ids??[...view.regions.keys()];
  const periods=type==='coxcomb'?timeDomain(view,spec).periods:[{id:spec.view?.period_id}];
  const compositions=new Map(regionIds.map(id=>[id,new Map(periods.map(period=>[period.id,compositionFor(ids,view,id,period.id,options,spec.aggregation)]))]));
  const all=[...compositions.values()].flatMap(periods=>[...periods.values()]);
  const valid=all.filter(composition=>composition.status==='value');
  const positiveComponents=valid.some(composition=>composition.items.some(item=>item.value>0));
  const totalMaximum=options.totalMaximum??valid.reduce((max,composition)=>Math.max(max,composition.denominator),0);
  const componentMaximum=options.componentMaximum??valid.reduce((max,composition)=>Math.max(max,...composition.items.map(item=>item.value)),0);
  if(![totalMaximum,componentMaximum].every(value=>Number.isFinite(value)&&value>=0))throw new StatsMapError('composition domains must be non-negative','INVALID_ENCODING');
  const valueMaximum=options.maxValue??(type==='bar'&&mode==='grouped'?componentMaximum:totalMaximum);
  const zeroTotalScale=valid.length>0&&options.sizeBy==='total'&&totalMaximum===0;
  const zeroValueScale=positiveComponents&&(type==='pieChart'&&mode==='radar'&&radarMode==='absolute'&&componentMaximum===0||['bar','coxcomb'].includes(type)&&valueMaximum===0);
  if(zeroTotalScale||zeroValueScale)throw new StatsMapError('positive composition values require a positive scale maximum','INVALID_ENCODING');
  const unit=presentation.label(view.data.units.find(unit=>unit.id===view.series.get(ids[0])?.unit_id));
  const widths=new Map();let widthMaximum=0,widthUnit;
  if(options.widthSeriesId){
    if(type!=='bar'||view.metricForSeries(options.widthSeriesId).value_type!=='number')throw new StatsMapError('bar width requires a numeric series','INVALID_ENCODING');
    widthUnit=presentation.label(view.data.units.find(unit=>unit.id===view.series.get(options.widthSeriesId)?.unit_id));
    const widthValues=new Map(channelValues(view,options.widthSeriesId,spec.view?.period_id,spec.aggregation).map(observation=>[observation.region_id,observation]));
    for(const id of regionIds){
      const observation=widthValues.get(id),value=observation?.status==='value'?observation.value:null;
      if(value!=null&&value<0)throw new StatsMapError('bar width cannot encode a negative value','UNSUPPORTED_VALUE');
      widths.set(id,value);widthMaximum=Math.max(widthMaximum,value??0);
    }
    widthMaximum=options.maxWidthValue??widthMaximum;
    if(!Number.isFinite(widthMaximum)||widthMaximum<0)throw new StatsMapError('bar maxWidthValue must be non-negative','INVALID_ENCODING');
    if(widthMaximum===0&&[...widths.values()].some(value=>value>0))throw new StatsMapError('positive bar widths require a positive maximum','INVALID_ENCODING');
  }
  const model={presentation,type,mode,radarMode,items,periods,compositions,totalMaximum,componentMaximum,unit,options,widths,widthMaximum,widthUnit,
    missing:all.some(item=>item.status==='incomplete'),zero:all.some(item=>item.status==='zero'),conflict:all.some(item=>item.status==='conflict')};
  for(const id of regionIds)if(!Number.isFinite(compositionCollisionRadius(model,id,options.size??options.radius??36)))throw new StatsMapError('composition dimensions exceed the finite geometry range','INVALID_ENCODING');
  return model;
}

function statusMarker(composition,id,x,y,size,period,filter,options={}) {
  const status=composition.status;
  return `<circle data-region-id="${esc(id)}"${period?` data-period-id="${esc(period)}"`:''} data-status="${status==='incomplete'?'incomplete-composition':status+'-composition'}"${legendFilterAttributes(status==='incomplete'?'missing':status,filter)} cx="${x}" cy="${y}" r="${Math.max(2,size*.12)}" fill="${status==='zero'?(options.zeroColor??'#fff'):status==='conflict'?(options.conflictColor??'#fee2e2'):(options.noDataColor??'#e5e7eb')}" stroke="#777"${status==='incomplete'?' stroke-dasharray="2 2"':''}/>`;
}
const attributes=(model,id,item,period)=>model.reference?'':`data-component-index="${item.index}" data-region-id="${esc(id)}" data-series-id="${esc(item.id)}" data-value="${item.value}" data-share="${item.share}"${period?` data-period-id="${esc(period)}"`:''}${legendFilterAttributes(`component:${item.id}`,model.options.legendFilter)}`;
const title=(item,model)=>model.reference?'':`<title>${esc(item.label)}: ${esc(model.presentation.number(item.value))} ${esc(model.unit??'')} (${esc(model.presentation.number(item.share*100,{style:'decimal',minimumFractionDigits:2,maximumFractionDigits:2,maximumSignificantDigits:undefined}))}%)</title>`;

// A layout radius is a glyph-size fallback only in Dorling. Grid cell sizes
// describe placement and must not silently change a composition's value scale.
export function compositionGlyphSize(options={},layout={}) {
  return options.size??options.radius??(layout.type==='dorling'&&layout.radius!=null?layout.radius*2:36);
}

export function compositionSizeLegend(model,size) {
  const config=model.options.sizeLegend;
  if(model.options.sizeBy!=='total'||config===false||model.totalMaximum<=0)return null;
  const values=config?.values??[model.totalMaximum/4,model.totalMaximum/2,model.totalMaximum];
  // Neutral, equal-share references explain nominal total dimensions. In
  // absolute radar mode the component scale still affects actual filled radii;
  // the reference uses the nominal envelope, explicitly labeled by the legend.
  const reference={...model,reference:true,radarMode:'share',options:{...model.options,legendFilter:undefined}};
  const marks=values.map(value=>{
    const items=model.items.map(item=>({...item,color:model.presentation.theme.border,value:value/model.items.length,share:1/model.items.length}));
    reference.compositions=new Map([['reference',new Map([[model.periods[0]?.id,{status:'value',denominator:value,items}]])]]);
    const radius=compositionCollisionRadius(reference,'reference',size);
    if(!Number.isFinite(radius))throw new StatsMapError('sizeLegend dimensions must remain finite','INVALID_ENCODING');
    return {value,radius,svg:compositionSymbolSvg(reference,'reference',0,0,size)};
  });
  return {title:config?.title??model.presentation.t('nominalSize'),marks};
}

function strokeOptions(model) {
  const {options,mode}=model;
  const circular=model.type==='coxcomb'||model.type==='pieChart'&&['pie','ring','radar'].includes(mode);
  return {stroke:options.stroke??(circular?'#fff':'none'),width:options.strokeWidth??.5,opacity:options.strokeOpacity??1};
}
function style(model) {
  const {stroke,width,opacity}=strokeOptions(model);
  return `stroke="${esc(stroke)}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linejoin="round" fill-opacity="${model.options.fillOpacity??1}"`;
}
function strokeExtent(model) {
  const {stroke,width,opacity}=strokeOptions(model);
  return stroke==='none'||stroke==='transparent'||opacity===0?0:width/2;
}
function dimensions(model,composition,size) {
  const factor=model.options.sizeBy==='total'?Math.sqrt(composition.denominator)/Math.sqrt(model.totalMaximum||1):1;
  const result={size:size*factor,radius:(model.options.maxRadius??size)*factor};
  if(!Number.isFinite(size)||size<0||!Object.values(result).every(Number.isFinite))throw new StatsMapError('composition dimensions must remain finite and non-negative','INVALID_ENCODING');
  return result;
}

export function compositionSymbolSvg(model,id,x,y,size) {
  const {options,mode}=model;
  if(model.type==='coxcomb')return coxcombSvg(model,id,x,y,size);
  const composition=model.compositions.get(id)?.get(model.periods[0]?.id);
  if(!composition)return '';
  if(composition.status!=='value')return statusMarker(composition,id,x,y,size,undefined,options.legendFilter,options);
  const measured=dimensions(model,composition,size),radius=measured.radius;
  const items=composition.items;
  if(model.type==='waffle')return waffleSvg(composition,model,id,x,y,measured.size);
  if(model.type==='bar')return barSvg(composition,model,id,x,y,size);
  size=measured.size;
  if(mode==='flag'||mode==='segment'){
    const vertical=(options.orientation??'vertical')==='vertical';
    const width=vertical?size:mode==='segment'?size*.35:size,height=vertical&&mode==='segment'?size*.35:size;
    let cumulative=0;
    return items.map(item=>{
      const rect=`<rect ${attributes(model,id,item)} x="${x-width/2+(vertical?0:cumulative*width)}" y="${y-height/2+(vertical?cumulative*height:0)}" width="${vertical?width:item.share*width}" height="${vertical?item.share*height:height}" fill="${esc(item.color)}" ${style(model)}>${title(item,model)}</rect>`;
      cumulative+=item.share;return rect;
    }).join('');
  }
  const offset=(options.offsetAngle??0)*Math.PI/180,step=Math.PI*2/items.length;
  let cumulative=0;
  const localMaximum=items.reduce((max,item)=>Math.max(max,item.share),0)||1;
  return items.map((item,i)=>{
    const attrs=attributes(model,id,item),fill=esc(item.color);
    if(mode==='agepyramid'){
      const height=size*(options.agePyramidHeightFactor??1),band=height/items.length,width=size*item.share/localMaximum;
      return `<rect ${attrs} x="${x-width/2}" y="${y-height/2+i*band}" width="${width}" height="${band}" fill="${fill}" ${style(model)}>${title(item,model)}</rect>`;
    }
    if(mode==='halftone'){
      const point=polar(x,y,size*.25,-Math.PI/2+i*step+offset),r=size*.333*Math.sqrt(item.share/localMaximum);
      return `<circle ${attrs} cx="${point[0]}" cy="${point[1]}" r="${r}" fill="${fill}" ${style(model)}>${title(item,model)}</circle>`;
    }
    let inner=0,outer=radius,start=-Math.PI/2+cumulative*Math.PI*2+offset,end=start+item.share*Math.PI*2;
    if(mode==='ring'){outer=radius*Math.sqrt(Math.max(0,1-cumulative));inner=radius*Math.sqrt(Math.max(0,1-cumulative-item.share));start=offset;end=offset+Math.PI*2;}
    else if(mode==='radar'){
      outer=radius*Math.sqrt(model.radarMode==='absolute'?item.value/(model.componentMaximum||1):item.share/localMaximum);
      start=-Math.PI/2+i*step+offset;end=start+step;
    }else inner=Math.min(radius,Math.max(0,options.innerRadius??0));
    cumulative+=item.share;
    return `<path ${attrs} data-inner-radius="${inner}" data-outer-radius="${outer}" d="${sector(x,y,inner,outer,start,end)}" fill="${fill}" ${style(model)}>${title(item,model)}</path>`;
  }).join('');
}

// Layout envelopes use the same model, total/width domains and dimensions as
// the glyph drawing above. These circles reserve space, never encode a value.
export function compositionCollisionRadius(model,id,size) {
  const {options,mode}=model;
  for(const [name,value] of Object.entries({size,maxRadius:options.maxRadius??size,width:options.width??size,agePyramidHeightFactor:options.agePyramidHeightFactor??1}))if(!Number.isFinite(value)||value<0)throw new StatsMapError(`Dorling requires nonnegative finite ${name}`,'INVALID_LAYOUT');
  const marker=amount=>Math.max(2,amount*.12);
  if(model.type==='coxcomb'){
    const radius=options.maxRadius??size,maximum=options.maxValue??model.totalMaximum;
    let bound=options.rings===false?0:radius+.25;
    for(const composition of model.compositions.get(id)?.values()??[]){
      if(composition.status!=='value'){bound=Math.max(bound,radius*.7+marker(size*.3)+.5);continue;}
      const sum=composition.items.reduce((sum,item)=>sum+item.value,0),ratio=maximum>0?sum/maximum:0;
      bound=Math.max(bound,radius*(options.scaleMode==='radius'?ratio:Math.sqrt(ratio))+strokeExtent(model));
    }
    return bound;
  }
  const composition=model.compositions.get(id)?.get(model.periods[0]?.id);
  if(!composition)return 0;
  if(composition.status!=='value'||model.type==='bar'&&options.widthSeriesId&&model.widths.get(id)==null)return marker(size)+.5;
  const measured=dimensions(model,composition,size),stroke=strokeExtent(model);
  if(model.type==='bar'){
    const maximum=options.maxValue??(mode==='stacked'?model.totalMaximum:model.componentMaximum);
    const value=mode==='stacked'?composition.items.reduce((sum,item)=>sum+item.value,0):Math.max(0,...composition.items.map(item=>item.value));
    const width=(options.width??size)*(options.widthSeriesId?(model.widthMaximum?model.widths.get(id)/model.widthMaximum:0):1);
    return Math.hypot(width/2,Math.max(size/2,Math.abs(size/2-size*value/(maximum||1))))+stroke;
  }
  size=measured.size;
  if(model.type==='waffle')return size/Math.SQRT2+stroke;
  if(mode==='flag'||mode==='segment')return Math.hypot(size/2,mode==='segment'?size*.175:size/2)+stroke;
  if(mode==='agepyramid')return Math.hypot(size/2,size*(options.agePyramidHeightFactor??1)/2)+stroke;
  if(mode==='halftone')return size*(.25+.333)+stroke;
  if(mode==='radar'&&model.radarMode==='absolute')return measured.radius*Math.sqrt(Math.max(0,...composition.items.map(item=>item.value))/(model.componentMaximum||1))+stroke;
  return measured.radius+stroke;
}

function waffleSvg(composition,model,id,x,y,size) {
  const cells=model.options.cells??100,columns=model.options.columns??10;
  const items=[...composition.items];
  const remainder=composition.denominator-items.reduce((sum,item)=>sum+item.value,0);
  if(remainder>1e-10)items.push({id:'__remainder__',index:items.length,value:remainder,share:remainder/composition.denominator,label:model.options.remainderLabel??'Unshown remainder',color:'#e5e7eb'});
  const counts=waffleAllocation(items.map(item=>item.value),cells),rows=Math.ceil(cells/columns),cell=size/Math.max(columns,rows),padding=cell*(model.options.cellPadding??.08),side=cell-padding;
  let index=0;
  return `<g data-waffle-cells="${cells}" data-approximation="rounded cell allocation">${items.map((item,i)=>Array.from({length:counts[i]},()=>{
    const column=index%columns,row=Math.floor(index/columns);index++;
    return `<rect ${attributes(model,id,item)} x="${x-columns*cell/2+column*cell+padding/2}" y="${y-rows*cell/2+row*cell+padding/2}" width="${side}" height="${side}" rx="${Math.min(model.options.cornerRadius??0,side/2)}" fill="${esc(item.color)}" ${style(model)}>${title(item,model)}</rect>`;
  }).join('')).join('')}</g>`;
}

function barSvg(composition,model,id,x,y,size) {
  const {options,mode}=model,items=composition.items,maximum=options.maxValue??(mode==='stacked'?model.totalMaximum:model.componentMaximum);
  if(!Number.isFinite(maximum)||maximum<0||maximum===0&&items.some(item=>item.value>0))throw new StatsMapError('positive bar values require a positive maxValue','INVALID_ENCODING');
  if(options.widthSeriesId&&model.widths.get(id)==null)return statusMarker({status:'incomplete'},id,x,y,size,undefined,options.legendFilter,options);
  const factor=options.widthSeriesId?(model.widthMaximum?model.widths.get(id)/model.widthMaximum:0):1;
  const width=(options.width??size)*factor,band=width/items.length,gap=options.gap??.5;
  let cumulative=0;
  return items.map((item,i)=>{
    const h=size*item.value/(maximum||1),stacked=mode==='stacked',w=stacked?width:Math.max(0,band-gap),px=stacked?x-width/2:x-width/2+i*band,py=y+size/2-h-(stacked?cumulative:0);
    cumulative+=h;
    return `<rect ${attributes(model,id,item)} data-bar-mode="${mode}"${options.widthSeriesId?` data-width-value="${model.widths.get(id)}"`:''} x="${px}" y="${py}" width="${w}" height="${h}" rx="${options.cornerRadius??0}" fill="${esc(item.color)}" ${style(model)}>${title(item,model)}</rect>`;
  }).join('');
}

function coxcombSvg(model,id,x,y,size) {
  const {options,periods}=model,maximum=options.maxValue??model.totalMaximum,radius=options.maxRadius??size,step=Math.PI*2/Math.max(1,periods.length),area=options.scaleMode!=='radius';
  const r=value=>maximum>0?radius*(area?Math.sqrt(value/maximum):value/maximum):0;
  let out='';
  if(options.rings!==false)for(const share of [.25,.5,.75,1])out+=`<circle data-reference-ring="${share}" cx="${x}" cy="${y}" r="${r(maximum*share)}" fill="none" stroke="#aaa" stroke-width=".5"/>`;
  periods.forEach((period,index)=>{
    const composition=model.compositions.get(id)?.get(period.id);if(!composition)return;
    const start=-Math.PI/2+index*step+(options.offsetAngle??0)*Math.PI/180,end=start+step;
    if(composition.status!=='value'){const point=polar(x,y,radius*.7,(start+end)/2);out+=statusMarker(composition,id,...point,size*.3,period.id,options.legendFilter,options);return;}
    let cumulative=0;
    for(const item of composition.items){const inner=r(cumulative);cumulative+=item.value;const outer=r(cumulative);out+=`<path ${attributes(model,id,item,period.id)} data-inner-radius="${inner}" data-outer-radius="${outer}" d="${sector(x,y,inner,outer,start,end)}" fill="${esc(item.color)}" ${style(model)}>${title(item,model)}</path>`;}
  });
  return out;
}
