// A deliberately small, fictional extension. Statistics, anchors, projection,
// accessibility and interaction state come from the public shared services.
export function protocolRenderer(lib,type='fictionalMarks') {
  const calls=[],active=new Set();let sequence=0;
  const definition={type,aliases:[type+'Alias'],capabilities:{layouts:['geographic','grid-square','grid-hex','dorling']},
    validateEncoding(context){calls.push(['validate',context.insetId,context.phase]);if(!context.bindings.length||context.layer.options.invalidEncoding)return false;},
    prepare(context){
      const token=++sequence;active.add(token);context.services.onDispose(()=>active.delete(token));calls.push(['prepare',token,context.insetId,context.phase]);
      if(context.layer.options.failPrepare)throw new Error('Fictional prepare failure');
      return {token,points:[...context.anchors].filter(([id])=>!context.spec.view?.region_ids||context.spec.view.region_ids.includes(id)).map(([regionId,point])=>({regionId,point,value:context.datasetView.observation(context.bindings[0].series_id,regionId,context.spec.view?.period_id)?.value??null}))};
    },
    render(context,prepared){
      calls.push(['render',prepared.token,context.insetId,context.phase]);
      if(context.layer.options.failRender||context.insetId&&context.layer.options.failInset)throw new Error('Fictional render failure');
      const svg=prepared.points.map(({regionId,point,value})=>`<circle data-region-id="${regionId}" data-value="${value??''}" cx="${point[0]}" cy="${point[1]}" r="10" fill="${context.selection.includes(regionId)?'#ff9900':'#123456'}"/>`).join('');
      return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${context.viewport.width} ${context.viewport.height}">${svg}</svg>`,collisionRadii:new Map(prepared.points.map(({regionId})=>[regionId,10])),token:prepared.token};
    },
    update(context,prepared,previous){calls.push(['update',prepared.token,previous.token]);if(context.layer.options.failUpdate)throw new Error('Fictional update failure');return definition.render(context,prepared);},
    hitTest(context,prepared,point){calls.push(['hitTest',prepared.token]);const hit=prepared.points.find(p=>Math.hypot(point[0]-p.point[0],point[1]-p.point[1])<=10);return hit?{regionId:hit.regionId,point:hit.point,distance:Math.hypot(point[0]-hit.point[0],point[1]-hit.point[1])}:null;},
    describe(context,prepared,target){calls.push(['describe',prepared.token]);const row=prepared.points.find(p=>p.regionId===(target.region_id??target.regionId));return row?{title:'Fictional mark '+row.regionId,rows:[{label:'Original value',value:String(row.value)}]}:null;},
    destroy(context,prepared){calls.push(['destroy',prepared?.token,context.insetId,context.phase]);if(context.layer.options.failDestroy)throw new Error('Fictional destroy failure');}
  };
  return {definition:lib.registerRenderer(definition),calls,active};
}
