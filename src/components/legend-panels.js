import { intersects } from './text-layout.js';

// Place complete measured panels. Explicit per-layer coordinates remain fixed;
// insufficient space is reported, without dropping labels or shrinking scales.
export function placeLegendPanels(panels,{width,height,obstacles=[],x=12,y=20,gap=10,collision='avoid',columnWidth}={}) {
  const fixed=new Map(panels.filter(panel=>panel.x!=null||panel.y!=null).map(panel=>[panel,{x:(panel.x??x)-6,y:(panel.y??y)-14,width:panel.width,height:panel.height}]));
  const occupied=[...obstacles,...fixed.values()],placed=[],diagnostics=[];
  for(const panel of panels){
    const preferred=fixed.get(panel)??{x:x-6,y:y-14,width:panel.width,height:panel.height};
    const fits=box=>box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height;
    const overlap=box=>occupied.some(other=>other!==fixed.get(panel)&&intersects(box,other,4));
    let box=preferred;
    if(collision!=='none'&&panel.x==null&&panel.y==null){
      const xs=[preferred.x,6,width-panel.width-6,...occupied.map(other=>other.x+(columnWidth??other.width+gap))];
      const ys=[preferred.y,6,height-panel.height-6,...occupied.map(other=>other.y+other.height+gap)];
      const candidates=[...new Set(xs)].flatMap(px=>[...new Set(ys)].map(py=>({...preferred,x:px,y:py})))
        .sort((a,b)=>(Math.abs(a.x-preferred.x)*3+Math.abs(a.y-preferred.y))-(Math.abs(b.x-preferred.x)*3+Math.abs(b.y-preferred.y))||a.y-b.y||a.x-b.x);
      box=candidates.find(box=>fits(box)&&!overlap(box))??{...preferred,x:Math.max(0,Math.min(width-panel.width,preferred.x)),y:Math.max(0,Math.min(height-panel.height,preferred.y))};
    }
    if(!fits(box))diagnostics.push({code:'LEGEND_OVERFLOW',layer_id:panel.layer_id,bounds:{...box},viewport:{width,height}});
    if(collision!=='none'&&overlap(box))diagnostics.push({code:'LEGEND_COLLISION',layer_id:panel.layer_id,bounds:{...box}});
    if(!fixed.has(panel))occupied.push(box);placed.push({...panel,x:box.x+6,y:box.y+14,bounds:box});
    x=box.x+6;y=box.y+panel.height+gap+14;
  }
  return {panels:placed,diagnostics};
}
