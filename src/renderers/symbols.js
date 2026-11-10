import { symbolRadius } from './math.js';
import { StatsMapError } from '../core/errors.js';
import { compileSvgPath } from './svg-path.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const SYMBOL_SHAPES=['circle','bar','square','star','diamond','wye','cross','triangle','spike','custom'];

function customShape(options) {
  const shape=options.customShape,box=shape?.viewBox;
  if(!shape||!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[2]<=0||box[3]<=0)throw new StatsMapError('customShape requires a numeric viewBox and closed SVG path data','INVALID_ENCODING');
  return {...shape,...compileSvgPath(shape.path,{closed:true})};
}
function customGeometry(shape,r) {
  const [bx,by,width,height]=shape.viewBox,scale=r/Math.max(width,height)*2,cx=bx+width/2,cy=by+height/2;
  const offset=(value,center)=>{const result=(value-center)*scale;return Number.isFinite(result)?result:value*scale-center*scale;};
  const {minX,minY,maxX,maxY}=shape.bounds,dx=Math.max(Math.abs(offset(minX,cx)),Math.abs(offset(maxX,cx))),dy=Math.max(Math.abs(offset(minY,cy)),Math.abs(offset(maxY,cy))),radius=Math.hypot(dx,dy);
  if(![scale,cx,cy,radius].every(Number.isFinite))throw new StatsMapError('customShape transformed bounds exceed the finite range','INVALID_ENCODING');
  return {scale,cx,cy,radius};
}

// The same scale and geometry are used on the map and in the size legend.
export function symbolScale(numbers,options={}) {
  const shape=options.shape??'circle',maxRadius=options.maxRadius??options.scale??20,minRadius=options.minRadius??0;
  const mode=['bar','spike'].includes(shape)?'height':(options.scaleMode??'area');
  const halfWidth=options.width??options.barWidth??maxRadius;
  if(!SYMBOL_SHAPES.includes(shape))throw new StatsMapError(`unsupported symbol shape: ${shape}`,'UNSUPPORTED_SYMBOL');
  if(shape==='custom')customGeometry(customShape(options),maxRadius);
  if(!['area','height'].includes(mode)||!Number.isFinite(maxRadius)||maxRadius<0||!Number.isFinite(minRadius)||minRadius<0||minRadius>maxRadius||!Number.isFinite(halfWidth)||halfWidth<0)throw new StatsMapError('invalid symbol scale','INVALID_ENCODING');
  validateSymbolStyle(options);
  const valid=numbers.filter(Number.isFinite);
  if(valid.some(value=>value<0))throw new StatsMapError('symbol size cannot encode a negative value','UNSUPPORTED_VALUE');
  const maximum=options.maxValue??valid.reduce((max,value)=>Math.max(max,value),0);
  if(!Number.isFinite(maximum)||maximum<0)throw new StatsMapError('symbol maxValue must be non-negative','INVALID_ENCODING');
  // Fixed-width shapes encode both height and area linearly in their height.
  const area=mode==='area';
  symbolCollisionRadius(shape,maxRadius,options);
  return {shape,mode,maximum,maxRadius,minRadius,halfWidth,radius:value=>{
    const r=symbolRadius(value,maximum,maxRadius,{area});
    return r==null||value===0||maximum===0?r:Math.max(minRadius,r);
  }};
}

function validateSymbolStyle(options) {
  for(const key of ['fillOpacity','strokeOpacity'])if(options[key]!==undefined&&(!Number.isFinite(options[key])||options[key]<0||options[key]>1))throw new StatsMapError(`symbol ${key} must be between 0 and 1`,'INVALID_ENCODING');
  for(const key of ['strokeWidth','spikeWidth'])if(options[key]!==undefined&&(!Number.isFinite(options[key])||options[key]<0))throw new StatsMapError(`symbol ${key} must be non-negative`,'INVALID_ENCODING');
  if(options.offset!==undefined&&(!options.offset||typeof options.offset!=='object'||Array.isArray(options.offset)||![options.offset.x,options.offset.y].every(Number.isFinite)))throw new StatsMapError('symbol offset requires finite x and y factors','INVALID_ENCODING');
}
function symbolOffset(r,options) {
  const dx=(options.offset?.x??0)*r,dy=(options.offset?.y??0)*r;
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new StatsMapError('symbol offset exceeds the finite range','INVALID_ENCODING');
  return [dx,dy];
}
const symbolWidth=options=>options.width??options.barWidth??options.maxRadius??options.scale??20;
const spikeHalfWidth=options=>options.spikeWidth===undefined?symbolWidth(options)*.55:options.spikeWidth/2;

export function symbolShapeSvg(shape,x,y,r,options={},attributes='') {
  validateSymbolStyle(options);
  const [dx,dy]=symbolOffset(r,options);x+=dx;y+=dy;
  const fill=esc(options.fill??'#67a9cf'),stroke=esc(options.stroke??'#222');
  const attrs=`${attributes} fill="${fill}" fill-opacity="${esc(options.fillOpacity??'.75')}" stroke="${stroke}" stroke-width="${options.strokeWidth??1}" stroke-opacity="${options.strokeOpacity??1}" stroke-linejoin="round"`;
  if(shape==='circle')return `<circle ${attrs} cx="${x}" cy="${y}" r="${r}"/>`;
  if(shape==='custom'){
    const custom=customShape(options),{scale,cx,cy}=customGeometry(custom,r);
    return `<path ${attrs} d="${esc(custom.path)}" transform="translate(${x} ${y}) scale(${scale}) translate(${-cx} ${-cy})" vector-effect="non-scaling-stroke"/>`;
  }
  const w=symbolWidth(options);
  if(shape==='bar')return `<rect ${attrs} x="${x-w}" y="${y-r}" width="${w*2}" height="${2*r}"/>`;
  let points;
  if(shape==='square')points=[[-r,-r],[r,-r],[r,r],[-r,r]];
  else if(shape==='diamond')points=[[0,-r],[r,0],[0,r],[-r,0]];
  else if(shape==='triangle')points=[[0,-r],[r*.9,r],[-r*.9,r]];
  else if(shape==='spike')points=[[0,-r],[spikeHalfWidth(options),r],[-spikeHalfWidth(options),r]];
  else if(shape==='wye')points=[[-.3,-1],[.3,-1],[.3,-.173205],[1.016025,.240192],[.716025,.759808],[0,.34641],[-.716025,.759808],[-1.016025,.240192],[-.3,-.173205]].map(([a,b])=>[a*r,b*r]);
  else if(shape==='cross')points=[[-.35,-1],[.35,-1],[.35,-.35],[1,-.35],[1,.35],[.35,.35],[.35,1],[-.35,1],[-.35,.35],[-1,.35],[-1,-.35],[-.35,-.35]].map(([a,b])=>[a*r,b*r]);
  else if(shape==='star')points=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,q=i%2?r*.42:r;return [Math.cos(a)*q,Math.sin(a)*q];});
  else throw new StatsMapError(`unsupported symbol shape: ${shape}`,'UNSUPPORTED_SYMBOL');
  return `<polygon ${attrs} points="${points.map(([dx,dy])=>`${x+dx},${y+dy}`).join(' ')}"/>`;
}

// Conservative circles around actual glyph bounds. Custom path extrema may
// extend beyond the declared viewBox, which controls scaling only.
export function symbolCollisionRadius(shape,r,options={}) {
  if(r==null)return 0;
  validateSymbolStyle(options);
  const width=symbolWidth(options),[dx,dy]=symbolOffset(r,options);
  let radius=r;
  if(shape==='custom')radius=customGeometry(customShape(options),r).radius;
  else if(shape==='bar')radius=Math.hypot(width,r);
  else if(shape==='spike')radius=Math.hypot(spikeHalfWidth(options),r);
  else if(['square','cross'].includes(shape))radius=Math.SQRT2*r;
  else if(shape==='triangle')radius=Math.hypot(.9,1)*r;
  else if(shape==='wye')radius=Math.hypot(1.016025,.240192)*r;
  // Round joins bound the stroke by half its width, including custom paths.
  radius+=Math.hypot(dx,dy)+(options.stroke==='none'||options.strokeOpacity===0?0:(options.strokeWidth??1)/2);
  if(!Number.isFinite(radius))throw new StatsMapError('symbol bounds exceed the finite range','INVALID_ENCODING');
  return radius;
}

export function assertComparablePair(view,ids) {
  if(ids.length!==2)throw new StatsMapError('mushroom requires two numeric series','INVALID_ENCODING');
  const series=ids.map(id=>view.series.get(id));
  if(series.some(s=>!s)||ids.some(id=>view.metricForSeries(id).value_type!=='number'))throw new StatsMapError('mushroom requires two numeric series','INVALID_ENCODING');
  if(['unit_id','scope_id','measure_type','review_status'].some(key=>series[0][key]!==series[1][key]))throw new StatsMapError('mushroom channels require a common unit, scope and measure/review status','INCOMPARABLE_COMPONENTS');
}

export function mushroomShapeSvg(x,y,radii,options={},attributes='') {
  const orientation=options.orientation??'horizontal';
  if(!['horizontal','vertical'].includes(orientation))throw new StatsMapError('unsupported mushroom orientation','INVALID_ENCODING');
  const colors=options.colors??['#2166ac','#ef8a62'];
  let out='';
  radii.forEach((r,i)=>{
    if(r==null)return;
    const angle=(orientation==='horizontal'?-Math.PI/2:-Math.PI)+i*Math.PI;
    const a=[x+Math.cos(angle)*r,y+Math.sin(angle)*r],b=[x+Math.cos(angle+Math.PI)*r,y+Math.sin(angle+Math.PI)*r];
    const component=options.components?.[i];
    out+=`<path ${attributes} data-component-index="${i}" data-radius="${r}" d="M${x},${y}L${a}A${r},${r} 0 0,1 ${b}Z"${component?` data-series-id="${esc(component.id)}" data-value="${component.value}" data-period-id="${esc(component.period)}"`:''} fill="${esc(colors[i])}" stroke="${esc(options.stroke??'#222')}"/>`;
  });
  if(radii.some(r=>r==null))out+=`<circle ${attributes} data-status="incomplete" cx="${x}" cy="${y}" r="2.5" fill="#e5e7eb" stroke="#555"/>`;
  return out;
}
