// Registration-time Node API. Deliberately absent from the rendering entry point.
import { createHash } from 'node:crypto';
import { StatsMapError } from '../core/errors.js';
import { validateGeography } from '../core/validate.js';
import { resolveAnchors, fitProjection, projectPoint } from '../core/geometry.js';
import { gridDistance, gridKey, gridPoint } from '../layouts/grid-lattice.js';
import { validateGridLayouts } from '../layouts/saved-grid.js';
import { minCostAssignment } from './assignment.js';
import { huber, qualityModel, spatialPairs } from './grid-quality.js';

const fail = (message, code = 'INVALID_GRID_INPUT', details = []) => { throw new StatsMapError(message, code, details); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const defaults = { position: 1, direction: .6, adjacency: 1, falseAdjacency: .2, compactness: .1 };
function context(geography, options) {
  validateGeography({ ...geography, grid_layouts: undefined });
  const type = options.type ?? 'grid-square';
  if (!['grid-square', 'grid-hex'].includes(type)) fail('Unknown grid type');
  if (options.algorithmVersion != null && options.algorithmVersion !== 1) fail('Unsupported grid algorithm version', 'UNSUPPORTED_VERSION');
  if (options.referenceRegionIds != null && !Array.isArray(options.referenceRegionIds)) fail('referenceRegionIds must be an array');
  const ids = [...(options.referenceRegionIds ?? geography.regions.map(r => r.id))].sort(), known = new Map(geography.regions.map(r => [r.id, r]));
  if (new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) fail('Grid scope must contain distinct registered region IDs');
  if (!options.allowMixedLevels && ids.some(id => { let r = known.get(id); while (r.parent_id) { if (ids.includes(r.parent_id)) return true; r = known.get(r.parent_id); } return false; })) fail('Parent and descendant regions need separate grid scopes', 'GRID_MIXED_SCOPE');
  const pins = options.positions ?? {};
  if (!pins || typeof pins !== 'object' || Array.isArray(pins)) fail('positions must be an object');
  const occupied = new Set();
  for (const [id, p] of Object.entries(pins)) {
    if (!ids.includes(id) || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isSafeInteger)) fail('Fixed positions must map scope IDs to integer pairs');
    if (occupied.has(gridKey(p))) fail('Fixed grid positions overlap');
    occupied.add(gridKey(p));
  }
  const resolution = resolveAnchors(geography, { regionIds: ids, policy: options.anchorPolicy }), missing = ids.filter(id => !resolution.anchors.has(id) && !Object.hasOwn(pins, id));
  if (missing.length) fail('Every region needs an anchor or a fixed grid position', 'GRID_MISSING_ANCHOR', missing);
  const projection = fitProjection(geography, { width: 1024, height: 1024 }, { regionIds: ids, projection: options.projection, padding: 0 });
  const points = ids.map(id => resolution.anchors.has(id) ? projectPoint(resolution.anchors.get(id).point, projection) : null);
  const weights = { ...defaults, ...options.weights };
  if (Object.keys(weights).some(k => !Object.hasOwn(defaults, k)) || Object.values(weights).some(v => !Number.isFinite(v) || v < 0) || !Object.values(weights).some(v => v > 0)) fail('Grid weights must be finite non-negative values with a positive total');
  const params = { weights, occupancies: options.occupancies ?? [.55, .70, .85], maxCandidates: options.maxCandidates ?? 12, maxIterations: options.maxIterations ?? 8, maxOperations: options.maxOperations ?? 100000, maxCells: options.maxCells ?? 4096, maxMatrixEntries: options.maxMatrixEntries ?? 2000000 };
  if (!Array.isArray(params.occupancies) || !params.occupancies.length || params.occupancies.some(x => !Number.isFinite(x) || x <= 0 || x > 1)) fail('occupancies must be in (0,1]');
  for (const key of ['maxCandidates', 'maxOperations', 'maxCells', 'maxMatrixEntries']) if (!Number.isSafeInteger(params[key]) || params[key] < 1) fail(`${key} must be a positive integer`);
  if (!Number.isSafeInteger(params.maxIterations) || params.maxIterations < 0) fail('maxIterations must be a non-negative integer');
  if (ids.length > params.maxCells) fail('Grid scope exceeds maxCells', 'GRID_BUDGET_EXCEEDED');
  const index = new Map(ids.map((id, i) => [id, i])), edgeMap = new Map(), adjacency = options.adjacency;
  if (adjacency && (!['complete', 'partial'].includes(adjacency.completeness) || !Array.isArray(adjacency.edges))) fail('adjacency requires edges and complete/partial completeness');
  for (const edge of adjacency?.edges ?? []) {
    if (!Array.isArray(edge) || edge.length !== 2 || edge[0] === edge[1] || edge.some(id => !index.has(id))) fail('Adjacency edges must join distinct scope IDs');
    const pair = edge.map(id => index.get(id)).sort((a, b) => a - b); edgeMap.set(JSON.stringify(pair), pair);
  }
  const edges = [...edgeMap.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const anchorMetadata = ids.map(id => { const a = resolution.anchors.get(id); return a ? { id, method: a.method, version: a.version ?? 1, derived: a.derived === true, source_feature_ids: [...(a.source_feature_ids ?? [])].sort() } : null; });
  const descriptor = { type, geography_ref: { id: geography.id, revision: geography.revision }, ids, points, anchor_metadata: anchorMetadata, anchor_policy: resolution.policy, projection, pins, params, edges, completeness: adjacency?.completeness ?? null, algorithm: 1 };
  return { type, ids, pins, points, edges, params, projection, descriptor, fingerprint: hash(descriptor), pairs: spatialPairs(points), resolution, complete: adjacency?.completeness === 'complete' };
}

function bounds(points) {
  const valid = points.filter(Boolean);
  return valid.length ? [Math.min(...valid.map(p => p[0])), Math.min(...valid.map(p => p[1])), Math.max(...valid.map(p => p[0])), Math.max(...valid.map(p => p[1]))] : [0, 0, 0, 0];
}
function candidates(ctx) {
  const { ids, pins, points, type, params } = ctx, n = ids.length;
  if (!n) return [{ sites: [], phase: [0, 0], columns: 0, rows: 0 }];
  const [x0, y0, x1, y1] = bounds(points), w = x1 - x0, h = y1 - y0, aspect = w && h ? w / h : w ? n : h ? 1 / n : 1;
  const result = [], seen = new Set(), fixed = Object.values(pins);
  for (const rho of params.occupancies) {
    const capacity = Math.ceil(n / rho), dimensions = [];
    for (let rows = 1; rows <= capacity; rows++) {
      const cols = Math.ceil(capacity / rows);
      if (w > 1e-9 && h > 1e-9 && (rows === 1 || cols === 1)) continue;
      const ratio = type === 'grid-hex' ? ((cols - 1) * Math.sqrt(3) / 2 + 1) / (rows + (cols > 1 ? .5 : 0)) : cols / rows;
      dimensions.push({ rows, cols, error: Math.abs(Math.log(ratio / aspect)) });
    }
    dimensions.sort((a, b) => a.error - b.error || a.rows * a.cols - b.rows * b.cols || a.rows - b.rows);
    for (const { rows, cols } of dimensions.slice(0, 2)) for (const phase of [[0, 0], [.5, .5]]) {
      const c0 = Math.min(0, ...fixed.map(p => p[0])), r0 = Math.min(0, ...fixed.map(p => p[1]));
      const c1 = Math.max(cols - 1, ...fixed.map(p => p[0])), r1 = Math.max(rows - 1, ...fixed.map(p => p[1]));
      const count = (c1 - c0 + 1) * (r1 - r0 + 1), signature = JSON.stringify([c0, r0, c1, r1, phase]);
      if (!Number.isSafeInteger(count) || count > params.maxCells || count * n > params.maxMatrixEntries || seen.has(signature)) continue;
      seen.add(signature);
      const sites = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) sites.push([c, r]);
      result.push({ sites, phase, columns: c1 - c0 + 1, rows: r1 - r0 + 1 });
      if (result.length === params.maxCandidates) return result;
    }
  }
  return result;
}
function targetsFor(ctx, candidate) {
  const source = bounds(ctx.points), destination = bounds(candidate.sites.map(p => gridPoint(p, ctx.type))), [x0, y0, x1, y1] = source;
  const ratios = [0, 1].filter(axis => source[axis + 2] - source[axis] > 1e-9).map(axis => (destination[axis + 2] - destination[axis]) / (source[axis + 2] - source[axis]));
  const scale = ratios.length ? Math.min(...ratios) : 1;
  const translation = [(destination[0] + destination[2]) / 2 - scale * (x0 + x1) / 2 + candidate.phase[0], (destination[1] + destination[3]) / 2 - scale * (y0 + y1) / 2 + candidate.phase[1]];
  return { targets: ctx.points.map(p => p ? p.map((x, axis) => x * scale + translation[axis]) : null), transform: { scale, translation } };
}
function assign(ctx, candidate, targets) {
  const free = ctx.ids.map((id, i) => Object.hasOwn(ctx.pins, id) ? -1 : i).filter(i => i >= 0), occupied = new Set(Object.values(ctx.pins).map(gridKey)), sites = candidate.sites.filter(p => !occupied.has(gridKey(p)));
  const cost = free.map(i => sites.map(p => huber(Math.hypot(...gridPoint(p, ctx.type).map((x, a) => x - targets[i][a])))));
  const result = ctx.ids.map(id => Object.hasOwn(ctx.pins, id) ? [...ctx.pins[id]] : null), matching = minCostAssignment(cost);
  free.forEach((i, k) => { result[i] = sites[matching[k]]; });
  return result;
}
function improve(ctx, candidate, sites, model) {
  let current = model.evaluate(sites), operations = 0, stopped = 'local-optimum';
  const movable = ctx.ids.map((id, i) => Object.hasOwn(ctx.pins, id) ? -1 : i).filter(i => i >= 0);
  const sourcePairs = new Set([...ctx.pairs, ...ctx.edges].map(([i, j]) => `${i}:${j}`));
  for (let iteration = 0; iteration < ctx.params.maxIterations; iteration++) {
    let best = null;
    const occupied = new Set(sites.map(gridKey));
    const consider = (changed, replacement) => {
      if (operations >= ctx.params.maxOperations) { stopped = 'operation-budget'; return; }
      operations++;
      const score = model.proposal(sites, current, changed, replacement);
      if (score.energy < (best?.score.energy ?? current.energy) - 1e-10) best = { changed, replacement, score };
    };
    for (const i of movable) {
      for (const p of candidate.sites) if (!occupied.has(gridKey(p)) && gridDistance(sites[i], p, ctx.type) <= 2) consider([i], [p]);
      for (const j of movable) if (j > i && (sourcePairs.has(`${i}:${j}`) || gridDistance(sites[i], sites[j], ctx.type) <= 2)) consider([i, j], [sites[j], sites[i]]);
      if (stopped === 'operation-budget') break;
    }
    if (!best) break;
    best.changed.forEach((i, k) => { sites[i] = best.replacement[k]; });
    current = model.evaluate(sites);
    if (stopped === 'operation-budget') break;
    if (iteration === ctx.params.maxIterations - 1) stopped = 'iteration-budget';
  }
  return { operations, stop_reason: ctx.params.maxIterations ? stopped : 'refinement-disabled' };
}

export function generateGridPlan(geography, options = {}) {
  const ctx = context(geography, options), alternatives = [];
  for (const candidate of candidates(ctx)) {
    const { targets, transform } = targetsFor(ctx, candidate), sites = assign(ctx, candidate, targets);
    const model = qualityModel(ctx.type, targets, ctx.pairs, ctx.edges, ctx.complete, ctx.params.weights), initial = model.report(sites);
    const search = improve(ctx, candidate, sites, model), quality = model.report(sites);
    alternatives.push({ positions: Object.fromEntries(ctx.ids.map((id, i) => [id, [...sites[i]]])), quality, initial_energy: initial.energy, frame: { columns: candidate.columns, rows: candidate.rows, phase: candidate.phase }, transform, search });
  }
  if (!alternatives.length) fail('No feasible candidate fits the grid budget and fixed positions', 'GRID_BUDGET_EXCEEDED');
  alternatives.sort((a, b) => a.quality.energy - b.quality.energy || (JSON.stringify(a.positions) < JSON.stringify(b.positions) ? -1 : JSON.stringify(a.positions) > JSON.stringify(b.positions) ? 1 : 0));
  const best = alternatives[0], degrees = new Array(ctx.ids.length).fill(0);
  for (const [i, j] of ctx.edges) { degrees[i]++; degrees[j]++; }
  const diagnostics = [];
  if (!options.adjacency) diagnostics.push({ code: 'GRID_ADJACENCY_UNAVAILABLE' });
  if (!ctx.points.some(Boolean)) diagnostics.push({ code: 'GRID_MANUAL_ANCHORS_ONLY' });
  const highDegree = ctx.ids.filter((_, i) => degrees[i] > (ctx.type === 'grid-hex' ? 6 : 4));
  if (highDegree.length) diagnostics.push({ code: 'GRID_ADJACENCY_DEGREE', region_ids: highDegree });
  const plan = { id: options.id ?? ctx.type, type: ctx.type, geography_ref: { id: geography.id, revision: geography.revision }, reference_region_ids: ctx.ids, positions: best.positions,
    algorithm: { name: 'geographic-grid', version: 1, parameters: ctx.params }, input_sha256: ctx.fingerprint, projection: options.projection ?? null,
    anchor_provenance: ctx.ids.flatMap(id => ctx.resolution.anchors.has(id) ? [{ region_id: id, method: ctx.resolution.anchors.get(id).method, version: ctx.resolution.anchors.get(id).version ?? 1 }] : []),
    adjacency_provenance: options.adjacency ? { completeness: options.adjacency.completeness, edge_count: ctx.edges.length } : null,
    candidate_frame: best.frame, target_transform: best.transform, quality: best.quality, diagnostics,
    search: { candidates: alternatives.length, operations: alternatives.reduce((n, a) => n + a.search.operations, 0), selected_stop_reason: best.search.stop_reason, initial_energy: best.initial_energy, candidates_summary: alternatives.map(a => ({ frame: a.frame, quality: a.quality })) } };
  validateGridLayouts({ ...geography, grid_layouts: [plan] });
  return plan;
}

// Run explicitly at registration, never in createMap or an adapter. Matching
// fingerprints reuse the saved table; stale tables require intentional regeneration.
export function prepareGridLayouts(geography, options = {}) {
  const scopes = options.referenceRegionIds ? [{ id: options.scopeId ?? 'scope', ids: options.referenceRegionIds }] : [...new Set(geography.regions.map(r => r.level_id))].sort().map(id => ({ id, ids: geography.regions.filter(r => r.level_id === id).map(r => r.id) }));
  const known = new Set(geography.regions.map(r => r.id));
  const saved = (geography.grid_layouts ?? []).filter(p => !options.regenerate || p.geography_ref?.id === geography.id && p.geography_ref?.revision === geography.revision && p.reference_region_ids?.every(id => known.has(id)));
  let generated = 0, reused = 0;
  for (const scope of scopes) for (const type of ['grid-square', 'grid-hex']) {
    const id = `${type}:${scope.id}`, args = { ...options, id, type, referenceRegionIds: scope.ids }, input = context(geography, args), index = saved.findIndex(p => p.id === id);
    if (index >= 0 && saved[index].input_sha256 === input.fingerprint) {
      validateGridLayouts({ ...geography, grid_layouts: [saved[index]] }); reused++; continue;
    }
    if (index >= 0 && !options.regenerate) fail(`Saved grid ${id} is stale; regenerate explicitly during map registration`, 'GRID_STALE_LAYOUT');
    const plan = generateGridPlan(geography, args);
    if (index >= 0) saved[index] = plan; else saved.push(plan);
    generated++;
  }
  const result = { ...geography, grid_layouts: saved };
  validateGeography(result);
  return { geography: result, generated, reused };
}
