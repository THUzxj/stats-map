import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as runtime from '../src/index.js';
import { generateGridPlan, prepareGridLayouts } from '../src/preparation/index.js';
import { minCostAssignment } from '../src/preparation/assignment.js';
import { gridDistance, gridNeighbors, gridPoint } from '../src/layouts/grid-lattice.js';
import { gridGeography } from './fixtures/grid-geography.js';
import { prepareGeographyFile } from '../scripts/prepare-grids.js';

const options = { maxCandidates: 4, maxIterations: 4 };
function exhaustive(cost, row = 0, used = new Set()) {
  if (row === cost.length) return 0;
  return Math.min(...cost[row].flatMap((v, j) => used.has(j) ? [] : [v + exhaustive(cost, row + 1, new Set([...used, j]))]));
}
test('rectangular matching equals independent exhaustive optima including negative costs and ties', () => {
  for (let seed = 0; seed < 9; seed++) for (let n = 1; n <= 4; n++) {
    const cost = Array.from({ length: n }, (_, i) => Array.from({ length: n + 2 }, (_, j) => ((i * 17 + j * 13 + seed * 23 + i * j * seed) % 19 - 9) / 3));
    const result = minCostAssignment(cost);
    assert.equal(new Set(result).size, n);
    assert.ok(Math.abs(result.reduce((s, j, i) => s + cost[i][j], 0) - exhaustive(cost)) < 1e-9);
  }
  assert.deepEqual(minCostAssignment([]), []);
  for (const bad of [[[1], [2]], [[NaN]], [[1, 2], [3]]]) assert.throws(() => minCostAssignment(bad));
});

test('square and hex lattice adjacency agrees with renderer coordinates including negative odd columns', () => {
  for (const layout of [runtime.gridLayout, runtime.hexGridLayout]) {
    const legacy = layout(['toString', 'missing'], { missing: null });
    assert.equal(legacy.get('toString').column, 0);
    assert.equal(legacy.get('missing').column, 1);
  }
  for (const type of ['grid-square', 'grid-hex']) for (let c = -3; c <= 3; c++) for (let r = -2; r <= 2; r++) {
    const p = [c, r], neighbors = gridNeighbors(p, type), [x, y] = gridPoint(p, type);
    assert.equal(neighbors.length, type === 'grid-square' ? 4 : 6);
    for (const q of neighbors) { assert.equal(gridDistance(p, q, type), 1); const [a, b] = gridPoint(q, type); assert.ok(Math.abs(Math.hypot(a - x, b - y) - 1) < 1e-10); }
    if (type === 'grid-hex') { const node = runtime.hexGridLayout(['a'], { a: p }, { cellSize: 1 }).get('a'); assert.ok(Math.abs(node.x / Math.sqrt(3) - x) < 1e-10); assert.ok(Math.abs(node.y / Math.sqrt(3) - y) < 1e-10); }
  }
});

test('generated grids preserve identity, north/south, pins and deterministic geometry-only placement', () => {
  for (const type of ['grid-square', 'grid-hex']) {
    const g = gridGeography(), plan = generateGridPlan(g, { ...options, type });
    assert.deepEqual(Object.keys(plan.positions), g.regions.map(r => r.id).sort());
    assert.equal(new Set(Object.values(plan.positions).map(JSON.stringify)).size, g.regions.length);
    assert.ok(Object.values(plan.positions).every(p => p.length === 2 && p.every(Number.isInteger)));
    assert.ok(gridPoint(plan.positions.delta, type)[1] < gridPoint(plan.positions.bravo, type)[1]);
    assert.ok(plan.quality.energy <= plan.search.initial_energy + 1e-10);
    const reordered = { ...g, regions: [...g.regions].reverse(), features: { ...g.features, features: [...g.features.features].reverse() } };
    assert.deepEqual(generateGridPlan(reordered, { ...options, type }), plan);
    const moved = structuredClone(g); for (const f of moved.features.features) f.geometry.coordinates = f.geometry.coordinates.map(x => x * 7 + 19);
    assert.deepEqual(generateGridPlan(moved, { ...options, type }).positions, plan.positions);
    const pinned = generateGridPlan(g, { ...options, type, positions: { delta: [-1, -1] } });
    assert.deepEqual(pinned.positions.delta, [-1, -1]);
  }
});

test('registration generates each shape once, serializes tables and rejects stale inputs unless forced', async () => {
  const g = gridGeography(), first = prepareGridLayouts(g, options);
  assert.deepEqual([first.generated, first.reused], [2, 0]);
  assert.equal(g.grid_layouts, undefined);
  const saved = JSON.parse(JSON.stringify(first.geography)), second = prepareGridLayouts(saved, options);
  assert.deepEqual([second.generated, second.reused], [0, 2]);
  assert.deepEqual(second.geography, saved);
  const changed = structuredClone(saved); changed.features.features[0].geometry.coordinates[0] += 5;
  assert.throws(() => prepareGridLayouts(changed, options), e => e.code === 'GRID_STALE_LAYOUT');
  assert.equal(prepareGridLayouts(changed, { ...options, regenerate: true }).generated, 2);
  const revision = structuredClone(saved); revision.revision = 'r2';
  assert.equal(prepareGridLayouts(revision, { ...options, regenerate: true }).generated, 2);
  assert.equal(runtime.generateGridPlan, undefined, 'rendering entry point must not import the generator');
  const dir = await mkdtemp(path.join(tmpdir(), 'stats-grid-')), filename = path.join(dir, 'geography.json');
  await writeFile(filename, JSON.stringify(g));
  assert.equal((await prepareGeographyFile(filename, filename, options)).generated, 2);
  const bytes = await readFile(filename, 'utf8');
  assert.equal((await prepareGeographyFile(filename, filename, options)).reused, 2);
  assert.equal(await readFile(filename, 'utf8'), bytes);
});

test('known and partial adjacency have separate quality semantics and impossible degree diagnostics', () => {
  const g = gridGeography(), edges = g.regions.filter(r => r.id !== 'echo').map(r => ['echo', r.id]);
  const partial = generateGridPlan(g, { ...options, adjacency: { edges, completeness: 'partial' } });
  assert.equal(partial.quality.adjacency_precision, null);
  assert.ok(partial.diagnostics.some(d => d.code === 'GRID_ADJACENCY_DEGREE'));
  const complete = generateGridPlan(g, { ...options, adjacency: { edges, completeness: 'complete' } });
  assert.equal(typeof complete.quality.adjacency_precision, 'number');
  assert.ok(complete.quality.adjacency_recall <= 4 / 5);
  assert.ok(complete.quality.energy <= complete.search.initial_energy + 1e-10);
});

test('missing anchors and invalid constraints fail explicitly; empty, single and coincident inputs remain valid', () => {
  const g = gridGeography(), missing = { ...g, features: { type: 'FeatureCollection', features: [] } };
  assert.throws(() => generateGridPlan(missing), e => e.code === 'GRID_MISSING_ANCHOR');
  assert.throws(() => generateGridPlan(g, { positions: { alpha: [0, 0], bravo: [0, 0] } }));
  assert.throws(() => generateGridPlan(g, { maxCells: 2 }), e => e.code === 'GRID_BUDGET_EXCEEDED');
  assert.throws(() => generateGridPlan(g, { occupancies: [0] }));
  assert.throws(() => generateGridPlan(g, { adjacency: { edges: [['alpha', 'unknown']], completeness: 'complete' } }));
  for (const type of ['grid-square', 'grid-hex']) {
    assert.deepEqual(generateGridPlan(g, { type, referenceRegionIds: [] }).positions, {});
    assert.equal(Object.keys(generateGridPlan(g, { type, referenceRegionIds: ['alpha'] }).positions).length, 1);
    const same = structuredClone(g); same.features.features.forEach(f => { f.geometry.coordinates = [0, 0]; });
    assert.equal(new Set(Object.values(generateGridPlan(same, { ...options, type }).positions).map(JSON.stringify)).size, 6);
  }
});

test('rendering reads stored grids after anchors are removed and subsets retain reference cells', () => {
  const prepared = prepareGridLayouts(gridGeography(), options).geography;
  const geography = { ...prepared, features: { type: 'FeatureCollection', features: [] }, anchors: [] };
  for (const type of ['grid-square', 'grid-hex']) {
    const spec = { layout: { type } }, saved = geography.grid_layouts.find(p => p.type === type);
    const whole = runtime.resolveLayout(geography, spec);
    for (const id of saved.reference_region_ids) assert.deepEqual([whole.get(id).column, whole.get(id).row], saved.positions[id]);
    const subset = runtime.resolveLayout(geography, { ...spec, view: { region_ids: ['delta', 'alpha'] } });
    assert.deepEqual(subset.get('delta'), whole.get('delta'));
    assert.equal(runtime.resolveLayout(geography, { layout: { type, positions: { alpha: [12, 12] } }, view: { region_ids: ['alpha'] } }).get('alpha').column, 12);
    assert.throws(() => runtime.resolveLayout(geography, { layout: { type, grid_layout_id: 'absent' } }), e => e.code === 'GRID_SCOPE_MISMATCH');
  }
  const bad = structuredClone(prepared); bad.grid_layouts[0].positions.alpha = bad.grid_layouts[0].positions.bravo;
  assert.throws(() => runtime.validateGeography(bad), e => e.code === 'INVALID_GRID_LAYOUT');
});

test('multiple administrative levels get separate tables and cannot silently mix scopes', () => {
  const g = gridGeography();
  g.levels.push({ id: 'parent', label: 'Parent' });
  g.regions.push({ id: 'root', label: 'Root', level_id: 'parent' });
  g.regions[0].parent_id = 'root';
  g.features.features.push({ type: 'Feature', id: 'f-root', properties: { role: 'region', region_id: 'root' }, geometry: { type: 'Point', coordinates: [1, 1] } });
  assert.throws(() => generateGridPlan(g), e => e.code === 'GRID_MIXED_SCOPE');
  const prepared = prepareGridLayouts(g, options);
  assert.equal(prepared.generated, 4);
  assert.equal(runtime.resolveLayout(prepared.geography, { layout: { type: 'grid-square' }, view: { level_ids: ['parent'] } }).size, 1);
  assert.throws(() => runtime.resolveLayout(prepared.geography, { layout: { type: 'grid-square' } }), e => e.code === 'GRID_SCOPE_MISMATCH');
});
