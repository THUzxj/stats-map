import { viewRegionIds } from '../core/view.js';
import { StatsMapError } from '../core/errors.js';
import { ternaryColor, ternaryPosition } from './math.js';
import { compositionFor } from './composition.js';

const sextantColors=['#ffff00','#b3dcc3','#01a0c6','#b8b3d8','#f11d8c','#ffb3b3'];
function hclHex(hue,chroma,lightness) {
  const angle=hue*Math.PI/180,a=chroma*Math.cos(angle),b=chroma*Math.sin(angle),fy=(lightness+16)/116;
  const inverse=t=>t>6/29?t**3:3*(6/29)**2*(t-4/29);
  const x=.95047*inverse(fy+a/500),y=inverse(fy),z=1.08883*inverse(fy-b/200);
  const rgb=[3.2406*x-1.5372*y-.4986*z,-.9689*x+1.8758*y+.0415*z,.0557*x-.204*y+1.057*z];
  return '#'+rgb.map(value=>Math.round(255*Math.max(0,Math.min(1,value<=.0031308?12.92*value:1.055*value**(1/2.4)-.055))).toString(16).padStart(2,'0')).join('');
}

export function ternaryScale(compositions=[],options={}) {
  const points=compositions.map(ternaryPosition).filter(Boolean).map(point=>[point.a,point.b,point.c]);
  let center=[1/3,1/3,1/3];
  if(options.resolvedCenter!=null){
    const value=options.resolvedCenter;
    if(!Array.isArray(value)||value.length!==3||!value.every(number=>Number.isFinite(number)&&number>0)||Math.abs(value.reduce((sum,number)=>sum+number,0)-1)>1e-9)throw new StatsMapError('resolvedCenter must be three positive normalized weights','INVALID_ENCODING');
    center=[...value];
  }else if(options.meanCentering&&points.length){
    const means=[0,1,2].map(index=>{const positive=points.map(point=>point[index]).filter(value=>value>0);return positive.length?Math.exp(positive.reduce((sum,value)=>sum+Math.log(value),0)/positive.length):0;});
    const sum=means.reduce((sum,value)=>sum+value,0);
    if(sum>0)center=means.map(value=>Math.max(value/sum,1e-12));
  }
  const mode=options.mode??(options.sextant?'sextant':'ternary'),spread=options.spread??1;
  if(!['ternary','sextant'].includes(mode)||!Number.isFinite(spread)||spread<=0)throw new StatsMapError('invalid ternary mode or spread','INVALID_ENCODING');
  const colors=options.sextantColors??sextantColors;
  if(colors.length!==6||colors.some(color=>!/^#[\da-f]{6}$/i.test(color)))throw new StatsMapError('sextant requires six hex colors','INVALID_COLOR');
  const classify=values=>{
    const point=ternaryPosition(values);if(!point)return null;
    const above=[point.a,point.b,point.c].map((value,index)=>value>center[index]+1e-12);
    const flags=(above[0]?4:0)+(above[1]?2:0)+(above[2]?1:0);
    return ({4:0,6:1,2:2,3:3,1:4,5:5})[flags]??'center';
  };
  const color=values=>{
    const point=ternaryPosition(values);if(!point)return null;
    if(mode==='sextant'){const cls=classify(values);return cls==='center'?(options.centerColor??'#f5f5f5'):colors[cls];}
    const relative=[point.a,point.b,point.c].map((value,index)=>(value/center[index])**spread),sum=relative.reduce((sum,value)=>sum+value,0),weights=relative.map(value=>value/sum);
    if(options.colorMode!=='hcl'&&['hue','chroma','lightness','contrast'].every(key=>options[key]==null))return ternaryColor(weights,options.colors);
    const hue=options.hue??80,chroma=options.chroma??140,lightness=options.lightness??80,contrast=options.contrast??.4;
    if(![hue,chroma,lightness,contrast].every(Number.isFinite)||chroma<0||lightness<0||lightness>100||contrast<0||contrast>1)throw new StatsMapError('invalid ternary color parameters','INVALID_COLOR');
    const vector=weights.reduce((vector,weight,index)=>{const angle=(hue+index*120)*Math.PI/180;return [vector[0]+weight*chroma*Math.cos(angle),vector[1]+weight*chroma*Math.sin(angle)];},[0,0]);
    const magnitude=Math.hypot(...vector),factor=1-contrast+(chroma?magnitude/chroma:0)*contrast;
    return hclHex(Math.atan2(vector[1],vector[0])*180/Math.PI,magnitude*factor,lightness*factor);
  };
  return {mode,center,colors,classify,color};
}

export function ternaryModel(ids,view,spec={},options={}) {
  if(ids.length!==3)throw new StatsMapError('ternary requires three component series','INVALID_ENCODING');
  const regionIds=viewRegionIds(view.geography,spec),period=spec.view?.period_id;
  const values=new Map(regionIds.map(id=>{
    const composition=compositionFor(ids,view,id,period,{},spec.aggregation);
    return [id,composition.complete&&!composition.conflict?composition.values.map(value=>value.value):null];
  }));
  const scale=ternaryScale([...values.values()].filter(Boolean),options);
  return {...scale,values,missing:[...values.values()].some(values=>!values||!ternaryPosition(values))};
}
