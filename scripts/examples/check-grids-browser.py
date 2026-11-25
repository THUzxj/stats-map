"""Check saved grids in the live, source-based preview; no preparation requests."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

CHECK = """() => {
  const rows = window.__galleryMaps;
  if (!rows?.length) throw Error('Gallery not ready');
  return rows.map(({map, fixture}) => {
    const plan = fixture.geography.grid_layouts.find(p => p.type === map.spec.layout.type);
    if (!plan) throw Error('Missing saved grid');
    for (const [id, p] of map.layoutPositions) {
      if (JSON.stringify([p.column,p.row]) !== JSON.stringify(plan.positions[id])) throw Error('Grid was repositioned');
    }
    return [...map.layoutPositions].map(([id,p]) => [id,p.column,p.row]);
  });
}"""

def run(url, output, channel=None):
    if output:
        output.mkdir(parents=True, exist_ok=True)
    results, errors, requests = [], [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, **({'channel': channel} if channel else {}))
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: requests.append(r.url))
        page.goto(url.rstrip('/') + '/preview/?layout=grid-square')
        page.wait_for_function('window.__galleryMaps?.length === 14 * window.__fixtures?.length')
        assert page.locator('.map-error').count() == 0
        for layout, width in [('grid-square', 1440), ('grid-hex', 1440), ('grid-hex', 390)]:
            page.set_viewport_size({"width": width, "height": 1000})
            page.locator('#layout').select_option(layout)
            page.wait_for_function('(layout) => window.__galleryMaps.every(e => e.map.spec.layout.type === layout)', arg=layout)
            before = page.evaluate(CHECK)
            page.locator('#period').select_option('p4')
            assert page.evaluate(CHECK) == before
            probe = page.evaluate("""() => {
              const {map} = window.__galleryMaps[0], node = map.layoutPositions.values().next().value;
              if (map.hitTest([node.x,node.y])?.regionId !== node.id) throw Error('Grid hit test failed');
              const exported = map.exportSpec({resolved:true});
              if (!exported.layout.positions || Object.keys(exported.layout.positions).length !== map.geography.regions.length) throw Error('Missing exported positions');
              return {regions:map.layoutPositions.size,positionCount:Object.keys(exported.layout.positions).length};
            }""")
            target = page.locator('.map').first.locator('[data-region-id][tabindex="0"]').first
            region_id = target.get_attribute('data-region-id')
            target.focus()
            target.press('Enter')
            assert page.evaluate('(id) => window.__galleryMaps[0].map.getState().selection.includes(id)', region_id)
            page.evaluate('window.__galleryMaps[0].map.setSelection([])')
            restored = page.evaluate("""async () => {
              const lib = await import('/src/index.js'), {map} = window.__galleryMaps[0];
              const other = lib.createMap(null,{geography:map.geography,dataset:[...map.datasets.values()][0],spec:map.exportSpec({resolved:true})});
              other.render();
              const same = JSON.stringify([...other.layoutPositions].map(([id,p])=>[id,p.column,p.row])) === JSON.stringify([...map.layoutPositions].map(([id,p])=>[id,p.column,p.row]));
              other.destroy();return same;
            }""")
            assert restored
            key = f'{layout}-{width}'
            page.evaluate('document.activeElement?.blur(); window.__galleryMaps.forEach(e=>e.map.tooltip?.hide())')
            page.mouse.move(1, 1)
            if output:
                page.locator('.type-section').first.screenshot(path=str(output / (key + '.png')))
                (output / (key + '.svg')).write_text(page.evaluate('window.__galleryMaps[0].map.export("svg")'), encoding='utf-8')
            results.append({'case': key, 'panels': len(before), **probe, 'period_stable': True, 'keyboard': True, 'reopened': restored})
        assert not errors, errors
        assert not any('/preparation/' in r for r in requests), 'Browser imported registration-time solver'
        browser.close()
    result = {'passed': True, 'cases': results, 'solver_requests': 0, 'page_errors': errors}
    if output:
        (output / 'browser-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--channel', choices=['chrome', 'msedge'])
    args = parser.parse_args()
    run(args.url, args.output, args.channel)
