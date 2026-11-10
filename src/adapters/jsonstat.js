import { StatsMapError } from '../core/errors.js';

const invalid=message=>{throw new StatsMapError(message,'INVALID_JSON_STAT');};
export const jsonStatSeriesId=dimensionValues=>`euro:${encodeURIComponent(JSON.stringify(dimensionValues))}`;

function categoryEntries(category,size,id) {
  const index=category.index??Object.keys(category.label??{});
  const entries=Array.isArray(index)?index.map((value,position)=>[String(value),position]):Object.entries(index).map(([value,position])=>[value,typeof position==='string'&&/^\d+$/.test(position)?Number(position):position]);
  if(entries.length!==size||new Set(entries.map(([value])=>value)).size!==size||new Set(entries.map(([,position])=>position)).size!==size||entries.some(([value,position])=>!value||!Number.isInteger(position)||position<0||position>=size))invalid(`dimension ${id} must have a complete category index`);
  return entries.sort((a,b)=>a[1]-b[1]);
}

function dimensionInfo(stat) {
  if(!Array.isArray(stat.id)||!stat.id.length||!Array.isArray(stat.size)||stat.size.length!==stat.id.length||new Set(stat.id).size!==stat.id.length||stat.id.some(id=>typeof id!=='string'||!id))invalid('JSON-stat needs distinct ordered dimension ids and matching sizes');
  return stat.id.map((id,index)=>{
    const size=stat.size[index];if(!Number.isSafeInteger(size)||size<1)invalid(`invalid dimension size: ${id}`);
    const category=stat.dimension?.[id]?.category??{},entries=categoryEntries(category,size,id);
    return {id,size,values:entries.map(([value])=>value),labels:Object.fromEntries(entries.map(([value])=>[value,category.label?.[value]??value])),category};
  });
}

function specialDimension(dims,explicit,pattern) {
  const index=dims.findIndex(dimension=>explicit?dimension.id===explicit:pattern.test(dimension.id));
  if(explicit&&index<0)invalid(`dimension not found: ${explicit}`);
  return index;
}

export function sourceStatus(value,flag) {
  if(Number.isFinite(value))return 'value';
  const codes=String(flag??'').trim().toLowerCase().split(/\s+/);
  if(codes.some(code=>['c','confidential','suppressed'].includes(code)))return 'suppressed';
  if(codes.some(code=>['-','not_applicable'].includes(code)))return 'not_applicable';
  if(codes.some(code=>[':', 'na','n/a','not_available'].includes(code)))return 'not_available';
  return 'missing';
}

function indexedValues(input,length,name,{scalar=false}={}) {
  if(scalar&&typeof input==='string')return ()=>input;
  if(input==null)return ()=>undefined;
  if(Array.isArray(input)){if(name==='value'&&input.length!==length)invalid('dense value array does not match dimension sizes');if(input.length>length)invalid(`${name} array exceeds dimension sizes`);}
  else if(typeof input==='object'){
    if(Object.keys(input).some(key=>!/^(0|[1-9]\d*)$/.test(key)||!Number.isSafeInteger(Number(key))||Number(key)>=length))invalid(`invalid sparse ${name} index`);
  }else invalid(`${name} must be an array or sparse index object`);
  return index=>input[index];
}

export function decodeJsonStat(stat,options={}) {
  const dims=dimensionInfo(stat),length=dims.reduce((product,dimension)=>product*dimension.size,1);
  if(!Number.isSafeInteger(length))invalid('dimension product exceeds safe integer range');
  if(options.maxCells!=null&&(!Number.isSafeInteger(options.maxCells)||options.maxCells<1||length>options.maxCells))invalid('JSON-stat cell count exceeds maxCells');
  const geoIndex=specialDimension(dims,options.geoDimension,/^(geo|region|nuts|area|territory)$/i),timeIndex=specialDimension(dims,options.timeDimension,/^(time|period)$/i),unitIndex=specialDimension(dims,options.unitDimension,/^unit$/i);
  if(geoIndex<0)invalid('JSON-stat requires an identifiable geographic dimension');
  if([timeIndex,unitIndex].some(index=>index>=0&&index===geoIndex)||timeIndex>=0&&timeIndex===unitIndex)invalid('geography, time and unit dimensions must be distinct');
  const valueAt=indexedValues(stat.value,length,'value'),flagAt=indexedValues(stat.status??stat.flags,length,'status',{scalar:true});
  const seriesIndexes=dims.map((_,index)=>index).filter(index=>index!==geoIndex&&index!==timeIndex);
  const combinations=seriesIndexes.reduce((out,index)=>out.flatMap(item=>dims[index].values.map(value=>({dimensionValues:{...item.dimensionValues,[dims[index].id]:value}}))),[{dimensionValues:{}}]);
  for(const combination of combinations)combination.id=jsonStatSeriesId(combination.dimensionValues);
  const records=[];
  for(let flat=0;flat<length;flat++){
    let rest=flat;const coordinates=Array(dims.length);
    for(let index=dims.length-1;index>=0;index--){coordinates[index]=rest%dims[index].size;rest=Math.floor(rest/dims[index].size);}
    const dimensionValues=Object.fromEntries(seriesIndexes.map(index=>[dims[index].id,dims[index].values[coordinates[index]]])),value=valueAt(flat),flag=flagAt(flat);
    if(value!=null&&!Number.isFinite(value))invalid(`value at cell ${flat} must be finite or null`);
    records.push({regionId:dims[geoIndex].values[coordinates[geoIndex]],periodId:timeIndex<0?String(options.periodId??'period-1'):dims[timeIndex].values[coordinates[timeIndex]],seriesId:jsonStatSeriesId(dimensionValues),dimensionValues,value,flag,status:sourceStatus(value,flag)});
  }
  return {dims,geoIndex,timeIndex,unitIndex,seriesIndexes,combinations,records};
}
