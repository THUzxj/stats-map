import { localizedLabel } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { escapeSvg as esc } from './composition.js';

export const NUMERIC_COLORS=['#2166ac','#67a9cf','#d1e5f0','#f7f7f7','#ef8a62','#b2182b','#74add1','#fdae61','#d73027'];
export const CATEGORY_COLORS=['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02'];
function rgb(color) {
  if(!/^#[\da-f]{6}$/i.test(color))throw new StatsMapError('colors must be six-digit hex values','INVALID_COLOR');
  return color.slice(1).match(/../g).map(value=>parseInt(value,16));
}
function interpolate(a,b,t){const first=rgb(a),last=rgb(b);return '#'+first.map((value,index)=>Math.round(value+(last[index]-value)*t).toString(16).padStart(2,'0')).join('');}

export function colorExtent(domain,options={}) {
  const extent=[...(options.colorDomain??[domain.domain[0],domain.domain.at(-1)])];
  if(!extent.every(Number.isFinite)&&!options.colorDomain)return [];
  if(extent.length!==2||!extent.every(Number.isFinite)||extent[1]<extent[0])throw new StatsMapError('invalid colorDomain','INVALID_ENCODING');
  if(options.colorMode==='diverging'){
    const center=options.center??0;
    if(!Number.isFinite(center))throw new StatsMapError('diverging center must be finite','INVALID_ENCODING');
    if(options.colorDomain&&(center<extent[0]||center>extent[1]))throw new StatsMapError('diverging center must be within colorDomain','INVALID_ENCODING');
    extent[0]=Math.min(extent[0],center);extent[1]=Math.max(extent[1],center);
  }
  return extent;
}

export function bivariateClassification(layer,index) {
  const options={...layer.classification,...layer.classification?.axes?.[index],classes:3};
  if(options.method==='threshold'&&(options.thresholds?.length??0)>2)throw new StatsMapError('bivariate axes support at most two thresholds (three classes)','INVALID_ENCODING');
  return options;
}

export function numericColor(value,domain,options={}) {
  if(!Number.isFinite(value))return options.noDataColor??'#e5e7eb';
  const colors=options.colors??NUMERIC_COLORS;
  if(!Array.isArray(colors)||!colors.length)throw new StatsMapError('numeric colors must be an array','INVALID_COLOR');
  if(options.colorMode!=='continuous'&&options.colorMode!=='diverging')return colors[(domain.classify(value)??0)%colors.length];
  const extent=colorExtent(domain,options);
  if(!extent.length)return options.noDataColor??'#e5e7eb';
  let t=extent[1]===extent[0]?.5:(value-extent[0])/(extent[1]-extent[0]);
  if(options.colorMode==='diverging'){
    const center=options.center??0;
    if(!Number.isFinite(center)||center<extent[0]||center>extent[1])throw new StatsMapError('diverging center must be within colorDomain','INVALID_ENCODING');
    t=value<center?.5*(value-extent[0])/(center-extent[0]||1):.5+.5*(value-center)/(extent[1]-center||1);
  }
  t=Math.max(0,Math.min(1,t))*(colors.length-1);
  const index=Math.min(colors.length-1,Math.floor(t));
  return interpolate(colors[index],colors[Math.min(index+1,colors.length-1)],t-index);
}

export function categoryStyles(view,seriesId,options={}) {
  const metric=view.metricForSeries(seriesId);
  if(metric.value_type!=='category')throw new StatsMapError('category styling requires a category series','INVALID_ENCODING');
  const dictionary=view.data.dimensions.find(dimension=>dimension.id===metric.category_dimension_id)?.values??[];
  const colors=options.categoryColors??options.colors;
  return [...dictionary].sort((a,b)=>(a.order??0)-(b.order??0)).map((item,index)=>({value:item.id,label:localizedLabel(item,options.locale,item.id),color:Array.isArray(colors)?colors[index%colors.length]:colors?.[item.id]??CATEGORY_COLORS[index%CATEGORY_COLORS.length],index}));
}

export function classificationTexture(id,index,classes,options={}) {
  const texture=typeof options.texture==='string'?{type:options.texture}:options.texture;
  if(!texture)return null;
  if(!['dot','square'].includes(texture.type))throw new StatsMapError('unsupported classification texture','INVALID_ENCODING');
  const spacing=texture.spacing??10;
  if(!Number.isFinite(spacing)||spacing<=0)throw new StatsMapError('texture spacing must be positive','INVALID_ENCODING');
  const radius=spacing*.42*(index+1)/Math.max(1,classes),fill=esc(texture.color??'#334155'),background=esc(texture.background??'#fff');
  const shape=texture.type==='dot'?`<circle cx="${spacing/2}" cy="${spacing/2}" r="${radius}" fill="${fill}"/>`:`<rect x="${spacing/2-radius}" y="${spacing/2-radius}" width="${radius*2}" height="${radius*2}" fill="${fill}"/>`;
  return {fill:`url(#${id})`,definition:`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}"><rect width="${spacing}" height="${spacing}" fill="${background}"/>${shape}</pattern>`};
}
