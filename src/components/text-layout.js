// Conservative, deterministic text metrics keep server and browser placement
// consistent. SVG exports contain the resulting positions and complete text.
export function textWidth(text,fontSize=12) {
  let units=0;
  for(const char of String(text)){
    if(/\p{Mark}/u.test(char))continue;
    units+=/\s/u.test(char)?.35:/[ilI.,:;'!|]/.test(char)?.34:/[MW@#%]/.test(char)?.95:/[\u0000-\u024f]/u.test(char)?.65:1.08;
  }
  return units*fontSize;
}
export function wrapText(text,maxWidth,fontSize=12) {
  if(!Number.isFinite(maxWidth)||maxWidth<=0)return [String(text)];
  const lines=[];
  for(const paragraph of String(text).split('\n')){
    let line='';
    for(const token of paragraph.match(/\S+\s*|\s+/gu)??['']){
      if(textWidth(line+token.trimEnd(),fontSize)<=maxWidth){line+=token;continue;}
      if(line.trim()){lines.push(line.trimEnd());line='';}
      for(const char of token.trimStart()){
        if(line&&textWidth(line+char,fontSize)>maxWidth){lines.push(line.trimEnd());line='';}
        line+=char;
      }
    }
    if(line.trim()||!paragraph)lines.push(line.trimEnd());
  }
  return lines.length?lines:[''];
}
export function textBox(lines,x,y,fontSize=12,anchor='start') {
  const width=Math.max(0,...lines.map(line=>textWidth(line,fontSize))),height=fontSize+(lines.length-1)*fontSize*1.25;
  return {x:x-(anchor==='middle'?width/2:anchor==='end'?width:0),y:y-fontSize*.85,width,height};
}
export const intersects=(a,b,padding=0)=>a.x<b.x+b.width+padding&&a.x+a.width+padding>b.x&&a.y<b.y+b.height+padding&&a.y+a.height+padding>b.y;

export function placeLabels(candidates,{width,height,obstacles=[],mode='avoid',padding=3,maxOffset=40,step=10}={}) {
  if(!Number.isFinite(step)||step<1||!Number.isFinite(maxOffset)||maxOffset<0||maxOffset>1000)throw new RangeError('label placement requires step >= 1 and maxOffset within 0–1000');
  const occupied=[...obstacles],result=new Map();
  for(const candidate of [...candidates].sort((a,b)=>(b.priority??0)-(a.priority??0)||(a.id<b.id?-1:a.id>b.id?1:0))){
    const offsets=[[0,0]];
    if(mode==='avoid')for(let distance=step;distance<=maxOffset;distance+=step)for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]])offsets.push([dx*distance,dy*distance]);
    let placed=null;
    for(const [dx,dy] of offsets){
      const x=candidate.x+dx,y=candidate.y+dy,box=textBox(candidate.lines,x,y,candidate.fontSize,candidate.anchor);
      if(mode!=='none'&&(box.x<padding||box.y<padding||box.x+box.width>width-padding||box.y+box.height>height-padding||occupied.some(other=>intersects(box,other,padding))))continue;
      placed={...candidate,x,y,box,visible:true,displaced:dx!==0||dy!==0};occupied.push(box);break;
    }
    result.set(candidate.id,placed??{...candidate,visible:false,reason:'collision'});
  }
  return result;
}
