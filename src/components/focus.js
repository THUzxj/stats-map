const attributes=['data-inset-toggle','data-region-id','data-symbol-region-id','data-relation-id','data-flow-route-id','data-component-index','data-series-id','data-period-id','data-legend-key','data-flow-channel','data-flow-category','data-flow-net','data-ranking-row'];
const scopes=['data-inset-id','data-layer-id','data-legend-layer-id','data-map-ranking'];
// SVG nodes are replaced on render. Remember semantic identity, including the
// view namespace, rather than accidentally focusing the same region elsewhere.
export function rememberFocus(container) {
  const active=container?.ownerDocument?.activeElement;
  if(!active||active===container||!container.contains?.(active))return null;
  const identity={attributes:{},scopes:{}};
  for(const name of attributes)if(active.hasAttribute?.(name))identity.attributes[name]=active.getAttribute(name);
  if(!Object.keys(identity.attributes).length)return null;
  for(const name of scopes)identity.scopes[name]=active.closest?.(`[${name}]`)?.getAttribute(name)??null;
  // Classification is display state, not a region's identity. A relation
  // anchor update can change a region from a class to missing and back.
  if(identity.scopes['data-legend-layer-id']==null)delete identity.attributes['data-legend-key'];
  return identity;
}
export function restoreFocus(container,identity) {
  if(!identity)return;
  for(const element of container.querySelectorAll?.('[tabindex="0"]')??[]){
    if(!Object.entries(identity.attributes).every(([name,value])=>element.getAttribute(name)===value))continue;
    if(!Object.entries(identity.scopes).every(([name,value])=>(element.closest?.(`[${name}]`)?.getAttribute(name)??null)===value))continue;
    element.focus?.();break;
  }
}
