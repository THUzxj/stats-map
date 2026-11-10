import { StatsMapError } from '../core/errors.js';

const fail=message=>{throw new StatsMapError(`invalid SVG path: ${message}`,'INVALID_ENCODING');};
const arity={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7};
const number=/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const tau=2*Math.PI;
const mix=(a,b,t)=>a*(1-t)+b*t;
const quadratic=(a,b,c,t)=>mix(mix(a,b,t),mix(b,c,t),t);
const cubic=(a,b,c,d,t)=>mix(quadratic(a,b,c,t),quadratic(b,c,d,t),t);
const cache=new Map();

// Compile arcs to deterministic <=90-degree tangent cubics. Measuring and
// drawing these same curves avoids native arc radius-correction discrepancies.
// Other paths keep their original serialized data. A viewBox never clips them.
export function compileSvgPath(path,{closed=false}={}) {
  if(typeof path!=='string'||!path.length||path.length>10000)fail('expected 1–10000 characters of path data');
  if(typeof closed!=='boolean')fail('closed must be boolean');
  const key=(closed?'closed:':'open:')+path;
  if(cache.has(key)){const result=cache.get(key);return {...result,bounds:{...result.bounds}};}
  const commands=[];let hasArc=false;
  let index=0,x=0,y=0,startX=0,startY=0,started=false,open=false,command=null,previous=null,control=null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const whitespace=()=>{while(index<path.length&&/[\t\n\r ]/.test(path[index]))index++;};
  const finite=value=>{if(!Number.isFinite(value))fail('coordinates or derived geometry exceed the finite range');return value;};
  const point=(px,py)=>{finite(px);finite(py);minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);};
  const argument=(comma,flag=false)=>{
    whitespace();
    if(path[index]===','){if(!comma)fail('unexpected comma');index++;whitespace();}
    if(flag){const value=path[index++];if(value!=='0'&&value!=='1')fail('arc flags must be 0 or 1');return Number(value);}
    number.lastIndex=index;const match=number.exec(path);if(!match)fail(`expected a number at offset ${index}`);
    index=number.lastIndex;return finite(Number(match[0]));
  };
  const bezier=(points,degree)=>{
    points.flat().forEach(finite);
    point(...points[0]);point(...points.at(-1));
    const roots=[];
    for(let axis=0;axis<2;axis++){
      const values=points.map(p=>p[axis]),magnitude=Math.max(...values.map(Math.abs))||1,p=values.map(v=>v/magnitude);
      if(degree===2){const denominator=p[0]-2*p[1]+p[2];if(denominator!==0)roots.push((p[0]-p[1])/denominator);}
      else {
        const d=[p[1]-p[0],p[2]-p[1],p[3]-p[2]],a=d[0]-2*d[1]+d[2],b=2*(d[1]-d[0]),c=d[0];
        if(a===0){if(b!==0)roots.push(-c/b);}
        else {
          const discriminant=b*b-4*a*c;
          if(discriminant>=0){const q=-.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));if(q===0)roots.push(-b/(2*a));else roots.push(q/a,c/q);}
        }
      }
    }
    for(const t of roots)if(t>0&&t<1)point(...[0,1].map(axis=>degree===2?quadratic(points[0][axis],points[1][axis],points[2][axis],t):cubic(points[0][axis],points[1][axis],points[2][axis],points[3][axis],t)));
  };
  const arc=(rx,ry,rotation,large,sweep,ex,ey)=>{
    point(x,y);point(ex,ey);
    rx=Math.abs(rx);ry=Math.abs(ry);
    if(!rx||!ry||x===ex&&y===ey){commands.push(`L${ex},${ey}`);return;}
    // Work in normalized coordinates so squared radii cannot overflow.
    const norm=Math.max(Math.abs(x),Math.abs(y),Math.abs(ex),Math.abs(ey),rx,ry),phi=(rotation%360)*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi);
    const dx=x/norm/2-ex/norm/2,dy=y/norm/2-ey/norm/2,xp=cos*dx+sin*dy,yp=-sin*dx+cos*dy;
    const radius=Math.max(rx,ry),aspectX=rx/radius,aspectY=ry/radius;
    let rX=rx/norm,rY=ry/norm;
    const required=Math.hypot(xp/aspectX,yp/aspectY);
    finite(required);
    if(required>radius/norm){rX=aspectX*required;rY=aspectY*required;}
    if(!rX||!rY)fail('arc aspect ratio exceeds the finite range');
    const ux=xp/rX,uy=yp/rY,length=Math.hypot(ux,uy);
    if(!length)fail('arc endpoint separation exceeds the finite range');
    const sign=large===sweep?-1:1,h=Math.sqrt(Math.max(0,1-length*length));
    const cpX=sign*rX*(uy/length)*h,cpY=-sign*rY*(ux/length)*h;
    const cx=(x/norm/2+ex/norm/2)+cos*cpX-sin*cpY,cy=(y/norm/2+ey/norm/2)+sin*cpX+cos*cpY;
    const start=Math.atan2((yp-cpY)/rY,(xp-cpX)/rX),end=Math.atan2((-yp-cpY)/rY,(-xp-cpX)/rX);
    let delta=end-start;if(sweep&&delta<0)delta+=tau;if(!sweep&&delta>0)delta-=tau;
    [rX,rY,cx,cy,start,end,delta].forEach(finite);
    const at=angle=>[cx+rX*cos*Math.cos(angle)-rY*sin*Math.sin(angle),cy+rX*sin*Math.cos(angle)+rY*cos*Math.sin(angle)];
    const tangent=angle=>[-rX*cos*Math.sin(angle)-rY*sin*Math.cos(angle),-rX*sin*Math.sin(angle)+rY*cos*Math.cos(angle)];
    const count=Math.max(1,Math.ceil(Math.abs(delta)/(Math.PI/2))),step=delta/count,k=4/3*Math.tan(step/4);
    let from=[x,y];
    for(let i=0;i<count;i++){
      const a=start+i*step,b=start+(i+1)*step,p=at(a),q=at(b),d=tangent(a),e=tangent(b);
      const first=p.map((v,axis)=>finite((v+k*d[axis])*norm)),second=q.map((v,axis)=>finite((v-k*e[axis])*norm)),to=i===count-1?[ex,ey]:q.map(v=>finite(v*norm));
      bezier([from,first,second,to],3);commands.push(`C${first} ${second} ${to}`);from=to;
    }
  };
  while(true){
    whitespace();if(index===path.length)break;
    let explicit=false;
    if(/[a-z]/i.test(path[index])){command=path[index++];explicit=true;}
    else if(!command)fail(`expected a command at offset ${index}`);
    const type=command.toUpperCase(),relative=command!==type;
    if(!started&&type!=='M')fail('first command must be moveto');
    if(type==='Z'){
      point(x,y);point(startX,startY);commands.push('Z');x=startX;y=startY;open=false;previous='Z';control=null;command=null;continue;
    }
    if(!arity[type])fail(`unsupported command ${command}`);
    const args=Array.from({length:arity[type]},(_,i)=>argument(i>0||!explicit,type==='A'&&(i===3||i===4)));
    const at=(a,b)=>[finite(a+(relative?x:0)),finite(b+(relative?y:0))];
    if(type==='M'){
      if(closed&&open)fail('every subpath must close before the next moveto');
      [x,y]=at(...args);startX=x;startY=y;started=true;open=true;command=relative?'l':'L';control=null;
      commands.push(`M${x},${y}`);
    }else {
      open=true;
      if(type==='L'||type==='H'||type==='V'){
        const [ex,ey]=type==='L'?at(...args):type==='H'?[finite(args[0]+(relative?x:0)),y]:[x,finite(args[0]+(relative?y:0))];
        point(x,y);point(ex,ey);x=ex;y=ey;control=null;
        commands.push(`L${x},${y}`);
      }else if(type==='C'||type==='S'){
        const reflected=previous==='C'||previous==='S';
        const first=type==='C'?at(args[0],args[1]):reflected?[finite(x+(x-control[0])),finite(y+(y-control[1]))]:[x,y];
        const second=at(args.at(-4),args.at(-3)),end=at(args.at(-2),args.at(-1));
        bezier([[x,y],first,second,end],3);control=second;[x,y]=end;
        commands.push(`C${first} ${second} ${end}`);
      }else if(type==='Q'||type==='T'){
        const reflected=previous==='Q'||previous==='T';
        const middle=type==='Q'?at(args[0],args[1]):reflected?[finite(x+(x-control[0])),finite(y+(y-control[1]))]:[x,y],end=at(args.at(-2),args.at(-1));
        bezier([[x,y],middle,end],2);control=middle;[x,y]=end;
        commands.push(`Q${middle} ${end}`);
      }else if(type==='A'){
        const end=at(args[5],args[6]);hasArc=true;arc(...args.slice(0,5),...end);[x,y]=end;control=null;
      }
    }
    previous=type;
  }
  if(!started||closed&&open)fail(closed?'every subpath must be closed':'missing moveto');
  if(minX===Infinity)point(x,y);
  const result={path:hasArc?commands.join(' '):path,bounds:{minX,minY,maxX,maxY}};
  if(cache.size>=128)cache.delete(cache.keys().next().value);
  cache.set(key,result);return {...result,bounds:{...result.bounds}};
}

export function svgPathBounds(path,options){return compileSvgPath(path,options).bounds;}
