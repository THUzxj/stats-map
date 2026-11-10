import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, MapLink, SmallMultiples, StoryMap } from '../src/index.js';
import { playbackBundle } from './fixtures/time-playback.js';
import { controlDocument } from './fixtures/control-dom.js';

const make=()=>createMap(playbackBundle());
const chapters=[{id:'early',view:{period_id:'early'},caption:'<em>Early</em>',selection:['a'],sources:[{id:'fictional',title:'Synthetic evidence',url:'https://example.invalid/evidence'}]},{id:'empty',view:{period_id:'empty'},caption:'Empty',selection:['b']},{id:'late',view:{period_id:'late'},caption:'Late',selection:['a','b']}];
const panels=chapters.map(chapter=>({id:chapter.id,period_id:chapter.view.period_id,title:chapter.caption}));

test('overlapping and cyclic links deliver selection hover and zoom once per map',()=>{
  const maps=[make(),make(),make(),make()],links=[new MapLink(maps.slice(0,3),{zoom:true}),new MapLink([maps[1],maps[2],maps[3]],{zoom:true}),new MapLink([maps[3],maps[0]],{zoom:true})];
  for(const [name,apply,check] of [
    ['selectionchange',()=>maps[0].setSelection(['a']),map=>assert.deepEqual(map.getState().selection,['a'])],
    ['regionhover',()=>maps[0].hover('b'),map=>assert.equal(map.hoveredRegionId,'b')],
    ['transformchange',()=>maps[0].setViewTransform({zoom:2,pan:[.1,-.2]}),map=>assert.deepEqual(map.getViewTransform(),maps[0].getViewTransform())]
  ]){
    const counts=maps.map(()=>0),unsubscribers=maps.map((map,index)=>map.on(name,()=>{if(++counts[index]>4)throw Error('unbounded link traffic');}));
    apply();assert.deepEqual(counts,[1,1,1,1]);maps.forEach(check);unsubscribers.forEach(fn=>fn());
  }
  links.forEach(link=>link.destroy());maps.forEach(map=>map.destroy());
});

test('links preserve the original identity through an intermediate subset and isolate geometry revisions',()=>{
  const [a,b,c,d]=[make(),make(),make(),make()];
  // Simulate an independent consumer exposing a subset of registered IDs.
  b.geography={...b.geography,regions:b.geography.regions.filter(region=>region.id==='a')};
  d.geography={...d.geography,revision:'other-revision'};
  const links=[new MapLink([a,b]),new MapLink([b,c,d])];
  a.setSelection(['a','b']);assert.deepEqual(b.getState().selection,['a']);assert.deepEqual(c.getState().selection,['a','b']);assert.deepEqual(d.getState().selection,[]);
  a.hover('b');assert.equal(b.hoveredRegionId,null);assert.equal(c.hoveredRegionId,'b');assert.equal(d.hoveredRegionId,undefined);
  links.forEach(link=>link.destroy());[a,b,c,d].forEach(map=>map.destroy());
});

test('a failing linked target reports its error and does not prevent other maps or independent nested actions',()=>{
  const [a,b,c]=[make(),make(),make()],link=new MapLink([a,b,c]),errors=[];b.on('error',event=>errors.push(event));b.setSelection=()=>{throw Error('synthetic target failure');};
  a.setSelection(['a']);assert.deepEqual(c.getState().selection,['a']);assert.equal(errors[0].error.code,'LINK_FAILED');assert.equal(errors[0].error.cause.message,'synthetic target failure');assert.equal(errors[0].target_instance_id,b.instanceId);
  b.destroy();assert.equal(link.maps.includes(b),false);let once=true;c.on('selectionchange',()=>{if(once){once=false;c.hover('b');}});a.setSelection(['b']);assert.equal(a.hoveredRegionId,'b');
  a.destroy();assert.deepEqual(link.maps,[c]);c.destroy();assert.equal(link.destroyed,true);assert.equal(link.subscriptions.size,0);link.destroy();
});

test('a newer selection emitted by a synchronous linked listener supersedes the original transaction',()=>{
  const [a,b,c]=[make(),make(),make()],links=[new MapLink([a,b,c]),new MapLink([a,c])];let once=true;
  b.on('selectionchange',()=>{if(once){once=false;b.setSelection(['b']);}});a.setSelection(['a']);for(const map of [a,b,c])assert.deepEqual(map.getState().selection,['b']);
  links.forEach(link=>link.destroy());[a,b,c].forEach(map=>map.destroy());
});

test('link declarations validate before subscribing and disabled channels stay independent',()=>{
  const a=make(),b=make();let subscriptions=0;const on=a.on.bind(a);a.on=(...args)=>{subscriptions++;return on(...args);};
  for(const args of [[null,{}],[[a,null],{}],[[a],null],[[a],{hover:'yes'}]])assert.throws(()=>new MapLink(...args),error=>error.code==='INVALID_ARGUMENT');assert.equal(subscriptions,0);
  const link=new MapLink([a,b],{selection:false,hover:false,zoom:true});b.setLayout({type:'grid-square'});a.setSelection(['a']);a.hover('a');a.setViewTransform({zoom:3,pan:[0,0]});assert.deepEqual(b.getState().selection,[]);assert.equal(b.hoveredRegionId,undefined);assert.equal(b.getViewTransform().zoom,1);
  link.destroy();a.destroy();assert.throws(()=>new MapLink([a,b]));b.destroy();
});

test('failed small-multiple pages retain old maps DOM and page, then recover',()=>{
  const document=controlDocument(),container=document.createElement('main'),multiples=new SmallMultiples(container,playbackBundle(),panels,{pageSize:1}),old=multiples.maps[0],oldChildren=container.children;
  multiples.panels[1].encodings={primary:{dataset_id:'amounts',series_id:'unknown'}};
  assert.throws(()=>multiples.showPage(1));assert.equal(multiples.page,0);assert.equal(multiples.maps[0],old);assert.equal(old.destroyed,false);assert.equal(container.children,oldChildren);
  delete multiples.panels[1].encodings;multiples.showPage(1);assert.equal(old.destroyed,true);assert.equal(multiples.page,1);assert.equal(multiples.maps[0].spec.view.period_id,'empty');
  assert.throws(()=>multiples.showPage(-1));assert.equal(multiples.page,1);multiples.destroy();assert.equal(container.children.length,0);assert.throws(()=>multiples.showPage(0),error=>error.code==='LIFECYCLE');multiples.destroy();
});

test('staging failures dispose newly mounted panels and keep old page listeners alive',()=>{
  const document=controlDocument(),container=document.createElement('main'),multiples=new SmallMultiples(container,playbackBundle(),[...panels,{id:'last',period_id:'late'}],{pageSize:2});
  const old=[...multiples.maps],created=[],mount=old[0].constructor.prototype.mount;
  const prototype=old[0].constructor.prototype;prototype.mount=function(target){created.push(this);if(created.length===2)throw Error('synthetic mount failure');return mount.call(this,target);};
  try{assert.throws(()=>multiples.showPage(1),/synthetic mount failure/);assert.equal(created.length,2);assert.ok(created.every(map=>map.destroyed));assert.ok(old.every(map=>!map.destroyed));old[0].setSelection(['a']);assert.deepEqual(old[1].getState().selection,['a']);}
  finally{prototype.mount=mount;multiples.destroy();}
});

test('small-multiple pagination controls preserve focus and report failed pages without uncaught DOM errors',()=>{
  const document=controlDocument(),container=document.createElement('main'),multiples=new SmallMultiples(container,playbackBundle(),panels,{pageSize:1}),errors=[];
  const controls=()=>container.querySelectorAll('[data-multiples-control]'),next=controls().find(element=>element.getAttribute('data-multiples-control')==='next');assert.equal(next.type,'button');next.focus();next.fire('click');assert.equal(multiples.page,1);assert.equal(document.activeElement.getAttribute('data-multiples-control'),'next');assert.equal(next.listeners.get('click').size,0);
  multiples.maps[0].on('error',event=>errors.push(event));multiples.panels[2].encodings={primary:{dataset_id:'amounts',series_id:'absent'}};document.activeElement.fire('click');assert.equal(multiples.page,1);assert.equal(errors[0].source,'small-multiples');
  delete multiples.panels[2].encodings;document.activeElement.fire('click');assert.equal(multiples.page,2);assert.equal(document.activeElement.getAttribute('data-multiples-control'),'previous');multiples.destroy();
});

test('small-multiple options and declarations are copied and validate before altering the container',()=>{
  const document=controlDocument(),container=document.createElement('main'),sentinel=document.createElement('p');container.replaceChildren(sentinel);
  for(const input of [[null,{}],[[null],{}],[[{id:''}],{}],[[{id:'a',title:()=>''}],{}],[panels,{pageSize:0}],[panels,{width:NaN}],[panels,{controls:'yes'}],[panels,{labels:{next:()=>''}}]])assert.throws(()=>new SmallMultiples(container,playbackBundle(),...input),error=>error.code==='INVALID_ARGUMENT');
  assert.deepEqual(container.children,[sentinel]);const declarations=structuredClone(panels),options={pageSize:1,labels:{next:'Forward'}},multiples=new SmallMultiples(container,playbackBundle(),declarations,options);declarations[1].period_id='late';options.pageSize=20;options.labels.next='Changed';multiples.showPage(1);assert.equal(multiples.maps.length,1);assert.equal(multiples.maps[0].spec.view.period_id,'empty');assert.equal(multiples.options.labels.next,'Forward');multiples.destroy();
});

test('shared numeric domains reject incompatible series semantics while independent domains remain available',()=>{
  for(const change of ['unit','scope','measure','review']){
    const bundle=playbackBundle(),dataset=bundle.resources.find(entry=>entry.resource.id==='amounts').resource;
    if(change==='unit'){dataset.units.push({id:'other-unit',label:'Other',dimension:'different'});dataset.series[1].unit_id='other-unit';}
    if(change==='scope'){dataset.scopes.push({id:'other-scope',description:'different'});dataset.series[1].scope_id='other-scope';}
    if(change==='measure')dataset.series[1].measure_type='estimate';
    if(change==='review')dataset.series[1].review_status='unreviewed';
    const declarations=[{id:'one',series_id:'one'},{id:'two',series_id:'two'}];
    assert.throws(()=>new SmallMultiples(null,bundle,declarations),error=>error.code==='INCOMPARABLE_PANELS');
    const independent=new SmallMultiples(null,bundle,declarations,{sharedDomain:false});assert.equal(independent.maps.length,2);independent.destroy();
  }
});

test('page destruction callbacks can replace or destroy the new page without reviving obsolete instances',()=>{
  const multiples=new SmallMultiples(null,playbackBundle(),panels,{pageSize:1});let last;
  multiples.maps[0].on('destroy',()=>{last=multiples.showPage(2)[0];});multiples.showPage(1);assert.equal(multiples.page,2);assert.equal(multiples.maps[0],last);assert.equal(last.destroyed,false);
  last.on('destroy',()=>multiples.destroy());multiples.showPage(0);assert.equal(multiples.destroyed,true);assert.deepEqual(multiples.maps,[]);
});

test('latest reentrant story chapter owns spec selection caption sources and event',()=>{
  const map=make(),caption={textContent:''},story=new StoryMap(map,chapters,{captionElement:caption}),events=[];map.on('storychange',event=>events.push(event));let once=true;
  const stop=map.on('specchange',()=>{if(once){once=false;story.goTo(2);}});story.goTo(1);stop();
  assert.equal(story.index,2);assert.equal(map.spec.view.period_id,'late');assert.deepEqual(map.getState().selection,['a','b']);assert.equal(caption.textContent,'Late');assert.deepEqual(events.map(event=>event.chapter_id),['late']);
  once=true;map.on('selectionchange',()=>{if(once){once=false;story.goTo(0);}});story.goTo(1);assert.equal(story.index,0);assert.equal(map.spec.view.period_id,'early');assert.deepEqual(map.getState().selection,['a']);assert.equal(caption.textContent,'<em>Early</em>');assert.equal(events.at(-1).chapter_id,'early');map.destroy();
});

test('story failures restore controls and can recover; remount and destroy remove handlers',()=>{
  const map=make(),document=controlDocument(),a=document.createElement('div'),b=document.createElement('div'),story=new StoryMap(map,chapters),events=[];map.on('error',event=>events.push(event));story.mount(a);const old=[...a.children];story.mount(b);assert.equal(a.children.length,0);assert.ok(old.every(element=>[...element.listeners.values()].every(handlers=>!handlers.size)));
  const original=map.setSpec.bind(map);map.setSpec=()=>{throw Error('synthetic rejected chapter');};const select=b.children[1];select.value='1';select.fire('change');assert.equal(select.value,'0');assert.equal(story.index,0);assert.match(b.children[5].textContent,/synthetic rejected chapter/);assert.equal(events[0].source,'story');assert.equal(events[0].controller_id,story.id);
  map.setSpec=original;select.value='1';select.fire('change');assert.equal(story.index,1);assert.equal(b.children[5].textContent,'');assert.ok([b.children[0],b.children[2]].every(element=>element.type==='button'));story.unmount();assert.equal(b.children.length,0);story.mount(b);map.destroy();assert.equal(story.destroyed,true);assert.equal(b.children.length,0);story.destroy();assert.throws(()=>story.next(),error=>error.code==='LIFECYCLE');
});

test('story construction rejects malformed declarations and cleans subscriptions after a failed initial chapter',()=>{
  const map=make(),before=map.spec;
  for(const declarations of [null,[],[null],[{id:''}],[{id:'a',caption:()=>''}],[{id:'a',selection:['unknown']}],[{id:'a',sources:[null]}]])assert.throws(()=>new StoryMap(map,declarations));assert.equal(map.spec,before);
  const subscriptions=new Set(),on=map.on.bind(map);map.on=(...args)=>{const unsubscribe=on(...args);subscriptions.add(unsubscribe);return()=>{subscriptions.delete(unsubscribe);unsubscribe();};};map.setSpec=()=>{throw Error('initial failure');};assert.throws(()=>new StoryMap(map,chapters),/initial failure/);assert.equal(subscriptions.size,0);map.destroy();assert.throws(()=>new StoryMap(map,chapters),error=>error.code==='LIFECYCLE');
});

test('destroying a story or its map during chapter events suppresses obsolete captions and events',()=>{
  for(const destroyMap of [false,true]){
    const map=make(),caption={textContent:''},story=new StoryMap(map,chapters,{captionElement:caption}),events=[];
    map.on('storychange',event=>events.push(event));map.on('specchange',()=>destroyMap?map.destroy():story.destroy());
    story.goTo(1);assert.equal(story.destroyed,true);assert.equal(caption.textContent,'<em>Early</em>');assert.equal(events.length,0);map.destroy();
  }
});
