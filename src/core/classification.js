import { StatsMapError } from './errors.js';
const clean = values => values.filter(Number.isFinite).sort((a, b) => a - b);
const quantile = (a, p) => { if (!a.length) return NaN; const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
function uniqueBreaks(xs, n) { return [...new Set(xs.slice(0, n - 1))]; }
export function equinter(values, n = 5) { const a = clean(values); if (!a.length) return []; const min = a[0], max = a[a.length - 1]; return max === min ? [] : Array.from({length: Math.max(0, n - 1)}, (_, i) => min + (i + 1) * (max - min) / n); }
export function quantileBreaks(values, n = 5) { const a = clean(values); if (!a.length || a[0] === a[a.length - 1]) return []; return uniqueBreaks(Array.from({length: Math.max(0, n - 1)}, (_, i) => quantile(a, (i + 1) / n)).filter(value=>value>a[0]), n); }
export function thresholdBreaks(values, thresholds = []) { if(!Array.isArray(thresholds)||!thresholds.every(Number.isFinite))throw new StatsMapError('classification thresholds must be finite numbers','INVALID_CLASSIFICATION');return [...new Set(thresholds)].sort((a,b)=>a-b); }
function optimalClusterBreaks(values,requested) {
  const sorted=clean(values),a=[],weights=[];
  for(const value of sorted){if(a.at(-1)===value)weights[weights.length-1]++;else {a.push(value);weights.push(1);}}
  const n=a.length,k=Math.min(Math.max(1,Math.floor(requested)||1),n);
  if(n<2||k<2)return [];
  // Shift and scale first, then accumulate weighted variance with Welford's
  // recurrence. Equal values remain together and retain their frequencies.
  const origin=a[0],span=a[n-1]-origin,normalized=a.map(value=>(value-origin)/span);
  const score=Array.from({length:k+1},()=>Array(n+1).fill(Infinity)),split=Array.from({length:k+1},()=>Array(n+1).fill(-1));
  score[0][0]=0;
  for(let classes=1;classes<=k;classes++)for(let end=classes;end<=n;end++){
    let count=0,mean=0,variance=0;
    for(let start=end-1;start>=classes-1;start--){
      const value=normalized[start],weight=weights[start],delta=value-mean;
      count+=weight;mean+=delta*weight/count;variance+=weight*delta*(value-mean);
      const candidate=score[classes-1][start]+variance;
      if(candidate<score[classes][end]){score[classes][end]=candidate;split[classes][end]=start;}
    }
  }
  const boundaries=[];let end=n;
  for(let classes=k;classes>1;classes--){const start=split[classes][end],mid=a[start-1]/2+a[start]/2;boundaries.push(mid>a[start-1]?mid:a[start]);end=start;}
  return boundaries.reverse();
}
export function jenksBreaks(values, n = 5) { return optimalClusterBreaks(values,n); }
export function ckmeansBreaks(values, n = 5) { return optimalClusterBreaks(values,n); }
export function breaks(values, method = 'quantile', n = 5, thresholds = []) { if(!Number.isInteger(n)||n<1||n>256)throw new StatsMapError('classification classes must be an integer from 1 to 256','INVALID_CLASSIFICATION');switch(method){case 'equinter':case 'equalInterval':return equinter(values,n);case 'threshold':return thresholdBreaks(values,thresholds);case 'jenks':return jenksBreaks(values,n);case 'ckmeans':return ckmeansBreaks(values,n);case 'quantile':return quantileBreaks(values,n);default:throw new StatsMapError(`unsupported classification method: ${method}`,'INVALID_CLASSIFICATION');} }
export function classify(value, breakpoints = [], options = {}) { if (!Number.isFinite(value)) return null; const b = [...breakpoints].sort((a,c)=>a-c); let i=0; while(i<b.length && value >= b[i]) i++; return i; }
export function classifyDomain(values, options = {}) {
  if(options.resolvedDomain!==undefined&&(!Array.isArray(options.resolvedDomain)||options.resolvedDomain.length!==2||!options.resolvedDomain.every(Number.isFinite)||options.resolvedDomain[0]>options.resolvedDomain[1]||(options.method??'quantile')!=='threshold'))throw new StatsMapError('resolvedDomain requires ordered finite bounds and fixed threshold classification','INVALID_CLASSIFICATION');
  const b=breaks(values,options.method??'quantile',options.classes??5,options.thresholds??[]); return {breaks:b,classes:b.length+1,method:options.method??'quantile',domain:clean(values), classify:value=>classify(value,b,options)};
}
