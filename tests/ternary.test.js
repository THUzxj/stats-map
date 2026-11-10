import test from 'node:test';
import assert from 'node:assert/strict';
import { ternaryScale } from '../src/renderers/ternary.js';

test('ternary equal and geometric mean centers normalize consistently and keep zero/missing invalid',()=>{
  const compositions=[[8,1,1],[4,2,4],[2,4,4]];
  const equal=ternaryScale(compositions),mean=ternaryScale(compositions,{meanCentering:true});
  assert.deepEqual(equal.center,[1/3,1/3,1/3]);
  const geometric=compositions[0].map((_,index)=>Math.exp(compositions.reduce((sum,point)=>sum+Math.log(point[index]/10),0)/3));
  const sum=geometric.reduce((sum,value)=>sum+value,0);
  mean.center.forEach((value,index)=>assert.ok(Math.abs(value-geometric[index]/sum)<1e-12));
  assert.notEqual(mean.color([8,1,1]),equal.color([8,1,1]));
  assert.equal(equal.color(null),null);
  assert.equal(equal.color([0,0,0]),null);
  assert.equal(equal.color([-1,2,3]),null);
  assert.equal(equal.color([1,0,0]),'#d73027');
  assert.equal(equal.color([0,1,0]),'#1a9850');
  assert.equal(equal.color([0,0,1]),'#4575b4');
});

test('ternary sextants cover all six relative component patterns with a distinct center',()=>{
  const scale=ternaryScale([],{mode:'sextant'}),points=[[8,1,1],[4,4,2],[1,8,1],[2,4,4],[1,1,8],[4,2,4]];
  assert.deepEqual(points.map(scale.classify),[0,1,2,3,4,5]);
  assert.equal(new Set(points.map(scale.color)).size,6);
  assert.equal(scale.classify([1,1,1]),'center');
  assert.equal(scale.color([1,1,1]),'#f5f5f5');
  assert.equal(scale.color([0,0,0]),null);
});

test('ternary HCL color parameters and spread are bounded and reproducible',()=>{
  const options={colorMode:'hcl',hue:50,chroma:60,lightness:75,contrast:.4,spread:1.5},scale=ternaryScale([],options);
  assert.match(scale.color([1,2,3]),/^#[\da-f]{6}$/);
  assert.equal(scale.color([1,2,3]),ternaryScale([],options).color([1,2,3]));
  assert.notEqual(scale.color([1,2,3]),ternaryScale([],{...options,hue:180}).color([1,2,3]));
  assert.throws(()=>ternaryScale([],{spread:0}),error=>error.code==='INVALID_ENCODING');
  assert.throws(()=>ternaryScale([],{sextantColors:['#fff']}),error=>error.code==='INVALID_COLOR');
  assert.throws(()=>ternaryScale([],{lightness:200}).color([1,2,3]),error=>error.code==='INVALID_COLOR');
});
