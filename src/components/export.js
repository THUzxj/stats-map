const csvCell=value=>{const s=String(value??'');return /[",\r\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
export function exportObservations(datasetView,seriesId,periodId,regionIds=null){
  const series=datasetView.series.get(seriesId),unit=datasetView.data.units.find(unit=>unit.id===series?.unit_id),dataset=datasetView.data;
  const sources=series?.source_refs?.length?(dataset.sources??[]).filter(source=>series.source_refs.includes(source.id)):dataset.sources??[];
  const rows=[['region_id','period_id','series_id','status','value','evidence','unit_id','unit_label','scope_id','measure_type','review_status','dataset_id','dataset_revision','geography_id','geography_revision','sources','source_flag']];
  for(const observation of datasetView.values(seriesId,periodId,regionIds?[...new Set(regionIds)]:null))rows.push([observation.region_id,observation.period_id,observation.series_id,observation.status,observation.value,observation.evidence?JSON.stringify(observation.evidence):'',series?.unit_id,unit?.label,series?.scope_id,series?.measure_type,series?.review_status,dataset.id,dataset.revision,dataset.geography_ref.id,dataset.geography_ref.revision,JSON.stringify(sources),observation.source_flag]);
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
// Export reported OD records. Render filters and derived route geometry never
// overwrite source values or turn a missing relation into a zero observation.
export function exportRelations(datasetView,seriesId,periodId,regionIds=null){
  const series=datasetView.series.get(seriesId),unit=datasetView.data.units.find(unit=>unit.id===series?.unit_id),dataset=datasetView.data,regions=regionIds?new Set(regionIds):null;
  const sources=series?.source_refs?.length?(dataset.sources??[]).filter(source=>series.source_refs.includes(source.id)):dataset.sources??[];
  const rows=[['relation_id','origin_region_id','destination_region_id','period_id','series_id','status','value','evidence','unit_id','unit_label','scope_id','measure_type','review_status','dataset_id','dataset_revision','geography_id','geography_revision','sources','source_flag']];
  for(const relation of datasetView.relations(seriesId,periodId)){
    if(regions&&(!regions.has(relation.origin_region_id)||!regions.has(relation.destination_region_id)))continue;
    rows.push([relation.id,relation.origin_region_id,relation.destination_region_id,relation.period_id,relation.series_id,relation.status,relation.value,relation.evidence?JSON.stringify(relation.evidence):'',series?.unit_id,unit?.label,series?.scope_id,series?.measure_type,series?.review_status,dataset.id,dataset.revision,dataset.geography_ref.id,dataset.geography_ref.revision,JSON.stringify(sources),relation.source_flag]);
  }
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function exportRelationSlice(view,seriesId,periodId,regionIds=null){
  if(!view.relationSliceOptions)throw new TypeError('exportRelationSlice requires a relationSliceView');
  const series=view.series.get(seriesId),dataset=view.data,unit=dataset.units.find(unit=>unit.id===series.unit_id);
  const sources=series.source_refs?.length?(dataset.sources??[]).filter(source=>series.source_refs.includes(source.id)):dataset.sources??[];
  const rows=[['derived_type','axis','anchor_region_id','region_id','origin_region_id','destination_region_id','relation_id','period_id','series_id','status','value','reported_status','reported_value','excluded_reason','evidence','source_flag','unit_id','unit_label','scope_id','measure_type','review_status','dataset_id','dataset_revision','geography_id','geography_revision','sources']];
  for(const observation of view.values(seriesId,periodId,regionIds?[...new Set(regionIds)]:null)){
    const slice=observation.relation_slice;
    rows.push([slice.type,slice.axis,slice.anchor_region_id,observation.region_id,slice.origin_region_id,slice.destination_region_id,slice.source_relation_ids[0],periodId,seriesId,observation.status,observation.value,slice.reported_status,slice.reported_value,slice.excluded_reason,observation.evidence?JSON.stringify(observation.evidence):'',observation.source_flag,series.unit_id,unit?.label,series.scope_id,series.measure_type,series.review_status,dataset.id,dataset.revision,dataset.geography_ref.id,dataset.geography_ref.revision,JSON.stringify(sources)]);
  }
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function exportSpec(spec){return JSON.stringify(spec,null,2)+'\n';}
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function svgDocument(svg,metadata={}){
  const sources=metadata.sources??[];
  const title=metadata.title??'Statistics map';
  const description=metadata.description??sources.map(s=>s.title??s.label??s.url??'').filter(Boolean).join('; ');
  const embedded=`<title>${xml(title)}</title><desc>${xml(description)}</desc><metadata>${xml(JSON.stringify({creator:metadata.creator??'stats-map',license:metadata.license??null,sources,...(metadata.geometry?{geometry:metadata.geometry}:{}),...(metadata.layout?{layout:metadata.layout}:{})}))}</metadata>`;
  return svg.replace(/(<svg\b[^>]*>)/,`$1${embedded}`);
}
export function svgDataUrl(svg){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;}
export function safeFilename(name='stats-map'){return String(name).replace(/[^\w\-.\u4e00-\u9fff]+/g,'_').slice(0,120)||'stats-map';}
