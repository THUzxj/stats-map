import { viewRegionIds } from '../core/view.js';
import { createPresentation } from '../core/presentation.js';
import { fitProjection, hitTest, projectPoint, resolveAnchors, geometryStatus } from '../core/geometry.js';
import { renderSvg, stageSvg } from '../renderers/svg.js';
import { decorationSvg, geographicBackgroundSvg, referenceSvg, graticuleSvg, selectionSvg, escapeSvg } from './decorations.js';
import { resolveScreenLayout, layoutHitTest, dorlingPositions } from '../layouts/resolve.js';

const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g,'');
// Reprojection is only affine for these known projections with identical
// parameters. Custom projections still render, without a false viewport box.
function overviewTransform(main,overview) {
  if(!['cartesian','equirectangular','mercator'].includes(main.type)||main.type!==overview.type||main.yDirection!==overview.yDirection)return null;
  const a=projectPoint([0,0],main),b=projectPoint([0,0],overview),scale=overview.scale/main.scale;
  return {scale,shift:[b[0]-a[0]*scale,b[1]-a[1]*scale]};
}
export function renderInsets(map,transaction) {
  const p=createPresentation(map.spec,map.geography),{theme}=p;
  let svg='';const views=[];
  for(const inset of map.spec.insets??[]){
    const title=p.label(inset,inset.id),controlY=inset.y+16;
    if(inset.controls!==false)svg+=`<g data-inset-toggle="${escapeSvg(inset.id)}" direction="ltr" role="button" tabindex="0" aria-label="${escapeSvg(title)}" aria-expanded="${inset.visible!==false}"><rect x="${inset.x}" y="${inset.y-4}" width="${inset.width}" height="24" fill="${theme.panelBackground}" stroke="${theme.border}"/><text x="${inset.x+6}" y="${controlY-4}" font-family="${escapeSvg(theme.fontFamily)}" fill="${theme.text}" font-size="12">${escapeSvg(title)} ${inset.visible===false?'+':'−'}</text></g>`;
    if(inset.visible===false)continue;
    const viewport={width:inset.width,height:inset.height,padding:inset.padding??12};
    const layout={...map.spec.layout,type:'geographic',...inset.layout};
    const spec={...map.spec,insets:[],title:undefined,titles:undefined,labels:undefined,subtitle:undefined,layout,view:{...map.spec.view,level_ids:undefined,region_ids:inset.region_ids??viewRegionIds(map.geography,map.spec)},decorations:{geographicBackground:map.spec.decorations?.geographicBackground,...(inset.decorations??{})}};
    const anchorOptions={policy:spec.anchor_policy,regionIds:spec.view.region_ids},symbolResolution=resolveAnchors(map.geography,anchorOptions),labelResolution=resolveAnchors(map.geography,{...anchorOptions,role:'label'});
    const fitted=fitProjection(map.geography,viewport,{...layout,regionIds:spec.view.region_ids});
    const transform=inset.transform??{zoom:1,pan:[0,0]};
    const projection={...fitted,scale:fitted.scale*transform.zoom,translate:[fitted.translate[0]+transform.pan[0]*viewport.width,fitted.translate[1]+transform.pan[1]*viewport.height]};
    let layoutPositions=resolveScreenLayout(map.geography,spec,viewport,null,map._views);
    if(layoutPositions){
      for(const node of layoutPositions.values()){
        node.x=(node.x-fitted.translate[0])*transform.zoom+projection.translate[0];node.y=(node.y-fitted.translate[1])*transform.zoom+projection.translate[1];
        if(layout.type!=='dorling'){if(node.size!=null)node.size*=transform.zoom;if(node.radius!=null)node.radius*=transform.zoom;}
      }
      if(layout.type==='dorling')layoutPositions=dorlingPositions([...layoutPositions.values()],{...layout,bounds:[0,0,viewport.width,viewport.height]});
    }
    const namespace=`${map.instanceId}-inset-${Array.from(inset.id,c=>c.codePointAt(0).toString(16)).join('-')}`,clip=`${namespace}-clip`;
    const fixedDecorations=decorationSvg({geography:map.geography,spec:{...spec,decorations:{...spec.decorations,labels:false}},projection,viewport,views:map._views,layoutPositions,anchorResolution:labelResolution});
    const obstacles=[...fixedDecorations.obstacles];
    let body=geographicBackgroundSvg(map.geography,projection,spec,layoutPositions)+graticuleSvg(map.geography,projection,spec),renders=[];
    for(const layer of [...spec.layers].sort((a,b)=>(a.role==='base'?0:1)-(b.role==='base'?0:1))){
      const encoding=layer.encoding??{},channel=encoding.dataset_id?encoding:Object.values(encoding).find(value=>value?.dataset_id)??encoding;
      const options={geography:map.geography,datasetView:map._views.get(channel.dataset_id??spec.dataset_refs[0]?.id),datasetViews:map._views,spec,layer,viewport,projection,selection:[...map.selection],selectionOverlay:true,layoutPositions,layoutType:layout.type,anchorResolution:symbolResolution,labelObstacles:obstacles,namespace:`${namespace}-${layer.id}`,insetId:inset.id};
      const result=transaction?stageSvg(transaction,options):renderSvg(options);
      for(const label of result.flowLayout?.labels?.values()??[])if(label.visible)obstacles.push(label.box);
      renders.push(result);body+=`<g data-layer-id="${escapeSvg(layer.id)}">${inner(result.svg)}</g>`;
    }
    body+=referenceSvg(map.geography,projection,spec);
    const decorations=decorationSvg({geography:map.geography,spec,projection,viewport,views:map._views,layoutPositions,obstacles,selection:map.selection,anchorResolution:labelResolution,preparedLayout:fixedDecorations.layout});body+=decorations.svg;
    body+=selectionSvg(map.geography,projection,map.selection,spec,layoutPositions);
    const overview=inset.minimap&&(map.spec.layout?.type??'geographic')==='geographic'&&layout.type==='geographic'?overviewTransform(map.projection,projection):null;
    if(overview){const [x,y]=overview.shift;body+=`<rect data-minimap-viewport="true" x="${x}" y="${y}" width="${map.viewport.width*overview.scale}" height="${map.viewport.height*overview.scale}" fill="none" stroke="${theme.selection}" stroke-width="1.5" pointer-events="none"/>`;}
    svg+=`<svg data-inset-id="${escapeSvg(inset.id)}" x="${inset.x}" y="${inset.y+20}" width="${inset.width}" height="${inset.height}" viewBox="0 0 ${inset.width} ${inset.height}" overflow="hidden"><defs><clipPath id="${clip}"><rect width="${inset.width}" height="${inset.height}"/></clipPath></defs><g clip-path="url(#${clip})"><rect width="${inset.width}" height="${inset.height}" fill="${escapeSvg(inset.background??theme.background)}"/>${body}</g><rect width="${inset.width}" height="${inset.height}" fill="none" stroke="${theme.border}" pointer-events="none"/></svg>`;
    views.push({id:inset.id,inset,viewport,projection,spec,renders,decorations,overview,layoutPositions,layout:layoutPositions?.metrics,geometry:geometryStatus(map.geography,{...anchorOptions,symbolResolution,labelResolution}),diagnostics:[...renders.flatMap(result=>result.diagnostics),...(layoutPositions?.diagnostics??[]),...decorations.diagnostics]});
  }
  return {svg,views};
}
export function insetHitTest(point,views,geography) {
  for(const view of [...views].reverse()){
    const x=point[0]-view.inset.x,y=point[1]-view.inset.y-20;
    if(view.inset.controls!==false&&x>=0&&x<=view.viewport.width&&y>=-24&&y<0)return {view,hit:null};
    if(x>=0&&y>=0&&x<=view.viewport.width&&y<=view.viewport.height)return {view,hit:view.layoutPositions?layoutHitTest([x,y],view.layoutPositions,view.spec.layout.type):hitTest([x,y],geography,view.projection,{regionIds:view.spec.view.region_ids,policy:view.spec.anchor_policy})};
  }
  return null;
}
