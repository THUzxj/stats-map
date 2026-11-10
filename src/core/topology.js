import { StatsMapError } from './errors.js';

const invalid=message=>{throw new StatsMapError(message,'INVALID_GEOMETRY');};

// Decode the TopoJSON arc/transform contract without geographic presets.
export function decodeTopology(topology,options={}) {
  if(topology?.type!=='Topology'||!topology.objects||!Array.isArray(topology.arcs))invalid('expected a TopoJSON topology');
  const transform=topology.transform;
  if(transform&&(!Array.isArray(transform.scale)||!Array.isArray(transform.translate)||transform.scale.length!==2||transform.translate.length!==2||![...transform.scale,...transform.translate].every(Number.isFinite)))invalid('invalid topology transform');
  const point=value=>{
    if(!Array.isArray(value)||value.length<2||!value.every(Number.isFinite))invalid('invalid topology coordinate');
    return transform?[value[0]*transform.scale[0]+transform.translate[0],value[1]*transform.scale[1]+transform.translate[1],...value.slice(2)]:[...value];
  };
  const cache=new Map();
  const arc=reference=>{
    if(!Number.isSafeInteger(reference))invalid('topology arc reference must be an integer');
    const index=reference<0?-reference-1:reference;
    if(index>=topology.arcs.length)invalid(`topology arc is absent: ${index}`);
    if(!cache.has(index)){
      const input=topology.arcs[index];if(!Array.isArray(input)||input.length<2)invalid(`invalid topology arc: ${index}`);
      let x=0,y=0;
      cache.set(index,input.map(value=>{if(!Array.isArray(value)||value.length<2||!value.every(Number.isFinite))invalid('invalid topology arc coordinate');if(!transform)return [...value];x+=value[0];y+=value[1];return point([x,y,...value.slice(2)]);}));
    }
    const coordinates=cache.get(index).map(value=>[...value]);
    return reference<0?coordinates.reverse():coordinates;
  };
  const line=references=>{
    if(!Array.isArray(references)||!references.length)invalid('topology line needs arc references');
    const coordinates=[];
    for(const reference of references){const next=arc(reference);if(coordinates.length){const last=coordinates.at(-1);if(last[0]!==next[0][0]||last[1]!==next[0][1])invalid('topology arcs do not join');coordinates.pop();}for(const coordinate of next)coordinates.push(coordinate);}
    return coordinates;
  };
  const ring=references=>{const coordinates=line(references),first=coordinates[0],last=coordinates.at(-1);if(coordinates.length<4||first[0]!==last[0]||first[1]!==last[1])invalid('topology polygon ring must be closed');return coordinates;};
  const list=(value,convert)=>{if(!Array.isArray(value))invalid('invalid topology geometry coordinates');return value.map(convert);};
  const geometry=input=>{
    if(input==null||input.type==null)return null;
    switch(input.type){
      case 'Point':return {type:input.type,coordinates:point(input.coordinates)};
      case 'MultiPoint':return {type:input.type,coordinates:list(input.coordinates,point)};
      case 'LineString':return {type:input.type,coordinates:line(input.arcs)};
      case 'MultiLineString':return {type:input.type,coordinates:list(input.arcs,line)};
      case 'Polygon':return {type:input.type,coordinates:list(input.arcs,ring)};
      case 'MultiPolygon':return {type:input.type,coordinates:list(input.arcs,polygon=>list(polygon,ring))};
      case 'GeometryCollection':return {type:input.type,geometries:list(input.geometries,geometry)};
      default:invalid(`unsupported topology geometry: ${input.type}`);
    }
  };
  const names=options.objects??Object.keys(topology.objects);
  if(!Array.isArray(names)||new Set(names).size!==names.length)invalid('topology objects must be distinct names');
  const features=[];
  for(const name of names){
    const object=topology.objects[name];if(!object)invalid(`topology object is absent: ${name}`);
    const objects=object.type==='GeometryCollection'?object.geometries:[object];
    if(!Array.isArray(objects))invalid('invalid topology geometry collection');
    for(const [index,input] of objects.entries())features.push({type:'Feature',id:input.id??`${name}-${index}`,properties:{...input.properties},geometry:geometry(input)});
  }
  return {type:'FeatureCollection',features};
}
