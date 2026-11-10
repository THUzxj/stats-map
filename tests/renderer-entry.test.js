import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { createRendererEntry } from '../src/renderers/entry.js';
import { adapterFixture, representativeMatrixCases, matrixMap } from './fixtures/adapter-matrix.js';

test('per-type entries render each registered family through the shared core with unchanged values and identity',()=>{
  for(const {row,layout} of representativeMatrixCases().filter(item=>item.adapter==='canonical')){
    const fixture=adapterFixture(lib,'canonical'),source=JSON.stringify(fixture),entry=createRendererEntry(row.type),map=matrixMap(lib,fixture,row,layout);
    try{
      const layer=entry.createLayer(map.spec.layers[0].encoding,map.spec.layers[0].options,{id:'standalone'});
      assert.equal(layer.type,row.type);assert.equal(layer.role,lib.getRenderer(row.type).defaultRole);
      const rendered=entry.render({geography:fixture.geography,datasetView:map._views.get(fixture.dataset.id),datasetViews:map._views,spec:map.spec,layer,viewport:map.viewport,projection:map.projection,layoutPositions:map.layoutPositions,layoutType:layout});
      assert.match(rendered.svg,/<(?:path|rect|circle|g)\b/);assert.doesNotMatch(rendered.svg,/NaN|Infinity/);
      assert.ok(rendered.svg.includes('data-region-id="a"')||rendered.svg.includes('data-symbol-region-id="a"')||rendered.svg.includes('data-origin-region-id="a"'),row.type);
      assert.equal(JSON.stringify(fixture),source);
    }finally{map.destroy();}
  }
  const alias=createRendererEntry('ch');assert.equal(alias.type,'choropleth');assert.ok(Object.isFrozen(alias));
  assert.throws(()=>createRendererEntry('unknown'),error=>error.code==='UNSUPPORTED_LAYER');
});
