import { wrapText, textBox } from './text-layout.js';
import { symbolCollisionRadius, symbolShapeSvg, mushroomShapeSvg } from '../renderers/symbols.js';
import { legendItemKey } from '../core/legend-filter.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const types=new Set(['bivariate','ternary','alpha','size','mushroom','time','composition']);

// The same explicit plan measures and draws specialized legends. Glyph sizes
// are statistical encodings; extra space is reserved instead of scaling them.
export function specializedLegendLayout(legend,width,p) {
  if(!types.has(legend.type)||legend.type==='composition'&&!legend.sizeLegend)return null;
  let actualWidth=['bivariate','ternary'].includes(legend.type)?Math.max(96,width):width;
  const elements=[],boxes=[];
  const text=(value,x,y,size=10,maxWidth=actualWidth-12,anchor='start')=>{
    const lines=wrapText(value,maxWidth,size),box=textBox(lines,x,y,size,anchor);
    elements.push({type:'text',value,lines,x,y,size,anchor});boxes.push(box);
    return Math.max(size*1.25,lines.length*size*1.25);
  };
  const rect=(x,y,w,h,color,extra={})=>{elements.push({type:'rect',x,y,width:w,height:h,color,...extra});boxes.push({x,y,width:w,height:h});};
  const rows=(items,start,x=0,rowWidth=actualWidth-12)=>{
    let y=start;
    for(const item of items){
      const first=elements.length;
      rect(x,y,12,12,item.color,{key:item.key,label:item.label});
      const height=text(item.label,x+18,y+10,10,rowWidth-18);
      if(legend.type==='composition'){
        const category=elements.splice(first);
        elements.push({type:'category',key:item.key,label:item.label,elements:category});
      }
      y+=Math.max(18,height+4);
    }
    return y;
  };
  let height=0;
  if(legend.type==='size'||legend.type==='mushroom'){
    const bounds=legend.marks.map(mark=>legend.type==='mushroom'?mark.radius:symbolCollisionRadius(legend.shape,mark.radius,legend.options));
    const extent=Math.max(0,...bounds),cx=Math.max(30,extent+2),labelX=Math.max(60,cx+extent+10);
    actualWidth=Math.max(width,labelX+48+12);
    const header=`${legend.color?p.t('size')+': '+legend.label+' / ':''}${legend.type==='mushroom'?'mushroom':legend.shape} / ${p.t(legend.mode==='area'?'area':'height')}${legend.unit?' ('+legend.unit+')':''}`;
    let y=10+text(header,0,10,10);
    if(legend.minRadius>0)y+=text(`${p.t('minimumSymbolSize')}: ${p.number(legend.minRadius)} px`,0,y,10)+5;
    for(const [index,mark] of legend.marks.entries()){
      const radius=bounds[index],cy=Math.max(index===0?40:0,y+radius+2);
      elements.push({type:legend.type==='mushroom'?'mushroom':'symbol',x:cx,y:cy,radius:mark.radius});
      boxes.push({x:cx-radius,y:cy-radius,width:radius*2,height:radius*2});
      const h=text(p.number(mark.value),labelX,cy+4,10,actualWidth-labelX-12);
      y=Math.max(cy+radius+8,cy+4+h+4,index===0?64:0);
    }
    height=rows(legend.components??[],y);
    if(legend.color){
      const color=legend.color;let y=height+14;
      y+=text(`${p.t('color')}: ${color.label}${color.unit?' ('+color.unit+')':''}`,0,y,10)+5;
      y=rows(color.items.map(item=>({...item,key:legendItemKey(color,item)})),y);
      if(color.missing)y=rows([{key:'missing',label:`${p.t('color')}: ${p.t('missing')}`,color:color.missingColor}],y);
      height=y;
    }
  }else if(legend.type==='composition'){
    const {marks,title}=legend.sizeLegend,extent=Math.max(0,...marks.map(mark=>mark.radius)),cx=extent+2,labelX=cx+extent+10;
    actualWidth=Math.max(width,labelX+60);
    let y=rows(legend.items.map(item=>({...item,key:legendItemKey(legend,item)})),0);
    for(const note of legend.notes??[])y+=text(note,0,y+10)+5;
    y+=text(`${title}${legend.unit?' ('+legend.unit+')':''}`,0,y+12)+7;
    y+=text(p.t('compositionSizeReference'),0,y+10)+7;
    for(const mark of marks){
      const cy=y+mark.radius+2;
      elements.push({type:'composition',x:cx,y:cy,mark});
      boxes.push({x:cx-mark.radius,y:cy-mark.radius,width:mark.radius*2,height:mark.radius*2});
      const h=text(p.number(mark.value),labelX,cy+4,10,actualWidth-labelX-12);
      y=Math.max(cy+mark.radius+8,cy+4+h+4);
    }
    height=y;
  }else if(legend.type==='bivariate'){
    const [axisX,axisY]=legend.axes,nx=axisX.items.length,ny=axisY.items.length;
    const cell=Math.min(24,(actualWidth-48)/Math.max(1,nx)),left=20,top=14;
    for(const item of legend.cells){
      const label=`${axisX.label??'X'}: ${axisX.items[item.x].label} / ${axisY.label??'Y'}: ${axisY.items[item.y].label}`;
      rect(left+item.x*cell,top+(ny-1-item.y)*cell,cell-2,cell-2,item.color,{key:`bivariate:${item.x}:${item.y}`,label,xClass:item.x,yClass:item.y});
    }
    for(let i=0;i<nx;i++)text('X'+(i+1),left+i*cell+cell/2,top+ny*cell+12,9,cell,'middle');
    for(let i=0;i<ny;i++)text('Y'+(i+1),left-3,top+(ny-1-i)*cell+cell/2+3,9,17,'end');
    let y=top+ny*cell+30;
    for(const [index,axis] of legend.axes.entries()){
      const name=index?'Y':'X',label=axis.label??p.t('indicator',{index:index+1});
      y+=text(`${name}: ${label}${axis.unit?' ('+axis.unit+')':''}`,0,y,10)+3;
      for(const [i,item] of axis.items.entries())y+=text(`${name}${i+1}: ${item.label}`,0,y,10)+3;
      y+=5;
    }
    height=y;
  }else if(legend.type==='ternary'){
    const r=Math.min(48,(actualWidth-28)/2),cx=14+r,cy=14+Math.sqrt(3)*r;
    elements.push({type:'ternary',cx,cy,r});boxes.push({x:cx-r,y:14,width:r*2,height:Math.sqrt(3)*r});
    text('1',cx-r,cy+14,9,16,'middle');text('2',cx+r,cy+14,9,16,'middle');text('3',cx,9,9,16,'middle');
    let y=cy+34;
    for(const [index,item] of legend.components.entries())y+=text(`${index+1}. ${item.label}${item.unit?' ('+item.unit+')':''}`,0,y,10)+5;
    height=y;
  }else if(legend.type==='alpha'){
    const columns=width>=300,colWidth=columns?(width-24)/2:width-12;
    let y=10;
    y+=text(`${p.t('color')}: ${legend.base.unit??p.t('indicator',{index:1})}`,0,y,10,colWidth)+5;
    const colorBottom=rows(legend.base.items.map(item=>({...item,key:`class:${item.index}`})),y,0,colWidth);
    const x=columns?colWidth+12:0;let opacityY=columns?10:colorBottom+12;
    opacityY+=text(`${p.t('opacity')}: ${legend.unit??p.t('indicator',{index:2})}`,x,opacityY,10,colWidth)+5;
    for(const band of legend.bands??[]){rect(x,opacityY,12,12,'#2166ac',{opacity:band.opacity});opacityY+=Math.max(18,text(band.label,x+18,opacityY+10,10,colWidth-18)+4);}
    height=Math.max(colorBottom,opacityY);
  }else if(legend.type==='time'){
    let y=10;
    for(const value of [`${p.label(legend.periods[0])} – ${p.label(legend.periods.at(-1))}`,`${p.t(legend.scale==='shared'?'sharedAxis':'localAxis')}: ${p.number(legend.domain[0])} – ${p.number(legend.domain[1])} ${legend.unit??''}`,p.t(legend.spacing==='time'?'timeSpacing':'orderedSpacing')])y+=text(value,0,y,10)+5;
    height=y;
  }
  return {width:actualWidth,height,elements,boxes};
}

export function specializedLegendSvg(layout,legend,p,wrap) {
  let out='';
  for(const item of layout.elements){
    if(item.type==='category')out+=wrap(item.key,item.label,specializedLegendSvg({elements:item.elements.map(element=>({...element,key:undefined}))},legend,p,(key,label,svg)=>svg));
    else if(item.type==='text')out+=`<text x="${item.x}" y="${item.y}" text-anchor="${item.anchor}" font-size="${item.size}" aria-label="${escape(item.value)}">${item.lines.map((line,i)=>i?`<tspan x="${item.x}" dy="${item.size*1.25}">${escape(line)}</tspan>`:escape(line)).join('')}</text>`;
    else if(item.type==='rect')out+=wrap(item.key,item.label,`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${escape(item.color)}"${item.opacity!=null?` fill-opacity="${item.opacity}"`:''}${item.xClass!=null?` data-x-class="${item.xClass}" data-y-class="${item.yClass}"`:''}/>`);
    else if(item.type==='symbol')out+=symbolShapeSvg(legend.shape,item.x,item.y,item.radius,legend.options);
    else if(item.type==='mushroom')out+=mushroomShapeSvg(item.x,item.y,[item.radius,item.radius],legend.options);
    else if(item.type==='composition')out+=`<g data-composition-size-value="${item.mark.value}" role="img" aria-label="${escape(`${legend.sizeLegend.title}: ${p.number(item.mark.value)} ${legend.unit??''}`)}" pointer-events="none" transform="translate(${item.x} ${item.y})">${item.mark.svg}</g>`;
    else if(item.type==='ternary'){
      const {cx,cy,r}=item,divisions=18,point=(b,c)=>[cx-r+2*(b+c*.5)*r,cy-c*Math.sqrt(3)*r];
      const tile=vertices=>{const mean=vertices.reduce((mean,[b,c])=>[mean[0]+b/3,mean[1]+c/3],[0,0]),color=legend.scale.color([1-mean[0]-mean[1],mean[0],mean[1]]);return `<polygon points="${vertices.map(([b,c])=>point(b,c).join(',')).join(' ')}" fill="${color}"/>`;};
      for(let c=0;c<divisions;c++)for(let b=0;b<divisions-c;b++){
        out+=tile([[b/divisions,c/divisions],[(b+1)/divisions,c/divisions],[b/divisions,(c+1)/divisions]]);
        if(b+c<divisions-1)out+=tile([[(b+1)/divisions,c/divisions],[(b+1)/divisions,(c+1)/divisions],[b/divisions,(c+1)/divisions]]);
      }
      const center=point(legend.center[1],legend.center[2]);
      out+=`<circle cx="${center[0]}" cy="${center[1]}" r="2" fill="${p.theme.text}" stroke="${p.theme.background}"><title>${escape(legend.center.map(value=>p.number(value*100,{style:'decimal',maximumFractionDigits:1,minimumFractionDigits:1,maximumSignificantDigits:undefined})+'%').join(' / '))}</title></circle>`;
      out+=`<path d="M${cx-r},${cy} L${cx+r},${cy} L${cx},${cy-Math.sqrt(3)*r} Z" fill="none" stroke="${p.theme.border}" stroke-width=".8"/>`;
    }
  }
  return out;
}
