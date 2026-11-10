// Explicit, offline map registration. No server/browser import of the solver.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareGridLayouts } from '../src/preparation/index.js';

export async function writeJsonAtomic(filename, data) {
  const temporary = filename + '.tmp';
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
  await rename(temporary, filename);
}
export async function prepareGeographyFile(input, output, options = {}) {
  const geography = JSON.parse(await readFile(input, 'utf8'));
  if (path.resolve(input) !== path.resolve(output)) {
    try {
      const saved = JSON.parse(await readFile(output, 'utf8'));
      if (saved.id !== geography.id) throw new Error('Output belongs to another geography');
      geography.grid_layouts = saved.grid_layouts;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const result = prepareGridLayouts(geography, options);
  if (result.generated || path.resolve(input) !== path.resolve(output)) await writeJsonAtomic(output, result.geography);
  return { generated: result.generated, reused: result.reused, output };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') values.regenerate = true;
    else if (['--input', '--output', '--options'].includes(args[i]) && args[i + 1]) values[args[i].slice(2)] = args[++i];
    else throw new Error('Usage: node scripts/prepare-grids.js --input geography.json [--output prepared.json] [--options options.json] [--force]');
  }
  if (!values.input) throw new Error('--input is required');
  const options = values.options ? JSON.parse(await readFile(values.options, 'utf8')) : {};
  console.log(JSON.stringify(await prepareGeographyFile(values.input, values.output ?? values.input, { ...options, regenerate: values.regenerate }), null, 2));
}
