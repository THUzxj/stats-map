export class MapState {
  constructor(initial={}){this.value={...initial};this.version=0;this.listeners=new Set();this.requests=new Map();}
  get(){return globalThis.structuredClone?globalThis.structuredClone(this.value):JSON.parse(JSON.stringify(this.value));}
  set(patch,source='api'){this.value={...this.value,...patch};this.version++;const snapshot=this.get();for(const fn of this.listeners)fn(snapshot,{version:this.version,source});return snapshot;}
  update(fn,source='api'){return this.set(fn(this.get()),source);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  begin(name='default'){const generation=(this.requests.get(name)?.generation??0)+1;const token={name,generation,cancelled:false,cancel(){token.cancelled=true;}};this.requests.set(name,token);return token;}
  isCurrent(token){return this.requests.get(token.name)===token&&!token.cancelled;}
  cancel(name='default'){const token=this.requests.get(name);if(token)token.cancel();}
  destroy(){for(const token of this.requests.values())token.cancel();this.requests.clear();this.listeners.clear();}
}
