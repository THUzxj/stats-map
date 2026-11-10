import { viewRegionIds } from '../core/view.js';
import { createPresentation } from '../core/presentation.js';
import { resolveAnchors, bounds, projectPoint } from '../core/geometry.js';
import { geometryPath } from '../renderers/geometry-path.js';
import { StatsMapError } from '../core/errors.js';
import { channelBindings } from '../core/channels.js';
import { wrapText, textBox, placeLabels } from './text-layout.js';
import { geometryHasCoordinates } from '../core/anchors.js';
import { validateDorlingOptions } from '../layouts/dorling.js';
import { validateRankingOptions } from './ranking-options.js';
import { validateRankingRegionSet } from '../core/region-sets.js';
import { layoutDecorationBoxes } from './decoration-layout.js';

export const escapeSvg = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finitePair = value => Array.isArray(value)&&value.length===2&&value.every(Number.isFinite);
// SVG glyph bounds include ascenders/descenders and small side bearings beyond
// the baseline estimate. Reserve this space without changing the text size.
const decorationTextBox=(lines,x,y,size,anchor)=>{
  const box=textBox(lines,x,y,size,anchor),side=Math.max(1.5,size*.1),vertical=size*.3;
  return {x:box.x-side,y:box.y-vertical,width:box.width+2*side,height:box.height+2*vertical};
};
function requireValue(condition,message) { if(!condition)throw new StatsMapError(message,'INVALID_ARGUMENT'); }
export function validatePresentation(spec,geography) {
  const regions = geography ? new Set(geography.regions.map(region=>region.id)) : null;
  const object=(value,name)=>requireValue(value&&typeof value==='object'&&!Array.isArray(value),`${name} must be an object`);
  const placement=(value,name)=>{
    if(value.collision!=null)requireValue(['avoid','fixed','none'].includes(value.collision),`${name}.collision must be avoid, fixed or none`);
    if(value.priority!=null)requireValue(Number.isFinite(value.priority),`${name}.priority must be finite`);
  };
  const textOptions=(value,name)=>{
    for(const key of ['fontSize','maxWidth'])if(value[key]!=null)requireValue(Number.isFinite(value[key])&&value[key]>0,`${name}.${key} must be positive`);
    if(value.anchor!=null)requireValue(['start','middle','end'].includes(value.anchor),`${name}.anchor is invalid`);
    if(value.opacity!=null)requireValue(Number.isFinite(value.opacity)&&value.opacity>=0&&value.opacity<=1,`${name}.opacity must be within 0–1`);
    if(value.text!=null)requireValue(typeof value.text==='string',`${name}.text must be a string`);
  };
  const ids=(value,name)=>{requireValue(Array.isArray(value)&&value.every(id=>typeof id==='string'&&(!regions||regions.has(id)))&&new Set(value).size===value.length,`${name} must contain distinct known region ids`);};
  if(spec.view?.region_ids!=null)ids(spec.view.region_ids,'view.region_ids');
  for(const [name,legend] of [['legend',spec.legend],...(spec.layers??[]).map(layer=>['layer.legend',layer.legend])])if(legend!=null&&!(name==='layer.legend'&&typeof legend==='boolean')){
    object(legend,name);
    for(const key of ['x','y'])if(legend[key]!=null)requireValue(Number.isFinite(legend[key]),`${name}.${key} must be finite`);
    if(legend.width!=null)requireValue(Number.isFinite(legend.width)&&legend.width>=64,`${name}.width must be at least 64 pixels`);
    if(legend.columnWidth!=null)requireValue(Number.isFinite(legend.columnWidth)&&legend.columnWidth>=64,`${name}.columnWidth must be at least 64 pixels`);
    if(legend.gap!=null)requireValue(Number.isFinite(legend.gap)&&legend.gap>=0,`${name}.gap must be nonnegative`);
    if(legend.collision!=null)requireValue(['avoid','none'].includes(legend.collision),`${name}.collision must be avoid or none`);
    if(legend.visible!=null)requireValue(typeof legend.visible==='boolean',`${name}.visible must be boolean`);
  }
  if(spec.ranking!=null){
    validateRankingOptions(spec.ranking);
    validateRankingRegionSet(spec.ranking.regionSet,spec.ranking.regionIds,geography);
    for(const name of ['x','y','width','rowHeight'])if(spec.ranking[name]!=null)requireValue(Number.isFinite(spec.ranking[name])&&(!['width','rowHeight'].includes(name)||spec.ranking[name]>0),`ranking.${name} must be finite and dimensions positive`);
    if(spec.ranking.regionIds)ids(spec.ranking.regionIds,'ranking.regionIds');
    if(spec.ranking.direction)requireValue(['ascending','descending'].includes(spec.ranking.direction),'invalid ranking direction');
  }
  if(spec.decorations!=null){
    const d=spec.decorations;object(d,'decorations');
    if(d.layout!=null){
      object(d.layout,'decorations.layout');
      requireValue(Object.keys(d.layout).every(key=>['padding','gap','collision'].includes(key)),'unknown decorations.layout option');
      for(const key of ['padding','gap'])if(d.layout[key]!=null)requireValue(Number.isFinite(d.layout[key])&&d.layout[key]>=0,`decorations.layout.${key} must be nonnegative`);
      if(d.layout.collision!=null)requireValue(['avoid','none'].includes(d.layout.collision),'decorations.layout.collision must be avoid or none');
    }
    for(const name of ['labels','scalebar','graticule','reference'])if(d[name]!=null&&typeof d[name]!=='boolean')object(d[name],`decorations.${name}`);
    if(d.geographicBackground!=null&&typeof d.geographicBackground!=='boolean'){
      object(d.geographicBackground,'decorations.geographicBackground');
      for(const key of ['fill','stroke'])if(d.geographicBackground[key]!=null)requireValue(typeof d.geographicBackground[key]==='string',`decorations.geographicBackground.${key} must be a string`);
      if(d.geographicBackground.strokeWidth!=null)requireValue(Number.isFinite(d.geographicBackground.strokeWidth)&&d.geographicBackground.strokeWidth>=0,'decorations.geographicBackground.strokeWidth must be nonnegative');
    }
    if(d.labels?.region_ids)ids(d.labels.region_ids,'label region_ids');
    if(d.labels?.offset)requireValue(finitePair(d.labels.offset),'label offset must be finite');
    if(d.labels&&typeof d.labels==='object'){
      if(d.labels.collision!=null)requireValue(['none','hide','avoid'].includes(d.labels.collision),'invalid label collision policy');
      for(const key of ['fontSize','maxWidth','step'])if(d.labels[key]!=null)requireValue(Number.isFinite(d.labels[key])&&d.labels[key]>0,`labels.${key} must be positive`);
      if(d.labels.step!=null)requireValue(d.labels.step>=1,'labels.step must be at least 1 pixel');
      if(d.labels.maxOffset!=null)requireValue(Number.isFinite(d.labels.maxOffset)&&d.labels.maxOffset>=0&&d.labels.maxOffset<=1000,'labels.maxOffset must be within 0–1000 pixels');
      if(d.labels.priority!=null)requireValue(d.labels.priority&&typeof d.labels.priority==='object'&&!Array.isArray(d.labels.priority)&&Object.values(d.labels.priority).every(Number.isFinite),'label priorities must be finite');
    }
    if(d.logos!=null){
      requireValue(Array.isArray(d.logos),'logos must be an array');const seen=new Set();
      for(const logo of d.logos){
        object(logo,'logo');placement(logo,'logo');requireValue(typeof logo.id==='string'&&logo.id&&!seen.has(logo.id),'logo ids must be distinct');seen.add(logo.id);
        requireValue(typeof logo.alt==='string'&&logo.alt.length>0,'logo alt text is required');
        requireValue(finitePair(logo.position)&&[logo.width,logo.height].every(value=>Number.isFinite(value)&&value>0),'logo needs a finite rectangle');
        const match=typeof logo.href==='string'&&logo.href.length<=8*1024*1024&&logo.href.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/);
        requireValue(match,'logos must use embedded PNG/JPEG/WebP/GIF data');let bytes;try{bytes=atob(match[2]);}catch{requireValue(false,'invalid logo base64');}
        requireValue(match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):match[1]==='gif'?/^GIF8[79]a/.test(bytes):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP','logo bytes do not match their MIME type');
      }
    }
    for(const name of ['annotations','places'])if(d[name]!=null){
      requireValue(Array.isArray(d[name]),`${name} must be an array`);
      const seen=new Set();
      for(const [index,item] of d[name].entries()){
        object(item,name);placement(item,name);textOptions(item,name);
        if(item.id!=null)requireValue(typeof item.id==='string'&&item.id.length>0,`${name}.id must be a nonempty string`);
        const id=String(item.id??index);requireValue(!seen.has(id),`${name} ids must be distinct`);seen.add(id);
        for(const key of ['leader','marker'])if(item[key]!=null)requireValue(typeof item[key]==='boolean',`${name}.${key} must be boolean`);
        requireValue(typeof item.text==='string',`${name} text is required`);
        requireValue(item.region_id!=null||item.point!=null||item.position!=null,`${name} needs a region_id, point or position`);
        if(item.region_id!=null)requireValue(typeof item.region_id==='string'&&(!regions||regions.has(item.region_id)),`${name} references unknown region`);
        for(const key of ['point','position','offset'])if(item[key]!=null)requireValue(finitePair(item[key]),`${name}.${key} must be finite`);
      }
    }
    for(const name of ['title','subtitle','unit','source','watermark'])if(d[name]!=null&&typeof d[name]!=='boolean'&&typeof d[name]!=='string'){
      object(d[name],name);placement(d[name],name);textOptions(d[name],name);if(d[name].position!=null)requireValue(finitePair(d[name].position),`${name}.position must be finite`);
    }
    if(d.graticule?.step!=null)requireValue(finitePair(d.graticule.step)&&d.graticule.step.every(value=>value>=.25), 'graticule step must be at least 0.25 degrees');
    if(d.scalebar&&typeof d.scalebar==='object')placement(d.scalebar,'scalebar');
    if(d.scalebar?.distance!=null)requireValue(Number.isFinite(d.scalebar.distance)&&d.scalebar.distance>0,'scalebar distance must be positive');
    if(d.scalebar?.latitude!=null)requireValue(Number.isFinite(d.scalebar.latitude)&&Math.abs(d.scalebar.latitude)<85,'scalebar latitude must be within 85 degrees');
    if(d.scalebar?.position!=null)requireValue(finitePair(d.scalebar.position),'scalebar position must be finite');
  }
  if(spec.insets!=null){
    requireValue(Array.isArray(spec.insets),'insets must be an array');const seen=new Set();
    for(const inset of spec.insets){
      object(inset,'inset');requireValue(typeof inset.id==='string'&&inset.id.length>0&&!seen.has(inset.id),'inset ids must be distinct');seen.add(inset.id);
      requireValue([inset.x,inset.y,inset.width,inset.height].every(Number.isFinite)&&inset.width>0&&inset.height>0,'inset needs a finite rectangle with positive dimensions');
      if(inset.region_ids!=null)ids(inset.region_ids,'inset.region_ids');
      if(inset.layout?.type!=null)requireValue(['geographic','grid-square','grid-hex','dorling'].includes(inset.layout.type),'unsupported inset layout');
      if(inset.layout?.type==='dorling')validateDorlingOptions(inset.layout);
      if(inset.visible!=null)requireValue(typeof inset.visible==='boolean','inset.visible must be boolean');
      if(inset.padding!=null)requireValue(Number.isFinite(inset.padding)&&inset.padding>=0,'inset padding must be non-negative');
      if(inset.transform!=null)requireValue(Number.isFinite(inset.transform.zoom)&&inset.transform.zoom>0&&finitePair(inset.transform.pan),'invalid inset transform');
      if(inset.decorations!=null)validatePresentation({decorations:inset.decorations},geography);
    }
  }
}

const rawText = (value,x,y,options={},attributes='') => {
  const fontSize=Number.isFinite(options.fontSize)?options.fontSize:12,lines=options.lines??[String(value)];
  const body=lines.map((line,index)=>index===0?escapeSvg(line):`<tspan x="${x}" y="${y+index*fontSize*1.25}">${escapeSvg(line)}</tspan>`).join('');
  return `<text ${attributes} aria-label="${escapeSvg(value)}" x="${x}" y="${y}" font-family="${escapeSvg(options.fontFamily??'sans-serif')}" font-size="${fontSize}" fill="${escapeSvg(options.color??'#1f2937')}" text-anchor="${escapeSvg(options.anchor??'start')}"${options.opacity!=null&&Number.isFinite(options.opacity)?` opacity="${Math.max(0,Math.min(1,options.opacity))}"`:''}>${body}</text>`;
};
export function referenceSvg(geography,projection,spec) {
  if((spec.layout?.type??'geographic')!=='geographic'||spec.decorations?.reference===false)return '';
  const options=spec.decorations?.reference??{},theme=createPresentation(spec,geography).theme;
  return `<g data-map-references="true" pointer-events="none">${geography.features.features.filter(feature=>['reference','decoration','boundary'].includes(feature.properties?.role)).map(feature=>`<path data-feature-role="${escapeSvg(feature.properties.role)}"${feature.properties.role==='boundary'?` data-map-boundary="${escapeSvg(feature.id)}"`:''} d="${geometryPath(feature.geometry,projection)}" fill="${escapeSvg(options.fill??(feature.properties.role==='boundary'?theme.noData:'none'))}" fill-rule="evenodd" stroke="${escapeSvg(options.stroke??theme.border)}" stroke-width="${Number.isFinite(options.strokeWidth)?options.strokeWidth:.7}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
}
export function geographicBackgroundSvg(geography,projection,spec,layoutPositions=null) {
  const config=spec.decorations?.geographicBackground;
  if(!config)return '';
  const options=config===true?{}:config,fill=escapeSvg(options.fill??'#eef2f5'),stroke=escapeSvg(options.stroke??'#a7b0b8'),strokeWidth=Number.isFinite(options.strokeWidth)?options.strokeWidth:.6;
  const visible=new Set(viewRegionIds(geography,spec));let shapes='';
  // Dorling displaces symbols from their geographic anchors. Keep the actual
  // geographic shapes as the background in that layout so the symbols remain
  // comparable to the map instead of replacing the map with displaced cells.
  if(layoutPositions&&spec.layout?.type!=='dorling'){
    for(const [id,cell] of layoutPositions){
      if(!visible.has(id))continue;
      if(spec.layout?.type==='dorling')shapes+=`<circle data-region-background="${escapeSvg(id)}" cx="${cell.x}" cy="${cell.y}" r="${cell.surfaceRadius??spec.layout.radius??12}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      else if(cell.shape==='hexagon'){
        const points=Array.from({length:6},(_,index)=>`${cell.x+Math.cos(index*Math.PI/3)*cell.size/2},${cell.y+Math.sin(index*Math.PI/3)*cell.size/2}`).join(' ');
        shapes+=`<polygon data-region-background="${escapeSvg(id)}" points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }else shapes+=`<rect data-region-background="${escapeSvg(id)}" x="${cell.x-cell.size/2}" y="${cell.y-cell.size/2}" width="${cell.size}" height="${cell.size}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
  }else for(const feature of geography.features.features??[]){
    const id=feature.properties?.region_id;
    if(feature.properties?.role!=='region'||!visible.has(id))continue;
    if(feature.geometry?.type==='Point'){
      const [x,y]=projectPoint(feature.geometry.coordinates,projection);
      shapes+=`<circle data-region-background="${escapeSvg(id)}" cx="${x}" cy="${y}" r="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }else shapes+=`<path data-region-background="${escapeSvg(id)}" d="${geometryPath(feature.geometry,projection)}" fill-rule="evenodd" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke"/>`;
  }
  return `<g data-geographic-background="true" pointer-events="none">${shapes}</g>`;
}
export function graticuleSvg(geography,projection,spec) {
  const config=spec.decorations?.graticule,theme=createPresentation(spec,geography).theme;
  if(!config||geography.coordinate_space.type!=='geographic'||(spec.layout?.type??'geographic')!=='geographic')return '';
  const extent=bounds(geography,viewRegionIds(geography,spec));if(!extent)return '';
  const [[west,south],[east,north]]=extent,step=config.step??[10,10],paths=[];
  // Geographic range is explicitly bounded, even for resources crossing wraps.
  const w=Math.max(-180,west),e=Math.min(180,east),s=Math.max(-85,south),n=Math.min(85,north);
  const samples=(a,b,make)=>Array.from({length:65},(_,index)=>make(a+(b-a)*index/64));
  for(let x=Math.ceil(w/step[0])*step[0];x<=e;x+=step[0])paths.push(geometryPath({type:'LineString',coordinates:samples(s,n,y=>[x,y])},projection));
  for(let y=Math.ceil(s/step[1])*step[1];y<=n;y+=step[1])paths.push(geometryPath({type:'LineString',coordinates:samples(w,e,x=>[x,y])},projection));
  return `<g data-map-graticule="true" pointer-events="none" fill="none" stroke="${escapeSvg(config.color??theme.border)}" stroke-width="0.5">${paths.map(path=>`<path d="${path}"/>`).join('')}</g>`;
}
function prepareDecorationLayout({geography,spec,projection,viewport,views,layoutPositions,location,obstacles}) {
  const p=createPresentation(spec,geography),d=spec.decorations??{},items=[],diagnostics=[],markers=[];
  const add=(item,options={})=>items.push({...item,collision:options.collision??(options.position?'fixed':'avoid'),priority:options.priority??item.priority??0,order:items.length});
  const datasets=[...views.values()].map(view=>view.data);
  const source=datasets.flatMap(dataset=>dataset.sources??[]).map(value=>typeof value==='string'?value:p.label(value,value.url??value.id)).filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join('; ');
  const units=[...new Set(spec.layers.flatMap(layer=>channelBindings(layer.encoding,{includeException:false})).map(binding=>{const view=views.get(binding.dataset_id),series=view?.series.get(binding.series_id);return p.label(view?.data.units.find(unit=>unit.id===series?.unit_id));}).filter(Boolean))].join('; ');
  const sourceOptions=d.source&&typeof d.source==='object'?d.source:{},sourceSize=sourceOptions.fontSize??10,sourceValue=p.label(sourceOptions,typeof d.source==='string'?d.source:sourceOptions.text??source);
  const sourceLines=d.source?wrapText(sourceValue,sourceOptions.maxWidth??viewport.width-24,sourceSize):[];
  const sourceHeight=sourceLines.length?sourceSize+(sourceLines.length-1)*sourceSize*1.25:0;
  let titleBottom=26;
  const defaults={title:[p.label(spec,spec.title),12,26,20,100],subtitle:[spec.subtitle,12,48,14,90],source:[source,12,viewport.height-16,10,80],unit:[units,12,viewport.height-28-sourceHeight,11,70],watermark:['',viewport.width/2,viewport.height/2,36,-100]};
  for(const [kind,[fallback,x,y,fontSize,priority]] of Object.entries(defaults)){
    const setting=d[kind];if(setting===false||setting==null&&kind!=='title'&&kind!=='subtitle')continue;
    const options=setting&&typeof setting==='object'?setting:{},value=p.label(options,typeof setting==='string'?setting:options.text??fallback);
    if(!value)continue;
    const size=options.fontSize??fontSize,lines=wrapText(value,options.maxWidth??viewport.width-24,size),position=options.position??[x,kind==='source'?y-(lines.length-1)*size*1.25:kind==='subtitle'?titleBottom+22:y];
    const style={fontSize:size,...(kind==='watermark'?{opacity:.2,anchor:'middle'}:{}),...options,lines};
    add({id:kind,kind,shape:'text',value,x:position[0],y:position[1],style,bounds:decorationTextBox(lines,...position,size,style.anchor),priority,reserve:kind!=='watermark',...(!options.position&&kind==='subtitle'?{after:'title'}:{}),...(!options.position&&kind==='unit'&&d.source?{before:'source'}:{})},options);
    if(kind==='title')titleBottom=position[1]+(lines.length-1)*size*1.25;
  }
  for(const logo of d.logos??[]){const [x,y]=logo.position;add({id:'logo:'+logo.id,kind:'logo',shape:'logo',logo,x,y,bounds:{x,y,width:logo.width,height:logo.height},priority:60},logo);}
  const visible=new Set(viewRegionIds(geography,spec));
  for(const kind of ['places','annotations'])for(const [index,item] of (d[kind]??[]).entries()){
    if(item.region_id&&!visible.has(item.region_id))continue;
    const id=kind+':'+(item.id??index);
    if(!item.position&&item.point&&layoutPositions){diagnostics.push({code:'DECORATION_POINT_UNAVAILABLE',decoration_id:id,kind});continue;}
    const point=item.position??(item.point?projectPoint(item.point,projection):location(item.region_id));
    if(!point){diagnostics.push({code:'MISSING_DECORATION_ANCHOR',decoration_id:id,kind,region_id:item.region_id});continue;}
    const offset=item.offset??[0,0],x=point[0]+offset[0],y=point[1]+offset[1],size=item.fontSize??12,value=p.label(item,item.text),lines=wrapText(value,item.maxWidth??Math.max(20,Math.min(240,viewport.width-24)),size),marker=kind==='places'||item.marker;
    if(marker)markers.push({x:point[0]-3,y:point[1]-3,width:6,height:6});
    add({id,kind,shape:'annotation',value,x,y,style:{...item,fontSize:size,lines},bounds:decorationTextBox(lines,x,y,size,item.anchor),priority:10,point,marker,leader:item.leader},item);
  }
  if(d.scalebar){
    const config=d.scalebar===true?{}:d.scalebar,geographic=geography.coordinate_space.type==='geographic',unit=geography.coordinate_space.units;
    const physical={m:1,metre:1,meter:1,km:1000,kilometre:1000,kilometer:1000}[unit];
    if((spec.layout?.type??'geographic')!=='geographic'||!geographic&&!physical||geographic&&!['equirectangular','mercator'].includes(projection.type))diagnostics.push({code:'SCALEBAR_UNAVAILABLE',message:'A physical scale is unavailable for this layout or coordinate system.'});
    else {
      const latitude=config.latitude??Math.max(-84.99,Math.min(84.99,projection.center[1]));
      const distancePerPixel=geographic?(projection.type==='mercator'?6371008.8:6371008.8*Math.PI/180)*Math.cos(latitude*Math.PI/180)/projection.scale:physical/projection.scale;
      const target=distancePerPixel*100,exponent=10**Math.floor(Math.log10(target)),nice=[1,2,5,10].map(value=>value*exponent).reduce((best,value)=>Math.abs(value-target)<Math.abs(best-target)?value:best),distance=config.distance??nice;
      const length=distance/distancePerPixel,[x,y]=config.position??[viewport.width-length-20,viewport.height-24],value=distance>=1000?`${p.number(distance/1000,{style:'decimal'})} km`:`${p.number(distance,{style:'decimal'})} m`;
      const label=decorationTextBox([value],x+length/2,y-9,10,'middle'),left=Math.min(x-1,label.x),top=Math.min(y-6,label.y),right=Math.max(x+length+1,label.x+label.width),bottom=Math.max(y+1,label.y+label.height);
      const description=geographic?p.t('scaleAt',{latitude:p.number(latitude,{style:'decimal',minimumFractionDigits:2,maximumFractionDigits:2,maximumSignificantDigits:undefined})}):p.t('physicalScale');
      add({id:'scalebar',kind:'scalebar',shape:'scale',x,y,value,length,distance,distancePerPixel,description,bounds:{x:left,y:top,width:right-left,height:bottom-top},priority:50},config);
    }
  }
  const {padding,gap,collision}=d.layout??{};
  const layout=layoutDecorationBoxes(items,{width:viewport.width,height:viewport.height,obstacles:[...obstacles,...markers],padding,gap,collision});
  layout.markers=markers;layout.diagnostics.unshift(...diagnostics);return layout;
}

export function decorationSvg({geography,spec,projection,viewport,views,layoutPositions,obstacles=[],selection=[],anchorResolution,preparedLayout}) {
  const p=createPresentation(spec,geography),{theme}=p,text=(value,x,y,options={},attributes='')=>rawText(value,x,y,{color:theme.text,fontFamily:theme.fontFamily,...options},attributes);
  const d=spec.decorations??{},visible=new Set(viewRegionIds(geography,spec));let svg='';const diagnostics=[],reserved=[...obstacles],labelCandidates=[];
  const resolved=anchorResolution??resolveAnchors(geography,{role:'label',policy:spec.anchor_policy,regionIds:[...visible]}),anchors=new Map([...resolved.anchors].map(([id,a])=>[id,a.point]));
  const location=id=>{const cell=layoutPositions?.get(id);return cell?[cell.x,cell.y]:anchors.has(id)?projectPoint(anchors.get(id),projection):null;};
  if(d.labels){const options=d.labels===true?{}:d.labels,ids=new Set(options.region_ids??visible),offset=options.offset??[0,0],selected=new Set(selection);
    for(const region of geography.regions)if(visible.has(region.id)&&ids.has(region.id)){
      const point=location(region.id),fontSize=options.fontSize??12,value=options.text?.[region.id]??p.label(region,region.id);
      if(!point){diagnostics.push({code:'MISSING_LABEL_ANCHOR',region_id:region.id,reason:resolved.diagnostics.find(item=>item.region_id===region.id)?.reason??'unplaced-layout'});continue;}
      labelCandidates.push({id:region.id,text:value,lines:wrapText(value,options.maxWidth??Math.min(120,viewport.width-8),fontSize),fontSize,anchor:options.anchor??'middle',x:point[0]+offset[0],y:point[1]+offset[1],priority:(options.priority?.[region.id]??0)+(selected.has(region.id)?1000:0),point});
    }
  }
  const layout=preparedLayout??prepareDecorationLayout({geography,spec,projection,viewport,views,layoutPositions,location,obstacles});
  diagnostics.push(...layout.diagnostics);
  for(const item of layout.items){
    const x=item.x+item.dx,y=item.y+item.dy;
    if(item.shape==='logo')svg+=`<image data-map-logo="${escapeSvg(item.logo.id)}" role="img" aria-label="${escapeSvg(p.label(item.logo,item.logo.alt))}" x="${x}" y="${y}" width="${item.logo.width}" height="${item.logo.height}" href="${escapeSvg(item.logo.href)}"><title>${escapeSvg(p.label(item.logo,item.logo.alt))}</title></image>`;
    else if(item.shape==='scale')svg+=`<g data-map-scalebar="true" transform="translate(${item.dx} ${item.dy})"><title>${escapeSvg(item.description)}</title><path d="M${item.x},${item.y-5}v5h${item.length}v-5" fill="none" stroke="${theme.text}"/>${text(item.value,item.x+item.length/2,item.y-9,{anchor:'middle',fontSize:10})}</g>`;
    else {
      if(item.shape==='annotation'){
        if(item.marker)svg+=`<circle data-decoration-marker="${escapeSvg(item.id)}" cx="${item.point[0]}" cy="${item.point[1]}" r="3" fill="${escapeSvg(item.style.color??theme.text)}"/>`;
        if(item.leader!==false&&(item.displaced||item.leader&&item.point.some((value,index)=>value!==[x,y][index])))svg+=`<path data-decoration-leader="${escapeSvg(item.id)}" d="M${item.point.join(',')}L${x},${y}" fill="none" stroke="${theme.mutedText}"/>`;
      }
      svg+=text(item.value,x,y,item.style,`data-map-${item.kind}="true" data-decoration-id="${escapeSvg(item.id)}"`);
    }
  }
  for(const box of [...layout.markers,...layout.items.filter(item=>item.reserve!==false).map(item=>item.bounds)])if(!reserved.includes(box))reserved.push(box);
  const labelOptions=d.labels===true?{}:d.labels??{};
  const placed=placeLabels(labelCandidates,{width:viewport.width,height:viewport.height,obstacles:reserved,mode:labelOptions.collision??'avoid',maxOffset:labelOptions.maxOffset??40,step:labelOptions.step??10});
  for(const label of placed.values()){
    if(!label.visible){diagnostics.push({code:'LABEL_COLLISION',region_id:label.id});continue;}
    if(label.displaced&&labelOptions.leader!==false)svg+=`<path data-label-leader="${escapeSvg(label.id)}" d="M${label.point.join(',')}L${label.x},${label.y}" fill="none" stroke="${theme.mutedText}" pointer-events="none"/>`;
    svg+=text(label.text,label.x,label.y,{...labelOptions,fontSize:label.fontSize,anchor:label.anchor,lines:label.lines},`data-map-label="${escapeSvg(label.id)}"`);
  }
  return {anchors:[...resolved.anchors.values()],labels:[...placed.values()],layout,obstacles:reserved,svg:`<g data-map-decorations="true" direction="ltr" pointer-events="none">${svg}</g>`,diagnostics};
}

export function selectionSvg(geography,projection,selection,spec,positions,options={}) {
  const theme=createPresentation(spec,geography).theme;
  const ids=new Set(viewRegionIds(geography,spec)),selected=new Set(selection);let paths='';
  if(positions){for(const [id,p] of positions)if(ids.has(id)&&selected.has(id)){
    const attrs=`data-selection-region-id="${escapeSvg(id)}"`;
    if(p.radius!=null)paths+=`<circle ${attrs} cx="${p.x}" cy="${p.y}" r="${p.radius}"/>`;
    else if(p.shape==='hexagon')paths+=`<polygon ${attrs} points="${Array.from({length:6},(_,i)=>[p.x+Math.cos(i*Math.PI/3)*p.size/2,p.y+Math.sin(i*Math.PI/3)*p.size/2].join(',')).join(' ')}"/>`;
    else paths+=`<rect ${attrs} x="${p.x-p.size/2}" y="${p.y-p.size/2}" width="${p.size}" height="${p.size}"/>`;
  }}else {
    const drawn=new Set();
    for(const feature of geography.features.features)if(feature.properties?.role==='region'&&ids.has(feature.properties.region_id)&&selected.has(feature.properties.region_id)&&geometryHasCoordinates(feature.geometry)){
      drawn.add(feature.properties.region_id);paths+=`<path data-selection-region-id="${escapeSvg(feature.properties.region_id)}" d="${geometryPath(feature.geometry,projection)}"/>`;
    }
    const unresolved=[...selected].filter(id=>ids.has(id)&&!drawn.has(id));
    if(unresolved.length)for(const [id,anchor] of resolveAnchors(geography,{policy:spec.anchor_policy,regionIds:unresolved}).anchors){const [x,y]=projectPoint(anchor.point,projection);paths+=`<circle data-selection-region-id="${escapeSvg(id)}" cx="${x}" cy="${y}" r="8"/>`;}
  }
  return `<g ${options.hover?'data-map-hover':'data-map-selection'}="true" fill="none" stroke="${options.hover?theme.hover:theme.selection}" stroke-width="2.5" pointer-events="none" vector-effect="non-scaling-stroke">${paths}</g>`;
}
