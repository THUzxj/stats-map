import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/index.js';
import { channelBindings } from '../src/core/channels.js';
import { symbolColorFixture } from './fixtures/symbol-color.js';
import { specializedLegendLayout } from '../src/components/specialized-legend.js';
import { comparisonDomains } from '../src/components/comparison.js';

const glyph=(map,id)=>(map.lastRender??map.render()).renders[0].svg.match(new RegExp(`<[^>]+data-symbol-region-id="${id}"[^>]*>`))?.[0];

test('size and signed color resolve colliding series ids independently of declaration order',()=>{
  const fixture=symbolColorFixture(lib),original=JSON.stringify(fixture),map=lib.createMap(fixture.bundle);
  try{
    assert.deepEqual(channelBindings(fixture.spec.layers[0].encoding).map(binding=>[binding.channel,binding.dataset_id]),[['size',fixture.dataset.id],['color',fixture.colors.id]]);
    assert.match(glyph(map,'a'),/fill="#112233"/);assert.match(glyph(map,'b'),/fill="#e5e7eb"/);
    assert.match(glyph(map,'zero'),/fill="#778899"/);assert.match(glyph(map,'zero'),/r="0"/);assert.equal(glyph(map,'gap'),undefined);
    assert.match(glyph(map,'b'),/data-color-status="suppressed"/);assert.match(glyph(map,'a'),/Size \/ Number|Size \/ Amount/);
    const legend=map.lastRender.legends[0];assert.equal(legend.unit,fixture.dataset.units[0].label);assert.equal(legend.color.unit,'color points');assert.equal(legend.color.missing,true);assert.equal(legend.missing,true);
    assert.deepEqual(legend.color.items.map(item=>item.color),['#112233','#778899','#ddeeff']);
    assert.equal(map.capabilities()[0].supported,true);
    const ranked=lib.buildRanking(map);assert.equal(ranked.datasetId,fixture.dataset.id);assert.equal(ranked.rows.find(row=>row.region_id==='a').color,'#112233');assert.equal(ranked.rows.find(row=>row.region_id==='b').color,'#e5e7eb');
    const tooltip=lib.buildTooltip(map,{layer_id:'theme',region_id:'a'});assert.deepEqual(tooltip.channels.map(channel=>channel.observation.value),[10,-10]);
    assert.deepEqual(tooltip.channels.map(channel=>channel.channel),['size','color']);assert.deepEqual(tooltip.channels.map(channel=>channel.dataset_ref.revision),['r1','r2']);
    assert.equal(tooltip.channels[1].measure_type,'estimate');assert.equal(tooltip.channels[1].reported_observation.evidence.source_id,'color-source');assert.ok(tooltip.rows.some(row=>row.label==='Color: Color measure'&&row.value==='-10 color points'));
    assert.equal(JSON.stringify(fixture),original);
  }finally{map.destroy();}
});

test('numeric and registered categorical color filters leave size, observations and selection intact',()=>{
  for(const kind of ['numeric','category']){
    const fixture=symbolColorFixture(lib,'canonical',kind),map=lib.createMap(fixture.bundle);
    try{
      const before=map.export('csv'),r=glyph(map,'a').match(/ r="([^"]+)"/)[1];map.setSelection(['a']);
      const key=kind==='category'?'category:second':'class:1';map.setLegendFilter('theme',[key]);
      assert.match(glyph(map,'a'),/data-filtered="true"/);assert.match(glyph(map,'a'),/tabindex="-1"/);assert.equal(glyph(map,'a').match(/ r="([^"]+)"/)[1],r);
      assert.equal(map.export('csv'),before);assert.deepEqual(map.getState().selection,['a']);
      if(kind==='category'){assert.match(glyph(map,'b'),/fill="#abcdef"/);assert.doesNotMatch(glyph(map,'b'),/data-filtered/);}
      else {assert.doesNotMatch(glyph(map,'zero'),/data-filtered/);map.setLegendFilter('theme',['missing']);assert.doesNotMatch(glyph(map,'b'),/data-filtered/);}
      assert.match(lib.legendSvg(map.lastRender.legends[0],0,0,'color',{layerId:'theme'}),new RegExp(`data-legend-key="${key}"`));
      map.setLegendFilter('theme',null);assert.doesNotMatch(glyph(map,'a'),/data-filtered/);
    }finally{map.destroy();}
  }
});

test('numeric continuous and diverging symbol colors freeze their own extent without changing size',()=>{
  for(const colorMode of ['continuous','diverging']){
    const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
    try{
      map.setLayers([{...map.spec.layers[0],options:{...map.spec.layers[0].options,colorMode,colors:['#0000ff','#ffffff','#ff0000']}}]);
      const legend=map.lastRender.legends[0],saved=JSON.parse(map.export('json')).spec;
      assert.deepEqual(saved.layers[0].options.colorDomain,[-10,100]);assert.equal(saved.layers[0].options.maxValue,40);
      assert.equal(legend.color.type,'color-ramp');assert.equal(legend.color.items.length,9);assert.equal(legend.color.items[0].color,'#0000ff');assert.equal(legend.color.items.at(-1).color,'#ff0000');
      const bundle=structuredClone(map.bundle);bundle.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource=saved;
      const reopened=lib.createMap(bundle);
      try{assert.equal(glyph(reopened,'a').match(/ fill="([^"]+)"/)[1],glyph(map,'a').match(/ fill="([^"]+)"/)[1]);assert.equal(reopened.export('csv'),map.export('csv'));}finally{reopened.destroy();}
    }finally{map.destroy();}
  }
});

test('shared symbol comparisons freeze both roles over empty periods and reject changed color semantics',()=>{
  for(const kind of ['numeric','category']){
    const fixture=symbolColorFixture(lib,'canonical',kind),map=lib.createMap(fixture.bundle);
    try{
      const panels=['early','late','empty'].map(period_id=>({...map.spec,view:{...map.spec.view,period_id}}));
      const patch=comparisonDomains(map.spec,panels,map.datasets,map.geography).get('theme');
      assert.equal(patch.options.maxValue,80);
      if(kind==='numeric')assert.deepEqual(patch.classification.resolvedDomain,[-40,1000]);
      for(const panel of panels){map.setSpec({...panel,layers:[{...panel.layers[0],...patch,options:{...panel.layers[0].options,...patch.options}}]});assert.equal(map.lastRender.legends[0].marks.at(-1).value,80);}
      assert.equal(map.lastRender.legends[0].color.items.length,kind==='numeric'?3:2);assert.equal(map.lastRender.legends[0].color.missing,true);
      const replacement=structuredClone(fixture.colors);replacement.series[0].scope_id='changed';replacement.scopes=[{id:'changed',description:'changed'}];
      const datasets=new Map(map.datasets);datasets.set(replacement.id,replacement);
      // An alternate panel points at a different dataset with incompatible scope.
      replacement.id='alternate';datasets.set(replacement.id,replacement);datasets.set(fixture.colors.id,fixture.colors);
      const invalid=structuredClone(panels[1]);invalid.layers[0].encoding.color.dataset_id=replacement.id;
      assert.throws(()=>comparisonDomains(panels[0],[panels[0],invalid],datasets,map.geography),error=>error.code==='INCOMPARABLE_PANELS');
    }finally{map.destroy();}
  }
});

test('symbol size/color legends measure long labels and separate missing roles in all locales',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    for(const locale of ['en','zh','fr','de']){
      map.setLocale(locale);const legend=map.lastRender.legends[0],plan=specializedLegendLayout(legend,120,legend.presentation);
      for(const box of plan.boxes)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=plan.width+1e-8&&box.y+box.height<=plan.height+1e-8);
      assert.ok(plan.elements.some(item=>item.key==='missing'));
      assert.ok(lib.legendSvg(legend).includes(legend.presentation.t('size')+': '+legend.presentation.t('missing')));
    }
  }finally{map.destroy();}
});

test('ambiguous size/color encodings and invalid color replacements are transactional',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    const layer=map.spec.layers[0],before=map.spec,svg=map.export('svg');
    for(const encoding of [{...layer.encoding,series_id:fixture.series.one,dataset_id:fixture.dataset.id},{...layer.encoding,color:{}},{...layer.encoding,color:{dataset_id:fixture.colors.id,series_ids:[fixture.series.one]}},{...layer.encoding,extra:{dataset_id:fixture.dataset.id,series_id:fixture.series.two}},{color:layer.encoding.color},{dataset_id:fixture.dataset.id,series_ids:[fixture.series.one,fixture.series.two]}]){
      assert.throws(()=>map.setLayers([{...layer,encoding}]),error=>error.code==='INVALID_ENCODING');assert.equal(map.spec,before);assert.equal(map.export('svg'),svg);
    }
    for(const options of [{colorMode:'bogus'},{colors:[]},{colors:{}},{colorMode:'continuous',colors:['red','blue']}])assert.throws(()=>map.setLayers([{...layer,options:{...layer.options,...options}}]));
    const invalid=structuredClone(fixture.dataset);invalid.observations.filter(row=>row.status==='value'&&row.series_id===fixture.series.one).forEach(row=>row.value=-1);
    assert.throws(()=>map.setData(invalid),error=>error.code==='UNSUPPORTED_VALUE');assert.equal(map.spec,before);
    const category=structuredClone(fixture.colors);category.metrics[0]={...category.metrics[0],value_type:'category',category_dimension_id:'classes'};category.dimensions=[{id:'classes',values:[{id:'first',label:'First'}]}];category.observations.forEach(row=>{if(row.status==='value')row.value='first';});
    map.setData(category);assert.equal(map.capabilities()[0].supported,true);assert.equal(map.lastRender.legends[0].color.type,'categorical');
  }finally{map.destroy();}
});

test('legacy top-level size plus an explicit color preserves the default driver and color export selection',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    const layer=map.spec.layers[0];map.setLayers([{...layer,encoding:{color:layer.encoding.color,dataset_id:fixture.dataset.id,series_id:fixture.series.one}}]);
    assert.match(glyph(map,'a'),/fill="#112233"/);
    const time=new lib.TimeController(map);assert.equal(time.datasetId,fixture.dataset.id);time.destroy();
    assert.match(map.export('csv',{datasetId:fixture.colors.id,seriesId:fixture.series.one}),/-10/);
  }finally{map.destroy();}
});

test('independent size and color OD slices retain their own direction, original relation and missing status',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    const colors=structuredClone(fixture.colors);colors.relations=[{id:'color-ab',origin_region_id:'a',destination_region_id:'b',period_id:'early',series_id:fixture.series.one,status:'value',value:-7},{id:'color-bb',origin_region_id:'b',destination_region_id:'b',period_id:'early',series_id:fixture.series.one,status:'value',value:0}];map.setData(colors);
    const layer=map.spec.layers[0];map.setLayers([{...layer,encoding:{color:{dataset_id:colors.id,relation_series_id:fixture.series.one,relation_slice:{axis:'destination',region_id:'b'}},size:{dataset_id:fixture.dataset.id,relation_series_id:fixture.series.one,relation_slice:{axis:'origin',region_id:'a'}}}}]);
    assert.match(glyph(map,'a'),/fill="#112233"/);assert.match(glyph(map,'b'),/fill="#778899"/);
    const channels=lib.buildTooltip(map,{layer_id:'theme',region_id:'a'}).channels;
    assert.equal(channels[0].observation.value,5);assert.equal(channels[1].observation.value,-7);
    assert.equal(channels[0].relation_slice.axis,'origin');assert.equal(channels[1].relation_slice.axis,'destination');assert.deepEqual(channels[1].relation_slice.source_relation_ids,['color-ab']);
    assert.equal(channels[1].reported_observation.id,'color-ab');assert.equal(channels[1].relation_slice.destination_region_id,'b');
    assert.match(map.export('csv',{relationSlice:true,datasetId:colors.id}),/color-ab/);assert.equal(map.capabilities()[0].supported,true);
  }finally{map.destroy();}
});

test('numeric color missing does not activate a size exception while absent size retains its category exception',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    const dataset=structuredClone(fixture.dataset);dataset.observations.filter(row=>row.series_id===fixture.series.category&&row.region_id==='gap').forEach(row=>{row.status='value';row.value='first';});map.setData(dataset);
    const layer=map.spec.layers[0];map.setLayers([{...layer,encoding:{...layer.encoding,exception:{dataset_id:dataset.id,series_id:fixture.series.category}},options:{...layer.options,exceptions:{categoryColors:{first:'#fedcba',second:'#abcdef'}}}}]);
    assert.match(glyph(map,'b'),/data-color-status="suppressed"/);assert.equal(glyph(map,'gap'),undefined);
    assert.match(map.lastRender.renders[0].svg,/data-region-id="gap" data-exception="first"[^>]*fill="#fedcba"/);
    assert.ok(map.lastRender.legends[0].color);assert.equal(map.lastRender.legends[0].exceptions.length,2);
    map.setLegendFilter('theme',['exception:first']);assert.match(glyph(map,'a'),/data-filtered="true"/);
  }finally{map.destroy();}
});

test('empty color periods still reject bad palettes and category sizes fail standalone validation',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    map.setView({period_id:'empty'});const before=map.spec;
    assert.throws(()=>map.setLayers([{...before.layers[0],options:{colors:['invalid'],colorMode:'continuous'}}]),error=>error.code==='INVALID_COLOR');assert.equal(map.spec,before);
    const layer=before.layers[0];assert.throws(()=>lib.validateMapSpec({...before,layers:[{...layer,encoding:{dataset_id:fixture.dataset.id,series_id:fixture.series.category}}]},fixture.geography,map.datasets),error=>error.code==='INVALID_ENCODING');
  }finally{map.destroy();}
});

test('automatic size/color legends avoid displaced Dorling glyphs and fixed overlaps are diagnosed',()=>{
  const fixture=symbolColorFixture(lib),map=lib.createMap(fixture.bundle);
  try{
    map.setLayout({type:'dorling',worker:false});
    const result=map.render(),panel=result.legendLayout.panels[0];
    const intersects=(box,node)=>box.x<node.x+node.radius&&box.x+box.width>node.x-node.radius&&box.y<node.y+node.radius&&box.y+box.height>node.y-node.radius;
    assert.ok([...map.layoutPositions.values()].every(node=>!intersects(panel.bounds,node)));
    const node=map.layoutPositions.get('a'),layer=map.spec.layers[0];map.setLayers([{...layer,legend:{x:node.x+6,y:node.y+14}}]);
    assert.ok(map.lastRender.diagnostics.some(item=>item.code==='LEGEND_COLLISION'));
    assert.equal(map.lastRender.legends[0].marks.at(-1).radius,20);
  }finally{map.destroy();}
});

test('symbol color themes use the matching palette and explicit palettes override defaults',()=>{
  for(const kind of ['numeric','category']){
    const fixture=symbolColorFixture(lib,'canonical',kind),map=lib.createMap(fixture.bundle);
    try{
      const layer=map.spec.layers[0];map.setLayers([{...layer,options:{maxRadius:20}}]);map.setTheme({numericColors:['#101010','#202020','#303030'],categoryColors:['#abcdef','#fedcba']});
      assert.match(glyph(map,'a'),kind==='category'?/fill="#abcdef"/:/fill="#101010"/);
      assert.equal(map.lastRender.legends[0].color.items[0].color,kind==='category'?'#abcdef':'#101010');
      map.setLayers([{...map.spec.layers[0],options:{colors:['#123456','#654321']}}]);assert.match(glyph(map,'a'),/fill="#123456"/);
    }finally{map.destroy();}
  }
});
