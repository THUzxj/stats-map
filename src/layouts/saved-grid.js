import { StatsMapError } from '../core/errors.js';

const invalid = message => { throw new StatsMapError(message, 'INVALID_GRID_LAYOUT'); };
export function validateGridLayouts(geography) {
  if (geography.grid_layouts == null) return;
  if (!Array.isArray(geography.grid_layouts)) invalid('grid_layouts must be an array');
  const known = new Set(geography.regions.map(r => r.id)), names = new Set();
  for (const plan of geography.grid_layouts) {
    if (!plan || typeof plan.id !== 'string' || !plan.id || names.has(plan.id)) invalid('saved grid IDs must be unique non-empty strings');
    names.add(plan.id);
    if (!['grid-square', 'grid-hex'].includes(plan.type)) invalid('saved grid type must be grid-square or grid-hex');
    if (plan.geography_ref?.id !== geography.id || plan.geography_ref?.revision !== geography.revision) invalid('saved grid geography_ref does not match geography');
    const ids = plan.reference_region_ids;
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) invalid('saved grid scope must contain distinct registered regions');
    if (!plan.positions || typeof plan.positions !== 'object' || Array.isArray(plan.positions)) invalid('saved grid positions must be an object');
    if (Object.keys(plan.positions).length !== ids.length || Object.keys(plan.positions).some(id => !ids.includes(id))) invalid('saved grid positions must exactly cover its reference scope');
    const occupied = new Set();
    for (const id of ids) {
      const p = Object.hasOwn(plan.positions, id) && plan.positions[id];
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isSafeInteger)) invalid(`saved grid position must be an integer pair: ${id}`);
      const key = JSON.stringify(p);
      if (occupied.has(key)) invalid(`saved grid cells overlap: ${id}`);
      occupied.add(key);
    }
    if (plan.algorithm != null && (typeof plan.algorithm.name !== 'string' || !Number.isInteger(plan.algorithm.version) || plan.algorithm.version < 1)) invalid('invalid saved grid algorithm metadata');
    if (plan.input_sha256 != null && (typeof plan.input_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(plan.input_sha256))) invalid('invalid saved grid input SHA-256');
  }
}

// Rendering only selects saved coordinates; it never imports the preparer.
export function savedGridPositions(geography, layout, ids) {
  if (layout.positions != null) {
    if (layout.grid_layout_id != null) invalid('positions and grid_layout_id are mutually exclusive');
    return layout.positions;
  }
  const candidates = (geography.grid_layouts ?? []).filter(p => p.type === layout.type);
  const selected = layout.grid_layout_id != null ? candidates.filter(p => p.id === layout.grid_layout_id) : candidates;
  const matching = selected.filter(p => ids.every(id => Object.hasOwn(p.positions, id)))
    .sort((a, b) => a.reference_region_ids.length - b.reference_region_ids.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (matching.length) return matching[0].positions;
  if (layout.grid_layout_id != null || candidates.length) throw new StatsMapError('No saved grid covers the requested view; prepare a grid for this scope during map registration', 'GRID_SCOPE_MISMATCH');
  return {};
}
