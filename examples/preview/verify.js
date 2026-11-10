// Explicit real-data example check; excluded from the default fictional test suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as lib from '../../src/index.js';
import { galleryFixture, gallerySpec, galleryTypes } from '../../tests/fixtures/gallery.js';
const root = new URL('../..', import.meta.url);
const config = JSON.parse(await readFile(new URL('./gallery.json', import.meta.url), 'utf8'));
const results = [];
for (const entry of config.geographies) {
  const bytes = await readFile(new URL(entry.path, root));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const source = JSON.parse(await readFile(new URL(entry.source_path, root), 'utf8'));
  assert.equal(sha256, entry.sha256);
  assert.equal(sha256, source.derived.sha256);
  const gridBytes = await readFile(new URL(entry.grid_layouts_path, root));
  assert.equal(createHash('sha256').update(gridBytes).digest('hex'), entry.grid_layouts_sha256);
  const saved = JSON.parse(gridBytes); assert.equal(saved.source_sha256, sha256);
  const fixture = galleryFixture(lib, entry, JSON.parse(bytes), saved);
  assert.equal(fixture.geography.regions.length, entry.id === 'china' ? 34 : 41);
  const cases = [['choropleth', 'geographic'], ['choropleth', 'grid-square'], ['choropleth', 'grid-hex'], ['flow', 'geographic']];
  for (const [type, layout] of cases) {
    const item = galleryTypes.find(item => item.type === type);
    const map = lib.createMap(null, { ...fixture, spec: gallerySpec(lib, fixture, item, item.variants[0], 'p1', layout), width: 660, height: 350 });
    try { assert.match(map.export('svg'), /data-region-id=/); } finally { map.destroy(); }
  }
  results.push({ id: entry.id, regions: fixture.geography.regions.length, sha256, source: source.source_url, cases, grid_quality: saved.grid_layouts.map(p => ({ type: p.type, ...p.quality })) });
}
console.log(JSON.stringify({ passed: true, geographies: results }, null, 2));
