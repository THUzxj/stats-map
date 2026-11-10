import { StatsMapError } from './errors.js';

export const ANCHOR_ALGORITHM_VERSION=1;
export function normalizeAnchorPolicy(policy) {
  if(policy==null)return {method:'none',version:1};
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||!['none','interior-point'].includes(policy.method)||policy.version!==1||Object.keys(policy).some(key=>!['method','version'].includes(key)))throw new StatsMapError('anchor_policy requires method none/interior-point and version 1','INVALID_ANCHOR_POLICY');
  return {...policy};
}
const polygonArea=polygon=>ringArea(polygon[0]??[])-polygon.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0);
export function geometryHasArea(geometry){return geometry?.type==='Polygon'?polygonArea(geometry.coordinates)>0:geometry?.type==='MultiPolygon'?geometry.coordinates.some(polygon=>polygonArea(polygon)>0):geometry?.type==='GeometryCollection'&&geometry.geometries.some(geometryHasArea)||false;}
export function geometryHasCoordinates(geometry){
  const any=value=>Array.isArray(value)&&(typeof value[0]==='number'&&value.length>=2||value.some(any));
  return any(geometry?.coordinates)||geometry?.type==='GeometryCollection'&&geometry.geometries.some(geometryHasCoordinates)||false;
}
export function pointInRing(point,ring) {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
export const pointInPolygon=(point,polygon)=>polygon.length>0&&pointInRing(point,polygon[0])&&!polygon.slice(1).some(ring=>pointInRing(point,ring));
function ringArea(ring) {
  if(!ring.length)return 0;
  const [ox,oy]=ring[0];let sum=0;
  for(let i=1;i<ring.length;i++)sum+=(ring[i-1][0]-ox)*(ring[i][1]-oy)-(ring[i][0]-ox)*(ring[i-1][1]-oy);
  return Math.abs(sum)/2;
}
function polygonsOf(geometry,out=[]) {
  if(geometry?.type==='Polygon')out.push(geometry.coordinates);
  if(geometry?.type==='MultiPolygon')out.push(...geometry.coordinates);
  if(geometry?.type==='GeometryCollection')for(const child of geometry.geometries)polygonsOf(child,out);
  return out;
}
function pointsOf(geometry,out=[]) {
  if(geometry?.type==='Point')out.push(geometry.coordinates);
  if(geometry?.type==='MultiPoint')out.push(...geometry.coordinates);
  if(geometry?.type==='GeometryCollection')for(const child of geometry.geometries)pointsOf(child,out);
  return out;
}
function clearance(point,polygon) {
  let squared=Infinity;
  for(const ring of polygon)for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
    squared=Math.min(squared,(point[0]-a[0]-t*dx)**2+(point[1]-a[1]-t*dy)**2);
  }
  return squared;
}
// A bounded scanline search in source coordinates: the longest interior interval
// on each sampled row is a candidate. Holes are subtracted by polygon membership.
// Ranking by boundary clearance avoids centroids in holes or outside concavities.
// This is a deterministic interior point, not a geographic area centroid.
export function interiorPoint(polygon) {
  const outer=polygon[0];if(!outer?.length)return null;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [x,y] of outer){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  if(!(x1>x0&&y1>y0)||ringArea(outer)<=0)return null;
  const center=[x0+(x1-x0)/2,y0+(y1-y0)/2];let best=null,bestScore=-1;
  const consider=point=>{if(!pointInPolygon(point,polygon))return;const score=clearance(point,polygon);if(score>bestScore&&score>0){best=point;bestScore=score;}};
  consider(center);
  const rows=[center[1],...Array.from({length:32},(_,i)=>y0+(y1-y0)*(i+.5)/32)];
  for(const y of rows){
    const xs=[];
    for(const ring of polygon)for(let i=1;i<ring.length;i++){
      const a=ring[i-1],b=ring[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    let widest=null;
    for(let i=1;i<xs.length;i+=2)if(xs[i]>xs[i-1]&&(!widest||xs[i]-xs[i-1]>widest[1]-widest[0]))widest=[xs[i-1],xs[i]];
    if(widest)consider([widest[0]+(widest[1]-widest[0])/2,y]);
  }
  return best;
}

export function resolveAnchors(geography,options={}) {
  const role=options.role??'symbol';if(!['symbol','label'].includes(role))throw new StatsMapError('anchor role must be symbol or label','INVALID_ARGUMENT');
  if(options.derive===true)throw new StatsMapError('derive:true needs an explicit anchor_policy method and version','INVALID_ANCHOR_POLICY');
  const policy=normalizeAnchorPolicy(options.derive===false?null:options.policy??geography.anchor_policy),ids=options.regionIds??geography.regions.map(region=>region.id);
  const declared=new Map(),symbols=new Map(),features=new Map(),anchors=new Map(),diagnostics=[];
  for(const a of geography.anchors??[])if(a.role===role)declared.set(a.region_id,a);else if(a.role==='symbol')symbols.set(a.region_id,a);
  for(const feature of geography.features?.features??[])if(feature.properties?.role==='region'){
    const id=feature.properties.region_id;if(!features.has(id))features.set(id,[]);features.get(id).push(feature);
  }
  const ref={id:geography.id,revision:geography.revision};
  for(const id of ids){
    const supplied=declared.get(id)??(role==='label'?symbols.get(id):null),local=features.get(id)??[];
    if(supplied){anchors.set(id,{...structuredClone(supplied),role,derived:supplied.derived===true,geography_ref:{...ref},...(supplied.role!==role?{source_role:supplied.role}:{})});continue;}
    const points=[];for(const feature of local)for(const point of pointsOf(feature.geometry))points.push({point,feature});
    const unique=[...new Map(points.map(entry=>[JSON.stringify(entry.point.slice(0,2)),entry])).values()];
    if(unique.length===1){const entry=unique[0];anchors.set(id,{region_id:id,role,point:entry.point.slice(0,2),method:'geometry-point',version:1,derived:false,geography_ref:{...ref},source_feature_ids:[...new Set(points.map(entry=>String(entry.feature.id)))].sort()});continue;}
    if(policy.method==='interior-point'){
      const polygons=local.flatMap(feature=>polygonsOf(feature.geometry).map((polygon,index)=>({polygon,index,feature,area:polygonArea(polygon)}))).filter(entry=>entry.area>0);
      polygons.sort((a,b)=>b.area-a.area||(String(a.feature.id)<String(b.feature.id)?-1:String(a.feature.id)>String(b.feature.id)?1:a.index-b.index));
      const main=polygons[0],point=main&&interiorPoint(main.polygon);
      if(point){anchors.set(id,{region_id:id,role,point,method:'interior-point',version:ANCHOR_ALGORITHM_VERSION,derived:true,geography_ref:{...ref},source_feature_ids:[String(main.feature.id)],source_polygon_index:main.index});continue;}
    }
    diagnostics.push({code:'MISSING_ANCHOR',region_id:id,role,reason:!local.some(feature=>geometryHasCoordinates(feature.geometry))?'no-geometry':policy.method==='none'?'policy-disabled':'no-interior-point'});
  }
  return {role,policy,anchors,diagnostics};
}

export function geometryStatus(geography,options={}) {
  const symbols=options.symbolResolution??resolveAnchors(geography,{...options,role:'symbol'}),labels=options.labelResolution??resolveAnchors(geography,{...options,role:'label'});
  const features=new Map();for(const feature of geography.features?.features??[])if(feature.properties?.role==='region'){
    const id=feature.properties.region_id;if(!features.has(id))features.set(id,[]);features.get(id).push(feature);
  }
  const regions=(options.regionIds??geography.regions.map(region=>region.id)).map(id=>({region_id:id,has_geometry:(features.get(id)??[]).some(feature=>geometryHasCoordinates(feature.geometry)),has_boundary:(features.get(id)??[]).some(feature=>geometryHasArea(feature.geometry)),has_symbol_anchor:symbols.anchors.has(id),has_label_anchor:labels.anchors.has(id)}));
  return {policy:symbols.policy,regions,symbols:[...symbols.anchors.values()],labels:[...labels.anchors.values()]};
}
