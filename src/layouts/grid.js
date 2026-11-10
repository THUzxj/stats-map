export function gridLayout(regionIds, positions = {}, options = {}) {
  const ids = [...regionIds], cols = options.columns ?? Math.ceil(Math.sqrt(ids.length || 1)), cell = options.cellSize ?? 30;
  return new Map(ids.map((id, i) => {
    const p = (Object.hasOwn(positions, id) ? positions[id] : null) ?? [i % cols, Math.floor(i / cols)];
    return [id, { id, x: p[0] * cell, y: p[1] * cell, size: cell * .9, row: p[1], column: p[0], shape: options.shape ?? 'square' }];
  }));
}
export function hexGridLayout(regionIds, positions = {}, options = {}) {
  const ids = [...regionIds], cols = options.columns ?? Math.ceil(Math.sqrt(ids.length || 1)), cell = options.cellSize ?? 30;
  return new Map(ids.map((id, i) => {
    const p = (Object.hasOwn(positions, id) ? positions[id] : null) ?? [i % cols, Math.floor(i / cols)];
    return [id, { id, x: p[0] * cell * 1.5, y: p[1] * cell * Math.sqrt(3) + (((p[0] % 2) + 2) % 2) * cell * Math.sqrt(3) / 2, size: cell * 1.8, row: p[1], column: p[0], shape: 'hexagon' }];
  }));
}
