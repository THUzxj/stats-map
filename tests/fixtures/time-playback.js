import { sample } from './encoding.js';

// Fictional, deliberately different timelines; index alignment would be wrong.
export function playbackBundle(){
  const {geography,dataset}=sample();
  dataset.periods=[{id:'late',label:'Late',order:2},{id:'early',label:'Early',order:0},{id:'empty',label:'Empty',order:1}];
  dataset.observations=dataset.observations.flatMap(row=>[
    {...row,id:row.id+'-early',period_id:'early',value:row.region_id==='a'?0:row.value},
    {...row,id:row.id+'-late',period_id:'late',status:'suppressed',value:null}
  ]);
  const other=structuredClone(dataset);other.id='other';other.revision='r2';
  other.periods=[{id:'late',label:'Other late',order:0},{id:'other-only',label:'Only in other',order:1}];
  other.observations=other.observations.filter(row=>row.period_id==='late');
  const spec={schema_version:1,kind:'stats-map/spec',id:'playback',revision:'r1',geography_ref:{id:geography.id,revision:geography.revision},dataset_refs:[dataset,other].map(d=>({id:d.id,revision:d.revision})),view:{period_id:'early'},layout:{type:'geographic'},layers:[
    {id:'primary',type:'choropleth',encoding:{dataset_id:dataset.id,series_id:'one'}},
    {id:'secondary',type:'proportionalSymbol',encoding:{dataset_id:other.id,series_id:'two'}}
  ]};
  return {schema_version:1,kind:'stats-map/bundle',id:'playback-bundle',revision:'r1',resources:[geography,dataset,other,spec].map(resource=>({storage:'inline',resource})),spec_ref:{id:spec.id,revision:spec.revision}};
}

export function queuedScheduler(){
  const callbacks=[],active=new Set(),cleared=[];
  return {callbacks,active,cleared,options:{setInterval(callback){callbacks.push(callback);active.add(callbacks.length);return callbacks.length;},clearInterval(id){active.delete(id);cleared.push(id);}}};
}

export function controlContainer(){
  return {ownerDocument:{createElement(){return {listeners:new Map(),setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}};}},replaceChildren(...children){this.children=children;}};
}
