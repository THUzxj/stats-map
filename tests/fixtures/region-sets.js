export function regionSetFixture(){
  const ids=Array.from({length:80},(_,i)=>'area-'+String(i).padStart(4,'0'));
  return {schema_version:1,id:'fictional-membership',revision:'snapshot-1',sources:[{title:'Fictional catalog evidence',url:'https://example.invalid/membership',sha256:'a'.repeat(64)}],groups:[
    {id:'small',label:'Fictional selection',labels:{en:'Fictional selection'},region_ids:[...ids.slice(0,19),'not-on-map'],sources:[{title:'Fictional group evidence'}]},
    {id:'large',region_ids:ids},
    {id:'empty',region_ids:[]}
  ]};
}
