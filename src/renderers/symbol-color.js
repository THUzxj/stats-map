import { symbolBindings, channelView, channelValues } from '../core/channels.js';
import { classifyDomain } from '../core/classification.js';
import { StatsMapError } from '../core/errors.js';
import { categoryStyles, numericColor, colorExtent } from './color.js';

// All color consumers use this model; a missing color never removes a valid
// magnitude or turns a reported zero into missing data.
export function symbolColorModel(layer,fallback,views,spec={}) {
  const bindings=symbolBindings(layer.encoding);
  const sizeView=channelView(bindings[0],fallback,views,spec);
  if(sizeView?.metricForSeries(bindings[0].series_id)?.value_type!=='number')throw new StatsMapError('symbol size requires a numeric series','INVALID_ENCODING');
  if(!layer.encoding.color)return null;
  const binding=bindings[1],view=channelView(binding,fallback,views,spec),metric=view.metricForSeries(binding.series_id);
  if(!metric)throw new StatsMapError('unknown symbol color series','INVALID_ENCODING');
  const options={...layer.options},visible=spec.view?.region_ids?new Set(spec.view.region_ids):null;
  const observations=channelValues(view,binding.series_id,spec.view?.period_id,layer.aggregation??spec.aggregation).filter(row=>!visible||visible.has(row.region_id));
  const values=new Map(observations.map(row=>[row.region_id,row]));
  const category=metric.value_type==='category';
  if(category){if(options.categoryColors===undefined&&options.colors===undefined)options.categoryColors=layer.presentation?.theme.categoryColors;}
  else options.colors??=layer.presentation?.theme.numericColors;
  if(options.colorMode!==undefined&&!['classified','continuous','diverging'].includes(options.colorMode))throw new StatsMapError('unsupported symbol colorMode','INVALID_ENCODING');
  const colors=category?options.categoryColors??options.colors:options.colors;
  if(colors!==undefined&&(!colors||typeof colors!=='object'||Object.values(colors).some(color=>typeof color!=='string')||Array.isArray(colors)&&!colors.length||!category&&!Array.isArray(colors)))throw new StatsMapError('invalid symbol color palette','INVALID_COLOR');
  if(category&&options.colorMode&&options.colorMode!=='classified')throw new StatsMapError('categorical symbol color requires classified colorMode','INVALID_ENCODING');
  const styles=category?categoryStyles(view,binding.series_id,options):null;
  const domain=category?null:classifyDomain(observations.filter(row=>row.status==='value').map(row=>row.value),layer.classification??{});
  if(!category){
    colorExtent(domain,options);
    // Validate colors even in an empty period, where drawing cannot exercise
    // interpolation. Use the declared extent when available.
    numericColor((options.colorDomain??[0])[0],{domain:[0,1],classify:()=>0},options);
    if(['continuous','diverging'].includes(options.colorMode)&&(options.colors??[]).some(color=>!/^#[\da-f]{6}$/i.test(color)))throw new StatsMapError('continuous symbol colors must be six-digit hex values','INVALID_COLOR');
  }
  const style=id=>{
    const row=values.get(id);
    if(row?.status!=='value')return {color:options.noDataColor??'#e5e7eb',key:'missing',status:row?.status??'missing'};
    return category?{color:styles.find(item=>item.value===row.value)?.color??options.noDataColor??'#e5e7eb',key:`category:${row.value}`,status:'value'}:{color:numericColor(row.value,domain,options),key:['continuous','diverging'].includes(options.colorMode)?'numeric':`class:${domain.classify(row.value)}`,status:'value'};
  };
  return {binding,view,metric,category,styles,domain,options,observations,missing:observations.some(row=>row.status!=='value'),style};
}
