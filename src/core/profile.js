import { StatsMapError } from './errors.js';

// Profiles are presentation defaults. Statistical identities and semantics
// always come from the spec and its referenced resources.
const fields = new Set(['title','titles','labels','subtitle','description','locale','messages','number_format','anchor_policy','theme','layout','insets','decorations','legend','interaction']);
function merge(defaults, explicit) {
  if (explicit === undefined) return structuredClone(defaults);
  if (!defaults || !explicit || Array.isArray(defaults) || Array.isArray(explicit) || typeof defaults !== 'object' || typeof explicit !== 'object') return structuredClone(explicit);
  const result = {...defaults};
  for (const [key,value] of Object.entries(explicit)) {
    if (['__proto__','constructor','prototype'].includes(key)) throw new StatsMapError('unsafe profile field','UNSAFE_INPUT');
    result[key] = merge(defaults[key],value);
  }
  return result;
}
export function resolveProfile(spec) {
  if(!spec||typeof spec!=='object')throw new StatsMapError('spec must be an object','INVALID_RESOURCE');
  if (spec.profile == null) return spec;
  if (typeof spec.profile !== 'object' || Array.isArray(spec.profile)) throw new StatsMapError('profile must contain resolved presentation defaults','INVALID_RESOURCE');
  const result = {...spec};
  for (const [key,value] of Object.entries(spec.profile)) {
    if (!fields.has(key)) throw new StatsMapError(`profile cannot set field: ${key}`,'INVALID_RESOURCE');
    result[key] = merge(value,spec[key]);
  }
  return result;
}
