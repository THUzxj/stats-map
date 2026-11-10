import { adapterFixture, matrixMap } from './adapter-matrix.js';

export function symbolColorFixture(lib,adapter='canonical',kind='numeric') {
  const fixture=adapterFixture(lib,adapter),{geography,dataset,series}=fixture;
  dataset.periods.push({id:'empty',label:'Empty',order:2});
  const category=kind==='category';
  const colors={schema_version:1,kind:'stats-map/dataset',id:'symbol-colors',revision:'r2',title:'Fictional independent colors',scope_note:'fictional color scope',geography_ref:{id:geography.id,revision:geography.revision},periods:structuredClone(dataset.periods),units:[{id:'color-unit',label:category?'classes':'color points',dimension:category?'category':'index'}],scopes:[{id:'color-scope',description:'fictional color scope'}],metrics:[{id:'color-metric',label:category?'Registered class':'Signed color index',value_type:category?'category':'number',aggregation:'none',...(category?{category_dimension_id:'classes'}:{})}],dimensions:category?[{id:'classes',label:'Classes',values:[{id:'first',label:'First'},{id:'second',label:'Second'}]}]:[],series:[{id:series.one,label:'Color measure',metric_id:'color-metric',unit_id:'color-unit',scope_id:'color-scope',measure_type:'estimate',review_status:'unreviewed'}],observations:[],sources:[{id:'color-source',title:'Fictional color evidence'}]};
  for(const period of colors.periods)for(const [index,region] of geography.regions.entries()){
    const value=period.id==='empty'?null:category?(index%2?'second':'first'):(period.id==='early'?[-10,null,0,100]:[30,70,-40,1000])[index];
    colors.observations.push({id:`color-${period.id}-${region.id}`,series_id:series.one,region_id:region.id,period_id:period.id,status:value==null?'suppressed':'value',value,evidence:{source_id:'color-source',locator:`${period.id}/${region.id}`},source_flag:value==null?'c':'p'});
  }
  const seed=matrixMap(lib,fixture,{id:'independent-color',type:'proportionalSymbol',options:{}},'geographic');
  const bundle=structuredClone(seed.bundle);seed.destroy();
  bundle.resources.push({storage:'inline',resource:colors});
  const spec=bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource;
  spec.dataset_refs.push({id:colors.id,revision:colors.revision});
  spec.layers[0].encoding={color:{dataset_id:colors.id,series_id:series.one},size:{dataset_id:dataset.id,series_id:series.one}};
  spec.layers[0].classification={method:'threshold',thresholds:[-5,5]};
  spec.layers[0].options={maxRadius:20,...(category?{categoryColors:{first:'#123456',second:'#abcdef'}}:{colors:['#112233','#778899','#ddeeff']})};
  return {...fixture,colors,bundle,spec};
}
