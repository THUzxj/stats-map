export function customPathFixtures(){return [
  {id:'polygon-outside-box',viewBox:[0,0,10,10],path:'M-5-5H15V15H-5Z'},
  {id:'cubic-smooth',viewBox:[0,-10,60,20],path:'M0 0C0 30 30 30 30 0S60-30 60 0Z'},
  {id:'quadratic-smooth',viewBox:[0,-5,40,10],path:'M0 0Q10 20 20 0T40 0Z'},
  {id:'rotated-ellipse',viewBox:[-5,-5,10,10],path:'M8.660254037844386 5A10 4 30 0 1-8.660254037844386-5A10 4 30 0 1 8.660254037844386 5Z'},
  {id:'arc-corrected',viewBox:[-5,0,10,10],path:'M10 0A1 1 0 1 0-10 0Z'},
  {id:'relative-subpaths',viewBox:[0,0,30,20],path:'m0 0h20v20h-20zm25 5q10 10 0 10z'}
];}

export function pathBoundsCases(){
  let state=34781;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296),coordinate=()=>Math.round((random()-.5)*60000)/100;
  const rows=customPathFixtures().map(row=>({id:row.id,path:row.path}));
  for(let i=0;i<120;i++){
    const start=[coordinate(),coordinate()],end=[coordinate(),coordinate()];
    rows.push({id:'quadratic-'+i,path:`M${start}Q${coordinate()} ${coordinate()} ${end}T${coordinate()} ${coordinate()}Z`});
    rows.push({id:'cubic-'+i,path:`M${start}C${coordinate()} ${coordinate()} ${coordinate()} ${coordinate()} ${end}S${coordinate()} ${coordinate()} ${coordinate()} ${coordinate()}Z`});
    rows.push({id:'arc-'+i,path:`M${start}A${Math.abs(coordinate())+.01} ${Math.abs(coordinate())+.01} ${coordinate()*4} ${i%2} ${Math.floor(i/2)%2} ${end}Z`});
  }
  return rows;
}
