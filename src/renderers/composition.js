import { localizedLabel } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { legendFilterAttributes } from '../core/legend-filter.js';

export const COMPOSITION_COLORS=['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02'];
export const escapeSvg=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function compositionItems(ids,view,options={}) {
  const order=options.categoryOrder??ids;
  if(order.length!==ids.length||new Set(order).size!==ids.length||order.some(id=>!ids.includes(id)))throw new StatsMapError('categoryOrder must contain every component exactly once','INVALID_ENCODING');
  const items=order.map(id=>{
    const index=ids.indexOf(id),series=view.series.get(id);
    if(!series)throw new StatsMapError(`unknown component series: ${id}`,'UNKNOWN_SERIES');
    return {id,index,label:localizedLabel(series,options.locale,localizedLabel(view.metricForSeries(id),options.locale,id)),color:Array.isArray(options.colors)?options.colors[index]??COMPOSITION_COLORS[index%COMPOSITION_COLORS.length]:options.colors?.[id]??COMPOSITION_COLORS[index%COMPOSITION_COLORS.length]};
  });
  if(options.totalSeriesId&&options.showOther!==false)items.push({id:'__other__',index:ids.length,label:options.otherLabel??'Other',color:options.otherColor??'#ffcc80'});
  return items;
}

export function compositionFor(ids,view,regionId,periodId,options={},aggregation) {
  const basis=aggregation?.basis_id&&(!aggregation.dataset_id||aggregation.dataset_id===view.data.id)?{basisId:aggregation.basis_id,displayValue:aggregation.display_value??'rollup'}:{};
  const result=view.composition(ids,regionId,periodId,{...basis,totalSeriesId:options.totalSeriesId});
  const items=compositionItems(ids,view,options).map(item=>{
    const component=result.values.find(value=>value.seriesId===item.id);
    const value=item.id==='__other__'?result.other:component.value;
    return {...item,value,share:value==null||!result.canNormalize?null:value/result.denominator};
  });
  if(options.sort!=null&&!['ascending','descending','none'].includes(options.sort))throw new StatsMapError('unsupported composition sort','INVALID_ENCODING');
  if(options.sort==='ascending'||options.sort==='descending')items.sort((a,b)=>(options.sort==='ascending'?1:-1)*((a.value??0)-(b.value??0))||a.index-b.index);
  const status=result.conflict?'conflict':!result.complete||result.denominator==null?'incomplete':result.denominator===0?'zero':'value';
  return {...result,items,status};
}

// Repeating fills are clipped by the region path (or layout cell), including holes.
export function stripePattern(composition,id,options={}) {
  if(composition.status!=='value')return {definition:'',fill:composition.status==='zero'?(options.zeroColor??'#ffffff'):composition.status==='conflict'?(options.conflictColor??'#fee2e2'):(options.noDataColor??'#e5e7eb')};
  const width=options.stripeWidth??50;
  const angle=options.orientation==='horizontal'?90:options.orientation==='vertical'||options.orientation==null?0:options.orientation;
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(angle))throw new StatsMapError('stripe width must be positive and orientation must be an angle','INVALID_ENCODING');
  let at=0,rects='';
  for(const item of composition.items){
    const w=width*item.share;
    rects+=`<rect data-component-index="${item.index}" data-series-id="${escapeSvg(item.id)}" data-value="${item.value}" data-share="${item.share}" x="${at}" y="0" width="${w}" height="${width}" fill="${escapeSvg(item.color)}"${legendFilterAttributes(`component:${item.id}`,options.legendFilter)}/>`;
    at+=w;
  }
  const definition=`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${width}" height="${width}" patternTransform="rotate(${angle})"><rect width="${width}" height="${width}" fill="${escapeSvg(options.remainderColor??'#e5e7eb')}"/>${rects}</pattern>`;
  return {definition,fill:`url(#${id})`};
}
