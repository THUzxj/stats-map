export const polar=(x,y,r,angle)=>[x+Math.cos(angle)*r,y+Math.sin(angle)*r];

// Full circles require two SVG arcs; one arc with identical endpoints is empty.
export function sector(x,y,inner,outer,start,end) {
  if(outer<=0||end<=start)return '';
  const point=(radius,angle)=>polar(x,y,radius,angle).join(',');
  if(end-start>=Math.PI*2-1e-10){
    const middle=start+Math.PI;
    let d=`M${point(outer,start)}A${outer},${outer} 0 1,1 ${point(outer,middle)}A${outer},${outer} 0 1,1 ${point(outer,start)}Z`;
    if(inner>0)d+=`M${point(inner,start)}A${inner},${inner} 0 1,0 ${point(inner,middle)}A${inner},${inner} 0 1,0 ${point(inner,start)}Z`;
    return d;
  }
  const large=end-start>Math.PI?1:0;
  return `M${point(outer,start)}A${outer},${outer} 0 ${large},1 ${point(outer,end)}${inner>0?`L${point(inner,end)}A${inner},${inner} 0 ${large},0 ${point(inner,start)}`:`L${x},${y}`}Z`;
}
