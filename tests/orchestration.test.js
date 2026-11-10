import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, MapLink, TimeController, SmallMultiples, StoryMap } from '../src/index.js';
import { sample } from './fixtures/encoding.js';

function map(){const {geography,dataset}=sample();return createMap(null,{geography,dataset});}
function bundle(){
  const instance=map(),result=structuredClone(instance.bundle);instance.destroy();
  const dataset=result.resources.find(entry=>entry.resource.kind==='stats-map/dataset').resource;
  dataset.periods=[{id:'early',label:'Early',order:0},{id:'empty',label:'Empty',order:1},{id:'late',label:'Late',order:2}];
  dataset.observations=dataset.observations.flatMap(observation=>[{...observation,id:observation.id+'early',period_id:'early'},{...observation,id:observation.id+'late',period_id:'late',value:observation.value*10}]);
  result.resources.find(entry=>entry.resource.kind==='stats-map/spec').resource.view.period_id='early';
  return result;
}

test('linked selection and hover propagate without loops while different layouts keep independent zoom',()=>{
  const a=map(),b=map(),c=map();c.setLayout({type:'grid-square',columns:2});
  a.setLayout({type:'geographic'});b.setLayout({type:'geographic'});
  const link=new MapLink([a,b,c],{zoom:true}),events=[];
  b.on('selectionchange',payload=>events.push(payload));
  a.setSelection(['a']);
  assert.deepEqual(b.getState().selection,['a']);assert.deepEqual(c.getState().selection,['a']);
  assert.equal(events.length,1);
  let hovered;b.on('regionhover',payload=>hovered=payload.region_id);a.hover('b');assert.equal(hovered,'b');
  a.setViewTransform({zoom:2,pan:[.1,-.2]});
  assert.deepEqual(b.getViewTransform(),a.getViewTransform());
  assert.equal(c.getViewTransform().zoom,1);
  link.destroy();a.setSelection(['b']);assert.deepEqual(b.getState().selection,['a']);
  a.destroy();b.destroy();c.destroy();
});

test('time playback keeps declared empty periods and clears timers on pause, end and map destruction',()=>{
  const instance=createMap(bundle()),scheduled=new Map();let id=0;
  const controller=new TimeController(instance,{setInterval:callback=>{scheduled.set(++id,callback);return id;},clearInterval:id=>scheduled.delete(id)});
  controller.play();assert.equal(scheduled.size,1);controller.play();assert.equal(scheduled.size,1);
  scheduled.values().next().value();assert.equal(instance.spec.view.period_id,'empty');
  scheduled.values().next().value();assert.equal(instance.spec.view.period_id,'late');
  scheduled.values().next().value();assert.equal(scheduled.size,0);
  controller.seek(0);controller.play();controller.pause();assert.equal(scheduled.size,0);
  controller.play();instance.destroy();assert.equal(scheduled.size,0);assert.equal(controller.destroyed,true);
});

test('time controls follow external view and data updates and pause on playback errors',()=>{
  const instance=createMap(bundle()),scheduled=new Map();let id=0;
  const controller=new TimeController(instance,{setInterval:callback=>{scheduled.set(++id,callback);return id;},clearInterval:id=>scheduled.delete(id)});
  const element=()=>({textContent:'',setAttribute(name,value){this[name]=value;},addEventListener(){},removeEventListener(){}}),container={ownerDocument:{createElement:element},replaceChildren(...children){this.children=children;}};
  controller.mount(container);instance.setView({period_id:'late'});
  assert.equal(controller.index,2);assert.equal(container.children[3].value,'2');assert.equal(container.children[4].textContent,'Late');assert.equal(container.children[2].disabled,true);
  const dataset=structuredClone([...instance.datasets.values()][0]);dataset.periods=[{id:'late',label:'Renamed',order:0}];dataset.observations=dataset.observations.filter(observation=>observation.period_id==='late');
  instance.setData(dataset);assert.equal(controller.index,0);assert.equal(container.children[3].max,'0');assert.equal(container.children[4].textContent,'Renamed');assert.equal(container.children[1].disabled,true);
  instance.setBundle(bundle());assert.equal(controller.index,0);assert.equal(container.children[3].max,'2');
  controller.play();const errors=[];instance.on('error',error=>errors.push(error));instance.setView=()=>{throw Error('synthetic render failure');};
  scheduled.values().next().value();assert.equal(scheduled.size,0);assert.equal(errors[0].error.code,'PLAYBACK_FAILED');assert.equal(errors[0].error.cause.message,'synthetic render failure');
  instance.destroy();assert.equal(container.children.length,0);
});

test('destroy notifies all controllers and remounting removes prior DOM and document listeners',()=>{
  const instance=createMap(bundle()),timers=new Set();let id=0;
  const options={setInterval:()=>{timers.add(++id);return id;},clearInterval:id=>timers.delete(id)};
  const first=new TimeController(instance,options),second=new TimeController(instance,options);first.play();second.play();
  function container(){const listeners=new Set(),documentListeners=new Set(),windowListeners=new Set();return {innerHTML:'',setAttribute(){},addEventListener:event=>listeners.add(event),removeEventListener:event=>listeners.delete(event),ownerDocument:{addEventListener:event=>documentListeners.add(event),removeEventListener:event=>documentListeners.delete(event),defaultView:{addEventListener:event=>windowListeners.add(event),removeEventListener:event=>windowListeners.delete(event)}},listeners,documentListeners,windowListeners};}
  const a=container(),b=container();instance.mount(a);assert.ok(a.listeners.size>0);instance.mount(b);
  assert.equal(a.listeners.size,0);assert.equal(a.documentListeners.size,0);assert.equal(a.windowListeners.size,0);
  instance.destroy();assert.equal(timers.size,0);assert.equal(first.destroyed,true);assert.equal(second.destroyed,true);
  assert.equal(b.listeners.size,0);assert.equal(b.documentListeners.size,0);assert.equal(b.windowListeners.size,0);
});

test('responsive maps preserve normalized zoom and disconnect observers on remount and destruction',()=>{
  const callbacks=[],observers=[];
  class Observer {constructor(callback){callbacks.push(callback);observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}}
  const container=()=>({innerHTML:'',setAttribute(){},addEventListener(){},removeEventListener(){}}),a=container(),b=container(),instance=createMap(bundle(),{responsive:true,ResizeObserver:Observer});
  instance.mount(a);instance.setViewTransform({zoom:2,pan:[.1,-.2]});callbacks[0]([{target:a,contentRect:{width:400,height:300}}]);
  assert.deepEqual(instance.viewport,{width:400,height:300});assert.deepEqual(instance.getViewTransform(),{zoom:2,pan:[.1,-.2]});
  instance.mount(b);assert.equal(observers[0].disconnected,true);callbacks[0]([{target:a,contentRect:{width:100,height:100}}]);assert.equal(instance.viewport.width,400);
  instance.destroy();assert.equal(observers[1].disconnected,true);
});

test('small multiples lock classification domains, retain empty panels and dispose paginated instances',()=>{
  const multiples=new SmallMultiples(null,bundle(),[{id:'first',period_id:'early'},{id:'missing',period_id:'empty'},{id:'last',period_id:'late'}],{pageSize:2});
  assert.equal(multiples.maps.length,2);
  assert.deepEqual(multiples.maps[0].spec.layers[0].classification,multiples.maps[1].spec.layers[0].classification);
  assert.match(multiples.maps[1].export('svg'),/fill="#e5e7eb"/);
  const previous=[...multiples.maps];multiples.showPage(1);
  assert.ok(previous.every(instance=>instance.destroyed));
  assert.equal(multiples.maps[0].spec.view.period_id,'late');
  assert.deepEqual(multiples.maps[0].spec.layers[0].classification,previous[0].spec.layers[0].classification);
  const last=multiples.maps[0];multiples.destroy();assert.equal(last.destroyed,true);
});

test('story chapters derive from the base spec and retain sources and plain-text captions',()=>{
  const instance=createMap(bundle()),caption={textContent:''},events=[];
  instance.on('storychange',payload=>events.push(payload));
  const story=new StoryMap(instance,[{id:'start',caption:'<em>plain text</em>',view:{period_id:'early'},selection:['a']},{id:'next',title:'Next',view:{period_id:'late'},selection:['b'],sources:[{id:'synthetic',title:'Synthetic'}]}],{captionElement:caption});
  assert.equal(caption.textContent,'<em>plain text</em>');assert.deepEqual(instance.getState().selection,['a']);
  story.next();assert.equal(instance.spec.view.period_id,'late');assert.deepEqual(instance.getState().selection,['b']);assert.equal(events.at(-1).sources[0].id,'synthetic');
  story.previous();assert.equal(instance.spec.view.period_id,'early');
  story.destroy();assert.throws(()=>story.next(),error=>error.code==='LIFECYCLE');
  instance.destroy();
});

test('story declarations validate every chapter before applying the first view',()=>{
  const instance=createMap(bundle()),prior=instance.spec;
  assert.throws(()=>new StoryMap(instance,[{id:'first',view:{period_id:'late'}},{id:'bad',selection:['unregistered']}]),error=>error.code==='INVALID_ARGUMENT');assert.equal(instance.spec,prior);
  assert.throws(()=>new StoryMap(instance,[{id:'bad',caption:()=>'<b>executable</b>'}]),error=>error.code==='INVALID_ARGUMENT');
  instance.destroy();
});
