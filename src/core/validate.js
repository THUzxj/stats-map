import { normalizeAnchorPolicy } from './anchors.js';
import { validateGridLayouts } from '../layouts/saved-grid.js';
import { createPresentation } from './presentation.js';
import { getRenderer } from '../renderers/registry.js';
import { StatsMapError, assert, fail, refKey } from './errors.js';
import { validateRelationSlice } from './relation-slice.js';
import { channelBindings, symbolBindings } from './channels.js';
import { validateFlowOptions } from '../renderers/flow-layout.js';
import { timeDomain } from '../renderers/temporal.js';
import { validateLegendFilters } from './legend-filter.js';
import { resolveProfile } from './profile.js';
import { validateDorlingOptions } from '../layouts/dorling.js';
import { validatePresentation } from '../components/decorations.js';
import { symbolScale } from '../renderers/symbols.js';
import { validateCompositionOptions } from '../renderers/composition-symbols.js';
import { classifyDomain } from './classification.js';

const KINDS = new Set(['stats-map/geography', 'stats-map/dataset', 'stats-map/spec', 'stats-map/bundle']);
const statuses = new Set(['value','missing','not_available','not_applicable','suppressed','out_of_scope']);
const valueTypes = new Set(['number','category']);
const aggregations = new Set(['sum','ratio','none']);
const measureTypes = new Set(['actual','estimate','target','unspecified']);
const reviewStatuses = new Set(['reviewed','unreviewed','unspecified']);
const layers = new Set(['choropleth','proportionalSymbol','categorical','bivariateChoropleth','trivariateChoropleth','stripeComposition','pieChart','sparkline','flow','coxcomb','alpha','mushroom','waffle','bar']);
function validateExtensions(extensions) { if (extensions == null) return; obj(extensions, 'extensions'); for (const [namespace, value] of Object.entries(extensions)) { obj(value, `extension ${namespace}`); assert(typeof value.required === 'boolean', `extension ${namespace}.required must be boolean`); if (value.required && namespace !== 'stats-map/core') fail(`unknown required extension: ${namespace}`, 'UNSUPPORTED_EXTENSION'); } }
function rejectExecutable(value, path='resource') { if (typeof value === 'string') { assert(!/^javascript:/i.test(value) && !/<script\b/i.test(value), `executable content is not allowed at ${path}`, 'UNSAFE_INPUT'); return; } if (Array.isArray(value)) value.forEach((x,i)=>rejectExecutable(x,`${path}[${i}]`)); else if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) { assert(!['script','sql','callback','function','svg_script'].includes(k.toLowerCase()), `executable field is not allowed: ${path}.${k}`, 'UNSAFE_INPUT'); rejectExecutable(v,`${path}.${k}`); } }

const str = (v, name) => { assert(typeof v === 'string' && v.length > 0, `${name} must be a non-empty string`); return v; };
const arr = (v, name, min = 0) => { assert(Array.isArray(v) && v.length >= min, `${name} must be an array`); return v; };
const obj = (v, name) => { assert(v && typeof v === 'object' && !Array.isArray(v), `${name} must be an object`); return v; };
const ids = (items, name, key = 'id') => { const s = new Set(); for (const x of items) { str(x?.[key], `${name}.${key}`); assert(!s.has(x[key]), `duplicate ${name} id: ${x[key]}`); s.add(x[key]); } return s; };
const ref = (v, name) => { obj(v, name); str(v.id, `${name}.id`); str(v.revision, `${name}.revision`); return v; };
function common(resource, kind) { obj(resource, 'resource'); assert(resource.schema_version === 1, 'schema_version must be 1', 'UNSUPPORTED_VERSION'); assert(resource.kind === kind, `kind must be ${kind}`); str(resource.id, 'id'); str(resource.revision, 'revision'); validateExtensions(resource.extensions); rejectExecutable(resource); }

function validateGeometry(geometry) {
  obj(geometry,'geometry');
  const point=value=>assert(Array.isArray(value)&&value.length>=2&&value.every(Number.isFinite),'geometry positions must contain finite coordinates','INVALID_GEOMETRY');
  const line=value=>{arr(value,'geometry line',2).forEach(point);};
  const ring=value=>{arr(value,'geometry ring',4).forEach(point);assert(value[0][0]===value.at(-1)[0]&&value[0][1]===value.at(-1)[1],'geometry ring must be closed','INVALID_GEOMETRY');};
  const polygon=value=>arr(value,'geometry polygon').forEach(ring);
  switch(geometry.type){
    case 'Point':point(geometry.coordinates);break;
    case 'MultiPoint':arr(geometry.coordinates,'geometry points').forEach(point);break;
    case 'LineString':line(geometry.coordinates);break;
    case 'MultiLineString':arr(geometry.coordinates,'geometry lines').forEach(line);break;
    case 'Polygon':polygon(geometry.coordinates);break;
    case 'MultiPolygon':arr(geometry.coordinates,'geometry polygons').forEach(polygon);break;
    case 'GeometryCollection':arr(geometry.geometries,'geometry collection').forEach(validateGeometry);break;
    default:fail(`unsupported geometry type: ${geometry.type}`,'INVALID_GEOMETRY');
  }
}

export function validateGeography(g) {
  common(g, 'stats-map/geography'); str(g.title, 'title');normalizeAnchorPolicy(g.anchor_policy);
  const levels = arr(g.levels, 'levels', 1); ids(levels, 'level');
  const levelIds = new Set(levels.map(x => x.id)); const regions = arr(g.regions, 'regions'); ids(regions, 'region');
  const regionIds = new Set(regions.map(x => x.id));
  for (const r of regions) { str(r.label, `region ${r.id}.label`); assert(levelIds.has(r.level_id), `unknown level for region ${r.id}`); if (r.parent_id != null) assert(regionIds.has(r.parent_id), `unknown parent for region ${r.id}`); }
  for (const r of regions) { const seen = new Set([r.id]); let p = r.parent_id; while (p != null) { assert(!seen.has(p), `geography parent cycle at ${r.id}`, 'INVALID_HIERARCHY'); seen.add(p); p = regions.find(x => x.id === p)?.parent_id; } }
  obj(g.coordinate_space, 'coordinate_space'); assert(['geographic','cartesian'].includes(g.coordinate_space.type), 'coordinate_space.type must be geographic or cartesian');
  const fc = obj(g.features, 'features'); assert(fc.type === 'FeatureCollection' && Array.isArray(fc.features), 'features must be a FeatureCollection');
  const featureIds = new Set();
  for(const feature of fc.features)validateGeometry(feature.geometry);
  for (const f of fc.features) { str(String(f.id ?? ''), 'feature.id'); assert(!featureIds.has(String(f.id)), `duplicate feature id: ${f.id}`); featureIds.add(String(f.id)); obj(f.properties, 'feature.properties'); const role = f.properties.role ?? 'region'; assert(['region','boundary','reference','decoration'].includes(role), `invalid feature role: ${role}`); if (role === 'region') assert(regionIds.has(f.properties.region_id), `feature references unknown region: ${f.properties.region_id}`); assert(f.geometry && typeof f.geometry.type === 'string', `feature ${f.id} has no geometry`); }
  const anchorKeys=new Set();
  if (g.anchors != null) for (const a of arr(g.anchors, 'anchors')) { assert(regionIds.has(a.region_id), `anchor references unknown region: ${a.region_id}`); assert(['symbol','label'].includes(a.role), 'anchor role invalid'); assert(Array.isArray(a.point) && a.point.length >= 2 && a.point.every(Number.isFinite), 'anchor point invalid'); str(a.method, 'anchor.method');const key=JSON.stringify([a.region_id,a.role]);assert(!anchorKeys.has(key),'duplicate anchor region/role','INVALID_GEOMETRY');anchorKeys.add(key);if(a.version!=null)assert(Number.isInteger(a.version)&&a.version>0,'anchor.version must be a positive integer','INVALID_GEOMETRY'); }
  validateGridLayouts(g);
  return g;
}

export function validateDataset(d, geography = null) {
  common(d, 'stats-map/dataset'); str(d.title, 'title'); assert(typeof d.scope_note === 'string', 'scope_note must be a string'); ref(d.geography_ref, 'geography_ref'); if (geography) assert(d.geography_ref.id === geography.id && d.geography_ref.revision === geography.revision, 'dataset geography_ref does not match geography', 'REFERENCE_MISMATCH');
  const periods = arr(d.periods, 'periods'); ids(periods, 'period'); const periodIds = new Set(periods.map(x => x.id)); const periodOrders = new Set(); for (const p of periods) { assert(Number.isInteger(p.order), `period ${p.id}.order must be an integer`); assert(!periodOrders.has(p.order), `duplicate period order: ${p.order}`); periodOrders.add(p.order); }
  const units = arr(d.units, 'units'); ids(units, 'unit'); const unitIds = new Set(units.map(x => x.id)); for (const u of units) { str(u.label, `unit ${u.id}.label`); str(u.dimension, `unit ${u.id}.dimension`); }
  const dimensions = d.dimensions ?? []; ids(dimensions, 'dimension'); const dimValues = new Map(); for (const x of dimensions) { const vals = arr(x.values, `dimension ${x.id}.values`, 1); ids(vals, `dimension ${x.id}.value`); dimValues.set(x.id, new Set(vals.map(v => v.id))); }
  const metrics = arr(d.metrics, 'metrics', 1); ids(metrics, 'metric'); const metricById = new Map(metrics.map(x => [x.id, x]));
  for (const m of metrics) { str(m.label, `metric ${m.id}.label`); assert(valueTypes.has(m.value_type), `invalid value_type for metric ${m.id}`); assert(aggregations.has(m.aggregation), `invalid aggregation for metric ${m.id}`); if (m.value_type === 'category') { assert(m.aggregation === 'none' && typeof m.category_dimension_id === 'string' && dimValues.has(m.category_dimension_id), `category metric ${m.id} needs a category dimension`); } }
  const scopes = arr(d.scopes, 'scopes', 1); ids(scopes, 'scope'); const scopeIds = new Set(scopes.map(x => x.id));
  const series = arr(d.series, 'series', 1); ids(series, 'series'); const seriesById = new Map(series.map(x => [x.id, x]));
  for (const s of series) { assert(metricById.has(s.metric_id), `series ${s.id} references unknown metric`); assert(unitIds.has(s.unit_id), `series ${s.id} references unknown unit`); assert(scopeIds.has(s.scope_id), `series ${s.id} references unknown scope`); assert(measureTypes.has(s.measure_type ?? 'unspecified'), `invalid measure_type for series ${s.id}`); assert(reviewStatuses.has(s.review_status ?? 'unspecified'), `invalid review_status for series ${s.id}`); if (s.dimension_values) for (const [dim, value] of Object.entries(s.dimension_values)) assert(dimValues.get(dim)?.has(value), `series ${s.id} has invalid dimension value`); }
  for (const s of series) { const m = metricById.get(s.metric_id); if (m.aggregation === 'ratio') { obj(m.derivation, `metric ${m.id}.derivation`); assert(m.derivation.type === 'ratio', `ratio metric ${m.id} needs derivation`); const ns=seriesById.get(m.derivation.numerator_series_id), dsr=seriesById.get(m.derivation.denominator_series_id); assert(ns&&dsr, `ratio metric ${m.id} has unknown dependencies`); assert(m.derivation.numerator_series_id !== s.id && m.derivation.denominator_series_id !== s.id, `ratio dependency cycle at ${s.id}`); assert(metricById.get(ns.metric_id)?.aggregation==='sum'&&metricById.get(dsr.metric_id)?.aggregation==='sum', `ratio metric ${m.id} dependencies must be sum series`); assert(Number.isFinite(m.derivation.scale??1), `ratio metric ${m.id} scale must be finite`); } }
  const visiting=new Set(),visited=new Set(); const visitSeries=id=>{if(visiting.has(id))fail(`ratio dependency cycle at ${id}`,'INVALID_DEPENDENCY');if(visited.has(id))return;visiting.add(id);const s=seriesById.get(id),m=s&&metricById.get(s.metric_id);if(m?.aggregation==='ratio'){visitSeries(m.derivation.numerator_series_id);visitSeries(m.derivation.denominator_series_id);}visiting.delete(id);visited.add(id);}; for(const s of series)visitSeries(s.id);
  const regionIds = geography ? new Set(geography.regions.map(x => x.id)) : null; const observations = arr(d.observations, 'observations'); ids(observations, 'observation'); const keys = new Set();
  for (const o of observations) { assert(seriesById.has(o.series_id), `observation ${o.id} references unknown series`); if (regionIds) assert(regionIds.has(o.region_id), `observation ${o.id} references unknown region`); assert(periodIds.has(o.period_id), `observation ${o.id} references unknown period`); assert(statuses.has(o.status), `invalid observation status: ${o.status}`); const key = `${o.series_id}\0${o.region_id}\0${o.period_id}`; assert(!keys.has(key), `duplicate observation: ${key}`); keys.add(key); const m = metricById.get(seriesById.get(o.series_id).metric_id); if (o.status === 'value') { if (m.value_type === 'number') { assert(typeof o.value === 'number' && Number.isFinite(o.value), `numeric observation ${o.id} must be finite`); assert(!Number.isInteger(o.value) || Number.isSafeInteger(o.value), `numeric observation ${o.id} exceeds safe integer range`, 'PRECISION_LOSS'); } else assert(typeof o.value === 'string' && dimValues.get(m.category_dimension_id)?.has(o.value), `category observation ${o.id} has invalid value`); } else assert(o.value == null, `non-value observation ${o.id} must have null value`); }
  if (d.aggregation_bases != null) { const basisIds = new Set(); for (const b of arr(d.aggregation_bases, 'aggregation_bases')) { str(b.id, 'aggregation basis.id'); assert(!basisIds.has(b.id), `duplicate aggregation basis: ${b.id}`); basisIds.add(b.id); arr(b.unit_region_ids, 'aggregation basis.unit_region_ids'); assert(new Set(b.unit_region_ids).size === b.unit_region_ids.length, `duplicate aggregation unit in ${b.id}`); assert(b.disjoint === true, `aggregation basis ${b.id} must be disjoint`); const bset = new Set(b.unit_region_ids); if (regionIds) for (const id of bset) assert(regionIds.has(id), `aggregation basis references unknown region ${id}`); for (const roll of b.rollups ?? []) { assert(regionIds?.has(roll.region_id) ?? true, 'rollup references unknown region'); assert(['complete','partial'].includes(roll.completeness), 'rollup completeness invalid'); const seen = new Set(); for (const id of roll.member_region_ids ?? []) { assert(bset.has(id), `rollup member is not a unit: ${id}`); assert(!seen.has(id), `duplicate rollup member: ${id}`); seen.add(id); } } } }
  if (d.relations != null) { ids(arr(d.relations,'relations'),'relation'); const relationKeys = new Set(); for (const r of d.relations) { str(r.id, 'relation.id'); assert(seriesById.has(r.series_id), `relation references unknown series`); assert(periodIds.has(r.period_id), 'relation references unknown period'); if (regionIds) assert(regionIds.has(r.origin_region_id) && regionIds.has(r.destination_region_id), 'relation endpoint unknown'); assert(statuses.has(r.status), 'relation status invalid'); if (r.status === 'value') {assert(Number.isFinite(r.value), 'relation value invalid');assert(!Number.isInteger(r.value)||Number.isSafeInteger(r.value),'relation value exceeds safe integer range','PRECISION_LOSS');} else assert(r.value == null, 'non-value relation must have null value'); const k = `${r.series_id}\0${r.period_id}\0${r.origin_region_id}\0${r.destination_region_id}`; assert(!relationKeys.has(k), `duplicate relation: ${k}`); relationKeys.add(k); } }
  return d;
}

export function validateMapSpec(s, geography = null, datasets = new Map()) {
  s=resolveProfile(s);
  common(s, 'stats-map/spec'); ref(s.geography_ref, 'geography_ref'); if (geography) assert(refKey(s.geography_ref) === refKey({id: geography.id, revision: geography.revision}), 'spec geography_ref does not match geography', 'REFERENCE_MISMATCH');
  const refs = arr(s.dataset_refs, 'dataset_refs'); const ds = new Set(), datasetIds = new Set(); for (const r of refs) { ref(r, 'dataset_ref'); assert(!datasetIds.has(r.id), `dataset id appears with more than one revision: ${r.id}`); datasetIds.add(r.id); assert(!ds.has(refKey(r)), `duplicate dataset ref: ${refKey(r)}`); ds.add(refKey(r)); if (datasets.size) assert(datasets.has(refKey(r)) || datasets.has(`stats-map/dataset:${refKey(r)}`) || datasets.has(r.id), `missing dataset: ${r.id}`); }
  const ls = arr(s.layers, 'layers', 1); const layerIds = new Set(); let bases = 0;
  if(s.view?.level_ids!=null){
    const levelIds=arr(s.view.level_ids,'view.level_ids');
    assert(levelIds.every(id=>typeof id==='string'&&id.length>0)&&new Set(levelIds).size===levelIds.length,'view.level_ids must contain distinct level ids');
    if(geography)assert(levelIds.every(id=>geography.levels.some(level=>level.id===id)),'view.level_ids references an unknown level');
  }
  for (const layer of ls) {
    str(layer.id, 'layer.id');
    assert(!layerIds.has(layer.id), `duplicate layer id: ${layer.id}`);layerIds.add(layer.id);
    const renderer=getRenderer(layer.type);
    if(layer.classification!==undefined){
      const classification=obj(layer.classification,'classification');classifyDomain([],classification);
      if(classification.axes!==undefined){assert(Array.isArray(classification.axes),'classification axes must be an array');for(const axis of classification.axes)classifyDomain([],obj(axis,'classification axis'));}
    }
    if(renderer.type==='proportionalSymbol')symbolScale([],layer.options);
    if(['pieChart','waffle','bar','coxcomb'].includes(renderer.type))validateCompositionOptions(renderer.type,layer.options);
    if(layer.tooltip!==undefined)assert(typeof layer.tooltip==='boolean','layer.tooltip must be boolean');
    const role=layer.role??renderer.defaultRole;
    assert(['base','overlay'].includes(role), 'layer role must be base or overlay');
    if(role==='base')bases++;
    const encoding=obj(layer.encoding ?? {}, `layer ${layer.id}.encoding`);
    const bindings=channelBindings(encoding,{includeException:false});
    if(renderer.type==='proportionalSymbol')symbolBindings(encoding);
    if(new Set(bindings.map(binding=>binding.dataset_id)).size>1)assert(['bivariateChoropleth','alpha','proportionalSymbol'].includes(renderer.type),`renderer ${renderer.type} requires its component series in one dataset`,'UNSUPPORTED_ENCODING');
    if(encoding.exception)assert(['choropleth','proportionalSymbol','pieChart'].includes(renderer.type),'exception channels are supported by choropleth, proportionalSymbol and pieChart','UNSUPPORTED_ENCODING');
    if(encoding.relation_slice!==undefined)validateRelationSlice(encoding.relation_slice,geography,s);
    if(encoding.exception?.relation_slice!==undefined)fail('exception channels use regional observations','UNSUPPORTED_ENCODING');
    const slices=bindings.map(binding=>{if(binding.relation_slice===undefined)return null;const slice=validateRelationSlice(binding.relation_slice,geography,s);return JSON.stringify([slice.axis,slice.region_id,slice.include_internal??true,slice.top??null]);});
    if(!['bivariateChoropleth','alpha','proportionalSymbol'].includes(renderer.type))assert(new Set(slices).size<=1,`renderer ${renderer.type} requires the same relation_slice for all components`,'UNSUPPORTED_ENCODING');
    if(bindings.some(binding=>binding.relation_slice)){
      assert(renderer.type!=='flow','flow cannot use a relation_slice','UNSUPPORTED_ENCODING');
      assert(!(layer.aggregation??s.aggregation)?.basis_id,'relation slices cannot use a regional aggregation basis','UNSUPPORTED_ENCODING');
    }
    const channels=Object.entries(encoding).filter(([name])=>name!=='exception').map(([,value])=>value).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&(x.series_id||x.series_ids||x.relation_series_id)).map(channel=>({...channel,dataset_id:channel.dataset_id??encoding.dataset_id,relation_slice:channel.relation_slice??encoding.relation_slice}));
    if(encoding.exception)channels.push({...encoding.exception,dataset_id:encoding.exception.dataset_id??encoding.dataset_id});
    if(encoding.series_id||encoding.series_ids||encoding.relation_series_id)channels.push(encoding);
    for(const channel of channels){
      if(channel.relation_slice!==undefined)validateRelationSlice(channel.relation_slice,geography,s);
      if(channel.relation_series_id&&renderer.type!=='flow')assert(channel.relation_slice,'regional rendering of relation_series_id requires relation_slice','INVALID_ENCODING');
      assert(typeof channel.dataset_id==='string', `layer ${layer.id} encoding requires dataset_id`);
      assert(datasetIds.has(channel.dataset_id), `layer ${layer.id} references an unlisted dataset`);
      const seriesIds=channel.series_ids??[channel.relation_series_id??channel.series_id];
      assert(Array.isArray(seriesIds)&&seriesIds.length>0&&seriesIds.every(id=>typeof id==='string'&&id.length>0)&&new Set(seriesIds).size===seriesIds.length, `layer ${layer.id} requires distinct series ids`);
      const reference=refs.find(reference=>reference.id===channel.dataset_id);
      const dataset=datasets.get(channel.dataset_id)??datasets.get(refKey(reference))??datasets.get(`stats-map/dataset:${refKey(reference)}`);
      if(dataset)for(const id of seriesIds){
        const series=dataset.series.find(series=>series.id===id);
        assert(series,`layer ${layer.id} references unknown series: ${id}`);
        if(renderer.type==='proportionalSymbol'&&channel.dataset_id===bindings[0].dataset_id&&id===bindings[0].series_id)assert(dataset.metrics.find(metric=>metric.id===series.metric_id)?.value_type==='number','symbol size requires a numeric series','INVALID_ENCODING');
        if(channel.relation_slice)assert(dataset.metrics.find(metric=>metric.id===series.metric_id)?.value_type==='number','relation_slice requires numeric relations','INVALID_ENCODING');
      }
      if(dataset&&['sparkline','coxcomb'].includes(renderer.type)&&s.view?.time_window)timeDomain({data:dataset},s);
    }
    if(renderer.type==='flow'){validateFlowOptions(layer.options);assert(channels.length>0,`flow layer ${layer.id} requires a relation series`);}
    assert(role===renderer.defaultRole, `${renderer.type} requires the ${renderer.defaultRole} role`, 'UNSUPPORTED_LAYER_COMBINATION');
  }
  assert(bases <= 1, 'a map spec may contain at most one base layer');
  if(s.view?.legend_filters!=null)validateLegendFilters(s.view.legend_filters,layerIds);
  if(s.layout?.grid_layout_id!=null){str(s.layout.grid_layout_id,'layout.grid_layout_id');assert(['grid-square','grid-hex'].includes(s.layout.type),'grid_layout_id requires a grid layout');assert(s.layout.positions==null,'positions and grid_layout_id are mutually exclusive');}
  if (s.layout) { assert(['geographic','grid-square','grid-hex','dorling'].includes(s.layout.type), 'unsupported layout'); if(s.layout.type==='dorling')validateDorlingOptions(s.layout); if(s.layout.projection) { obj(s.layout.projection,'layout.projection'); str(s.layout.projection.id,'layout.projection.id'); } if (s.layout.type.startsWith('grid')) assert(s.layout.positions == null || typeof s.layout.positions === 'object', 'grid positions must be an object'); }
  if(s.aggregation){obj(s.aggregation,'aggregation');assert(typeof s.aggregation.dataset_id==='string'&&typeof s.aggregation.basis_id==='string','aggregation requires dataset_id and basis_id');assert(['reported','rollup'].includes(s.aggregation.display_value),'aggregation.display_value invalid');}
  if(s.view?.relation_region_id!==undefined){str(s.view.relation_region_id,'view.relation_region_id');if(geography)assert(geography.regions.some(region=>region.id===s.view.relation_region_id),'unknown view.relation_region_id');}
  if (s.interaction) obj(s.interaction, 'interaction');
  if(s.interaction?.relationRegionOnClick!==undefined)assert(typeof s.interaction.relationRegionOnClick==='boolean','interaction.relationRegionOnClick must be boolean');
  validatePresentation(s,geography);
  createPresentation(s,geography??{});
  normalizeAnchorPolicy(s.anchor_policy);
  if(s.interaction?.reducedMotion!=null)assert([true,false,'auto'].includes(s.interaction.reducedMotion),'interaction.reducedMotion must be boolean or auto');
  if(s.interaction?.tooltip!==undefined)assert(typeof s.interaction.tooltip==='boolean','interaction.tooltip must be boolean');
  if(s.view?.time_window!=null){const window=s.view.time_window;assert(Array.isArray(window)?window.length===2&&window.every(id=>typeof id==='string'&&id.length>0):window&&typeof window==='object'&&typeof window.start_period_id==='string'&&window.start_period_id.length>0&&typeof window.end_period_id==='string'&&window.end_period_id.length>0,'view.time_window requires start and end period ids');}
  return s;
}

export function validateBundle(bundle, options = {}) {
  common(bundle, 'stats-map/bundle'); const resources = arr(bundle.resources, 'resources', 1); const refs = new Map();
  for (const entry of resources) { obj(entry, 'bundle resource'); assert(entry.storage === 'inline' || entry.storage === 'external', 'resource storage must be inline or external'); if (entry.storage === 'inline') { obj(entry.resource, 'inline resource'); const r = entry.resource; assert(KINDS.has(r.kind), 'unknown inline resource kind'); validateResource(r); const k = refKey({kind:r.kind,id:r.id,revision:r.revision}); assert(!refs.has(k), `duplicate bundle resource: ${k}`); refs.set(k, r); } else { ref(entry.ref, 'external ref'); str(entry.path, 'external path'); assert(!entry.path.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(entry.path)&&!entry.path.split('/').includes('..')&&!entry.path.includes('\\'), 'external path must be a relative POSIX path', 'UNSAFE_INPUT'); assert(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256), 'external sha256 must be hexadecimal'); const k = refKey(entry.ref); assert(!refs.has(k), `duplicate bundle resource: ${k}`); refs.set(k, entry); } }
  ref(bundle.spec_ref, 'spec_ref'); assert(bundle.spec_ref.kind ? bundle.spec_ref.kind === 'stats-map/spec' : true, 'spec_ref must reference a spec'); assert(refs.has(refKey({kind:'stats-map/spec', ...bundle.spec_ref})) || refs.has(refKey(bundle.spec_ref)), `bundle spec_ref is missing: ${bundle.spec_ref.id}`);
  return bundle;
}

export function validateResource(resource) { assert(KINDS.has(resource?.kind), `unknown resource kind: ${resource?.kind}`); if (resource.kind === 'stats-map/geography') return validateGeography(resource); if (resource.kind === 'stats-map/dataset') return validateDataset(resource); if (resource.kind === 'stats-map/spec') return validateMapSpec(resource); return validateBundle(resource); }
export { KINDS, layers as LAYER_TYPES, statuses as OBSERVATION_STATUSES };
