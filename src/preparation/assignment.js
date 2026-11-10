import { StatsMapError } from '../core/errors.js';

// Rectangular Hungarian assignment, rows <= columns. Stable traversal breaks ties.
export function minCostAssignment(cost) {
  const n = cost.length, m = cost[0]?.length ?? 0;
  if (!n) return [];
  if (m < n || cost.some(row => row.length !== m || row.some(x => !Number.isFinite(x)))) throw new StatsMapError('Assignment requires a finite rectangular matrix with at least as many columns as rows', 'INVALID_GRID_INPUT');
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const c = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (c < min[j]) { min[j] = c; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
      j0 = j1;
    } while (p[j0]);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) result[p[j] - 1] = j - 1;
  return result;
}
