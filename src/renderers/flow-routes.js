import { StatsMapError } from '../core/errors.js';

const compare=(a,b)=>a<b?-1:a>b?1:0;
export const flowRouteId=(a,b)=>'flow-route:'+JSON.stringify([a,b].sort(compare));

// An unordered display route is a derived mark, never a reported relation.
// JSON tuple keys preserve arbitrary endpoint ids without delimiter collisions.
export function flowDisplayEdges(edges,reciprocalMode='separate') {
  if(reciprocalMode!=='merged')return edges.map(edge=>({...edge,source_relation_ids:[edge.id]}));
  const routes=new Map(),self=[];
  for(const edge of edges.slice().sort((a,b)=>compare(a.id,b.id))){
    if(edge.origin_region_id===edge.destination_region_id){self.push({...edge,source_relation_ids:[edge.id]});continue;}
    const id=flowRouteId(edge.origin_region_id,edge.destination_region_id);
    if(!routes.has(id)){
      const endpoints=[edge.origin_region_id,edge.destination_region_id].sort(compare);
      routes.set(id,{id,route_id:id,endpoint_region_ids:endpoints,origin_region_id:endpoints[0],destination_region_id:endpoints[1],value:0,source_relation_ids:[],integer:true});
    }
    const route=routes.get(id);route.value+=edge.value;route.source_relation_ids.push(edge.id);route.integer&&=Number.isInteger(edge.value);
    if(!Number.isFinite(route.value))throw new StatsMapError('flow route total must be finite','UNSUPPORTED_VALUE');
    if(route.integer&&!Number.isSafeInteger(route.value))throw new StatsMapError('flow route total exceeds safe integer precision','PRECISION_LOSS');
  }
  return [...self,...[...routes.values()].map(({integer,...route})=>({...route,source_relation_ids:route.source_relation_ids.sort(compare)}))].sort((a,b)=>compare(a.route_id??a.id,b.route_id??b.id));
}

export function registeredRouteRelations(observations,route) {
  const [a,b]=route.endpoint_region_ids;
  return observations.filter(edge=>edge.origin_region_id===a&&edge.destination_region_id===b||edge.origin_region_id===b&&edge.destination_region_id===a).sort((a,b)=>compare(a.id,b.id));
}
