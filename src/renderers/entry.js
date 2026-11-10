import { getRenderer } from './registry.js';
import { renderSvg } from './svg.js';

// Per-type public entries share the existing renderer implementation. They do
// not register another copy or keep private selection/statistic state.
export function createRendererEntry(type) {
  const definition=getRenderer(type);
  const createLayer=(encoding,options={},settings={})=>({...settings,id:settings.id??'theme',type:definition.type,role:settings.role??definition.defaultRole,encoding,options});
  return Object.freeze({
    type:definition.type,
    createLayer,
    render:options=>renderSvg({...options,layer:{...options.layer,type:definition.type}})
  });
}
