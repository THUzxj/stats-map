import { StatsMapError } from '../core/errors.js';
import { validateRankingRegionSet } from '../core/region-sets.js';

export function validateRankingOptions(options={}) {
  const require=(condition,message)=>{if(!condition)throw new StatsMapError(message,'INVALID_ARGUMENT');};
  require(options&&typeof options==='object'&&!Array.isArray(options),'ranking must be an object');
  require(!Object.hasOwn(options,'countryGroup'),'resolve ranking.countryGroup through euroBundle with regionSets or applyRankingRegionSet before using the canonical spec');
  validateRankingRegionSet(options.regionSet,options.regionIds);
  for(const key of ['x','y'])if(options[key]!=null)require(Number.isFinite(options[key]),`ranking.${key} must be finite`);
  for(const key of ['width','height','rowHeight','shapeHeight','labelFontSize'])if(options[key]!=null)require(Number.isFinite(options[key])&&options[key]>0,`ranking.${key} must be positive`);
  if(options.width!=null)require(options.width>=64,'ranking.width must be at least 64 pixels');
  if(options.boxPadding!=null)require(Number.isFinite(options.boxPadding)&&options.boxPadding>=0,'ranking.boxPadding must be nonnegative');
  if(options.boxOpacity!=null)require(Number.isFinite(options.boxOpacity)&&options.boxOpacity>=0&&options.boxOpacity<=1,'ranking.boxOpacity must be within 0–1');
  for(const key of ['limit','decimals'])if(options[key]!=null)require(Number.isInteger(options[key])&&options[key]>=0&&(key!=='decimals'||options[key]<=20),`ranking.${key} must be a nonnegative integer${key==='decimals'?' within 0–20':''}`);
  for(const key of ['barLimit','bins','pageSize'])if(options[key]!=null)require(Number.isInteger(options[key])&&options[key]>=1&&options[key]<=(key==='bins'?100:10000),`ranking.${key} is outside its integer range`);
  for(const key of ['ascending','onlyApplyOpacityWhileZoomed'])if(options[key]!=null)require(typeof options[key]==='boolean',`ranking.${key} must be boolean`);
  for(const key of ['title','subtitle','color','categoryLabel','missingLabel','hiddenLabel','layerId','datasetId','seriesId','periodId'])if(options[key]!=null)require(typeof options[key]==='string',`ranking.${key} must be a string`);
  if(options.direction!=null)require(['ascending','descending'].includes(options.direction),'invalid ranking direction');
  if(options.position!=null)require(['top right','bottom right','top left','bottom left'].includes(options.position),'invalid ranking position');
  if(options.mode!=null)require(['auto','bars','histogram'].includes(options.mode),'invalid ranking mode');
  if(options.regionIds!=null)require(Array.isArray(options.regionIds)&&options.regionIds.every(id=>typeof id==='string')&&new Set(options.regionIds).size===options.regionIds.length,'ranking.regionIds must contain distinct region ids');
  // Formatting is declarative so exported specs never carry executable callbacks.
  if(options.labelFormatter!=null)require(false,'ranking.labelFormatter callbacks are unsupported; use decimals or number_format');
  return options;
}

export function rankingNumber(p,value,options={}) {
  return p.number(value,options.decimals==null?undefined:{minimumFractionDigits:options.decimals,maximumFractionDigits:options.decimals,maximumSignificantDigits:undefined});
}

// Normalize before subtraction, preserving finite signed extremes and tiny data.
export function rankingScale(rows) {
  let minimum=0,maximum=0;
  for(const row of rows){minimum=Math.min(minimum,row.value);maximum=Math.max(maximum,row.value);}
  const magnitude=Math.max(-minimum,maximum)||1,low=minimum/magnitude,span=maximum/magnitude-low||1;
  return {minimum,maximum,position:value=>(value/magnitude-low)/span,zero:-low/span};
}

export function rankingDistribution(rows,requestedBins) {
  if(!rows.length)return [];
  let low=Infinity,high=-Infinity;
  for(const row of rows){low=Math.min(low,row.value);high=Math.max(high,row.value);}
  if(low===high)return [{index:0,lower:low,upper:high,upperInclusive:true,count:rows.length,region_ids:rows.map(row=>row.region_id)}];
  const count=requestedBins??Math.min(20,Math.ceil(Math.sqrt(rows.length))),magnitude=Math.max(Math.abs(low),Math.abs(high))||1;
  const min=low/magnitude,span=high/magnitude-min;
  const edges=Array.from({length:count+1},(_,index)=>index===0?low:index===count?high:low*(1-index/count)+high*(index/count));
  // Adjacent representable numbers may collapse interpolated edges.
  const distinct=[...new Set(edges)].sort((a,b)=>a-b);
  const bins=distinct.slice(0,-1).map((lower,index)=>({index,lower,upper:distinct[index+1],upperInclusive:index===distinct.length-2,count:0,region_ids:[]}));
  for(const row of rows){
    let index=Math.max(0,Math.min(bins.length-1,Math.floor((row.value/magnitude-min)/span*count)));
    while(index>0&&row.value<bins[index].lower)index--;
    while(index<bins.length-1&&row.value>=bins[index].upper)index++;
    bins[index].count++;bins[index].region_ids.push(row.region_id);
  }
  return bins;
}
