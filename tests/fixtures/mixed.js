import { sample } from './encoding.js';

// Non-administrative synthetic hierarchy, a separately registered point and an
// unlocated identity. Parent observations intentionally differ from leaf sums.
export function mixed() {
  const {geography,dataset}=sample();
  geography.levels.push({id:'group',label:'Group'},{id:'site',label:'Site'});
  geography.regions.forEach(region=>region.parent_id='parent');
  geography.regions.push({id:'parent',label:'Reported parent',level_id:'group'},{id:'site',label:'Independent site',level_id:'site'},{id:'unlocated',label:'Unlocated site',level_id:'site'});
  geography.features.features.push({type:'Feature',id:'parent-shape',properties:{role:'region',region_id:'parent'},geometry:{type:'Polygon',coordinates:[[[20,0],[24,0],[24,4],[20,4],[20,0]]]}},{type:'Feature',id:'site-point',properties:{role:'region',region_id:'site'},geometry:{type:'Point',coordinates:[40,0]}});
  for(const [region_id,one] of [['parent',10000],['site',50],['unlocated',0]])for(const series of dataset.series)dataset.observations.push({id:region_id+'-'+series.id,region_id,series_id:series.id,period_id:'t',status:'value',value:series.id==='one'?one:one*2});
  dataset.aggregation_bases=[{id:'units',unit_region_ids:['a','b','site','unlocated'],disjoint:true,rollups:[{region_id:'parent',member_region_ids:['a','b'],completeness:'complete'}]}];
  return {geography,dataset};
}
