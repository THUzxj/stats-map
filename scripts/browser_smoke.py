"""Explicit offline browser smoke; requires Python Playwright in the test environment."""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

SETUP="""async config=>{
 window.assert=(value,message)=>{if(!value)throw Error(message);};
 window.lib=window.StatsMap??await import('/dist/index.js');
 const fixtures=await import('/tests/fixtures/adapter-matrix.js');window.fixture=fixtures.adapterFixture(lib,'canonical');
 const row=fixtures.matrixCases().find(row=>row.id===(config.dorling?'pie-pie':'ch-quantile'));
 window.map=fixtures.matrixMap(lib,fixture,row,config.dorling?'dorling':'geographic',document.querySelector('#map'));
 map.setInteraction({...map.spec.interaction,componentClickSelectsRegion:true});
 window.settled=async()=>{const start=performance.now();while(map.lastRender?.layout?.status==='pending'){if(performance.now()-start>10000)throw Error('Worker timeout');await new Promise(resolve=>setTimeout(resolve,10));}assert(map.lastRender.layout?.status!=='failed','Worker failed');};
 await settled();assert(lib.listRenderers().length===14,'renderer registry');
 const entry=await import('/dist/renderers/pieChart.js');assert(entry.type==='pieChart'&&entry.createLayer({series_ids:['one','two']}).role==='overlay','per-type entry');
 if(config.dorling){map.setView({period_id:'late'});map.setView({period_id:'early'});await settled();assert(map.spec.view.period_id==='early','Worker replacement');}
 const saved=map.exportSpec({resolved:true}),source=JSON.stringify(fixture.dataset),reopened=lib.createMap(null,{geography:fixture.geography,dataset:fixture.dataset,spec:saved});
 try{assert(reopened.export('csv')===map.export('csv'),'CSV reopening');}finally{reopened.destroy();}
 assert(JSON.stringify(fixture.dataset)===source,'source mutation');
 if(!config.dorling){
  map.destroy();const {protocolRenderer}=await import('/tests/fixtures/protocol-renderer.js');window.extension=protocolRenderer(lib);
  window.map=fixtures.matrixMap(lib,fixture,{id:'extension',type:extension.definition.type,options:{}},'geographic',document.querySelector('#map'));
  map.setSpec({...map.spec,insets:[{id:'detail',x:230,y:350,width:140,height:120,region_ids:['zero']}]});
  assert(extension.active.size===2,'main/inset resources');
  const point=map.rendererFrames.values().next().value.context.anchors.get('a');assert(map.hitTest(point).regionId==='a','extension picking');
  assert(map.describe({layer_id:map.spec.layers[0].id,region_id:'zero'}).rows[0].value==='0','extension zero description');
  const before=map.spec,svg=map.lastRender.svg;
  try{map.setLayers(map.spec.layers.map(layer=>({...layer,options:{failInset:true}})));throw Error('failed candidate accepted');}catch(error){assert(error.message==='Fictional render failure','wrong candidate error');}
  assert(map.spec===before&&map.lastRender.svg===svg&&extension.active.size===2,'failed candidate changed the live frame');
  const exported=map.exportSpec({resolved:true}),restored=lib.createMap(null,{geography:fixture.geography,dataset:fixture.dataset,spec:exported});
  restored.render();restored.destroy();assert(extension.active.size===2,'reopening leaked resources');
 }
}"""

def run(channel=None,output=None):
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}/'
    cases=[dict(id='classic-geographic',classic=True,dorling=False),dict(id='classic-worker',classic=True,dorling=True),dict(id='esm-worker',classic=False,dorling=True),dict(id='classic-touch',classic=True,dorling=False,touch=True)]
    results=[];errors=[]
    if output:output.mkdir(parents=True,exist_ok=True)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,**({'channel':channel} if channel else {}))
            for config in cases:
                context=browser.new_context(viewport={'width':390 if config.get('touch') else 1100,'height':850},has_touch=bool(config.get('touch')),is_mobile=bool(config.get('touch')))
                page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                workers=[];external=[]
                page.on('worker',lambda worker:workers.append(worker.url))
                def serve(route):
                    if not route.request.url.startswith(origin):external.append(route.request.url);route.abort();return
                    if route.request.url.endswith('/consumer'):
                        html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dist/stats-map.css"><div class="stats-map" id="map"></div>'
                        if config['classic']:html+='<script src="/dist/stats-map.iife.js"></script>'
                        route.fulfill(content_type='text/html',body=html,headers={'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:"})
                    else:route.continue_()
                page.route('**/*',serve);page.goto(origin+'consumer');page.evaluate(SETUP,config)
                target=page.locator('#map [data-region-id="a"][tabindex="0"]').first
                if config.get('touch'):target.tap()
                else:target.focus();target.press('Enter')
                assert page.evaluate('map.getState().selection.includes("a")'),config
                if not config['dorling']:
                    assert page.evaluate('extension.active.size') == 2
                    assert page.evaluate("lib.buildTooltip(map,{layer_id:map.spec.layers[0].id,region_id:'a'}).title") == 'Fictional mark a'
                assert not external,external
                if config['dorling']:assert workers and all(url==origin+'dist/src/layouts/dorling-worker.js' for url in workers),workers
                png=page.evaluate('async()=>Array.from(new Uint8Array(await (await map.exportImage("png")).arrayBuffer()))')
                assert bytes(png).startswith(b'\x89PNG\r\n\x1a\n')
                if output:
                    (output/(config['id']+'.png')).write_bytes(bytes(png))
                    (output/(config['id']+'.svg')).write_text(page.evaluate('map.export("svg")'),encoding='utf-8')
                page.evaluate('map.destroy()')
                if not config['dorling']:
                    assert page.evaluate('extension.active.size') == 0
                    assert page.evaluate("['validate','prepare','render','update','hitTest','describe','destroy'].every(name=>extension.calls.some(call=>call[0]===name))")
                results.append({**config,'worker_urls':workers,'native_selection':True,'resolved_reopen':True,'png_export':True,'renderer_protocol':not config['dorling'],'external_requests':external})
                context.close()
            browser.close()
    finally:server.shutdown();server.server_close()
    assert not errors,errors
    report={'cases':results,'count':len(results),'page_errors':errors}
    if output:(output/'browser_result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel',help='Installed browser channel, e.g. chrome; default uses Playwright Chromium.')
    parser.add_argument('--output',type=Path,help='Optional retained test evidence directory.')
    args=parser.parse_args();run(args.channel,args.output)
