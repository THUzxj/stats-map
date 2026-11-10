// Read-only, loopback-only preview. All default inputs live in this package.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.geojson', 'application/geo+json; charset=utf-8'], ['.md', 'text/markdown; charset=utf-8']]);

const inside = (base, target) => { const rel = path.relative(base, target); return !rel || !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

export async function createPreviewServer({ configPath = path.join(root, 'examples/preview/gallery.json'), dataRoot = root } = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.schema_version !== 1 || !Array.isArray(config.geographies) || !config.geographies.length) throw new Error('Invalid gallery config');
  const dataBase = path.resolve(dataRoot);
  function resolve(route) {
    if (route === '/' || route === '/preview' || route === '/preview/') return path.join(root, 'scripts/preview/index.html');
    if (route.startsWith('/preview/')) return path.join(root, 'scripts/preview', route.slice('/preview/'.length));
    if (['/src/', '/dist/', '/docs/'].some(prefix => route.startsWith(prefix))) return path.join(root, route.slice(1));
    if (['/fixtures/gallery.js', '/fixtures/third-map.json'].includes(route)) return path.join(root, 'tests', route.slice(1));
    if (route === '/README.md') return path.join(root, 'README.md');
    return null;
  }
  return createServer(async (request, response) => {
    let route;
    try { route = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { response.writeHead(400).end('Bad request'); return; }
    if (route === '/config.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(config)); return;
    }
    const match = route.match(/^\/geographies\/([a-z0-9-]+)(\/(?:source|grids))?$/i);
    const geography = match && config.geographies.find(item => item.id === match[1]);
    const inputPath = geography && (match[2] === '/source' ? geography.source_path : match[2] === '/grids' ? geography.grid_layouts_path : geography.path);
    const target = inputPath ? path.resolve(dataBase, inputPath) : resolve(route);
    if (!target || !inside(geography ? dataBase : root, target)) { response.writeHead(404).end('Not found'); return; }
    try {
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': mime.get(path.extname(target)) ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(body);
    } catch { response.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  let port = 4173;
  if (args.includes('--help')) console.log('npm run preview -- [--port 4173] [--config <json> --data-root <directory>]');
  else {
    for (let i = 0; i < args.length; i += 2) {
      const value = args[i + 1];
      if (!value || !['--port', '--config', '--data-root'].includes(args[i])) throw new Error('Invalid arguments; use --help');
      if (args[i] === '--port') port = Number(value);
      else options[args[i] === '--config' ? 'configPath' : 'dataRoot'] = path.resolve(value);
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = await createPreviewServer(options);
    server.listen(port, '127.0.0.1', () => console.log(`stats-map gallery: http://127.0.0.1:${server.address().port}/preview/`));
  }
}
