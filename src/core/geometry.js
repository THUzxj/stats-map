import { StatsMapError } from './errors.js';
import { resolveAnchors, pointInPolygon, geometryHasArea } from './anchors.js';
export { resolveAnchors, geometryStatus, normalizeAnchorPolicy, ANCHOR_ALGORITHM_VERSION } from './anchors.js';
const coords = g => { const out=[]; const walk=x=>{if(!Array.isArray(x))return; if(typeof x[0]==='number')out.push(x); else x.forEach(walk)}; const geometry=value=>{walk(value?.coordinates);value?.geometries?.forEach(geometry);};geometry(g);return out; };
export function featureIndex(geography) { const map = new Map(); for (const f of geography.features?.features ?? []) { const id=f.properties?.region_id; if (id && f.properties.role === 'region') { if(!map.has(id))map.set(id,[]); map.get(id).push(f); } } return map; }
function regionCoordinates(geography,regionIds) {
  const ids=regionIds?new Set(regionIds):null,represented=new Set(),out=[];
  for(const feature of geography.features?.features??[]){
    const id=feature.properties?.region_id;if(feature.properties?.role!=='region'||ids&&!ids.has(id))continue;
    const points=coords(feature.geometry);if(points.length){represented.add(id);for(const point of points)out.push(point);}
  }
  // Anchor-only statistical nodes still participate in fitting and hit testing.
  for(const anchor of geography.anchors??[])if(!represented.has(anchor.region_id)&&(!ids||ids.has(anchor.region_id)))out.push(anchor.point);
  return out;
}
export function bounds(geography,regionIds=null) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of regionCoordinates(geography,regionIds)){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
  return minX===Infinity?null:[[minX,minY],[maxX,maxY]];
}
const projections=new Map([
  ['equirectangular',(point,projection)=>[point[0]-(projection.center?.[0]??0),(projection.center?.[1]??0)-point[1]]],
  ['mercator',(point,projection)=>{
    const rad=Math.PI/180,latitude=value=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,value))*rad/2));
    return [(point[0]-(projection.center?.[0]??0))*rad,latitude(projection.center?.[1]??0)-latitude(point[1])];
  }]
]);
export function registerProjection(id,forward) {
  if(typeof id!=='string'||!id||typeof forward!=='function'||['raw','cartesian','identity'].includes(id))throw new StatsMapError('projection registration requires a name and forward function','INVALID_ARGUMENT');
  if(projections.has(id))throw new StatsMapError(`projection already registered: ${id}`,'INVALID_ARGUMENT');
  projections.set(id,forward);return ()=>{if(projections.get(id)===forward)projections.delete(id);};
}
function rawPoint(point,projection) {
  const [x,y]=point,[cx,cy]=projection.center??[0,0];
  if(['cartesian','identity','raw'].includes(projection.type))return [x-cx,projection.yDirection==='down'?y-cy:cy-y];
  const forward=projections.get(projection.type??'equirectangular');
  if(!forward)throw new StatsMapError(`unregistered projection: ${projection.type}`,'UNSUPPORTED_PROJECTION');
  const result=forward(point,projection);
  if(!Array.isArray(result)||result.length<2||!result.slice(0,2).every(Number.isFinite))throw new StatsMapError('projection returned nonfinite coordinates','INVALID_GEOMETRY');
  return result;
}
export function projectPoint(point,projection={}) {
  if(projection.type==='raw')return [point[0],point[1]];
  const scale=projection.scale??1,translate=projection.translate??[0,0],[x,y]=rawPoint(point,projection);
  return [x*scale+translate[0],y*scale+translate[1]];
}
export function fitProjection(geography,viewport={width:800,height:600},options={}) {
  const width=viewport.width??800,height=viewport.height??600,padding=viewport.padding??options.padding??20;
  if(![width,height,padding].every(Number.isFinite)||width<=0||height<=0||padding<0)throw new StatsMapError('viewport dimensions must be positive and padding non-negative','INVALID_ARGUMENT');
  const type=geography.coordinate_space?.type==='cartesian'?'cartesian':(options.projection?.id??'equirectangular');
  if(!['cartesian','identity','raw'].includes(type)&&!projections.has(type))throw new StatsMapError(`unregistered projection: ${type}`,'UNSUPPORTED_PROJECTION');
  const yDirection=geography.coordinate_space?.y_direction??'up',b=bounds(geography,options.regionIds);
  const center=options.projection?.center??(b?[(b[0][0]+b[1][0])/2,(b[0][1]+b[1][1])/2]:[0,0]);
  if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite))throw new StatsMapError('projection center must be a numeric pair','INVALID_ARGUMENT');
  const base={...options.projection,type,yDirection,center,scale:1,translate:[width/2,height/2]};
  if(!b)return base;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const coordinate of regionCoordinates(geography,options.regionIds)){
    const [x,y]=rawPoint(coordinate,base);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  const w=Math.max(maxX-minX,1e-12),h=Math.max(maxY-minY,1e-12),inset=Math.min(padding,Math.min(width,height)*.49),scale=Math.min((width-2*inset)/w,(height-2*inset)/h);
  return {...base,scale,translate:[width/2-(minX+maxX)/2*scale,height/2-(minY+maxY)/2*scale]};
}
export function anchorIndex(geography, options={}) { return new Map([...resolveAnchors(geography,options).anchors].map(([id,a])=>[id,[...a.point]])); }
export function screenAnchors(geography, projection, options={}) { const a=anchorIndex(geography,options); return new Map([...a].map(([id,p])=>[id,projectPoint(p,projection)])); }
function polygonHit(point,geometry,projection) {
  if(geometry.type==='GeometryCollection')return geometry.geometries.some(child=>polygonHit(point,child,projection));
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  return polygons.some(polygon=>pointInPolygon(point,polygon.map(ring=>ring.map(position=>projectPoint(position,projection)))));
}
export function hitTest(point, geography, projection, options={}) {
  const ids=options.regionIds?new Set(options.regionIds):null;
  const features=[...(geography.features?.features??[])].reverse();
  const areaIds=new Set(features.filter(feature=>feature.properties?.role==='region'&&geometryHasArea(feature.geometry)).map(feature=>feature.properties.region_id));
  for(const feature of features){
    const id=feature.properties?.region_id;
    if(feature.properties?.role!=='region'||ids&&!ids.has(id))continue;
    if(polygonHit(point,feature.geometry,projection))return {regionId:id,distance:0,point};
  }
  const radius=options.radius??8,hits=[];
  for(const [id,position] of screenAnchors(geography,projection,options)){
    if(ids&&!ids.has(id))continue;
    if(areaIds.has(id)&&options.includePolygonAnchors!==true)continue;
    const distance=Math.hypot(position[0]-point[0],position[1]-point[1]);
    if(distance<=radius)hits.push({regionId:id,distance,point:position});
  }
  return hits.sort((a,b)=>a.distance-b.distance)[0]??null;
}
