import { gridDistance, gridKey, gridNeighbors, gridPoint } from '../layouts/grid-lattice.js';

export const huber = x => x <= 2 ? x * x : 4 * x - 4;
const pairKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
export function spatialPairs(points) {
  const result = new Map(), valid = points.map((p, i) => p ? i : -1).filter(i => i >= 0);
  const add = (i, j) => { if (i !== j) result.set(pairKey(i, j), i < j ? [i, j] : [j, i]); };
  if (valid.length <= 80) for (let a = 0; a < valid.length; a++) for (let b = a + 1; b < valid.length; b++) add(valid[a], valid[b]);
  else {
    const extrema = [0, 1].flatMap(axis => [valid.reduce((a, b) => points[a][axis] < points[b][axis] ? a : b), valid.reduce((a, b) => points[a][axis] > points[b][axis] ? a : b)]);
    for (const i of valid) {
      const near = valid.filter(j => j !== i).sort((a, b) => Math.hypot(points[i][0] - points[a][0], points[i][1] - points[a][1]) - Math.hypot(points[i][0] - points[b][0], points[i][1] - points[b][1]) || a - b).slice(0, 8);
      for (const j of [...near, ...extrema]) add(i, j);
    }
  }
  return [...result.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function qualityModel(type, targets, pairs, edges, complete, weights) {
  const axes = pairs.flatMap(([i, j]) => [0, 1].filter(axis => Math.abs(targets[j][axis] - targets[i][axis]) >= .5).map(axis => [i, j, axis, Math.sign(targets[j][axis] - targets[i][axis])]));
  const edgeSet = new Set(edges.map(([i, j]) => pairKey(i, j))), count = targets.filter(Boolean).length;
  const dirIncident = targets.map(() => []), adjIncident = targets.map(() => []);
  axes.forEach(([i, j], k) => { dirIncident[i].push(k); dirIncident[j].push(k); });
  edges.forEach(([i, j], k) => { adjIncident[i].push(k); adjIncident[j].push(k); });
  const xy = p => gridPoint(p, type);
  const pos = (i, sites) => targets[i] ? huber(Math.hypot(...xy(sites[i]).map((x, a) => x - targets[i][a]))) : 0;
  const dir = (k, sites) => { const [i, j, axis, sign] = axes[k]; return Math.max(0, .25 - sign * (xy(sites[j])[axis] - xy(sites[i])[axis])) ** 2; };
  const adj = (k, sites) => { const [i, j] = edges[k]; return Math.max(0, gridDistance(sites[i], sites[j], type) - 1) ** 2; };
  function globalTerms(sites) {
    if (!sites.length) return { false: 0, compact: 0, contacts: 0, trueContacts: 0, bboxArea: 0 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, contacts = 0, trueContacts = 0;
    const occupied = new Map(sites.map((p, i) => [gridKey(p), i]));
    sites.forEach((p, i) => {
      const [x, y] = xy(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const neighbor of gridNeighbors(p, type)) { const j = occupied.get(gridKey(neighbor)); if (j > i) { contacts++; if (edgeSet.has(pairKey(i, j))) trueContacts++; } }
    });
    const bboxArea = (x1 - x0 + (type === 'grid-hex' ? 2 / Math.sqrt(3) : 1)) * (y1 - y0 + 1), area = sites.length * (type === 'grid-hex' ? Math.sqrt(3) / 2 : 1);
    return { false: complete ? (contacts - trueContacts) / Math.max(1, contacts) : 0, compact: bboxArea / area - 1, contacts, trueContacts, bboxArea };
  }
  const energy = s => weights.position * s.position / Math.max(1, count) + weights.direction * s.direction / Math.max(1, axes.length) + weights.adjacency * s.adjacency / Math.max(1, edges.length) + weights.falseAdjacency * s.false + weights.compactness * s.compact;
  function evaluate(sites) {
    const terms = { position: sites.reduce((s, _, i) => s + pos(i, sites), 0), direction: axes.reduce((s, _, k) => s + dir(k, sites), 0), adjacency: edges.reduce((s, _, k) => s + adj(k, sites), 0), ...globalTerms(sites) };
    return { ...terms, energy: energy(terms) };
  }
  function affected(sites, changed) {
    return { position: changed.reduce((s, i) => s + pos(i, sites), 0), direction: [...new Set(changed.flatMap(i => dirIncident[i]))].reduce((s, k) => s + dir(k, sites), 0), adjacency: [...new Set(changed.flatMap(i => adjIncident[i]))].reduce((s, k) => s + adj(k, sites), 0) };
  }
  function proposal(sites, current, changed, replacements) {
    const oldSites = changed.map(i => sites[i]), before = affected(sites, changed);
    changed.forEach((i, k) => { sites[i] = replacements[k]; });
    const after = affected(sites, changed), global = globalTerms(sites);
    changed.forEach((i, k) => { sites[i] = oldSites[k]; });
    const next = { ...global, ...Object.fromEntries(['position', 'direction', 'adjacency'].map(key => [key, current[key] - before[key] + after[key]])) };
    return { ...next, energy: energy(next) };
  }
  function report(sites) {
    const terms = evaluate(sites), distances = targets.flatMap((t, i) => t ? [Math.hypot(...xy(sites[i]).map((x, axis) => x - t[axis]))] : []).sort((a, b) => a - b);
    let reversed = 0, tied = 0;
    for (const [i, j, axis, sign] of axes) { const d = sign * (xy(sites[j])[axis] - xy(sites[i])[axis]); if (d < -1e-9) reversed++; else if (Math.abs(d) <= 1e-9) tied++; }
    return { energy: terms.energy, terms: { position: terms.position / Math.max(1, count), direction: terms.direction / Math.max(1, axes.length), adjacency: terms.adjacency / Math.max(1, edges.length), falseAdjacency: terms.false, compactness: terms.compact }, displacement_mean: distances.length ? distances.reduce((s, x) => s + x, 0) / distances.length : null, displacement_p95: distances.length ? distances[Math.ceil(distances.length * .95) - 1] : null, cardinal_reversal_rate: axes.length ? reversed / axes.length : null, cardinal_tie_rate: axes.length ? tied / axes.length : null, cardinal_comparisons: axes.length, adjacency_recall: edges.length ? terms.trueContacts / edges.length : null, adjacency_precision: complete && terms.contacts ? terms.trueContacts / terms.contacts : null, occupied_cell_count: sites.length, occupied_bbox_area: terms.bboxArea };
  }
  return { evaluate, proposal, report };
}
