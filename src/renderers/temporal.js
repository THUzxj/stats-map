import { resolveView } from '../core/view.js';
import { createPresentation } from '../core/presentation.js';
import { StatsMapError } from '../core/errors.js';
import { escapeSvg as esc } from './composition.js';
import { channelValues } from '../core/channels.js';

export function timeDomain(view,spec={},options={}) {
  let periods=[...view.data.periods].sort((a,b)=>a.order-b.order);
  const window=spec.view?.time_window;
  if(window){
    const start=Array.isArray(window)?window[0]:window.start_period_id,end=Array.isArray(window)?window[1]:window.end_period_id;
    const first=periods.findIndex(period=>period.id===start),last=periods.findIndex(period=>period.id===end);
    if(first<0||last<first)throw new StatsMapError('time_window requires ordered, registered period ids','INVALID_ENCODING');
    periods=periods.slice(first,last+1);
  }
  const parse=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  const starts=periods.map(period=>parse(period.start));
  const actual=starts.length>1&&starts.every(Number.isFinite);
  if(actual&&starts.some((value,index)=>index>0&&value<=starts[index-1]))throw new StatsMapError('period start times must increase in declared time order','INVALID_ENCODING');
  const coordinates=actual?starts:periods.map(period=>period.order);
  const first=coordinates[0]??0,span=(coordinates.at(-1)??first)-first;
  return {periods,positions:coordinates.map(value=>span?(value-first)/span:.5),spacing:actual?'time':'order'};
}

export function sparklineModel(view,seriesId,spec={},options={}) {
  spec=resolveView(spec,view.geography);
  const presentation=createPresentation(spec,view.geography);
  const mode=options.mode??options.type??'line',scale=options.scale??'shared';
  if(!['line','area','bar'].includes(mode)||!['shared','local'].includes(scale))throw new StatsMapError('unsupported sparkline mode or scale','INVALID_ENCODING');
  if(view.metricForSeries(seriesId).value_type!=='number')throw new StatsMapError('sparkline requires a numeric series','INVALID_ENCODING');
  const time=timeDomain(view,spec,options),regionIds=spec.view?.region_ids??[...view.regions.keys()];
  const observations=new Map(time.periods.map(period=>[period.id,new Map(channelValues(view,seriesId,period.id,spec.aggregation).map(observation=>[observation.region_id,observation]))]));
  const values=new Map(regionIds.map(id=>[id,time.periods.map(period=>{const observation=observations.get(period.id).get(id);return observation?.status==='value'?observation.value:null;})]));
  const extent=numbers=>{const valid=numbers.filter(Number.isFinite);return [Math.min(0,...valid),Math.max(0,...valid)];};
  let domain=options.yDomain??extent([...values.values()].flat());
  if(!Array.isArray(domain)||domain.length!==2||!domain.every(Number.isFinite)||domain[1]<domain[0])throw new StatsMapError('sparkline yDomain must be an ordered numeric pair','INVALID_ENCODING');
  return {...time,presentation,options,mode,scale,domain,values,seriesId,unit:presentation.label(view.data.units.find(unit=>unit.id===view.series.get(seriesId)?.unit_id)),
    regionDomain:id=>scale==='local'&&!options.yDomain?extent(values.get(id)??[]):domain,
    missing:[...values.values()].some(numbers=>numbers.some(value=>!Number.isFinite(value)))};
}

export function sparklineSvg(model,id,x,y,size) {
  const values=model.values.get(id)??[],[min,max]=model.regionDomain(id),span=max-min||1;
  const px=index=>x-size/2+model.positions[index]*size,py=value=>y+size/2-(value-min)/span*size,baseline=py(0);
  const common=(index,value)=>`data-region-id="${esc(id)}" data-sparkline-mode="${model.mode}" data-period-id="${esc(model.periods[index].id)}" data-value="${value}"`;
  const title=(index,value)=>`<title>${esc(model.presentation.label(model.periods[index]))}: ${esc(model.presentation.number(value))}${model.unit?' '+esc(model.unit):''}</title>`;
  const hits=model.options.interactive===false?'':values.map((value,index)=>{
    const left=index?(px(index-1)+px(index))/2:x-size/2,right=index<values.length-1?(px(index)+px(index+1))/2:x+size/2;
    return `<rect data-region-id="${esc(id)}" data-sparkline-point="true" data-period-id="${esc(model.periods[index].id)}" data-series-id="${esc(model.seriesId)}"${value==null?'':` data-value="${value}"`} x="${left}" y="${y-size/2}" width="${Math.max(1,right-left)}" height="${size}" fill="transparent" pointer-events="all"/>`;
  }).join('');
  if(model.mode==='bar')return values.map((value,index)=>{
    if(!Number.isFinite(value))return '';
    const neighbors=[model.positions[index]-(model.positions[index-1]??model.positions[index]-.2),(model.positions[index+1]??model.positions[index]+.2)-model.positions[index]],width=Math.min(...neighbors)*size*.7;
    return `<rect ${common(index,value)} x="${px(index)-width/2}" y="${Math.min(py(value),baseline)}" width="${width}" height="${Math.abs(baseline-py(value))}" fill="${esc(model.options.fill??model.presentation.theme.accent)}">${title(index,value)}</rect>`;
  }).join('')+hits;
  const segments=[];let segment=[];
  values.forEach((value,index)=>{if(!Number.isFinite(value)){if(segment.length)segments.push(segment);segment=[];}else segment.push({value,index});});
  if(segment.length)segments.push(segment);
  return segments.map(points=>{
    const line=points.map((point,i)=>`${i?'L':'M'}${px(point.index)},${py(point.value)}`).join('');
    const d=model.mode==='area'?`${line}L${px(points.at(-1).index)},${baseline}L${px(points[0].index)},${baseline}Z`:line;
    const path=points.length>1?`<path data-region-id="${esc(id)}" data-sparkline-mode="${model.mode}" d="${d}" fill="${esc(model.mode==='area'?(model.options.fill??model.presentation.theme.accent):'none')}" fill-opacity="${model.mode==='area'?'.45':'1'}" stroke="${esc(model.options.stroke??model.presentation.theme.accent)}" stroke-width="1.5"/>`:'';
    return path+points.map(point=>`<circle ${common(point.index,point.value)} cx="${px(point.index)}" cy="${py(point.value)}" r="1.5" fill="${esc(model.options.fill??model.presentation.theme.accent)}">${title(point.index,point.value)}</circle>`).join('');
  }).join('')+hits;
}

export function sparklineCollisionRadius(model,id,size) {
  const [min,max]=model.regionDomain(id),span=max-min||1;
  let bound=Math.hypot(size/2,size/2);
  for(const [index,value] of (model.values.get(id)??[]).entries())if(Number.isFinite(value)){
    const x=(model.positions[index]-.5)*size,y=size/2-(value-min)/span*size;
    const width=model.mode==='bar'?Math.min(model.positions[index]-(model.positions[index-1]??model.positions[index]-.2),(model.positions[index+1]??model.positions[index]+.2)-model.positions[index])*size*.35:1.5;
    bound=Math.max(bound,Math.hypot(Math.abs(x)+width,Math.abs(y)+1.5));
  }
  return bound;
}
