import { StatsMapError } from '../core/errors.js';
const definitions = [
 ['choropleth',['ch'],'base','number',['quantile','equinter','threshold','ckmeans','jenks','dot']], ['proportionalSymbol',['proportionalSymbols','ps'],'overlay','number',['circle','bar','square','star','diamond','wye','cross','triangle','spike','custom']], ['categorical',['ct'],'base','category',['categorical']],
 ['bivariateChoropleth',['chbi'],'base','number',['bivariate']], ['trivariateChoropleth',['ternary','chtri'],'base','number',['ternary','sextant']], ['stripeComposition',['scomp','stripe'],'base','composition',['stripe']],
 ['pieChart',['pie','composition'],'overlay','composition',['pie','ring','flag','segment','radar','agepyramid','halftone']], ['sparkline',['spark','sparklines'],'overlay','timeseries',['line','area','bar']], ['flow',['flowmap'],'overlay','relation',['curved','straight','sankey']],
 ['coxcomb',['polar'],'overlay','timeseries',['polar','stacked']], ['alpha',['valueByAlpha'],'base','number',['alpha']], ['mushroom',[],'overlay','number',['horizontal','vertical']], ['waffle',[],'overlay','composition',['waffle']], ['bar',['barComposition'],'base','composition',['grouped','stacked']]
];
const registry = new Map();
const layouts=['geographic','grid-square','grid-hex','dorling'];
const defaults={validateEncoding(){},prepare(){},hitTest(){return null;},describe(){return null;},destroy(){}};
function install(definition,builtin=false) {
  const invalid=message=>{throw new StatsMapError(message,'INVALID_RENDERER');};
  if(typeof definition?.type!=='string'||!definition.type.trim())invalid('renderer type must be a non-empty string');
  const aliases=definition.aliases??[];
  if(!Array.isArray(aliases)||aliases.some(alias=>typeof alias!=='string'||!alias.trim())||new Set([definition.type,...aliases]).size!==aliases.length+1)invalid('renderer aliases must be distinct non-empty strings');
  for(const name of [definition.type,...aliases])if(registry.has(name))throw new StatsMapError(`renderer already registered: ${name}`,'DUPLICATE_RENDERER');
  for(const name of [...Object.keys(defaults),'render','update'])if(definition[name]!=null&&typeof definition[name]!=='function')invalid(`renderer ${name} must be a function`);
  if(typeof definition.render!=='function')invalid('renderer render hook is required');
  const role=definition.defaultRole??'overlay',capabilities=definition.capabilities??{};
  if(typeof capabilities!=='object'||Array.isArray(capabilities))invalid('renderer capabilities must be an object');
  if(definition.modes!=null&&(!Array.isArray(definition.modes)||definition.modes.some(mode=>typeof mode!=='string')))invalid('renderer modes must be strings');
  if(!['base','overlay'].includes(role))invalid('renderer defaultRole must be base or overlay');
  if(capabilities.layouts!=null&&(!Array.isArray(capabilities.layouts)||capabilities.layouts.some(layout=>!layouts.includes(layout))))invalid('renderer layouts are invalid');
  const d=Object.freeze({...defaults,...definition,type:definition.type,builtin,defaultRole:role,aliases:Object.freeze([...aliases]),modes:Object.freeze([...(definition.modes??[])]),capabilities:Object.freeze({selection:true,legend:true,export:true,...capabilities,roles:Object.freeze([role]),layouts:Object.freeze([...(capabilities.layouts??layouts)])})});
  registry.set(d.type,d);for(const alias of aliases)registry.set(alias,d);return d;
}
for (const [type, aliases, role, encoding, modes] of definitions) install({type,aliases,defaultRole:role,encoding,modes,render:context=>context.services.renderBuiltin(context)},true);
export const RENDERER_TYPES = definitions.map(x=>x[0]);
export const RENDERER_ALIASES = Object.fromEntries(definitions.map(([t,a])=>[t,a]));
export function getRenderer(type) { const r=registry.get(type); if(!r)throw new StatsMapError(`unsupported renderer: ${type}`,'UNSUPPORTED_LAYER'); return r; }
export function listRenderers() { return [...registry].filter(([name,d])=>name===d.type).map(([,d])=>d); }
export function registerRenderer(definition) { return install(definition); }
export function rendererCapabilities(type) { return getRenderer(type).capabilities; }
