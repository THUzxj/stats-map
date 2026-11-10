import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('asset export requires an explicit separate empty target and preserves existing content', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stats-map-export-'));
  const root = path.join(directory, 'package');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'scripts/publish.js'), await readFile(new URL('../scripts/publish.js', import.meta.url)));
  const manifest = '{"files":[{"path":"index.js"}]}';
  await writeFile(path.join(root, 'dist/manifest.json'), manifest);
  await writeFile(path.join(root, 'dist/index.js'), 'export const sample = true;');
  const run = args => spawnSync(process.execPath, ['scripts/publish.js', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.notEqual(run([]).status, 0);
  assert.notEqual(run(['--target', directory]).status, 0);
  assert.notEqual(run(['--target', path.join(root, 'src')]).status, 0);
  const target = path.join(directory, 'assets');
  assert.equal(run(['--target', target]).status, 0);
  assert.equal(await readFile(path.join(target, 'manifest.json'), 'utf8'), manifest);
  await writeFile(path.join(target, 'keep.txt'), 'retain');
  assert.notEqual(run(['--target', target]).status, 0);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'retain');
});
