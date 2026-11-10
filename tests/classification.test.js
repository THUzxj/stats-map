import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomain } from '../src/index.js';

test('resolved class extents require finite ordered bounds with fixed thresholds',()=>{
  for(const resolvedDomain of [null,[],[1],[1,2,3],[2,1],[NaN,2],['1',2]])assert.throws(()=>classifyDomain([1],{method:'threshold',resolvedDomain}),error=>error.code==='INVALID_CLASSIFICATION');
  assert.throws(()=>classifyDomain([1],{resolvedDomain:[1,1]}),error=>error.code==='INVALID_CLASSIFICATION');
  const domain=classifyDomain([],{method:'threshold',thresholds:[],resolvedDomain:[7,7]});assert.deepEqual(domain.domain,[]);assert.deepEqual(domain.breaks,[]);assert.equal(domain.classify(7),0);
});

function squaredError(groups) {
  return groups.reduce((total,values)=>{
    const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
    return total+values.reduce((sum,value)=>sum+(value-mean)**2,0);
  },0);
}
function exhaustiveOptimum(values,classes) {
  const sorted=[...values].sort((a,b)=>a-b);
  let best=Infinity;
  function split(start,remaining,groups) {
    if(remaining===1){best=Math.min(best,squaredError([...groups,sorted.slice(start)]));return;}
    for(let end=start+1;end<=sorted.length-remaining+1;end++)if(sorted[end-1]!==sorted[end])split(end,remaining-1,[...groups,sorted.slice(start,end)]);
  }
  split(0,classes,[]);
  return best;
}

test('natural-break classifiers match exhaustive weighted optimum and retain large offsets',()=>{
  const cases=[[0,1,2,8,9,10],[-5,-5,0,3,3,20],[0,...Array(20).fill(5),10,12],[0,0,0,0,0,4,5,9]];
  for(const method of ['ckmeans','jenks'])for(const values of cases)for(let classes=2;classes<=Math.min(4,new Set(values).size);classes++){
    const result=classifyDomain(values,{method,classes}),groups=Array.from({length:result.classes},()=>[]);
    for(const value of values)groups[result.classify(value)].push(value);
    assert.ok(groups.every(group=>group.length>0));
    assert.ok(Math.abs(squaredError(groups)-exhaustiveOptimum(values,classes))<1e-9);
    const offset=classifyDomain(values.map(value=>value+1e12),{method,classes});
    assert.deepEqual(values.map(value=>result.classify(value)),values.map(value=>offset.classify(value+1e12)));
  }
});
