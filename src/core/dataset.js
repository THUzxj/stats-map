import { validateDataset } from './validate.js';
import { StatsMapError } from './errors.js';

const unique = values => [...new Set(values)];
const key = (...parts) => JSON.stringify(parts);
const goodNumber = o => o.status === 'value' && Number.isFinite(o.value);

// A snapshot: later changes to caller-owned objects cannot invalidate the indexes.
export class DatasetView {
  constructor(dataset, geography = null) {
    validateDataset(dataset, geography);
    const clone = value => globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
    this.data = clone(dataset);
    this.geography = geography ? clone(geography) : null;
    this.metrics = new Map(this.data.metrics.map(m => [m.id, m]));
    this.series = new Map(this.data.series.map(s => [s.id, s]));
    this.periods = new Map(this.data.periods.map(p => [p.id, p]));
    this.regions = new Map((this.geography?.regions ?? []).map(r => [r.id, r]));
    this.observations = new Map(this.data.observations.map(o => [key(o.series_id, o.region_id, o.period_id), o]));
    this.bases = new Map((this.data.aggregation_bases ?? []).map(b => [b.id, b]));
  }

  metricForSeries(seriesId) {
    const series = this.series.get(seriesId);
    if (!series) throw new StatsMapError(`unknown series: ${seriesId}`, 'UNKNOWN_SERIES');
    return this.metrics.get(series.metric_id);
  }

  derivationFor(seriesId) {
    return this.series.get(seriesId)?.derivation ?? this.metricForSeries(seriesId).derivation;
  }

  observation(seriesId, regionId, periodId) {
    const metric = this.metricForSeries(seriesId);
    if (metric.aggregation === 'ratio') {
      const d = this.derivationFor(seriesId);
      const n = this.observation(d.numerator_series_id, regionId, periodId);
      const q = this.observation(d.denominator_series_id, regionId, periodId);
      const valid = goodNumber(n) && goodNumber(q) && q.value !== 0;
      return { series_id: seriesId, region_id: regionId, period_id: periodId,
        status: valid ? 'value' : 'missing', value: valid ? n.value / q.value * (d.scale ?? 1) : null,
        numerator: goodNumber(n) ? n.value : null, denominator: goodNumber(q) ? q.value : null,
        evidence: { derivation: d, observations: [n.id, q.id].filter(Boolean) } };
    }
    return this.observations.get(key(seriesId, regionId, periodId)) ?? {
      status: 'missing', value: null, series_id: seriesId, region_id: regionId, period_id: periodId
    };
  }

  children(regionId) { return [...this.regions.values()].filter(r => r.parent_id === regionId).map(r => r.id); }
  descendants(regionId) {
    const children = this.children(regionId);
    return children.length ? children.flatMap(id => this.descendants(id)) : [regionId];
  }

  unitsFor(regionIds, basisId) {
    const basis = this.bases.get(basisId);
    if (!basis) throw new StatsMapError(`unknown aggregation basis: ${basisId}`, 'UNKNOWN_BASIS');
    const units = new Set(basis.unit_region_ids);
    const rollups = new Map(basis.rollups.map(r => [r.region_id, r]));
    const out = new Set();
    for (const id of unique(regionIds)) {
      if (units.has(id)) out.add(id);
      else if (rollups.has(id)) for (const member of rollups.get(id).member_region_ids) out.add(member);
      else throw new StatsMapError(`region ${id} is not in aggregation basis ${basisId}`, 'UNDECLARED_ROLLUP');
    }
    return [...out];
  }

  summary(regionIds, seriesId, periodId, options = {}) {
    if (!Array.isArray(regionIds)) throw new StatsMapError('regionIds must be an array', 'INVALID_ARGUMENT');
    const metric = this.metricForSeries(seriesId);
    const selected = unique(regionIds);
    if (this.geography) for (const id of selected) if (!this.regions.has(id)) throw new StatsMapError(`unknown region: ${id}`, 'UNKNOWN_REGION');
    const display = options.displayValue ?? (options.basisId ? 'rollup' : 'reported');
    const units = display === 'rollup' ? this.unitsFor(selected, options.basisId) : selected;
    const observations = units.map(id => this.observation(seriesId, id, periodId));
    let presentIds = observations.filter(o => o.status === 'value').map(o => o.region_id);
    let value = null, numerator = null, denominator = null;
    const permitted = display === 'rollup' && metric.aggregation !== 'none';
    if (metric.aggregation === 'ratio') {
      const d = this.derivationFor(seriesId);
      const paired = units.map(id => ({ id,
        n: this.observation(d.numerator_series_id, id, periodId),
        d: this.observation(d.denominator_series_id, id, periodId) })).filter(p => goodNumber(p.n) && goodNumber(p.d));
      presentIds = paired.map(p => p.id);
      numerator = paired.reduce((sum, p) => sum + p.n.value, 0);
      denominator = paired.reduce((sum, p) => sum + p.d.value, 0);
      if ((permitted || units.length === 1) && paired.length && denominator !== 0) value = numerator / denominator * (d.scale ?? 1);
    } else if (metric.aggregation === 'sum' && permitted) {
      numerator = observations.filter(goodNumber).reduce((sum, o) => sum + o.value, 0);
      if (presentIds.length) value = numerator;
    } else if (units.length === 1 && observations[0]?.status === 'value') value = observations[0].value;
    const missingIds = units.filter(id => !presentIds.includes(id));
    const declaredPartial = display === 'rollup' && (this.bases.get(options.basisId)?.rollups ?? []).some(r => selected.includes(r.region_id) && r.completeness === 'partial');
    return { value, present: presentIds.length, expected: units.length, missing: missingIds.length,
      missingIds, missingCodes: missingIds, regionIds: units, leafCodes: units,
      numerator, denominator, commonCoverage: metric.aggregation === 'ratio' ? presentIds.length : undefined,
      displayValue: display, completeness: declaredPartial ? 'partial' : 'complete',
      aggregationAvailable: permitted || units.length <= 1, observations };
  }

  values(seriesId, periodId, regionIds = null) {
    return (regionIds ?? [...this.regions.keys()]).map(id => this.observation(seriesId, id, periodId));
  }
  categoryCounts(seriesId, periodId, regionIds = null) {
    const counts = new Map();
    for (const o of this.values(seriesId, periodId, regionIds)) if (o.status === 'value') counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
    return Object.fromEntries(counts);
  }

  composition(seriesIds, regionId, periodId, options = {}) {
    if (!seriesIds.length) throw new StatsMapError('composition requires component series', 'INVALID_COMPOSITION');
    const all = [...seriesIds, ...(options.totalSeriesId ? [options.totalSeriesId] : [])];
    const first = this.series.get(seriesIds[0]);
    for (const id of all) {
      const series = this.series.get(id), metric = this.metricForSeries(id);
      if (metric.value_type !== 'number' || metric.aggregation !== 'sum' ||
          series.unit_id !== first.unit_id || series.scope_id !== first.scope_id ||
          series.measure_type !== first.measure_type || series.review_status !== first.review_status) {
        throw new StatsMapError('components need additive metrics, a common unit, scope and measure/review status', 'INCOMPARABLE_COMPONENTS');
      }
    }
    const read = seriesId => {
      if (!options.basisId) return this.observation(seriesId, regionId, periodId);
      const result = this.summary([regionId], seriesId, periodId, options);
      return {status: result.value == null ? 'missing' : 'value', value: result.value, evidence: result};
    };
    const values = seriesIds.map(seriesId => {
      const series = this.series.get(seriesId), metric = this.metricForSeries(seriesId);
      const o = read(seriesId);
      return { seriesId, label: series.label ?? metric.label, value: o.status === 'value' ? o.value : null,
        status: o.status, unit: first.unit_id, evidence: o.evidence };
    });
    const negative = values.some(x => x.value != null && x.value < 0);
    const complete = values.every(x => x.value != null);
    const sum = values.reduce((s, x) => s + (x.value ?? 0), 0);
    const totalObservation = options.totalSeriesId ? read(options.totalSeriesId) : null;
    const total = totalObservation?.status === 'value' ? totalObservation.value : null;
    const conflict = negative || (total != null && (total < 0 || sum > total));
    const denominator = options.totalSeriesId ? total : (complete ? sum : null);
    return { values, sum, total, denominator, complete, conflict,
      other: complete && !conflict && total != null ? total - sum : null,
      canNormalize: !conflict && denominator != null && denominator > 0,
      missingSeriesIds: values.filter(x => x.value == null).map(x => x.seriesId) };
  }

  relations(seriesId, periodId, options = {}) {
    this.metricForSeries(seriesId);
    return (this.data.relations ?? []).filter(r => r.series_id === seriesId && r.period_id === periodId && (!options.status || r.status === options.status));
  }
}
export function createDatasetView(dataset, geography) { return new DatasetView(dataset, geography); }
