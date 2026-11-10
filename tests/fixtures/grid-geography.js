// Deliberately scrambled identities; all coordinates and relationships fictional.
export function gridGeography() {
  const rows = [['delta', 0, 2], ['alpha', 2, 0], ['foxtrot', 2, 2], ['bravo', 0, 0], ['echo', 1, 1], ['charlie', 3, 1]];
  return { schema_version: 1, kind: 'stats-map/geography', id: 'grid-fixture', revision: 'r1', title: 'Fictional grid', levels: [{ id: 'area', label: 'Area' }],
    regions: rows.map(([id]) => ({ id, label: id, level_id: 'area' })), coordinate_space: { type: 'cartesian', units: 'unit', y_direction: 'up' },
    features: { type: 'FeatureCollection', features: rows.map(([id, x, y]) => ({ type: 'Feature', id: 'f-' + id, properties: { role: 'region', region_id: id }, geometry: { type: 'Point', coordinates: [x, y] } })) } };
}
