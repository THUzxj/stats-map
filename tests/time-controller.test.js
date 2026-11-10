import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, TimeController } from '../src/index.js';
import { playbackBundle, queuedScheduler, controlContainer } from './fixtures/time-playback.js';

test('driver timeline preserves declared order and empty periods without aligning other datasets by index',()=>{
  const map=createMap(playbackBundle()),events=[];map.on('timechange',e=>events.push(e));
  const before=JSON.stringify([...map.datasets.values()]),csv=map.export('csv'),time=new TimeController(map);
  assert.deepEqual(time.periods.map(p=>p.id),['early','empty','late']);
  assert.deepEqual(events.at(-1).unavailable_dataset_ids,['other']);
  assert.equal(events.at(-1).dataset_id,'amounts');assert.equal(events.at(-1).dataset_revision,'r1');
  assert.equal(events.at(-1).controller_id,time.id);assert.equal(events.at(-1).source,'time-controller');
  time.seek(1);assert.equal(map.spec.view.period_id,'empty');assert.deepEqual(events.at(-1).unavailable_dataset_ids,['other']);
  time.seek(2);assert.deepEqual(events.at(-1).unavailable_dataset_ids,[]);
  assert.equal(JSON.stringify([...map.datasets.values()]),before);
  time.seek(0);assert.equal(map.export('csv'),csv);
  const data=map.datasets.get('amounts');assert.equal(data.observations.find(o=>o.region_id==='a'&&o.period_id==='early').value,0);
  assert.equal(data.observations.some(o=>o.period_id==='empty'),false);assert.ok(data.observations.filter(o=>o.period_id==='late').every(o=>o.status==='suppressed'&&o.value===null));
  const other=new TimeController(map,{datasetId:'other'});assert.deepEqual(other.periods.map(p=>p.id),['late','other-only']);assert.equal(other.index,-1);
  other.next();assert.equal(map.spec.view.period_id,'late');other.next();assert.equal(map.spec.view.period_id,'other-only');assert.equal(time.index,-1);
  assert.deepEqual(events.at(-1).unavailable_dataset_ids,['amounts']);map.destroy();
});

test('queued callbacks from paused, restarted, replaced and destroyed playback cannot change the map',()=>{
  const map=createMap(playbackBundle()),clock=queuedScheduler(),time=new TimeController(map,clock.options);
  time.play();const first=clock.callbacks[0];time.pause();first();assert.equal(time.index,0);
  time.play();first();assert.equal(time.index,0);clock.callbacks[1]();assert.equal(time.index,1);
  const old=clock.callbacks[1];map.setData(structuredClone(map.datasets.get('amounts')));old();assert.equal(time.index,1);assert.equal(time.playing,false);
  time.play();const beforeBundle=clock.callbacks.at(-1);map.setBundle(playbackBundle());beforeBundle();assert.equal(time.index,0);
  time.play();const beforeDriver=clock.callbacks.at(-1);map.setLayers(map.spec.layers.map(layer=>layer.id==='primary'?{...layer,encoding:{dataset_id:'other',series_id:'one'}}:layer));beforeDriver();assert.equal(time.datasetId,'other');assert.equal(time.playing,false);assert.equal(map.spec.view.period_id,'early');
  time.play();const beforeDestroy=clock.callbacks.at(-1);map.destroy();beforeDestroy();assert.equal(clock.active.size,0);assert.equal(time.destroyed,true);
  assert.throws(()=>time.seek(0),e=>e.code==='LIFECYCLE');assert.throws(()=>time.play(),e=>e.code==='LIFECYCLE');time.destroy();
});

test('explicit driver loss reports once, disables controls and recovers on bundle replacement',()=>{
  const full=playbackBundle(),map=createMap(full),clock=queuedScheduler(),errors=[],time=new TimeController(map,{...clock.options,datasetId:'other'}),container=controlContainer();
  time.mount(container);map.on('error',e=>errors.push(e));time.play();const stale=clock.callbacks.at(-1);
  const reduced=structuredClone(full);reduced.resources=reduced.resources.filter(e=>e.resource.id!=='other');
  const spec=reduced.resources.find(e=>e.resource.kind==='stats-map/spec').resource;spec.dataset_refs=spec.dataset_refs.filter(r=>r.id!=='other');spec.layers=spec.layers.slice(0,1);
  map.setBundle(reduced);stale();assert.equal(time.error.code,'UNKNOWN_DATASET');assert.equal(time.playing,false);assert.ok(container.children.slice(0,4).every(e=>e.disabled));
  assert.equal(errors.length,1);map.setView({period_id:'late'});assert.equal(errors.length,1);assert.throws(()=>time.play(),e=>e.code==='UNKNOWN_DATASET');
  map.setBundle(full);assert.equal(time.error,null);assert.equal(container.children[3].disabled,false);time.seek(0);assert.equal(map.spec.view.period_id,'late');map.destroy();
});

test('timechange deduplicates same views and permits synchronous listeners to destroy the constructing controller',()=>{
  const map=createMap(playbackBundle()),events=[];map.on('timechange',e=>{events.push(e);map.setView({period_id:e.period_id});});
  const time=new TimeController(map);assert.equal(events.length,1);map.setView({period_id:'early'});assert.equal(events.length,1);
  map.setView({period_id:'late'});assert.equal(events.length,2);assert.equal(time.index,2);map.destroy();
  const other=createMap(playbackBundle());other.on('timechange',()=>other.destroy());const dead=new TimeController(other);assert.equal(dead.destroyed,true);assert.deepEqual(dead.unsubscribers,[]);
});

test('invalid options and dead maps fail before subscribing or scheduling',()=>{
  const map=createMap(playbackBundle());let subscribed=0;const on=map.on.bind(map);map.on=(...args)=>{subscribed++;return on(...args);};
  for(const options of [null,[],{datasetId:''},{datasetId:'absent'},{interval:0},{interval:NaN},{loop:'yes'},{labels:{play:()=>''}},{setInterval(){return 1;}}])assert.throws(()=>new TimeController(map,options));
  assert.equal(subscribed,0);map.destroy();assert.throws(()=>new TimeController(map),e=>e.code==='LIFECYCLE');
});

test('independent looping controllers retain separate timers and period domains',()=>{
  const a=createMap(playbackBundle()),b=createMap(playbackBundle()),ca=queuedScheduler(),cb=queuedScheduler(),ta=new TimeController(a,{...ca.options,loop:true}),tb=new TimeController(b,cb.options);
  ta.seek(2);ta.play();tb.play();ca.callbacks[0]();assert.equal(ta.index,0);assert.equal(tb.index,0);
  cb.callbacks[0]();assert.equal(tb.index,1);a.destroy();assert.equal(cb.active.size,1);cb.callbacks[0]();assert.equal(tb.index,2);cb.callbacks[0]();assert.equal(cb.active.size,0);b.destroy();
});

test('synchronous and failing schedulers cannot leave phantom playback or handles',()=>{
  const map=createMap(playbackBundle()),cleared=[];
  const time=new TimeController(map,{setInterval(callback){callback();callback();callback();return 7;},clearInterval(handle){cleared.push(handle);}});
  time.play();assert.equal(time.index,2);assert.equal(time.playing,false);assert.equal(time.timer,null);assert.deepEqual(cleared,[7]);time.destroy();
  for(const schedule of [()=>{throw Error('scheduler failed');},()=>undefined]){
    const failed=new TimeController(map,{setInterval:schedule,clearInterval(){}});assert.throws(()=>failed.play());assert.equal(failed.playing,false);assert.equal(failed.timer,null);failed.destroy();
  }
  map.destroy();
});

test('reentrant restart survives an obsolete scheduler failure and throwing cleanup still releases subscriptions',()=>{
  const map=createMap(playbackBundle());let first=true,time;
  time=new TimeController(map,{setInterval(){if(first){first=false;time.pause();time.play();throw Error('obsolete scheduler failure');}return 9;},clearInterval(){}});
  assert.throws(()=>time.play(),/obsolete scheduler failure/);assert.equal(time.playing,true);assert.equal(time.timer,9);time.destroy();
  const broken=new TimeController(map,{setInterval:()=>4,clearInterval(){throw Error('cleanup failure');}}),container=controlContainer();broken.mount(container);broken.play();
  assert.throws(()=>broken.destroy(),/cleanup failure/);assert.equal(broken.timer,null);assert.equal(broken.playing,false);assert.equal(container.children.length,0);assert.deepEqual(broken.unsubscribers,[]);broken.destroy();map.destroy();
});

test('controls remount without handlers, use form-safe buttons, and surface action errors',()=>{
  const map=createMap(playbackBundle()),clock=queuedScheduler(),time=new TimeController(map,clock.options),a=controlContainer(),b=controlContainer(),errors=[];map.on('error',e=>errors.push(e));time.mount(a);
  const old=[...a.children];assert.ok(old.slice(0,3).every(e=>e.type==='button'));time.mount(b);assert.equal(a.children.length,0);assert.ok(old.every(e=>e.listeners.size===0));
  const [previous,play,next,input,output]=b.children;assert.equal(input['aria-valuetext'],'Early');
  map.setView=()=>{throw Error('rejected view');};input.value='1';input.listeners.get('input')();assert.equal(input.value,'0');assert.match(output.textContent,/rejected view/);assert.equal(errors.at(-1).source,'time-controller');
  play.listeners.get('click')();assert.equal(play['aria-pressed'],'true');time.unmount();assert.equal(clock.active.size,1);assert.equal(b.children.length,0);assert.ok([previous,play,next,input].every(e=>e.listeners.size===0));
  clock.callbacks[0]();assert.equal(clock.active.size,0);assert.equal(errors.at(-1).error.code,'PLAYBACK_FAILED');assert.equal(map.spec.view.period_id,'early');map.destroy();
});
