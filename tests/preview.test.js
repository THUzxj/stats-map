import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPreviewServer } from '../scripts/examples/server.js';
import * as lib from '../src/index.js';
import { interiorPoint } from '../src/core/anchors.js';
import { preparePreviewGrids } from '../scripts/prepare-preview-grids.js';
import { galleryFixture, gallerySpec, galleryTypes } from './fixtures/gallery.js';

async function serve(t, options) {
  const server = await createPreviewServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return route => fetch(base + route);
}

test('China and Hainan can inset or hide offshore geometry without changing the selected region or values', async t => {
  const get = await serve(t);
  for (const [sample, regionId] of [['china', '460000'], ['hainan', '460300']]) {
    const bytes = Buffer.from(await (await get(`/examples/preview/geometry/${sample}.geojson`)).arrayBuffer());
    if (sample === 'hainan') {
      const source = await (await get('/examples/preview/geometry/hainan.source.json')).json();
      assert.equal(createHash('sha256').update(bytes).digest('hex'), source.derived.sha256);
    }
    const features = JSON.parse(bytes);
    const regions = features.features.filter(({ properties }) => properties.name).map(({ properties }) => ({
      code: String(properties.adcode), name: properties.name,
    }));
    const original = lib.chinaGeography({ id: sample, regions, features });
    const { geography, inset } = lib.chinaSouthChinaSeaInset(original);
    assert.deepEqual(geography.regions, original.regions);
    const dataset = lib.chinaDataset({
      periods: ['p1'], metrics: [{ id: 'value' }],
      records: regions.map(({ code }, index) => ({ region_code: code, period: 'p1', values: { value: index } })),
    }, geography);
    const map = lib.createMap(null, { geography, dataset, width: 920, height: 540 });
    const { spec } = map;
    t.after(() => map.destroy());
    const fullScale = map.projection.scale;
    const full = map.render();
    const csv = map.export('csv');
    map.setSpec({ ...spec, insets: [inset] });
    const result = map.lastRender;
    const detail = result.insets[0];
    assert.ok(map.projection.scale > fullScale);
    assert.deepEqual(result.renders[0].domain.breaks, detail.renders[0].domain.breaks);
    assert.equal(map.export('csv'), csv);
    if (sample === 'china') {
      assert.match(full.svg, /data-map-boundary="region-100000_JD"/);
      assert.doesNotMatch(result.svg.split('<svg data-inset-id=')[0], /region-100000_JD/);
      assert.match(result.svg.split('<svg data-inset-id=')[1], /data-map-boundary="region-100000_JD"/);
      assert.equal(detail.geography.features.features.length, 2);
    } else {
      assert.doesNotMatch(result.renders[0].svg, /data-region-id="460300"/);
      assert.equal(detail.geography.features.features.length, 1);
    }
    const offshore = detail.geography.features.features.find(({ properties }) => properties.region_id === regionId);
    const local = lib.projectPoint(interiorPoint(offshore.geometry.coordinates[0]), detail.projection);
    const point = [detail.inset.x + local[0], detail.inset.y + 20 + local[1]];
    assert.equal(map.hitTest(point)?.regionId, regionId);
    assert.equal(map.hitTest(point)?.insetId, inset.id);
    map.setSelection([regionId]);
    assert.match(map.export('svg').split('<svg data-inset-id=')[1], new RegExp(`data-selection-region-id="${regionId}"`));
    map.zoomAt(point, 1.5, inset.id);
    assert.ok(Math.abs(map.lastRender.insets[0].projection.scale / detail.projection.scale - 1.5) < 1e-12);
    const fitted = map.projection;
    map.toggleInset(inset.id, false);
    assert.deepEqual(map.projection, fitted);
    map.toggleInset(inset.id, true);
    map.setViewport({ width: 390, height: 500 });
    const positioned = map.lastRender.insets[0].inset;
    assert.equal(positioned.x + positioned.width + inset.x, 390);
    assert.equal(positioned.y + positioned.height + 20 + inset.y, 500);
    assert.deepEqual(map.getState().selection, [regionId]);

    const insetProjection = map.projection;
    const hidden = map.setSpec({ ...spec, insets: [{ ...inset, visible: false, controls: false }] });
    assert.ok(map.projection.scale >= insetProjection.scale);
    assert.notDeepEqual(map.projection, insetProjection);
    assert.equal(hidden.insets.length, 0);
    const hiddenSvg = map.export('svg');
    assert.doesNotMatch(hiddenSvg, /data-inset-(id|toggle)=|data-map-boundary="region-100000_JD"/);
    const regionShapes = hiddenSvg.match(new RegExp(`data-region-id="${regionId}"`, 'g')) ?? [];
    assert.equal(regionShapes.length, sample === 'china' ? 1 : 0);
    const offshorePoint = lib.projectPoint(interiorPoint(offshore.geometry.coordinates[0]), map.projection);
    assert.equal(map.hitTest(offshorePoint), null);
    assert.equal(map.export('csv'), csv);
    assert.deepEqual(map.getState().selection, [regionId]);

    map.setSpec({ ...spec, insets: [inset] });
    assert.deepEqual(map.projection, insetProjection);
    assert.equal(map.lastRender.insets.length, 1);
    map.setViewport({ width: 920, height: 540 });
    map.setSpec(spec);
    assert.equal(map.projection.scale, fullScale);
  }
});

test('configured fictional preview serves package-only resources and renders all gallery types', async t => {
  const get = await serve(t, { configPath: new URL('../scripts/examples/config.json', import.meta.url) });
  const config = await (await get('/config.json')).json();
  assert.equal(config.geographies.length, 2);
  for (const route of ['/preview/', '/preview/quickstart.html', '/preview/gallery.js', '/src/index.js', '/fixtures/gallery.js', '/docs/USAGE.md', '/README.md']) {
    assert.equal((await get(route)).status, 200, route);
  }
  const bundle = await (await get('/fixtures/third-map.json')).json();
  const minimal = lib.createMap(bundle);
  assert.match(minimal.export('svg'), /data-region-id="island-a"/);
  minimal.destroy();
  for (const entry of config.geographies) {
    const collection = await (await get(`/geographies/${entry.id}`)).json();
    const fixture = galleryFixture(lib, entry, collection);
    assert.equal(fixture.geography.regions.length, 20);
    for (const item of galleryTypes) {
      const spec = gallerySpec(lib, fixture, item, item.variants[0]);
      const map = lib.createMap(null, { ...fixture, spec, width: 660, height: 350 });
      assert.match(map.export('svg'), /data-region-id=/, `${entry.id}/${item.type}`);
      map.destroy();
    }
  }
  for (const route of ['/catalog/maps/index.json', '/geographies/unknown', '/preview/..%5C..%5C..%5Cpackage.json']) {
    assert.equal((await get(route)).status, 404, route);
  }
});

test('external preview data is opt-in and confined to the explicit data root', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stats-map-preview-'));
  const configPath = path.join(directory, 'config.json');
  await writeFile(path.join(directory, 'shape.json'), '{"type":"FeatureCollection","features":[]}');
  await writeFile(configPath, JSON.stringify({ schema_version: 1, geographies: [
    { id: 'custom', path: 'shape.json', source_path: 'config.json' }, { id: 'escape', path: '../outside.json', source_path: '../outside.json' }
  ] }));
  const get = await serve(t, { configPath, dataRoot: directory });
  assert.equal((await get('/geographies/custom')).status, 200);
  assert.equal((await get('/geographies/custom/source')).status, 200);
  assert.equal((await get('/geographies/escape')).status, 404);
  assert.equal((await get('/geographies/escape/source')).status, 404);
});

test('saved preview grids are read without a preparation request and survive period, viewport and export reopening', async t => {
  const get = await serve(t, { configPath: new URL('../scripts/examples/config.json', import.meta.url) });
  const config = await (await get('/config.json')).json(), item = galleryTypes[0];
  for (const entry of config.geographies) {
    const saved = await (await get(`/geographies/${entry.id}/grids`)).json();
    const fixture = galleryFixture(lib, entry, await (await get(`/geographies/${entry.id}`)).json(), saved);
    for (const layout of ['grid-square', 'grid-hex']) {
      const map = lib.createMap(null, { ...fixture, spec: gallerySpec(lib, fixture, item, item.variants[0], 'p1', layout) });
      map.render();
      const positions = () => [...map.layoutPositions].map(([id, p]) => [id, p.column, p.row]);
      const before = positions();
      map.setView({ period_id: 'p3' }); map.setViewport({ width: 390, height: 350 });
      assert.deepEqual(positions(), before);
      const first = map.layoutPositions.values().next().value;
      assert.equal(map.hitTest([first.x, first.y]).regionId, first.id);
      const exported = map.exportSpec({ resolved: true });
      assert.deepEqual(exported.layout.positions, saved.grid_layouts.find(p => p.type === layout).positions);
      const reopened = lib.createMap(null, { ...fixture, spec: exported });
      reopened.render();
      assert.deepEqual([...reopened.layoutPositions].map(([id, p]) => [id, p.column, p.row]), before);
      reopened.destroy(); map.destroy();
    }
  }
});

test('preview registration persists separate map catalogs once and rejects a changed source until explicit force', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stats-grid-preview-')), configPath = path.join(directory, 'gallery.json');
  const source = await readFile(new URL('./fixtures/gallery-geography.geojson', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../scripts/examples/config.json', import.meta.url), 'utf8'));
  for (const entry of config.geographies) { entry.path = 'shape.json'; delete entry.grid_layouts_path; delete entry.grid_layouts_sha256; }
  await writeFile(path.join(directory, 'shape.json'), source); await writeFile(configPath, JSON.stringify(config));
  const initial = await preparePreviewGrids({ configPath, dataRoot: directory });
  assert.deepEqual(initial.map(p => p.generated), [2, 2]);
  assert.notEqual(initial[0].path, initial[1].path);
  const again = await preparePreviewGrids({ configPath, dataRoot: directory });
  assert.deepEqual(again.map(p => [p.generated, p.reused]), [[0, 2], [0, 2]]);
  await writeFile(path.join(directory, 'shape.json'), source + '\n');
  await assert.rejects(preparePreviewGrids({ configPath, dataRoot: directory }), /source changed/);
  const before = JSON.parse(await readFile(path.join(directory, initial[0].path), 'utf8'));
  const rebound = await preparePreviewGrids({ configPath, dataRoot: directory, regenerate: true });
  assert.deepEqual(rebound.map(p => [p.generated, p.reused]), [[0, 2], [0, 2]], 'a byte-only source change rebinds provenance without solving again');
  const after = JSON.parse(await readFile(path.join(directory, initial[0].path), 'utf8'));
  assert.notEqual(after.source_sha256, before.source_sha256);
  assert.deepEqual(after.grid_layouts, before.grid_layouts);
});

test('npm publication does not run a host deployment hook and ships preview inputs', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.publish, undefined);
  assert.equal(pkg.scripts.prepack, 'npm run build');
  for (const file of ['docs', 'examples/preview', 'tests/fixtures/gallery.js', 'tests/fixtures/gallery-geography.geojson', 'tests/fixtures/third-map.json']) {
    assert.ok(pkg.files.includes(file), file);
  }
});
