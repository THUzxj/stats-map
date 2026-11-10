import { StatsMapError } from './errors.js';
import { validateBundle, validateResource, validateGeography, validateDataset, validateMapSpec } from './validate.js';

async function digest(bytes){
  if(globalThis.crypto?.subtle){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');}
  const {createHash}=await import('node:crypto');return createHash('sha256').update(bytes).digest('hex');
}
const abort=signal=>{if(signal?.aborted)throw new StatsMapError('bundle loading cancelled','CANCELLED');};
function resolveWithSignal(resolver,path,ref,signal){
  abort(signal);
  if(!signal)return resolver(path,ref,{});
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(new StatsMapError('bundle loading cancelled','CANCELLED'));
    signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve().then(()=>{abort(signal);return resolver(path,ref,{signal});}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}
function resourceBytes(result){
  const input=result?.bytes??result;
  if(typeof input==='string')return new TextEncoder().encode(input);
  if(input instanceof ArrayBuffer)return new Uint8Array(input).slice();
  if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice();
  throw new StatsMapError('external resolver must return original bytes or text','LOAD_FAILED');
}

export async function loadBundle(bundle,resolver,options={}){
  validateBundle(bundle);abort(options.signal);
  const loaded=[];
  for(const entry of bundle.resources){
    abort(options.signal);
    if(entry.storage==='inline'){loaded.push(entry.resource);continue;}
    if(typeof resolver!=='function')throw new StatsMapError('external resources require a resolver','LOAD_FAILED');
    const result=await resolveWithSignal(resolver,entry.path,entry.ref,options.signal);abort(options.signal);
    const bytes=resourceBytes(result),actual=await digest(bytes);abort(options.signal);
    if(actual.toLowerCase()!==entry.sha256.toLowerCase())throw new StatsMapError(`SHA-256 mismatch for ${entry.path}`,'HASH_MISMATCH');
    let resource;
    try{resource=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));}
    catch(cause){const error=new StatsMapError(`invalid JSON resource: ${entry.path}`,'LOAD_FAILED');error.cause=cause;throw error;}
    validateResource(resource);
    if(resource.id!==entry.ref.id||resource.revision!==entry.ref.revision||entry.ref.kind&&resource.kind!==entry.ref.kind)throw new StatsMapError(`resource identity mismatch for ${entry.path}`,'REFERENCE_MISMATCH');
    loaded.push(resource);
  }
  const result={...bundle,resources:loaded.map(resource=>({storage:'inline',resource}))};
  validateBundle(result);
  const byKind=new Map(loaded.map(resource=>[`${resource.kind}:${resource.id}@${resource.revision}`,resource]));
  const spec=byKind.get(`stats-map/spec:${bundle.spec_ref.id}@${bundle.spec_ref.revision}`);
  if(!spec)throw new StatsMapError('bundle spec is missing','MISSING_RESOURCE');
  const geography=byKind.get(`stats-map/geography:${spec.geography_ref.id}@${spec.geography_ref.revision}`);
  if(!geography)throw new StatsMapError('bundle geography is missing','MISSING_RESOURCE');
  validateGeography(geography);
  const datasets=new Map();
  for(const reference of spec.dataset_refs){
    const dataset=byKind.get(`stats-map/dataset:${reference.id}@${reference.revision}`);
    if(!dataset)throw new StatsMapError(`bundle dataset is missing: ${reference.id}`,'MISSING_RESOURCE');
    validateDataset(dataset,geography);datasets.set(dataset.id,dataset);
  }
  validateMapSpec(spec,geography,datasets);abort(options.signal);return result;
}
export { digest as sha256Bytes };
