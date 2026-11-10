import { cp, readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
// Explicit static-asset export, never an npm publication lifecycle hook.
const root=resolve(fileURLToPath(new URL('..',import.meta.url))), source=resolve(root,'dist');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--target')throw new Error('Usage: npm run export:assets -- --target <new-or-empty-directory>');
const target=resolve(args[1]), inside=(base,path)=>{const rel=relative(base,path);return !rel||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../');};
if(inside(root,target)||inside(target,root))throw new Error('Asset target must be separate from the package source directory');
const manifest=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
await mkdir(target,{recursive:true});
if((await readdir(target)).length)throw new Error('Asset target must be new or empty; deploy replacements in the host');
await cp(source,target,{recursive:true});
console.log(`Exported ${manifest.files.length} stats-map files to ${target}`);
