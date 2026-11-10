import { intersects } from './text-layout.js';

// Search free vertical intervals at obstacle edges, without constructing a
// Cartesian product of every x/y pair. Sizes and text are never reduced.
export function freeRectangle(preferred,{width,height,obstacles=[],padding=6,gap=6}={}) {
  const w=preferred.width,h=preferred.height,maxX=width-padding-w,maxY=height-padding-h;
  if(maxX<padding||maxY<padding)return null;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const xs=new Set([clamp(preferred.x,padding,maxX),padding,maxX]);
  for(const box of obstacles)for(const x of [box.x+box.width+gap,box.x-w-gap])if(x>=padding&&x<=maxX)xs.add(x);
  let best=null,bestScore=Infinity;
  for(const x of xs){
    const intervals=obstacles.filter(box=>x<box.x+box.width+gap&&x+w+gap>box.x)
      .map(box=>[box.y-h-gap,box.y+box.height+gap]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let start=padding;
    const consider=end=>{
      if(end<start)return;
      const y=clamp(preferred.y,start,end),score=3*Math.abs(x-preferred.x)+Math.abs(y-preferred.y);
      if(score<bestScore||score===bestScore&&(y<best.y||y===best.y&&x<best.x)){best={...preferred,x,y};bestScore=score;}
    };
    for(const [a,b] of intervals){if(b<=start)continue;if(a>maxY)break;consider(Math.min(a,maxY));start=Math.max(start,b);if(start>maxY)break;}
    consider(maxY);
  }
  return best;
}

export function layoutDecorationBoxes(items,{width,height,obstacles=[],padding=6,gap=6,collision='avoid'}={}) {
  const fixed=new Map(items.filter(item=>item.reserve!==false&&(collision==='none'||item.collision!=='avoid')).map(item=>[item.id,item.bounds]));
  const occupied=[...obstacles,...fixed.values()],positions=new Map(),diagnostics=[];
  for(const item of [...items].sort((a,b)=>(b.priority??0)-(a.priority??0)||a.order-b.order)){
    let preferred=item.bounds;
    const relative=positions.get(item.after??item.before);
    if(relative&&item.collision==='avoid'&&collision!=='none')preferred={...preferred,x:preferred.x+relative.dx,y:item.after?relative.bounds.y+relative.bounds.height+gap:relative.bounds.y-preferred.height-gap};
    let box=preferred;
    if(item.reserve!==false&&item.collision==='avoid'&&collision!=='none')box=freeRectangle(preferred,{width,height,obstacles:occupied,padding,gap})??preferred;
    const displaced=box.x!==item.bounds.x||box.y!==item.bounds.y;
    const placed={...item,bounds:box,displaced,dx:box.x-item.bounds.x,dy:box.y-item.bounds.y};positions.set(item.id,placed);
    if(item.reserve===false)continue;
    if(collision!=='none'&&item.collision!=='none'){
      if(box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height)diagnostics.push({code:'DECORATION_OVERFLOW',decoration_id:item.id,kind:item.kind,bounds:{...box},viewport:{width,height}});
      const conflicts=occupied.filter(other=>other!==fixed.get(item.id)&&intersects(box,other,gap));
      if(conflicts.length)diagnostics.push({code:'DECORATION_COLLISION',decoration_id:item.id,kind:item.kind,bounds:{...box},conflicts:conflicts.map(other=>({...other}))});
    }
    if(!fixed.has(item.id))occupied.push(box);
  }
  return {items:items.map(item=>positions.get(item.id)),obstacles:occupied,diagnostics};
}
