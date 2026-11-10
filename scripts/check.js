import { RENDERER_TYPES, RENDERER_ALIASES } from '../src/index.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
if (RENDERER_TYPES.length !== 14) throw new Error(`expected 14 renderers, got ${RENDERER_TYPES.length}`);
if (new Set(RENDERER_TYPES).size !== 14 || Object.keys(RENDERER_ALIASES).length !== 14) throw new Error('renderer registry is inconsistent');
for (const kind of ['geography','dataset','spec','bundle']) { const schema=JSON.parse(await readFile(resolve('schemas',`stats-map-${kind}-v1.schema.json`),'utf8')); if(schema.properties?.schema_version?.const!==1)throw new Error(`invalid ${kind} schema`); }
const coverage=JSON.parse(await readFile(resolve('upstream-coverage.json'),'utf8'));
const entries=coverage.examples.entries;
if(coverage.examples.count!==entries.length||new Set(entries.map(entry=>entry.path)).size!==entries.length)throw new Error('reference example count and unique paths must agree');
const ids=new Set([...coverage.renderers,...coverage.layouts,...coverage.orchestration].map(entry=>entry.id).concat(Object.keys(coverage.capability_acceptance)));
for(const [prefix,count] of [['V',14],['S',15],['L',6],['C',7],['X',10]])for(let index=1;index<=count;index++)if(!ids.has(prefix+String(index).padStart(2,'0')))throw new Error(`missing coverage capability ${prefix}${index}`);
for(const entry of entries)if((!entry.capability_ids.length&&!['container','no-new-capability'].includes(entry.mapping_kind))||entry.capability_ids.some(id=>!ids.has(id)))throw new Error(`unmapped upstream example: ${entry.path}`);
console.log(`stats-map check: ${RENDERER_TYPES.length} renderers registered`);
