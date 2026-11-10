import { wrapText, textWidth } from './text-layout.js';
import { rankingNumber, rankingScale, validateRankingOptions } from './ranking-options.js';

// One drawing plan drives both measurement and SVG. Names and numeric labels
// occupy separate columns, above each bar, so long text cannot cross a glyph.
export function rankingLayout(model,options,p) {
  validateRankingOptions(options);
  const padding=options.boxPadding??7,size=options.labelFontSize??11,width=Math.max(options.width??220,2*padding+size*6),inner=width-2*padding,gap=6;
  const elements=[],rows=[];let cursor=padding;
  function text(value,x=padding,maxWidth=inner,fontSize=size,attributes={}) {
    const lines=wrapText(value,maxWidth,fontSize),height=fontSize*1.5+(lines.length-1)*fontSize*1.25;
    const element={type:'text',value,lines,x,y:cursor+fontSize*1.1,fontSize,height,...attributes};elements.push(element);return element;
  }
  for(const [key,fontSize] of [['title',size*1.3],['subtitle',size]])if(options[key]){const el=text(options[key],padding,inner,fontSize,{kind:key});cursor+=el.height+gap;}
  if(!model.available){const el=text(model.reason);cursor+=el.height;}
  else {
    const context=[p.label(model.unit),model.periodLabel].filter(Boolean).join(' / ');
    if(context){const el=text(context,padding,inner,size,{kind:'context'});cursor+=el.height+gap;}
    const scale=rankingScale(model.rows),countMax=model.bins.reduce((max,bin)=>Math.max(max,bin.count),0)||1;
    const entries=model.mode==='histogram'?model.bins:model.rows;
    for(const entry of entries){
      const bin=model.mode==='histogram',value=bin?p.number(entry.count,{maximumSignificantDigits:undefined,maximumFractionDigits:0}):rankingNumber(p,entry.value,options);
      const name=bin?(entry.lower===entry.upper?rankingNumber(p,entry.lower,options):`${rankingNumber(p,entry.lower,options)} ≤ x ${entry.upperInclusive?'≤':'<'} ${rankingNumber(p,entry.upper,options)}`):`${p.number(entry.rank)}. ${entry.label}`;
      const valueWidth=Math.min(inner*.45,Math.max(size*2,textWidth(value,size)+size*.3)),labelWidth=Math.max(8,inner-valueWidth-gap),top=cursor;
      const label=text(name,padding,labelWidth,size,{kind:bin?'interval':'label'}),numeric=text(value,padding+inner-valueWidth,valueWidth,size,{kind:bin?'count':'value'});
      cursor+=Math.max(label.height,numeric.height)+2;
      const barHeight=options.shapeHeight??10,zero=bin?0:scale.zero,end=bin?entry.count/countMax:scale.position(entry.value);
      const bar={type:'bar',x:padding+Math.min(zero,end)*inner,y:cursor,width:Math.abs(end-zero)*inner,height:barHeight,zero:padding+zero*inner,entry};
      cursor+=barHeight+gap;cursor=Math.max(cursor,top+(options.rowHeight??24));
      rows.push({entry,bin,label,numeric,bar,bounds:{x:padding,y:top,width:inner,height:cursor-top},name,value});
    }
    if(model.mode==='histogram'){const el=text(p.t('rankingDistribution'),padding,inner,size,{kind:'distribution'});cursor+=el.height+gap;}
    const note=`${options.missingLabel??p.t('rankingMissing')}: ${p.number(model.missing.length)}${model.hidden?`; ${options.hiddenLabel??p.t('hiddenRanking')}: ${p.number(model.hidden)}`:''}`;
    const el=text(note,padding,inner,size,{kind:'missing'});cursor+=el.height;
  }
  const naturalHeight=cursor+padding,scale=options.height==null?1:Math.min(1,options.height/naturalHeight),height=naturalHeight*scale;
  return {width,height,naturalHeight,scale,padding,elements,rows};
}
