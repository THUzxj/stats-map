import { StatsMapError } from '../core/errors.js';

export function validateDorlingOptions(options={}) {
  for(const [key,fallback] of [['radius',12],['gap',2],['tolerance',.1],['padding',20]])if(!Number.isFinite(options[key]??fallback)||(options[key]??fallback)<0)throw new StatsMapError(`invalid Dorling ${key}`,'INVALID_LAYOUT');
  if(!Number.isInteger(options.iterations??100)||(options.iterations??100)<0||(options.iterations??100)>10000)throw new StatsMapError('Dorling iterations must be an integer from 0 to 10000','INVALID_LAYOUT');
  if(!Number.isInteger(options.seed??1))throw new StatsMapError('Dorling seed must be an integer','INVALID_LAYOUT');
  if(options.worker!==undefined&&typeof options.worker!=='boolean')throw new StatsMapError('Dorling worker must be boolean','INVALID_LAYOUT');
  if(!Number.isFinite(options.strength??.5)||(options.strength??.5)<=0||(options.strength??.5)>1)throw new StatsMapError('Dorling strength must be greater than zero and at most one','INVALID_LAYOUT');
  if(options.bounds!=null&&(!Array.isArray(options.bounds)||options.bounds.length!==4||!options.bounds.every(Number.isFinite)||options.bounds[2]<options.bounds[0]||options.bounds[3]<options.bounds[1]))throw new StatsMapError('Dorling bounds must be an ordered finite rectangle','INVALID_LAYOUT');
}

export function dorlingMetrics(nodes,options={}) {
  const gap=options.gap??2,tolerance=options.tolerance??.1,pairs=[],overflow=[];
  let maxOverlap=0,pairCount=0;
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i],b=options.bounds;
    if(b&&(a.x-a.radius<b[0]-tolerance||a.x+a.radius>b[2]+tolerance||a.y-a.radius<b[1]-tolerance||a.y+a.radius>b[3]+tolerance))overflow.push(a.id);
    for(let j=i+1;j<nodes.length;j++){
      const b=nodes[j],overlap=a.radius+b.radius+gap-Math.hypot(a.x-b.x,a.y-b.y);
      maxOverlap=Math.max(maxOverlap,overlap);
      if(overlap>tolerance){pairCount++;if(pairs.length<1000)pairs.push({region_ids:[a.id,b.id],overlap});}
    }
  }
  return {iterations:options.iterations??100,seed:options.seed??1,strength:options.strength??.5,gap,bounds:options.bounds?[...options.bounds]:null,tolerance,max_overlap:maxOverlap,collision_pairs:pairCount,pairs,overflow_region_ids:overflow};
}

export function dorlingLayout(nodes, options={}) {
  validateDorlingOptions(options);
  const seed=options.seed??1,iterations=options.iterations??100,strength=options.strength??.5,radius=options.radius??12,gap=options.gap??2;
  let randomState=seed>>>0;
  const random=()=>((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/4294967296);
  const ids=new Set();
  const out=nodes.map(n=>{
    if(n.id==null||ids.has(String(n.id))||n.radius!=null&&(!Number.isFinite(n.radius)||n.radius<0)||['x','y'].some(key=>n[key]!=null&&!Number.isFinite(n[key])))throw new StatsMapError('Dorling nodes need distinct ids and finite nonnegative radii/coordinates','INVALID_LAYOUT');
    ids.add(String(n.id));return {...n};
  }).sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0).map((n,i)=>({...n,x:n.x??(i%10)*radius*2+(random()-.5),y:n.y??Math.floor(i/10)*radius*2+(random()-.5),radius:n.radius??radius}));
  const constrain=node=>{
    if(!options.bounds)return;
    const [x0,y0,x1,y1]=options.bounds,r=node.radius;
    node.x=x1-x0<2*r?(x0+x1)/2:Math.max(x0+r,Math.min(x1-r,node.x));
    node.y=y1-y0<2*r?(y0+y1)/2:Math.max(y0+r,Math.min(y1-r,node.y));
  };
  out.forEach(constrain);
  for(let k=0;k<iterations;k++){
    for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){
      const a=out[i],b=out[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
      if(d<1e-9){const angle=random()*Math.PI*2;dx=Math.cos(angle)*1e-6;dy=Math.sin(angle)*1e-6;d=1e-6;}
      const min=a.radius+b.radius+gap;
      if(d<min){const q=(min-d)/d*strength,px=dx*q/2,py=dy*q/2;a.x-=px;a.y-=py;b.x+=px;b.y+=py;}
    }
    out.forEach(constrain);
  }
  return out;
}
