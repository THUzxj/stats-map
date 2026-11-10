import { sample } from './encoding.js';

export function rankingFixture(count=80) {
  const {geography,dataset}=sample();
  geography.regions=[];geography.features.features=[];
  dataset.observations=[];dataset.periods.push({id:'later',label:'Later',order:1});
  dataset.sources=[{id:'synthetic-source',title:'Fictional ranking evidence'}];
  for(let index=0;index<count;index++){
    const id='area-'+String(index).padStart(4,'0'),x=index%10,y=Math.floor(index/10);
    geography.regions.push({id,label:`Synthetic long region ${index} with complete multilingual labels 虚构地区`,labels:{ar:`منطقة اصطناعية طويلة الاسم ${index}`},level_id:'area'});
    geography.features.features.push({type:'Feature',id:'f-'+id,properties:{role:'region',region_id:id},geometry:{type:'Polygon',coordinates:[[[x,y],[x+.8,y],[x+.8,y+.8],[x,y+.8],[x,y]]]}});
    for(const period of dataset.periods)for(const [i,series] of dataset.series.entries()){
      const status=index%13===0?'suppressed':'value',value=index%9===0?0:(index%2?-1:1)*(index%17)*(period.id==='later'?2:1)*(i+1);
      dataset.observations.push({id:`${id}-${period.id}-${series.id}`,region_id:id,series_id:series.id,period_id:period.id,status,value:status==='value'?value:null,evidence:[{source_id:'synthetic-source',locator:id+'/'+period.id}],source_flag:'synthetic'});
    }
  }
  return {geography,dataset};
}

export function rankingAdapterFixture(lib,adapter,count=80) {
  const input=rankingFixture(count);
  if(adapter==='canonical')return input;
  const {geography:geo,dataset:data}=input;
  let geography,dataset;
  if(adapter==='euro'){
    geography=lib.euroGeography({...geo.features,regions:geo.regions,anchor_policy:geo.anchor_policy},{coordinateSpace:geo.coordinate_space});
    const ids=geo.regions.map(region=>region.id),series=data.series.map(series=>series.id),periods=data.periods.map(period=>period.id),index=new Map(data.observations.map(row=>[[row.series_id,row.region_id,row.period_id].join('/'),row]));
    const observations=series.flatMap(s=>ids.flatMap(id=>periods.map(t=>index.get([s,id,t].join('/')))));
    dataset=lib.euroDataset({id:['indicator','geo','time'],size:[series.length,ids.length,periods.length],dimension:{indicator:{category:{index:series}},geo:{category:{index:ids}},time:{category:{index:periods}}},value:observations.map(row=>row.value),status:observations.map(row=>row.status==='suppressed'?'c':'p'),source:data.sources},{...geography},{unitId:'u',unitLabel:'items',periods:data.periods,aggregation:'sum'});
  }else {
    const raw={id:'synthetic-ranking',title:'Fictional ranking',scope_note:'Synthetic',anchor_policy:geo.anchor_policy,coordinate_space:geo.coordinate_space,source:data.sources[0],periods:data.periods,regions:geo.regions.map((region,index)=>({code:region.id,name:region.label,labels:region.labels,level:region.level_id,geometry:geo.features.features[index].geometry})),metrics:data.series.map(series=>({id:series.id,name:series.label,unit:'items',aggregation:'sum'})),records:geo.regions.flatMap(region=>data.periods.map(period=>({region_code:region.id,period:period.id,values:Object.fromEntries(data.series.map(series=>[series.id,data.observations.find(row=>row.region_id===region.id&&row.period_id===period.id&&row.series_id===series.id).value])),statuses:Object.fromEntries(data.series.map(series=>[series.id,data.observations.find(row=>row.region_id===region.id&&row.period_id===period.id&&row.series_id===series.id).status]))})))};
    geography=lib.chinaGeography(raw);dataset=lib.chinaDataset(raw,geography);
  }
  return {geography,dataset};
}
