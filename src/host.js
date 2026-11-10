// Browser bridge: the host owns data loading and can use the same package without
// duplicating renderer or statistic code. No network or catalog access happens here.
import * as StatsMap from './index.js';
if (typeof globalThis !== 'undefined') {
  globalThis.StatsMap = StatsMap;
  globalThis.dispatchEvent?.(new Event('stats-map-ready'));
}
export default StatsMap;
