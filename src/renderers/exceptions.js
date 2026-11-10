import { createPresentation } from '../core/presentation.js';
import { channelView, channelValues } from '../core/channels.js';
import { categoryStyles } from './color.js';
import { escapeSvg as esc } from './composition.js';
import { legendFilterAttributes } from '../core/legend-filter.js';

export function exceptionModel(layer,fallback,views,spec={}) {
  const channel=layer.encoding?.exception;
  if(!channel)return null;
  const view=channelView({...channel,dataset_id:channel.dataset_id??layer.encoding.dataset_id},fallback,views,spec);
  const items=categoryStyles(view,channel.series_id,{...layer.options?.exceptions,locale:createPresentation(spec,view.geography).locale});
  const values=new Map(channelValues(view,channel.series_id,spec.view?.period_id).map(observation=>[observation.region_id,observation]));
  return {items,style:regionId=>{const observation=values.get(regionId);return observation?.status==='value'?items.find(item=>item.value===observation.value):null;}};
}

export function exceptionSymbol(item,id,x,y,options={},filter) {
  const radius=options.radius??6;
  return `<rect data-region-id="${esc(id)}" data-exception="${esc(item.value)}"${legendFilterAttributes(`exception:${item.value}`,filter)} x="${x-radius}" y="${y-radius}" width="${radius*2}" height="${radius*2}" fill="${esc(item.color)}" stroke="#555"><title>${esc(item.label)}</title></rect>`;
}
