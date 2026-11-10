import { StatsMapError } from './errors.js';

export function legendItemKey(legend,item) {
  if(legend.type==='categorical')return `category:${item.value}`;
  if(legend.type==='composition')return `component:${item.id}`;
  if(legend.type==='continuous')return `class:${item.index}`;
  if(legend.type==='bivariate')return `bivariate:${item.x}:${item.y}`;
  return null;
}

export function validateLegendFilters(filters,layerIds) {
  if(!filters||typeof filters!=='object'||Array.isArray(filters))throw new StatsMapError('legend_filters must be an object','INVALID_ARGUMENT');
  for(const [layer,keys] of Object.entries(filters))if(!layerIds.has(layer)||!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!key)||new Set(keys).size!==keys.length)throw new StatsMapError(`invalid legend filter for layer ${layer}`,'INVALID_ARGUMENT');
}

export function legendFilterAttributes(key,filter) {
  if(key==null)return '';
  const escaped=String(key).replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[value]));
  return ` data-legend-key="${escaped}"${Array.isArray(filter)&&!filter.includes(key)?' data-filtered="true" opacity="0.16" pointer-events="none"':''}`;
}
