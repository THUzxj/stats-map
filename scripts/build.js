import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { RENDERER_TYPES } from '../src/renderers/registry.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))), out=resolve(root,'dist');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(resolve(root,'src'),resolve(out,'src'),{recursive:true});
await cp(resolve(root,'schemas'),resolve(out,'schemas'),{recursive:true});
await cp(resolve(root,'types'),resolve(out,'types'),{recursive:true});
await cp(resolve(root,'upstream-coverage.json'),resolve(out,'upstream-coverage.json'));
await writeFile(resolve(out,'index.js'),"export * from './src/index.js';\n");
await writeFile(resolve(out,'host.js'),"export { default } from './src/host.js';\n");
await cp(resolve(root,'src/stats-map.css'),resolve(out,'stats-map.css'));
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await cp(resolve(root,name),resolve(out,name));
const esbuildLicense=await readFile(new URL('../LICENSE.md',import.meta.resolve('esbuild')),'utf8');
await mkdir(resolve(out,'licenses'),{recursive:true});
await writeFile(resolve(out,'licenses/esbuild-MIT.txt'),esbuildLicense);
await mkdir(resolve(out,'renderers'),{recursive:true});
for(const type of RENDERER_TYPES){
  await writeFile(resolve(out,'renderers',type+'.js'),`import { createRendererEntry } from '../src/renderers/entry.js';\nconst renderer=createRendererEntry('${type}');\nexport const {type,createLayer,render}=renderer;\nexport default renderer;\n`);
  await writeFile(resolve(out,'renderers',type+'.d.ts'),`import type { RendererEntry } from '../src/types/index.js';\ndeclare const renderer:RendererEntry<'${type}'>;\nexport declare const type:typeof renderer.type,createLayer:typeof renderer.createLayer,render:typeof renderer.render;\nexport default renderer;\n`);
}
await build({
  entryPoints:[resolve(root,'src/index.js')],outfile:resolve(out,'stats-map.iife.js'),bundle:true,format:'iife',globalName:'__statsMapExports',platform:'browser',target:'es2022',external:['node:crypto'],
  banner:{js:`/*! esbuild helper code:\n${esbuildLicense}\n*/\n(function(){\n'use strict';\nconst __statsMapScriptUrl=document.currentScript?.src;`},
  footer:{js:"globalThis.StatsMap=__statsMapExports;\nglobalThis.dispatchEvent?.(new Event('stats-map-ready'));\n})();"},
  plugins:[{name:'classic-worker-url',setup(builder){builder.onLoad({filter:/[\\/]layouts[\\/]worker-url\.js$/},()=>({contents:"export const dorlingWorkerUrl=new URL('./src/layouts/dorling-worker.js',__statsMapScriptUrl);",loader:'js'}));}}]
});
const files=[];const walk=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isDirectory())await walk(path);else{const rel=relative(out,path).split(sep).join('/');const data=await readFile(path);files.push({path:rel,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});}}};
await walk(out);await writeFile(resolve(out,'manifest.json'),JSON.stringify({schema_version:1,package:'stats-map',files},null,2)+'\n');
console.log(`Built ${files.length} stats-map files in dist/`);
