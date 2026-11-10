import { viewRegionIds } from '../core/view.js';
import { gridLayout, hexGridLayout } from './grid.js';
import { savedGridPositions } from './saved-grid.js';
import { dorlingLayout, dorlingMetrics } from './dorling.js';
import { anchorIndex, fitProjection, projectPoint } from '../core/geometry.js';
import { renderSvg } from '../renderers/svg.js';
import { StatsMapError } from '../core/errors.js';

export function prepareDorling(geography,spec,viewport,datasetViews) {
  const ids=viewRegionIds(geography,spec),layout=spec.layout??{},anchors=anchorIndex(geography,{policy:spec.anchor_policy,regionIds:ids});
  const projection=fitProjection(geography,viewport,{...layout,regionIds:ids}),padding=layout.padding??20;
  const positions=new Map(ids.filter(id=>anchors.has(id)).map(id=>{
    const [x,y]=projectPoint(anchors.get(id),projection);
    return [id,{id,x,y,radius:layout.radius??12,surfaceRadius:layout.radius??12,glyphSize:layout.radius==null?36:layout.radius*2}];
  }));
  const radii=new Map([...positions.keys()].map(id=>[id,0]));
  for(const layer of spec.layers){
    const encoding=layer.encoding??{},id=encoding.dataset_id??Object.values(encoding).find(value=>value?.dataset_id)?.dataset_id??spec.dataset_refs[0]?.id;
    const result=renderSvg({geography,spec,layer,datasetView:datasetViews.get(id),datasetViews,viewport,projection,layoutPositions:positions,layoutType:'dorling',measureCollisions:true});
    for(const [id,radius] of result.collisionRadii)radii.set(id,Math.max(radii.get(id)??0,radius));
  }
  const nodes=[...positions.values()];
  if([...radii.values()].some(radius=>!Number.isFinite(radius)||radius<0))throw new StatsMapError('Renderer produced an invalid Dorling collision radius','INVALID_LAYOUT');
  // Keep the projected geographic anchors in the same coordinate system as the
  // background map.  Scaling the anchor extent to fill the viewport makes a
  // province-level view (whose anchors occupy only the interior points of the
  // full geography) drift hundreds of pixels away from its actual boundary.
  // The Dorling solver already constrains glyphs to the viewport bounds, so no
  // second extent fit is needed here.
  for(const node of nodes)node.radius=radii.get(node.id);
  const options={...layout,bounds:[Math.min(padding,viewport.width/2),Math.min(padding,viewport.height/2),Math.max(viewport.width-padding,viewport.width/2),Math.max(viewport.height-padding,viewport.height/2)]};
  return {nodes,options};
}

export function dorlingPositions(nodes,options) {
  const positions=new Map(nodes.map(node=>[node.id,node])),metrics=dorlingMetrics(nodes,options);
  positions.metrics=metrics;positions.diagnostics=[];
  if(metrics.collision_pairs)positions.diagnostics.push({code:'DORLING_COLLISION',...metrics});
  if(metrics.overflow_region_ids.length)positions.diagnostics.push({code:'DORLING_OVERFLOW',region_ids:metrics.overflow_region_ids});
  return positions;
}
export function resolveLayout(geography,spec,options={}) {
  const ids=viewRegionIds(geography,spec),layout=spec.layout??{type:'geographic'};
  if(layout.type==='grid-square')return gridLayout(ids,savedGridPositions(geography,layout,ids),layout);
  if(layout.type==='grid-hex')return hexGridLayout(ids,savedGridPositions(geography,layout,ids),layout);
  const anchors=anchorIndex(geography,{policy:spec.anchor_policy,regionIds:ids});
  if(layout.type==='dorling')return new Map(dorlingLayout(ids.filter(id=>anchors.has(id)).map(id=>({id,x:anchors.get(id)[0],y:anchors.get(id)[1]})),layout).map(x=>[x.id,x]));
  return new Map(ids.map(id=>[id,{id,point:anchors.get(id)??null}]));
}

// Fit complete glyph bounds, including radii, rather than only their centres.
export function resolveScreenLayout(geography, spec, viewport, positions, datasetViews) {
  if (!['grid-square','grid-hex','dorling'].includes(spec.layout?.type)) return null;
  if(spec.layout?.type==='dorling'&&datasetViews){
    if(positions){const copy=new Map([...positions].map(([id,node])=>[id,{...node}]));copy.metrics=positions.metrics;copy.diagnostics=positions.diagnostics;return copy;}
    const {nodes,options}=prepareDorling(geography,spec,viewport,datasetViews);
    return dorlingPositions(dorlingLayout(nodes,options),options);
  }
  const raw=positions??resolveLayout(geography,spec);
  if (!raw.size) return raw;
  const nodes=[...raw.values()];
  const extent=p=>p.radius??p.size/2;
  const x0=Math.min(...nodes.map(p=>p.x-extent(p))), x1=Math.max(...nodes.map(p=>p.x+extent(p)));
  const y0=Math.min(...nodes.map(p=>p.y-extent(p))), y1=Math.max(...nodes.map(p=>p.y+extent(p)));
  const pad=spec.layout.padding??20;
  const scale=Math.max(0,Math.min((viewport.width-2*pad)/(x1-x0||1),(viewport.height-2*pad)/(y1-y0||1)));
  return new Map([...raw].map(([id,p])=>[id,{...p,
    x:(p.x-(x0+x1)/2)*scale+viewport.width/2,
    y:(p.y-(y0+y1)/2)*scale+viewport.height/2,
    size:p.size==null?undefined:p.size*scale,
    radius:p.radius==null?undefined:p.radius*scale
  }]));
}

export function layoutHitTest(point,positions,type) {
  for(const [id,p] of [...positions].reverse()){
    const dx=Math.abs(point[0]-p.x),dy=Math.abs(point[1]-p.y);
    const inside=type==='dorling'?Math.hypot(dx,dy)<=p.radius:p.shape==='hexagon'?dx<=p.size/2&&dy<=Math.sqrt(3)*p.size/4&&Math.sqrt(3)*dx+dy<=Math.sqrt(3)*p.size/2:dx<=p.size/2&&dy<=p.size/2;
    if(inside)return {regionId:id,distance:Math.hypot(dx,dy),point:[p.x,p.y]};
  }
  return null;
}
