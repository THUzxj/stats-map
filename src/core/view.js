// A view filters registered identities; it never changes hierarchy, observations
// or aggregation membership. Insets can supply their own explicit scope.
export function viewRegionIds(geography,spec={}) {
  const view=spec.view??{},regions=geography?.regions??[];
  const levels=view.level_ids==null?null:new Set(view.level_ids);
  const allowed=levels?new Set(regions.filter(region=>levels.has(region.level_id)).map(region=>region.id)):null;
  const ids=view.region_ids??regions.map(region=>region.id);
  return [...new Set(ids)].filter(id=>!allowed||allowed.has(id));
}

export function resolveView(spec,geography) {
  return spec.view?.level_ids==null?spec:{...spec,view:{...spec.view,region_ids:viewRegionIds(geography,spec)}};
}
