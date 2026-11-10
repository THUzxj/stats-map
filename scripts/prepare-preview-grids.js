import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../src/index.js';
import { prepareGridLayouts } from '../src/preparation/index.js';
import { galleryFixture } from '../tests/fixtures/gallery.js';
import { writeJsonAtomic } from './prepare-grids.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function preparePreviewGrids({ configPath = path.join(root, 'examples/preview/gallery.json'), dataRoot = root, regenerate = false } = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8')), results = [];
  const confined = filename => {
    const target = path.resolve(dataRoot, filename), rel = path.relative(path.resolve(dataRoot), target);
    if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) throw new Error('Preview registration path escapes data root');
    return target;
  };
  for (const entry of config.geographies) {
    if (!/^[a-z0-9-]+$/i.test(entry.id)) throw new Error('Preview IDs must be safe route identifiers');
    const bytes = await readFile(confined(entry.path)), sourceSha = createHash('sha256').update(bytes).digest('hex');
    const geography = galleryFixture(lib, entry, JSON.parse(bytes)).geography;
    entry.grid_layouts_path ??= path.posix.join(path.posix.dirname(entry.path), entry.id + '.grids.json');
    const destination = confined(entry.grid_layouts_path);
    let old;
    try { old = JSON.parse(await readFile(destination, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old && old.source_sha256 !== sourceSha && !regenerate) throw new Error('Preview source changed; use --force to regenerate its saved grids');
    if (old?.geography_ref?.id !== undefined && old.geography_ref.id !== geography.id) throw new Error('Saved grids belong to another preview geography');
    geography.grid_layouts = old?.grid_layouts;
    const prepared = prepareGridLayouts(geography, { projection: { id: entry.projection }, regenerate });
    const artifact = { schema_version: 1, geography_ref: { id: geography.id, revision: geography.revision }, source_sha256: sourceSha, grid_layouts: prepared.geography.grid_layouts };
    if (prepared.generated || !old || old.source_sha256 !== sourceSha) { await mkdir(path.dirname(destination), { recursive: true }); await writeJsonAtomic(destination, artifact); }
    entry.grid_layouts_sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
    results.push({ id: entry.id, generated: prepared.generated, reused: prepared.reused, path: entry.grid_layouts_path, quality: artifact.grid_layouts.map(p => ({ type: p.type, ...p.quality })) });
  }
  await writeJsonAtomic(configPath, config);
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') options.regenerate = true;
    else if (['--config', '--data-root'].includes(args[i]) && args[i + 1]) options[args[i] === '--config' ? 'configPath' : 'dataRoot'] = path.resolve(args[++i]);
    else throw new Error('Usage: node scripts/prepare-preview-grids.js [--config file] [--data-root directory] [--force]');
  }
  console.log(JSON.stringify(await preparePreviewGrids(options), null, 2));
}
