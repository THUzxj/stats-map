import type { Geography, GridPlan, GridPreparationOptions } from '../types/index.js';
/** Offline Node map-registration API. Rendering never calls these functions. */
export function generateGridPlan(geography:Geography, options?:GridPreparationOptions):GridPlan;
export function prepareGridLayouts(geography:Geography, options?:GridPreparationOptions):{geography:Geography;generated:number;reused:number};
