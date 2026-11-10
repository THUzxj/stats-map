import { StatsMapError } from '../core/errors.js';

const compare=(a,b)=>a<b?-1:a>b?1:0;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const abort=signal=>{if(signal?.aborted)throw new StatsMapError('flow bundling cancelled','ABORTED');};

export function normalizeBundleSettings(settings={}) {
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new StatsMapError('bundleSettings must be an object','INVALID_ENCODING');
  const result={iterations:80,subdivisions:8,alphaDecay:.035,chargeStrength:12,distanceMax:40,linkStrength:.2,linkIterations:1,compatibilityThreshold:.6,...settings};
  for(const key of Object.keys(settings))if(!['iterations','subdivisions','alphaDecay','chargeStrength','distanceMax','linkStrength','linkIterations','compatibilityThreshold'].includes(key))throw new StatsMapError(`unknown bundle setting: ${key}`,'INVALID_ENCODING');
  for(const [key,min,max] of [['iterations',1,1000],['subdivisions',1,32],['linkIterations',1,8]])if(!Number.isInteger(result[key])||result[key]<min||result[key]>max)throw new StatsMapError(`bundleSettings.${key} must be an integer from ${min} to ${max}`,'INVALID_ENCODING');
  for(const [key,min,max] of [['alphaDecay',0,1],['linkStrength',0,1],['compatibilityThreshold',0,1],['chargeStrength',-1000,1000]])if(!Number.isFinite(result[key])||result[key]<min||result[key]>max)throw new StatsMapError(`invalid bundleSettings.${key}`,'INVALID_ENCODING');
  if(result.distanceMax!=null&&(!Number.isFinite(result.distanceMax)||result.distanceMax<=0))throw new StatsMapError('bundleSettings.distanceMax must be positive or null','INVALID_ENCODING');
  return result;
}

// A bounded force relaxation on subdivided edges. Endpoints stay fixed. Nearby
// parallel edges attract; chain springs smooth each path. No centroid, timer,
// random initial positions or mutation of the statistical graph is involved.
export function bundleFlowPaths(routes,settings={},options={}) {
  abort(options.signal);const config=normalizeBundleSettings(settings),n=config.subdivisions;
  if(!Array.isArray(routes))throw new StatsMapError('flow routes must be an array','INVALID_ENCODING');
  const ids=new Set();
  for(const route of routes){
    if(!route||typeof route.id!=='string'||!route.id||ids.has(route.id)||![route.start,route.end].every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)))throw new StatsMapError('flow routes need unique string ids and finite endpoint pairs','INVALID_ENCODING');
    ids.add(route.id);
  }
  if(routes.length*(n+2)>20000)throw new StatsMapError('flow bundle exceeds 20000 control points','FLOW_BUNDLE_LIMIT');
  const baseWork=routes.length*n*config.iterations*(config.linkIterations+1);
  if(baseWork>8000000)throw new StatsMapError('flow bundle exceeds the bounded force work limit','FLOW_BUNDLE_LIMIT');
  const paths=routes.slice().sort((a,b)=>compare(String(a.id),String(b.id))).map(route=>{
    const start=[...route.start],end=[...route.end],length=distance(start,end),mid=[(start[0]+end[0])/2,(start[1]+end[1])/2];
    return {id:route.id,start,end,length,mid,points:Array.from({length:n+2},(_,i)=>[start[0]+(end[0]-start[0])*i/(n+1),start[1]+(end[1]-start[1])*i/(n+1)])};
  });
  const pairs=[],radius=config.distanceMax??Infinity,grid=new Map();let candidates=0;
  const check=(a,b)=>{
    if(++candidates>8000000)throw new StatsMapError('flow bundle exceeds the bounded candidate limit','FLOW_BUNDLE_LIMIT');
    const p=paths[a],q=paths[b];if(!p.length||!q.length||distance(p.mid,q.mid)>radius)return;
    const cosine=((p.end[0]-p.start[0])*(q.end[0]-q.start[0])+(p.end[1]-p.start[1])*(q.end[1]-q.start[1]))/(p.length*q.length);
    if(cosine<=0)return;
    // Opposite directions retain separate routes rather than silently merging.
    const scale=2*Math.min(p.length,q.length)/(p.length+q.length),position=(p.length+q.length)/(p.length+q.length+2*distance(p.mid,q.mid));
    const compatibility=Math.max(0,cosine)*scale*position;
    if(compatibility>=config.compatibilityThreshold)pairs.push([a,b,compatibility]);
    if(baseWork+pairs.length*n*config.iterations>8000000)throw new StatsMapError('flow bundle exceeds the bounded force work limit','FLOW_BUNDLE_LIMIT');
  };
  for(let i=0;i<paths.length;i++){
    if(Number.isFinite(radius)){
      const [x,y]=paths[i].mid.map(value=>Math.floor(value/radius));
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of grid.get(`${x+dx},${y+dy}`)??[])check(j,i);
      const key=`${x},${y}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
    }else for(let j=0;j<i;j++)check(j,i);
  }
  let alpha=1;
  for(let tick=0;tick<config.iterations;tick++){
    abort(options.signal);
    const forces=paths.map(()=>Array.from({length:n+2},()=>[0,0,0]));
    for(const [a,b,compatibility] of pairs)for(let i=1;i<=n;i++){
      const p=paths[a].points[i],q=paths[b].points[i],dx=q[0]-p[0],dy=q[1]-p[1],d=Math.hypot(dx,dy);
      if(d>radius||d<1e-9)continue;
      const strength=config.chargeStrength*compatibility/(d+1),fx=dx/d*strength,fy=dy/d*strength;
      forces[a][i][0]+=fx;forces[a][i][1]+=fy;forces[a][i][2]++;
      forces[b][i][0]-=fx;forces[b][i][1]-=fy;forces[b][i][2]++;
    }
    for(let p=0;p<paths.length;p++)for(let i=1;i<=n;i++){
      const force=forces[p][i],count=Math.max(1,force[2]),limit=Number.isFinite(radius)?radius/8:10;
      const dx=force[0]/count*alpha,dy=force[1]/count*alpha,factor=Math.min(1,limit/(Math.hypot(dx,dy)||1));
      paths[p].points[i][0]+=dx*factor;paths[p].points[i][1]+=dy*factor;
    }
    for(let iteration=0;iteration<config.linkIterations;iteration++)for(const path of paths){
      const next=path.points.map(point=>[...point]);
      for(let i=1;i<=n;i++)for(let axis=0;axis<2;axis++)next[i][axis]+=(path.points[i-1][axis]+path.points[i+1][axis]-2*path.points[i][axis])*config.linkStrength*alpha;
      path.points=next;
    }
    alpha*=1-config.alphaDecay;
  }
  return {algorithm:'subdivision-force',version:1,settings:config,compatible_pairs:pairs.length,paths:new Map(paths.map(path=>[path.id,path.points]))};
}
