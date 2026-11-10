import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, DatasetView, flowModel, flowSvg, flowLayout, flowNodeRadius, buildLegend, legendSvg, legendHeight, buildTooltip, renderSvg } from '../src/index.js';
import { flowCategory, flowDisplayCategory, flowNetStyle, flowRegionKey } from '../src/renderers/flow-categories.js';
import { intersects } from '../src/components/text-layout.js';
import { flowRibbon } from '../src/renderers/flow-layout.js';
import { targetChannels } from '../src/core/target-data.js';
import { sample } from './fixtures/encoding.js';

function fixture(options={}){
  const {geography,dataset}=sample();
  geography.regions.push(...['c','d'].map(id=>({id,label:id.toUpperCase(),level_id:'area'})));
  dataset.relations=[['ab','a','b',10],['ba','b','a',5],['ac','a','c',20],['da','d','a',4],['bd','b','d',2],['aa','a','a',1000],['cc','c','c',0],['dc','d','c',null]].map(([id,origin,destination,value])=>({id,origin_region_id:origin,destination_region_id:destination,series_id:'one',period_id:'t',value,status:value===null?'missing':'value',evidence:{source_id:id,sha256:'a'.repeat(64)},source_flag:id}));
  const view=new DatasetView(dataset,geography),anchors=new Map([['a',[60,90]],['b',[210,90]],['c',[60,210]],['d',[210,210]]]);
  const model=flowModel(view,'one','t',options);
  return {geography,dataset,view,anchors,model};
}

test('top selectors rank cross-boundary flow in scope, break ties by id, and keep category-only filtering explicit',()=>{
  const {view,dataset}=fixture(),raw=structuredClone(dataset.relations);
  for(const [type,expected] of [['sum','a'],['origin','a'],['destination','c']])assert.deepEqual(flowModel(view,'one','t',{topLocations:1,topLocationsType:type}).top,[expected]);
  assert.deepEqual(flowModel(view,'one','t',{topLocations:1,topLocationsType:'destination'},['a','b']).top,['b']);
  assert.equal(flowModel(view,'one','t',{topLocations:1,topLocationsType:'destination'}).filtered.total,20);
  assert.equal(flowModel(view,'one','t',{topLocations:1,topLocationsType:'destination',filterTopLocations:false}).filtered.total,1041);
  assert.deepEqual(flowModel(view,'one','t',{topLocations:0}).top,[]);
  const tied=structuredClone(view.data);tied.relations=tied.relations.filter(edge=>['ab','ba'].includes(edge.id));tied.relations[1].value=10;
  assert.deepEqual(flowModel(new DatasetView(tied,view.geography),'one','t',{topLocations:1}).top,['a']);
  assert.deepEqual(dataset.relations,raw);
});

test('route color uses the selected endpoint role and merged mixed categories never imply a direction',()=>{
  for(const type of ['sum','origin','destination']){
    const {model,anchors}=fixture({topLocations:4,topLocationsType:type,filterTopLocations:false,reciprocalMode:'merged',gradient:true,topColors:['#112233','#445566','#778899','#aabbcc']});
    const ab=model.edges.find(edge=>edge.id==='ab');
    assert.equal(flowCategory(model,ab),flowRegionKey(type==='origin'?'a':'b'));
    const route=model.displayEdges.find(edge=>edge.route_id&&edge.source_relation_ids.includes('ab'));
    assert.equal(flowDisplayCategory(model,route),'mixed');
    const result=flowSvg(model,anchors);assert.equal(result.layout.edges.find(edge=>edge.id===route.id).category_key,'mixed');
    const legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'},options:model.options},fixture().view,'t');
    assert.ok(legend.items.some(item=>item.key==='mixed'));
    assert.match(legendSvg(legend),/Mixed route categories/);
  }
});

test('donut groups partition each node exactly once with original directed evidence in every mode',()=>{
  for(const type of ['sum','origin','destination'])for(const reciprocalMode of ['separate','midpoint','merged'])for(const showInternal of [true,false]){
    const {model,anchors,view}=fixture({nodeShape:'donut',topLocations:2,topLocationsType:type,filterTopLocations:false,showInternal,reciprocalMode});
    for(const [id,node] of model.filtered.nodes){
      const groups=model.breakdowns.get(id),records=groups.flatMap(group=>group.source_relation_ids);
      assert.equal(new Set(records).size,records.length);
      assert.equal(groups.reduce((sum,group)=>sum+group.value,0),node.incoming+node.outgoing+node.internal);
      for(const group of groups){assert.equal(group.value,group.source_relation_ids.reduce((sum,id)=>sum+model.edgeIndex.get(id).value,0));if(group.channel!=='internal')for(const id of group.source_relation_ids)assert.equal(flowCategory(model,model.edgeIndex.get(id)),group.key);}
    }
    const svg=flowSvg(model,anchors).body;assert.doesNotMatch(svg,/NaN|Infinity/);
    assert.equal((svg.match(/data-flow-channel="internal"/g)??[]).length,showInternal?1:0);
    const reverse=flowModel(new DatasetView({...view.data,relations:[...view.data.relations].reverse()},view.geography),'one','t',model.options);
    assert.deepEqual(model.breakdowns,reverse.breakdowns);
    assert.deepEqual(flowSvg(model,anchors),flowSvg(reverse,anchors));
  }
});

test('net regions use filtered raw directions, cancel internal, preserve equal-flow neutral areas and share legend styles',()=>{
  const {model,view,geography}=fixture({regionColors:['#112233','#445566'],regionLabels:['Supply','Receive'],minValue:6});
  assert.deepEqual(flowNetStyle(model,'a'),{key:'exporter',value:-30,color:'#112233',label:'Supply'});
  assert.equal(flowNetStyle(model,'b').value,10);assert.equal(flowNetStyle(model,'d'),null);
  assert.equal(flowNetStyle(flowModel(view,'one','t',{regionColors:false}),'a'),null);
  const result=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layer:{id:'flows',type:'flow',encoding:{relation_series_id:'one'},options:model.options}});
  assert.match(result.svg,/data-flow-net="exporter"[^>]+fill="#112233"/);
  const legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'},options:model.options},view,'t');
  assert.ok(legend.items.some(item=>item.label==='Supply'&&item.color==='#112233'));
  const equal=structuredClone(view.data);equal.relations=equal.relations.filter(edge=>['ab','ba','aa'].includes(edge.id));equal.relations[1].value=10;
  assert.equal(flowNetStyle(flowModel(new DatasetView(equal,geography),'one','t'),'a'),null);
});

test('node size and legend use the same explicit domain with missing anchors, zero, floors and area/radius modes',()=>{
  assert.equal(flowNodeRadius(0,100,{minNodeRadius:3}),0);
  assert.equal(flowNodeRadius(25,100,{maxNodeRadius:20}),10);
  assert.equal(flowNodeRadius(25,100,{maxNodeRadius:20,nodeSizeScale:'radius'}),5);
  assert.equal(flowNodeRadius(25,100,{maxNodeRadius:20,minNodeRadius:4}),12);
  assert.equal(flowNodeRadius(200,100,{maxNodeRadius:20}),20);
  const {model,anchors,view}=fixture({maxNodeValue:2000,nodeSizeScale:'radius',minNodeRadius:2});
  anchors.delete('a');const layout=flowLayout(model,anchors);
  const legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'},options:model.options},view,'t');
  assert.equal(legend.nodeMaximum,2000);assert.equal(layout.nodes.get('b').radius,flowNodeRadius(17,legend.nodeMaximum,model.options));
  assert.match(legendSvg(legend),/Incoming \+ outgoing \+ internal/);assert.ok(legendHeight(legend)>220);
});

test('donut tooltip resolves category totals and evidence from current data rather than supplied SVG totals',()=>{
  const {geography,dataset}=fixture(),map=createMap(null,{geography,dataset});
  const options={nodeShape:'donut',topLocations:1,topLocationsType:'destination',filterTopLocations:false};
  map.setLayers([{id:'flows',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options}]);
  const target={layer_id:'flows',region_id:'a',flow_channel:'outgoing',flow_category:flowRegionKey('c'),value:999};
  const tip=buildTooltip(map,target);assert.equal(tip.derived.type,'flow-node-breakdown');assert.equal(tip.derived.value,20);assert.equal(tip.derived.region_id,'a');assert.equal(tip.derived.category_region_id,'c');
  assert.deepEqual(tip.derived.source_relation_ids,['ac']);assert.equal(tip.channels[0].observation,null);assert.equal(tip.channels[0].reported_observation,null);
  assert.ok(tip.rows.some(row=>row.label.includes('ac')&&row.value.includes('a'.repeat(64))));
  const channel=targetChannels(map,target)[0];assert.deepEqual(channel.relations.map(edge=>edge.id),['ac']);
  assert.equal(buildTooltip(map,{...target,flow_category:'spoof'}),null);
  const svg=map.export('svg');assert.match(svg,/data-flow-category="\[&quot;region&quot;,&quot;c&quot;\]"/);assert.match(svg,/ac: 20/);
  assert.match(map.export('csv'),/dc/);assert.match(map.export('csv'),/missing/);map.destroy();
});

test('flow labels reuse wrapping and collision placement against nodes, legends, insets and decorations',()=>{
  const {geography,dataset,model,anchors}=fixture({nodeLabels:{content:'name-value',offset:[7,0],maxWidth:85}});
  const obstacle={x:70,y:70,width:70,height:40},result=flowSvg(model,anchors,'labels',{width:400,height:300,obstacles:[obstacle]});
  for(const label of result.layout.labels.values())if(label.visible)assert.equal(intersects(label.box,obstacle,3),false);
  const map=createMap(null,{geography,dataset,width:600,height:500});
  map.setSpec({...map.spec,layers:[{id:'flows',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options:{nodeLabels:{maxOffset:100,maxWidth:80}}}],legend:{x:200,y:20},decorations:{labels:{collision:'avoid'}},insets:[{id:'detail',x:20,y:280,width:180,height:100,region_ids:['a','b']}]});
  const rendered=map.render(),legendBox={x:194,y:6,width:210,height:legendHeight(rendered.legends[0])+18};
  for(const label of rendered.renders[0].flowLayout.labels.values())if(label.visible){assert.equal(intersects(label.box,legendBox),false);assert.equal(intersects(label.box,{x:20,y:300,width:180,height:100}),false);}
  assert.match(rendered.svg,/data-flow-label=/);assert.equal(map.getState().selection.length,0);map.destroy();
});

test('flow option contracts reject invalid selectors, palettes, labels and node sizes transactionally',()=>{
  const {view,geography,dataset}=fixture(),map=createMap(null,{geography,dataset});
  const original=map.exportSpec();
  for(const options of [{topLocationsType:'both'},{topLocations:-1},{filterTopLocations:1},{regionColors:[]},{regionLabels:['one']},{topColors:[]},{internalColor:3},{nodeLabels:[]},{nodeLabels:{offset:[NaN,0]}},{nodeLabels:{step:.5}},{nodeLabels:{maxOffset:1001}},{nodeLabels:{content:'unknown'}},{nodeSizeScale:'unknown'},{minNodeRadius:13,maxNodeRadius:12}]){
    assert.throws(()=>flowModel(view,'one','t',options));
    assert.throws(()=>map.setLayers([{id:'flows',type:'flow',encoding:{dataset_id:dataset.id,relation_series_id:'one'},options}]));assert.deepEqual(map.exportSpec(),original);
  }
  map.destroy();
});

test('directed categorical gradients end at the category color while merged routes keep a neutral constant band',()=>{
  const {view,anchors}=fixture();
  const options={topLocations:4,filterTopLocations:false,topLocationsType:'destination',regionColors:['#112233','#445566'],topColors:['#010101','#020202','#030303','#040404'],gradient:true,opacityGradient:true,widthGradient:true};
  const directed=flowSvg(flowModel(view,'one','t',options),anchors);
  assert.match(directed.definitions,/<stop offset="0" stop-color="#112233" stop-opacity="0.25"\/><stop offset="1" stop-color="#0[1-4]0[1-4]0[1-4]"/);
  const merged=flowSvg(flowModel(view,'one','t',{...options,reciprocalMode:'merged'}),anchors);
  for(const edge of merged.layout.edges.filter(edge=>edge.route_id))assert.equal(edge.render_path,flowRibbon(edge.points,edge.width,{...options,widthGradient:false,pointedTip:false}));
  assert.equal((merged.definitions.match(/<linearGradient /g)??[]).length,2); // two original self loops, including zero
});

test('region ids named Other and Internal remain distinct from derived donut groups',()=>{
  const {geography,dataset}=sample();
  geography.regions.push(...['Other','Internal'].map(id=>({id,label:id,level_id:'area'})));
  dataset.relations=[['one','a','Other',9],['two','a','Internal',8],['three','b','a',1],['self','a','a',3]].map(([id,origin_region_id,destination_region_id,value])=>({id,origin_region_id,destination_region_id,value,status:'value',series_id:'one',period_id:'t'}));
  const model=flowModel(new DatasetView(dataset,geography),'one','t',{topLocations:2,topLocationsType:'destination',filterTopLocations:false});
  const keys=model.breakdowns.get('a').map(group=>group.key);
  assert.ok(keys.includes(flowRegionKey('Other'))&&keys.includes(flowRegionKey('Internal'))&&keys.includes('other')&&keys.includes('internal'));
  assert.equal(new Set(keys).size,4);
});

test('net fills follow grid and Dorling region cells without inventing geographic polygons',()=>{
  const {view,geography}=fixture();
  for(const [layoutType,cell,tag] of [['grid-square',{x:90,y:80,size:40},'rect'],['grid-hex',{x:90,y:80,size:40,shape:'hexagon'},'polygon'],['dorling',{x:90,y:80,radius:20},'circle']]){
    const result=renderSvg({geography,datasetView:view,spec:{view:{period_id:'t'}},layoutType,layoutPositions:new Map([['a',cell],['b',{...cell,x:220}]]),layer:{id:'flows',type:'flow',encoding:{relation_series_id:'one'}}});
    assert.match(result.svg,new RegExp(`<${tag} data-region-id="a" data-flow-net="exporter"`));assert.doesNotMatch(result.svg,/<path data-region-id="a" data-flow-net=/);
  }
});

test('all selector, mode and node-shape combinations share categories, net totals and unmodified original records',()=>{
  const {view,anchors}=fixture(),raw=structuredClone(view.data.relations);
  for(const topLocationsType of ['sum','origin','destination'])for(const mode of ['straight','curved','sankey'])for(const nodeShape of ['circle','donut'])for(const reciprocalMode of ['separate','midpoint','merged']){
    const model=flowModel(view,'one','t',{topLocations:2,topLocationsType,mode,nodeShape,reciprocalMode,filterTopLocations:false,nodeLabels:true,gradient:true,outline:true});
    const result=flowSvg(model,anchors,'matrix',{width:400,height:300});
    assert.equal(result.renderedTotal,1041);assert.equal(model.filtered.total,1041);assert.equal(flowNetStyle(model,'a').value,-21);assert.doesNotMatch(result.body,/NaN|Infinity/);
    assert.equal(model.breakdowns.get('a').reduce((sum,group)=>sum+group.value,0),1039);
  }
  assert.deepEqual(view.data.relations,raw);
});

test('a donut with categorical ranking disabled still explains its Other and Internal colors',()=>{
  const {view}=fixture(),legend=buildLegend({type:'flow',encoding:{relation_series_id:'one'},options:{nodeShape:'donut',topLocations:0,color:'#123456',internalColor:'#456789'}},view,'t');
  assert.ok(legend.items.some(item=>item.key==='other'&&item.color==='#123456'));
  assert.ok(legend.items.some(item=>item.key==='internal'&&item.color==='#456789'));
});
