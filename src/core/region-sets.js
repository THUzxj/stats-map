import { StatsMapError } from './errors.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const require=(condition,message)=>{if(!condition)throw new StatsMapError(message,'INVALID_REGION_SET');};
const string=(value,name)=>require(typeof value==='string'&&value.length>0,`${name} must be a nonempty string`);
const ref=(value,name)=>{require(object(value),`${name} must be an object`);string(value.id,`${name}.id`);string(value.revision,`${name}.revision`);};
const ids=(value,name)=>require(Array.isArray(value)&&value.every(id=>typeof id==='string'&&id.length>0)&&new Set(value).size===value.length,`${name} must contain distinct nonempty region ids`);
const equal=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
function sources(value){
  if(value==null)return;
  require(Array.isArray(value),'region set sources must be an array');
  for(const source of value){require(object(source),'region set source must be an object');string(source.title,'source.title');if(source.url!=null)require(typeof source.url==='string'&&/^https?:\/\/[^\s]+$/i.test(source.url),'invalid region set source URL');if(source.sha256!=null)require(typeof source.sha256==='string'&&/^[a-f0-9]{64}$/i.test(source.sha256),'invalid region set source SHA-256');}
}
function labels(value){
  if(value.label!=null)string(value.label,'region set label');
  if(value.labels!=null)require(object(value.labels)&&Object.values(value.labels).every(label=>typeof label==='string'),'region set labels must contain text');
}

// A caller-supplied configuration, not another canonical map resource. The
// package never loads a regional catalog or guesses membership from ID prefixes.
export function validateRegionSetCatalog(catalog){
  require(object(catalog)&&catalog.schema_version===1,'region set catalog schema_version must be 1');ref(catalog,'region set catalog');
  require(Array.isArray(catalog.groups),'region set catalog groups must be an array');
  const seen=new Set();sources(catalog.sources);
  for(const group of catalog.groups){require(object(group),'region set must be an object');string(group.id,'region set id');require(!seen.has(group.id),'duplicate region set id');seen.add(group.id);labels(group);ids(group.region_ids,'region set region_ids');sources(group.sources);}
  return catalog;
}

export function validateRankingRegionSet(snapshot,regionIds,geography){
  if(snapshot==null)return;
  require(object(snapshot),'ranking.regionSet must be an object');string(snapshot.id,'region set id');ref(snapshot.catalog_ref,'catalog_ref');ref(snapshot.geography_ref,'region set geography_ref');labels(snapshot);sources(snapshot.sources);
  ids(snapshot.region_ids,'configured region_ids');ids(snapshot.unavailable_region_ids,'unavailable_region_ids');ids(regionIds,'ranking.regionIds');
  if(snapshot.requested_region_ids!=null)ids(snapshot.requested_region_ids,'requested_region_ids');
  require(snapshot.unavailable_region_ids.every(id=>snapshot.region_ids.includes(id)),'unavailable members must belong to the configured set');
  require(regionIds.every(id=>snapshot.region_ids.includes(id)&&!snapshot.unavailable_region_ids.includes(id)),'ranking members must belong to the available configured set');
  if(snapshot.requested_region_ids!=null)require(regionIds.every(id=>snapshot.requested_region_ids.includes(id)),'ranking members must belong to the explicit requested scope');
  const available=snapshot.region_ids.filter(id=>!snapshot.unavailable_region_ids.includes(id)&&(!snapshot.requested_region_ids||snapshot.requested_region_ids.includes(id)));
  require(equal(available,regionIds),'ranking.regionIds do not match the saved region set');
  if(geography){
    require(snapshot.geography_ref.id===geography.id&&snapshot.geography_ref.revision===geography.revision,'ranking region set geography revision mismatch; resolve the configuration again');
    const known=new Set(geography.regions.map(region=>region.id));
    const unavailable=snapshot.region_ids.filter(id=>!known.has(id));
    require(equal(unavailable,snapshot.unavailable_region_ids),'region set unavailable members do not match the geography');
    if(snapshot.requested_region_ids!=null)require(snapshot.requested_region_ids.every(id=>known.has(id)),'region set requested scope references an unknown region');
    const requested=snapshot.requested_region_ids==null?null:new Set(snapshot.requested_region_ids),expected=snapshot.region_ids.filter(id=>known.has(id)&&(!requested||requested.has(id)));
    require(equal(expected,regionIds),'ranking.regionIds do not match the resolved region set');
  }
}

export function resolveRegionSet(catalog,groupId,geography,options={}){
  validateRegionSetCatalog(catalog);string(groupId,'region set id');
  require(object(geography)&&Array.isArray(geography.regions),'region set resolution requires a geography');ref(geography,'geography');
  const group=catalog.groups.find(group=>group.id===groupId);require(group,`unknown region set: ${groupId}`);
  const known=new Set(geography.regions.map(region=>region.id));
  if(options.regionIds!=null){ids(options.regionIds,'requested regionIds');require(options.regionIds.every(id=>known.has(id)),'requested regionIds reference an unknown region');}
  const requested=options.regionIds==null?null:new Set(options.regionIds),regionIds=group.region_ids.filter(id=>known.has(id)&&(!requested||requested.has(id))),unavailable=group.region_ids.filter(id=>!known.has(id));
  const regionSet={id:group.id,catalog_ref:{id:catalog.id,revision:catalog.revision},geography_ref:{id:geography.id,revision:geography.revision},...(group.label?{label:group.label}:{}),...(group.labels?{labels:structuredClone(group.labels)}:{}),region_ids:[...group.region_ids],unavailable_region_ids:unavailable,...(requested?{requested_region_ids:[...options.regionIds]}:{}),sources:structuredClone([...(catalog.sources??[]),...(group.sources??[])])};
  validateRankingRegionSet(regionSet,regionIds,geography);
  return {regionIds,regionSet};
}

export function applyRankingRegionSet(spec,geography,catalog,groupId){
  require(object(spec),'region set application requires a spec');
  // A previously resolved set is a saved selection, not a new explicit scope.
  const ranking=spec.ranking??{},requested=ranking.regionSet?ranking.regionSet.requested_region_ids:ranking.regionIds;
  require(object(ranking),'ranking must be an object');
  validateRankingRegionSet(ranking.regionSet,ranking.regionIds);
  const resolved=resolveRegionSet(catalog,groupId,geography,{regionIds:requested});
  const {countryGroup,...rest}=ranking;
  return {...spec,ranking:{...rest,...resolved}};
}
