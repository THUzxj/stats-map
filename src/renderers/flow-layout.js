import { StatsMapError } from '../core/errors.js';
import { bundleFlowPaths, normalizeBundleSettings } from './flow-bundle.js';

const compare=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const finite=(value,name,min=0,max=Infinity)=>{if(!Number.isFinite(value)||value<min||value>max)throw new StatsMapError(`invalid flow ${name}`,'INVALID_ENCODING');return value;};
export function validateFlowOptions(options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new StatsMapError('flow options must be an object','INVALID_ENCODING');
  if(!['curved','straight','sankey',undefined].includes(options.mode)||!['circle','donut',undefined].includes(options.nodeShape))throw new StatsMapError('unsupported flow mode or nodeShape','INVALID_ENCODING');
  for(const key of ['stack','arrows','showNodes','showInternal','filterTopLocations','gradient','opacityGradient','widthGradient','outline'])if(options[key]!==undefined&&typeof options[key]!=='boolean')throw new StatsMapError(`flow ${key} must be boolean`,'INVALID_ENCODING');
  if(!['sum','origin','destination',undefined].includes(options.topLocationsType)||!['area','radius',undefined].includes(options.nodeSizeScale))throw new StatsMapError('unsupported flow topLocationsType or nodeSizeScale','INVALID_ENCODING');
  if(!['separate','midpoint','merged',undefined].includes(options.reciprocalMode))throw new StatsMapError('unsupported flow reciprocalMode','INVALID_ENCODING');
  if(!['angle','value-ascending','value-descending','id',undefined].includes(options.order))throw new StatsMapError('unsupported flow port order','INVALID_ENCODING');
  for(const key of ['maxWidth','minWidth','maxValue','minValue','maxNodeValue','maxNodeRadius','minNodeRadius','loopRadius','nodeGap','stackGap','outlineWidth','bidirectionalGap','arrowScale'])if(options[key]!==undefined)finite(options[key],key);
  if((options.minNodeRadius??0)>(options.maxNodeRadius??12))throw new StatsMapError('flow minNodeRadius exceeds maxNodeRadius','INVALID_ENCODING');
  if(options.topLocations!==undefined&&(!Number.isInteger(options.topLocations)||options.topLocations<0))throw new StatsMapError('topLocations must be a non-negative integer','INVALID_ENCODING');
  for(const key of ['color','endColor','outlineColor','internalColor'])if(options[key]!==undefined&&(typeof options[key]!=='string'||!options[key]))throw new StatsMapError(`flow ${key} must be a nonempty color string`,'INVALID_ENCODING');
  for(const key of ['regionColors','regionLabels','topColors'])if(options[key]!==undefined&&!(key==='regionColors'&&options[key]===false)&&(!Array.isArray(options[key])||!options[key].length||(key!=='topColors'&&options[key].length!==2)||options[key].some(value=>typeof value!=='string'||!value)))throw new StatsMapError(`invalid flow ${key}`,'INVALID_ENCODING');
  if(options.nodeLabels!==undefined&&typeof options.nodeLabels!=='boolean'){
    const labels=options.nodeLabels;
    if(!labels||typeof labels!=='object'||Array.isArray(labels))throw new StatsMapError('flow nodeLabels must be boolean or an object','INVALID_ENCODING');
    for(const key of Object.keys(labels))if(!['content','offset','fontSize','maxWidth','collision','maxOffset','step'].includes(key))throw new StatsMapError(`unknown flow nodeLabels setting: ${key}`,'INVALID_ENCODING');
    if(!['name','value','name-value',undefined].includes(labels.content)||!['none','hide','avoid',undefined].includes(labels.collision))throw new StatsMapError('invalid flow node label content or collision policy','INVALID_ENCODING');
    if(labels.offset!==undefined&&(!Array.isArray(labels.offset)||labels.offset.length!==2||!labels.offset.every(Number.isFinite)))throw new StatsMapError('flow node label offset must be a finite pair','INVALID_ENCODING');
    for(const key of ['fontSize','maxWidth'])if(labels[key]!==undefined)finite(labels[key],`nodeLabels.${key}`,Number.MIN_VALUE);
    if(labels.step!==undefined)finite(labels.step,'nodeLabels.step',1);
    if(labels.maxOffset!==undefined)finite(labels.maxOffset,'nodeLabels.maxOffset',0,1000);
  }
  if((options.minWidth??0)>(options.maxWidth??12))throw new StatsMapError('flow minWidth exceeds maxWidth','INVALID_ENCODING');
  if(options.opacity!==undefined)finite(options.opacity,'opacity',0,1);
  if(options.curvature!==undefined)finite(options.curvature,'curvature',-10,10);
  if(options.bundling!==undefined&&typeof options.bundling!=='boolean'&&!(typeof options.bundling==='number'&&Number.isFinite(options.bundling)&&options.bundling>=0&&options.bundling<=1))throw new StatsMapError('flow bundling must be boolean or a strength from 0 to 1','INVALID_ENCODING');
  if(options.bundling&&options.mode==='sankey')throw new StatsMapError('force bundling and spatial Sankey are distinct flow modes','UNSUPPORTED_ENCODING');
  if(options.bundleSettings!==undefined||options.bundling)normalizeBundleSettings(options.bundleSettings);
  for(const key of ['curvatureSettings','widthGradientSettings'])if(options[key]!==undefined&&(!options[key]||typeof options[key]!=='object'||Array.isArray(options[key])))throw new StatsMapError(`flow ${key} must be an object`,'INVALID_ENCODING');
  for(const [key,value] of Object.entries(options.curvatureSettings??{}))if(['gapX','padX','padY','bumpY'].includes(key))finite(value,`curvatureSettings.${key}`);else if(key==='curvature')finite(value,'curvatureSettings.curvature',0,1);else throw new StatsMapError(`unknown flow curvature setting: ${key}`,'INVALID_ENCODING');
  const gradient=options.widthGradientSettings??{};
  for(const key of Object.keys(gradient))if(!['startRatio','minStartWidth','samples'].includes(key))throw new StatsMapError(`unknown flow width gradient setting: ${key}`,'INVALID_ENCODING');
  if(gradient.startRatio!==undefined)finite(gradient.startRatio,'widthGradientSettings.startRatio',0,1);
  if(gradient.minStartWidth!==undefined)finite(gradient.minStartWidth,'widthGradientSettings.minStartWidth');
  if(gradient.samples!==undefined&&(!Number.isInteger(gradient.samples)||gradient.samples<8||gradient.samples>256))throw new StatsMapError('flow widthGradientSettings.samples must be an integer from 8 to 256','INVALID_ENCODING');
}

export function flowWidth(value,maximum,options={}) {
  if(value<=0||maximum<=0)return 0;
  return (options.minWidth??0)+value/maximum*((options.maxWidth??12)-(options.minWidth??0));
}

export function flowNodeRadius(value,maximum,options={}) {
  if(value<=0||maximum<=0||options.showNodes===false)return 0;
  const ratio=Math.min(1,value/maximum),scaled=options.nodeSizeScale==='radius'?ratio:Math.sqrt(ratio);
  return (options.minNodeRadius??0)+scaled*((options.maxNodeRadius??12)-(options.minNodeRadius??0));
}

function sampleCubic(segment,count=16){
  const [a,b,c,d]=segment;
  return Array.from({length:count},(_,i)=>{const t=(i+1)/count,u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];});
}
function cubicBetween(a,b,curvature){
  if(a[0]===b[0]){const bend=Math.max(8,Math.abs(b[1]-a[1])*curvature*.5);return [a,[a[0]+bend,a[1]],[b[0]+bend,b[1]],b];}
  return [a,[a[0]+(b[0]-a[0])*curvature,a[1]],[b[0]-(b[0]-a[0])*curvature,b[1]],b];
}
function cubicGeometry(segments,count=16){return {path:`M${segments[0][0]}`+segments.map(s=>`C${s[1]} ${s[2]} ${s[3]}`).join(''),points:[segments[0][0],...segments.flatMap(s=>sampleCubic(s,count))]};}

// Bypass other node symbols and stems in screen coordinates; graph nodes never
// move. Cycles and disconnected components need no DAG conversion.
function sankeyGeometry(edge,nodes,settings={},samples=16) {
  const a=edge.start,b=edge.end,curvature=settings.curvature??.5;
  if(a[0]===b[0])return cubicGeometry([cubicBetween(a,b,curvature)],samples);
  const reversed=a[0]>b[0],first=reversed?b:a,last=reversed?a:b,half=edge.width/2;
  const obstacles=[];
  for(const node of nodes.values()){
    if(node.id===edge.origin_region_id||node.id===edge.destination_region_id)continue;
    if(node.x<=first[0]||node.x>=last[0])continue;
    const pad=(settings.padY??2)+half,top=Math.min(node.y-node.radius,node.y-node.span/2)-pad,bottom=Math.max(node.y+node.radius,node.y+node.span/2)+pad;
    const y=first[1]+(last[1]-first[1])*(node.x-first[0])/(last[0]-first[0]);
    if(y<top||y>bottom)continue;
    const horizontal=node.radius+(settings.padX??2)+(settings.gapX??10)+half;
    obstacles.push({left:Math.max(first[0]+1e-6,node.x-horizontal),right:Math.min(last[0]-1e-6,node.x+horizontal),top:top-(settings.bumpY??1),bottom:bottom+(settings.bumpY??1)});
  }
  obstacles.sort((a,b)=>a.left-b.left);const groups=[];
  for(const obstacle of obstacles){const previous=groups.at(-1);if(previous&&obstacle.left<=previous.right){previous.right=Math.max(previous.right,obstacle.right);previous.top=Math.min(previous.top,obstacle.top);previous.bottom=Math.max(previous.bottom,obstacle.bottom);}else groups.push({...obstacle});}
  let points=[first];
  for(const group of groups){const baseline=first[1]+(last[1]-first[1])*((group.left+group.right)/2-first[0])/(last[0]-first[0]),y=Math.abs(baseline-group.top)<=Math.abs(baseline-group.bottom)?group.top:group.bottom;points.push([group.left,y],[group.right,y]);}
  points.push(last);if(reversed)points.reverse();
  return cubicGeometry(points.slice(1).map((point,i)=>cubicBetween(points[i],point,curvature)),samples);
}

// Catmull-Rom interpolation provides a smooth path through the relaxed controls
// without using DOM path measurement or changing fixed geographic endpoints.
export function smoothFlowGeometry(points,samples=16){
  if(points.length<2)return {path:'',points:[]};
  const segments=[];
  for(let i=0;i<points.length-1;i++){const before=points[Math.max(0,i-1)],a=points[i],b=points[i+1],after=points[Math.min(points.length-1,i+2)];segments.push([a,[a[0]+(b[0]-before[0])/6,a[1]+(b[1]-before[1])/6],[b[0]-(after[0]-a[0])/6,b[1]-(after[1]-a[1])/6],b]);}
  return cubicGeometry(segments,samples);
}

export function flowLayout(model,anchors,options={}) {
  if(options.signal?.aborted)throw new StatsMapError('flow layout cancelled','ABORTED');
  validateFlowOptions(model.options);const settings=model.options,stack=settings.stack??model.mode==='sankey',diagnostics=[],nodes=new Map(),edges=[];
  const samples=settings.widthGradientSettings?.samples??32;
  const maxNode=settings.maxNodeValue??[...model.filtered.nodes.values()].reduce((max,node)=>Math.max(max,node.incoming+node.outgoing+node.internal),0);
  for(const node of [...model.filtered.nodes.values()].sort((a,b)=>compare(a.id,b.id))){const point=anchors.get(node.id);if(!point)continue;if(!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite))throw new StatsMapError('flow anchors must contain finite screen coordinates','INVALID_GEOMETRY');nodes.set(node.id,{id:node.id,x:point[0],y:point[1],radius:flowNodeRadius(node.incoming+node.outgoing+node.internal,maxNode,settings),span:0,left:[],right:[]});}
  for(const raw of (model.displayEdges??model.edges).slice().sort((a,b)=>compare(a.id,b.id))){
    const source=nodes.get(raw.origin_region_id),target=nodes.get(raw.destination_region_id);
    if(!source||!target){diagnostics.push({code:'MISSING_ANCHOR',...(raw.route_id?{route_id:raw.route_id,source_relation_ids:[...raw.source_relation_ids]}:{relation_id:raw.id}),region_ids:[...new Set([!source?raw.origin_region_id:null,!target?raw.destination_region_id:null].filter(Boolean))]});continue;}
    edges.push({id:raw.id,layout_key:JSON.stringify([raw.route_id?'route':'relation',raw.id]),...(raw.route_id?{route_id:raw.route_id,endpoint_region_ids:[...raw.endpoint_region_ids]}:{}),origin_region_id:raw.origin_region_id,destination_region_id:raw.destination_region_id,value:raw.value,width:flowWidth(raw.value,model.maximum,settings),start:[source.x,source.y],end:[target.x,target.y],self:source===target,source_relation_ids:[...(raw.source_relation_ids??[raw.id])]});
  }
  const reverse=new Map(edges.map(edge=>[JSON.stringify([edge.origin_region_id,edge.destination_region_id]),edge])),midpoints=[];
  for(const edge of edges){
    if(edge.self)continue;const back=reverse.get(JSON.stringify([edge.destination_region_id,edge.origin_region_id]));
    if(settings.reciprocalMode==='midpoint'&&back&&edge.value>0&&back.value>0){
      edge.midpoint=true;edge.start=[(nodes.get(edge.origin_region_id).x+nodes.get(edge.destination_region_id).x)/2,(nodes.get(edge.origin_region_id).y+nodes.get(edge.destination_region_id).y)/2];
      if(compare(edge.id,back.id)<0)midpoints.push({relation_ids:[edge.id,back.id],point:edge.start});
    }
    const source=nodes.get(edge.origin_region_id),target=nodes.get(edge.destination_region_id),add=(node,other,at)=>{
      const side=other[0]<node.x?'left':'right';node[side].push({edge,at,other,side});
    };
    if(!edge.midpoint)add(source,[target.x,target.y],'start');add(target,edge.midpoint?edge.start:[source.x,source.y],'end');
  }
  for(const node of nodes.values())for(const side of ['left','right']){
    const ports=node[side],order=settings.order??'angle';
    ports.sort((a,b)=>order==='value-ascending'?a.edge.value-b.edge.value||compare(a.edge.id,b.edge.id):order==='value-descending'?b.edge.value-a.edge.value||compare(a.edge.id,b.edge.id):order==='id'?compare(a.edge.id,b.edge.id):Math.atan2(a.other[1]-node.y,a.other[0]-node.x)-Math.atan2(b.other[1]-node.y,b.other[0]-node.x)||compare(a.edge.id,b.edge.id));
    const gap=settings.stackGap??0,total=ports.reduce((sum,port)=>sum+port.edge.width,0)+gap*Math.max(0,ports.filter(port=>port.edge.width>0).length-1);let y=node.y-total/2;
    for(const port of ports){
      const offset=stack&&port.edge.width>0?y+port.edge.width/2:node.y;
      const dx=port.other[0]-node.x,dy=port.other[1]-node.y,length=Math.hypot(dx,dy)||1,r=Math.min(node.radius+(settings.nodeGap??1),length/4);
      port.point=stack?[node.x+(side==='left'?-1:1)*(node.radius+(settings.nodeGap??1)),offset]:[node.x+dx/length*r,node.y+dy/length*r];port.edge[port.at]=port.point;
      port.interval=[offset-port.edge.width/2,offset+port.edge.width/2];
      if(stack&&port.edge.width>0)y+=port.edge.width+gap;
    }
    if(stack)node.span=Math.max(node.span,total);
  }
  const byId=new Map(edges.map(edge=>[edge.id,edge]));
  for(const midpoint of midpoints){const pair=midpoint.relation_ids.map(id=>byId.get(id));midpoint.point=[midpoint.point[0],(pair[0].end[1]+pair[1].end[1])/2];for(const edge of pair)edge.start=[...midpoint.point];}
  for(const edge of edges){
    const node=nodes.get(edge.origin_region_id);
    if(edge.self){const r=Math.max(node.radius+8,settings.loopRadius??20),a=[node.x+node.radius*.7,node.y-node.radius*.7],b=[node.x-node.radius*.7,node.y-node.radius*.7];edge.start=a;edge.end=b;Object.assign(edge,cubicGeometry([[a,[node.x+r*2,node.y-r*2],[node.x-r*2,node.y-r*2],b]],samples));continue;}
    if(node.x===nodes.get(edge.destination_region_id).x&&node.y===nodes.get(edge.destination_region_id).y){
      edge.coincident=true;diagnostics.push({code:'COINCIDENT_FLOW_ANCHORS',...(edge.route_id?{route_id:edge.route_id,source_relation_ids:[...edge.source_relation_ids]}:{relation_id:edge.id}),region_ids:[edge.origin_region_id,edge.destination_region_id]});
      const r=Math.max(node.radius+8,settings.loopRadius??20),direction=compare(edge.origin_region_id,edge.destination_region_id)<0?1:-1;
      edge.start=[node.x+direction*node.radius,node.y];edge.end=[node.x-direction*node.radius,node.y];
      Object.assign(edge,cubicGeometry([[edge.start,[node.x+direction*r*2,node.y-r*2],[node.x-direction*r*2,node.y-r*2],edge.end]],samples));continue;
    }
    if(!edge.midpoint&&!stack&&(model.mode==='straight'||settings.bundling||model.mode==='sankey')){
      const back=reverse.get(JSON.stringify([edge.destination_region_id,edge.origin_region_id]));
      if(back){const dx=edge.end[0]-edge.start[0],dy=edge.end[1]-edge.start[1],length=Math.hypot(dx,dy)||1,shift=settings.bidirectionalGap??Math.max(3,(edge.width+back.width)/4+1);edge.start=[edge.start[0]-dy/length*shift,edge.start[1]+dx/length*shift];edge.end=[edge.end[0]-dy/length*shift,edge.end[1]+dx/length*shift];}
    }
    if(!edge.route_id&&model.mode!=='sankey'&&!settings.widthGradient&&settings.arrows!==false&&edge.width>0){
      const dx=edge.end[0]-edge.start[0],dy=edge.end[1]-edge.start[1],length=Math.hypot(dx,dy);
      edge.arrow_size=Math.min(Math.max(6,edge.width*1.5)*(settings.arrowScale??1),length*.3);
      edge.end=[edge.end[0]-dx/(length||1)*edge.arrow_size,edge.end[1]-dy/(length||1)*edge.arrow_size];
    }
    if(model.mode==='sankey')Object.assign(edge,sankeyGeometry(edge,nodes,settings.curvatureSettings,samples));
    else if(model.mode==='curved'&&!settings.bundling){
      const a=edge.start,b=edge.end,curvature=settings.curvature??.2,control=[(a[0]+b[0])/2-(b[1]-a[1])*curvature,(a[1]+b[1])/2+(b[0]-a[0])*curvature];edge.path=`M${a}Q${control} ${b}`;edge.points=Array.from({length:samples+1},(_,i)=>{const t=i/samples,u=1-t;return [u*u*a[0]+2*u*t*control[0]+t*t*b[0],u*u*a[1]+2*u*t*control[1]+t*t*b[1]];});
    }else {edge.path=`M${edge.start}L${edge.end}`;edge.points=Array.from({length:samples+1},(_,i)=>edge.start.map((value,axis)=>value+(edge.end[axis]-value)*i/samples));}
  }
  let bundle=null;
  if(settings.bundling){bundle=bundleFlowPaths(edges.filter(edge=>!edge.self&&!(nodes.get(edge.origin_region_id).x===nodes.get(edge.destination_region_id).x&&nodes.get(edge.origin_region_id).y===nodes.get(edge.destination_region_id).y)).map(edge=>({id:edge.layout_key,start:edge.start,end:edge.end})),{...settings.bundleSettings,chargeStrength:(settings.bundleSettings?.chargeStrength??12)*(typeof settings.bundling==='number'?settings.bundling:1)},options);for(const edge of edges)if(bundle.paths.has(edge.layout_key))Object.assign(edge,smoothFlowGeometry(bundle.paths.get(edge.layout_key),samples));}
  return {algorithm:'spatial-flow',version:1,nodes,edges,midpoints,diagnostics,bundle,stack};
}

export function flowRibbon(points,width,options={}) {
  if(!points.length||width===0)return '';
  const total=points.slice(1).reduce((sum,point,i)=>sum+Math.hypot(point[0]-points[i][0],point[1]-points[i][1]),0),top=[],bottom=[];let distance=0;
  for(let i=0;i<points.length;i++){
    if(i)distance+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1,t=total?distance/total:0;
    const start=options.widthGradient?Math.max(options.widthGradientSettings?.minStartWidth??0,width*(options.widthGradientSettings?.startRatio??.25)):width;
    const half=(options.pointedTip&&i===points.length-1?0:(start+(width-start)*t)/2)+(options.extraPad??0);
    top.push([points[i][0]-dy/length*half,points[i][1]+dx/length*half]);bottom.push([points[i][0]+dy/length*half,points[i][1]-dx/length*half]);
  }
  return `M${top[0]}`+top.slice(1).map(point=>`L${point}`).join('')+bottom.reverse().map(point=>`L${point}`).join('')+'Z';
}
