import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { adapterFixture, matrixCases, matrixAdapters, matrixLayouts, matrixMap, representativeMatrixCases } from './fixtures/adapter-matrix.js';

const cases=process.env.STATS_MAP_FULL_MATRIX==='1'
  ?matrixAdapters.flatMap(adapter=>matrixLayouts.flatMap(layout=>matrixCases().map(row=>({adapter,layout,row}))))
  :representativeMatrixCases();

for(const {adapter,layout,row} of cases)test(`${adapter}/${layout}/${row.id}: source values and offline reopening`,()=>{
  const fixture=adapterFixture(lib,adapter),original=JSON.stringify(fixture),view=new lib.DatasetView(fixture.dataset,fixture.geography);
  assert.equal(view.observation(fixture.series.one,'a','early').value,10);
  assert.equal(view.observation(fixture.series.one,'zero','early').value,0);
  assert.equal(view.observation(fixture.series.one,'gap','early').status,'missing');
    let map,reopened;
    try {
      map=matrixMap(lib,fixture,row,layout);map.setSelection(['b']);
      const result=map.render();assert.doesNotMatch(result.svg,/\b(?:NaN|Infinity)\b/,row.id);
      assert.equal(map.capabilities()[0].supported,true,row.id+': '+JSON.stringify(map.capabilities()));
      assert.ok(result.svg.includes('Fictional matrix evidence'),row.id);
      const spec=map.exportSpec({resolved:true});
      reopened=lib.createMap(null,{geography:fixture.geography,dataset:fixture.dataset,spec});
      assert.deepEqual(reopened.exportSpec({resolved:true}),spec,row.id);
      const visible=legends=>legends.map(legend=>lib.legendSvg(legend,12,20,'matrix'));
      assert.deepEqual(visible(reopened.render().legends),visible(result.legends),row.id);
      map.setView({period_id:'late'});assert.equal(view.observation(fixture.series.one,'a','late').value,20);
      const csv=map.export('csv');assert.match(csv,/synthetic-source/,row.id);
      if(row.type==='flow'){assert.match(csv,/suppressed/);assert.match(csv,/,0,/);}
      assert.deepEqual(map.getState().selection,['b']);
    }catch(error){error.message=`${adapter}/${layout}/${row.id}: ${error.message}`;throw error;}
    finally{map?.destroy();reopened?.destroy();}
  assert.equal(JSON.stringify(fixture),original);
});
