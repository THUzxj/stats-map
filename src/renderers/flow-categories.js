// Category keys are tagged: a real region called "Other" or "Internal" can
// never collide with a derived group. Every group retains raw OD identities.
export const compareFlowIds=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const palette=['#00b3e3','#fbba00','#2ba966','#d23142','#005289','#93397f'];
export const flowRegionKey=id=>JSON.stringify(['region',id]);
export function flowCategory(model,edge) {
  const top=new Set(model.top),type=model.options.topLocationsType??'sum';
  const id=type==='origin'?(top.has(edge.origin_region_id)?edge.origin_region_id:null):type==='destination'?(top.has(edge.destination_region_id)?edge.destination_region_id:null):top.has(edge.destination_region_id)?edge.destination_region_id:top.has(edge.origin_region_id)?edge.origin_region_id:null;
  return id==null?'other':flowRegionKey(id);
}
export function flowCategoryStyle(model,key) {
  const {options,presentation:p}=model;
  if(key==='internal')return {key,label:p.t('internal'),color:options.internalColor??'#999999'};
  if(key==='mixed')return {key,label:p.t('mixedFlow'),color:options.color??'#526b8e'};
  if(key==='other')return {key,label:p.t('other'),color:options.color??'#526b8e'};
  const id=JSON.parse(key)[1],colors=options.topColors??p.theme.categoryColors??palette;
  return {key,region_id:id,label:model.labels.get(id)??id,color:colors[model.top.indexOf(id)%colors.length]};
}
export function flowDisplayCategory(model,edge) {
  if(!model.top.length)return 'other';
  const records=edge.route_id?edge.source_relation_ids.map(id=>model.edgeIndex.get(id)):[edge];
  const keys=new Set(records.map(record=>flowCategory(model,record)));
  // A merged route with two different categories is neutral, rather than
  // assigning its sum to the arbitrary canonical endpoint direction.
  return keys.size===1?[...keys][0]:'mixed';
}
export function flowBreakdowns(model) {
  const result=new Map();
  const add=(id,channel,key,edge)=>{
    if(!result.has(id))result.set(id,new Map());const groups=result.get(id),identity=JSON.stringify([channel,key]);
    if(!groups.has(identity))groups.set(identity,{id:identity,channel,...flowCategoryStyle(model,key),value:0,source_relation_ids:[]});
    const group=groups.get(identity);group.value+=edge.value;group.source_relation_ids.push(edge.id);
  };
  for(const edge of model.edges){
    const key=flowCategory(model,edge);
    if(edge.origin_region_id===edge.destination_region_id)add(edge.origin_region_id,'internal','internal',edge);
    else {add(edge.origin_region_id,'outgoing',key,edge);add(edge.destination_region_id,'incoming',key,edge);}
  }
  return new Map([...result].map(([id,groups])=>[id,[...groups.values()].sort((a,b)=>['incoming','outgoing','internal'].indexOf(a.channel)-['incoming','outgoing','internal'].indexOf(b.channel)||(a.key==='other')-(b.key==='other')||b.value-a.value||compareFlowIds(a.key,b.key))]));
}
export function flowNetStyle(model,id) {
  const node=model.filtered.nodes.get(id),net=(node?.incoming??0)-(node?.outgoing??0);
  if(!net||model.options.regionColors===false)return null;
  const index=net>0?1:0;
  return {key:index?'importer':'exporter',value:net,color:(model.options.regionColors??['#bbd7ee','#c7e3c6'])[index],label:model.options.regionLabels?.[index]??model.presentation.t(index?'netImporter':'netExporter')};
}
