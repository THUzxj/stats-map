import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, createPresentation, resolveTheme, buildLegend, legendSvg, DatasetView, chinaBundle, euroBundle } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

test('translated map titles stay outside insets and decoration overrides follow the current locale',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset,locale:'fr'});
  map.setSpec({...map.spec,title:'Original',titles:{fr:'Carte principale'},decorations:{source:{text:'Original source',labels:{fr:'Source traduite'}},subtitle:{text:'Original subtitle',labels:{fr:'Sous-titre'}}},insets:[{id:'detail',x:500,y:300,width:200,height:160,decorations:{labels:true}}]});
  assert.match(map.export('svg'),/aria-label="Carte principale"/);assert.match(map.export('svg'),/Source traduite/);assert.match(map.export('svg'),/Sous-titre/);
  assert.equal(map.render().insets[0].spec.titles,undefined);assert.equal((map.export('svg').match(/data-map-title/g)??[]).length,1);
  map.setSpec({...map.spec,decorations:{source:null}});assert.doesNotMatch(map.export('svg'),/data-map-source/);map.destroy();
});

test('presentation uses instance BCP 47 locales, translated dictionaries and plain-text message overrides',()=>{
  const de=createPresentation({locale:'de-DE'}),fr=createPresentation({locale:'fr-FR'}),zh=createPresentation({locale:'zh-CN'});
  assert.equal(de.number(1234.5),'1.234,5');assert.match(fr.number(1234.5),/1\s234,5/);assert.equal(zh.t('legend'),'图例');assert.equal(fr.t('missing'),'Aucune donnée');
  const custom=createPresentation({locale:'fr-CA',messages:{legend:'Clé personnalisée',scaleAt:'Latitude {latitude}'}});
  assert.equal(custom.t('legend'),'Clé personnalisée');assert.equal(custom.t('scaleAt',{latitude:'25,5'}),'Latitude 25,5');assert.equal(custom.t('zero'),'Total nul');
  assert.equal(custom.label({label:'Original',labels:{fr:'Français'}}),'Français');assert.equal(custom.label({label:'Original',labels:{'fr-CA':'Québec',fr:'Français'}}),'Québec');
  assert.equal(createPresentation({locale:'ar'}).direction,'rtl');assert.equal(createPresentation({view:{locale:'de'},locale:'fr'}).language,'de');
  assert.throws(()=>createPresentation({locale:['en']}),error=>error.code==='INVALID_LOCALE');
});

test('simultaneous maps isolate themes, translated labels, numeric formats and selection without changing observations',()=>{
  const {geography,dataset}=sample();geography.regions[0].labels={de:'Gebiet A',fr:'Région A'};dataset.units[0].labels={de:'Stück',fr:'éléments'};dataset.series[0].labels={de:'Menge',fr:'Quantité'};
  dataset.observations.find(row=>row.id==='a-0').value=1234.5;dataset.observations.find(row=>row.id==='b-0').status='missing';dataset.observations.find(row=>row.id==='b-0').value=null;
  const original=structuredClone(dataset),first=createMap(null,{geography,dataset,locale:'en-US'}),second=createMap(null,{geography,dataset,locale:'de-DE',theme:'dark'});
  first.setSpec({...first.spec,decorations:{labels:true}});second.setSpec({...second.spec,decorations:{labels:true}});second.setSelection(['a']);
  const a=first.export('svg'),b=second.export('svg');
  assert.match(a,/1,234\.5 items/);assert.match(b,/1\.234,5 Stück/);assert.match(b,/Gebiet A/);assert.match(b,/Keine Daten/);
  assert.match(b,/<rect data-map-background="true"[^>]+fill="#111827"/);assert.match(b,/data-map-selection="true"[^>]+stroke="#facc15"/);assert.match(a,/<rect data-map-background="true"[^>]+fill="#ffffff"/);
  assert.equal(first.spec.locale,'en-US');assert.deepEqual(dataset,original);assert.match(second.export('csv'),/1234\.5/);assert.deepEqual(second.getState().selection,['a']);
  second.setLocale('fr-FR');assert.match(second.export('svg'),/Région A/);assert.match(second.export('svg'),/Aucune donnée/);assert.deepEqual(second.getState().selection,['a']);first.destroy();second.destroy();
});

test('theme palettes, explicit color overrides and missing fills stay identical between surfaces and legends',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});
  map.setLayers([{id:'base',role:'base',type:'choropleth',encoding:{dataset_id:dataset.id,series_id:'one'},classification:{method:'threshold',thresholds:[20]}}]);
  const breaks=map.render().renders[0].domain.breaks;
  map.setTheme({base:'dark',numericColors:['#123456','#abcdef']});let result=map.render();assert.match(result.svg,/data-region-id="a"[^>]+fill="#123456"/);assert.equal(result.legends[0].items[0].color,'#123456');
  map.setLayers([{...map.spec.layers[0],options:{colors:['#112233','#445566']}}]);result=map.render();assert.match(result.svg,/data-region-id="a"[^>]+fill="#112233"/);assert.equal(result.legends[0].items[0].color,'#112233');assert.deepEqual(result.renders[0].domain.breaks,breaks);
  dataset.observations.find(row=>row.id==='a-0').status='missing';dataset.observations.find(row=>row.id==='a-0').value=null;map.setData(dataset);map.setLayers([{...map.spec.layers[0],options:{noDataColor:'#aabbcc'}}]);result=map.render();assert.match(result.svg,/data-region-id="a"[^>]+fill="#aabbcc"/);assert.match(result.legend,/fill="#aabbcc"/);map.destroy();
});

test('bivariate palettes and composition zero/conflict colors share their actual themed legend styles',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});const colors=Array.from({length:9},(_,i)=>'#'+(i+1).toString(16).padStart(6,'0'));
  map.setTheme({base:'dark',bivariateColors:colors});map.setRenderer('bivariateChoropleth',{dataset_id:dataset.id,series_ids:['one','two']});let result=map.render();assert.match(result.svg,/data-region-id="b"[^>]+fill="#000009"/);assert.equal(result.legends[0].cells.find(cell=>cell.x===2&&cell.y===2).color,'#000009');
  for(const row of dataset.observations)row.value=row.region_id==='a'?0:row.series_id==='total'?1:10;
  map.setData(dataset);map.setRenderer('stripeComposition',{dataset_id:dataset.id,series_ids:['one','two']},{totalSeriesId:'total'});map.setLocale('fr');result=map.render();
  assert.match(result.svg,/data-region-id="a"[^>]+fill="#111827"/);assert.match(result.svg,/data-region-id="b"[^>]+fill="#7f1d1d"/);assert.match(result.legend,/Total nul/);assert.match(result.legend,/Composantes incompatibles/);assert.match(result.legend,/fill="#7f1d1d"/);map.destroy();
});

test('numeric, size, time, alpha, composition and flow legends all use the declared locale',()=>{
  const {geography,dataset}=sample();dataset.periods.push({id:'late',label:'Later',labels:{fr:'Plus tard'},order:1});dataset.relations=[{id:'ab',series_id:'one',period_id:'t',origin_region_id:'a',destination_region_id:'b',value:1234.5,status:'value'}];
  const view=new DatasetView(dataset,geography),spec={locale:'fr-FR',view:{period_id:'t'}};
  for(const [type,encoding,expected] of [['choropleth',{series_id:'one'},'Légende'],['proportionalSymbol',{series_id:'one'},'Surface'],['alpha',{series_ids:['one','two']},'Opacité'],['sparkline',{series_id:'one'},'Axe vertical commun'],['pieChart',{series_ids:['one','two']},'Autres'],['flow',{relation_series_id:'one'},'Avant filtrage']]){
    const layer={id:'test',type,encoding:{dataset_id:dataset.id,...encoding},options:type==='pieChart'?{totalSeriesId:'total'}:{}};
    const legend=buildLegend(layer,view,'t',{spec});assert.match(legendSvg(legend),new RegExp(expected));
  }
});

test('invalid locale, theme tokens, number format and messages leave a map transaction unchanged',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset});map.render();const spec=map.spec,svg=map.lastRender.svg;
  for(const patch of [{locale:'not_a_locale'},{messages:{missing:5}},{theme:'unknown'},{theme:{background:'url(https://example.invalid/image)'}},{theme:{numericColors:[]}},{theme:{bivariateColors:['#ffffff']}},{number_format:{minimumFractionDigits:10,maximumFractionDigits:1}}]){
    assert.throws(()=>map.setSpec({...spec,...patch}));assert.equal(map.spec,spec);assert.equal(map.lastRender.svg,svg);
  }
  assert.throws(()=>resolveTheme({fontFamily:'bad; color:red'}));map.destroy();
});

test('resolved exports freeze locale, message catalog, theme and reduced motion for independent reopening',()=>{
  const {geography,dataset}=sample(),map=createMap(null,{geography,dataset,locale:'fr-FR',theme:'dark'});map.setSpec({...map.spec,messages:{legend:'Ma légende'},interaction:{reducedMotion:true}});
  const spec=map.exportSpec({resolved:true});assert.equal(spec.locale,'fr-FR');assert.equal(spec.messages.legend,'Ma légende');assert.equal(spec.messages.missing,'Aucune donnée');assert.equal(spec.theme.selection,'#facc15');assert.equal(spec.interaction.reducedMotion,true);
  const reopened=createMap(null,{geography,dataset,spec});assert.match(reopened.export('svg'),/Ma légende/);assert.match(reopened.export('svg'),/lang="fr-FR"/);assert.match(reopened.export('svg'),/data-reduced-motion="true"/);assert.equal(reopened.render().legends[0].presentation.theme.background,'#111827');map.destroy();reopened.destroy();
});

test('reduced-motion media changes rerender only the mounted instance and release their listeners',()=>{
  const {geography,dataset}=sample(),listeners=new Set(),query={matches:true,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  const container={innerHTML:'',style:{},setAttribute(){},addEventListener(){},removeEventListener(){}};
  const map=createMap(null,{geography,dataset,matchMedia:()=>query});map.mount(container);assert.match(container.innerHTML,/data-reduced-motion="true"/);assert.equal(listeners.size,1);
  query.matches=false;for(const callback of listeners)callback();assert.match(container.innerHTML,/data-reduced-motion="false"/);map.unmount();assert.equal(listeners.size,0);map.destroy();
});

test('China preserves declared region geometry, anchor and translations and Euro retains the same multilingual identity',()=>{
  const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]},labels={fr:'Zone synthétique',de:'Synthetisches Gebiet'};
  const china=chinaBundle({id:'synthetic-localized',title:'Synthetic',scope_note:'Synthetic',default_locale:'fr',periods:['t'],regions:[{code:'a',name:'A',labels,level:'zone',geometry,point:[1.5,1.5]}],metrics:[{id:'one',name:'Amount',labels:{fr:'Quantité'},unit:'items'}],units:[{id:'items',label:'items',labels:{fr:'éléments'}}],records:[{region_code:'a',period:'t',values:{one:1234.5}}]});
  const euro=euroBundle({geography:{type:'FeatureCollection',features:[{type:'Feature',id:'a',properties:{name:'A',labels},geometry}]},dataset:{records:[{region_id:'a',period_id:'t',value:1234.5}]}},{locale:'fr',unitLabel:'éléments'});
  for(const bundle of [china,euro]){const map=createMap(bundle);map.setSpec({...map.spec,decorations:{labels:true}});assert.match(map.export('svg'),/Zone synthétique/);assert.match(map.export('svg'),/1\s234,5 éléments/);assert.equal(map.geography.features.features.length,1);map.destroy();}
  const geo=china.resources.find(entry=>entry.resource.kind==='stats-map/geography').resource;assert.deepEqual(geo.anchors[0].point,[1.5,1.5]);
});
