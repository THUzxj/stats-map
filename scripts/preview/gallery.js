import * as lib from '/src/index.js';
import { galleryFixture, gallerySpec, galleryTypes, mockPeriods } from '/fixtures/gallery.js';

const root = document.querySelector('#gallery');
const periodSelect = document.querySelector('#period');
const layoutSelect = document.querySelector('#layout');
const filterInput = document.querySelector('#filter');
const status = document.querySelector('#status');
const maps = [];
window.__galleryMaps = maps;
const states = new Map();
function optionLabel(item, choice) { return choice.label; }
function makeSelect(item, state) {
  const select = document.createElement('select');
  for (const choice of item.variants) { const o = document.createElement('option'); o.value = choice.id; o.textContent = optionLabel(item, choice); select.append(o); }
  select.value = state.choice;
  select.addEventListener('change', () => { state.choice = select.value; updateMaps(entry => entry.item.type === item.type); });
  return select;
}
function makePanel(item, fixture, side, state) {
  const panel = document.createElement('article'); panel.className = 'map-panel';
  const title = document.createElement('div'); title.className = 'map-title'; title.innerHTML = `<strong>${fixture.config.label}</strong><span>${fixture.config.subtitle}</span>`; panel.append(title);
  const variant = document.createElement('div'); variant.className = 'variant'; const label = document.createElement('label'); label.textContent = '子模式'; label.append(makeSelect(item, state)); variant.append(label); panel.append(variant);
  const mount = document.createElement('div'); mount.className = 'map'; panel.append(mount);
  const source = document.createElement('div'); source.className = 'source'; source.textContent = fixture.config.attribution; panel.append(source);
  if (fixture.config.source_path) {
    const link = document.createElement('a'); link.href = `/geographies/${encodeURIComponent(fixture.config.id)}/source`; link.textContent = '边界来源与 SHA-256';
    source.append(' ', link);
  }
  const spec = gallerySpec(lib, fixture, item, item.variants.find(v => v.id === state.choice), periodSelect.value, layoutSelect.value);
  try {
    const map = lib.createMap(mount, { geography: fixture.geography, dataset: fixture.dataset, spec, width: 660, height: 350, responsive: true, theme: { base: 'light' } });
    maps.push({ map, mount, item, side, state, fixture, select: panel.querySelector('select') });
  } catch (error) {
    mount.replaceChildren(Object.assign(document.createElement('div'), { className: 'map-error', textContent: `此组合暂时无法显示：${error.message}` }));
    console.error(item.type, fixture.config.id, error);
  }
  return panel;
}
function renderSection(item, index, fixtures) {
  const section = document.createElement('section'); section.className = 'type-section'; section.dataset.search = `${item.type} ${item.label} ${item.note}`.toLowerCase();
  const head = document.createElement('div'); head.className = 'type-head'; head.innerHTML = `<div class="type-index">${String(index + 1).padStart(2, '0')}</div><div><h2>${item.label}</h2><p>${item.note}</p></div>`; section.append(head);
  const pair = document.createElement('div'); pair.className = 'pair';
  for (const [side, fixture] of fixtures.entries()) { const key = item.type; const state = states.get(key) ?? { choice: item.variants[0].id }; states.set(key, state); pair.append(makePanel(item, fixture, side, state)); }
  section.append(pair); return section;
}
function renderAll(fixtures) {
  for (const entry of maps) entry.map.destroy(); maps.length = 0;
  const query = filterInput.value.trim().toLowerCase(); root.replaceChildren();
  galleryTypes.forEach((item, i) => { if (!query || `${item.type} ${item.label} ${item.note}`.toLowerCase().includes(query)) root.append(renderSection(item, i, fixtures)); });
  status.textContent = `${root.querySelectorAll('.type-section').length} 类图型 · 来源协议对照 · 模拟数据`;
}
function updateMaps(predicate = () => true) {
  for (const entry of maps) {
    if (!predicate(entry)) continue;
    const choice = entry.item.variants.find(value => value.id === entry.state.choice);
    entry.map.setSpec(gallerySpec(lib, entry.fixture, entry.item, choice, periodSelect.value, layoutSelect.value));
    if (entry.select.value !== entry.state.choice) entry.select.value = entry.state.choice;
  }
}
function filterSections() {
  const query = filterInput.value.trim().toLowerCase(); let visible = 0;
  for (const section of root.querySelectorAll('.type-section')) {
    section.hidden = !!query && !section.dataset.search.includes(query);
    if (!section.hidden) visible++;
  }
  status.textContent = `${visible} 类图型 · 来源协议对照 · 模拟数据`;
}
async function loadJson(url, expectedSha) {
  const response = await fetch(url); if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = await response.arrayBuffer();
  if (expectedSha) {
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (sha !== expectedSha) throw new Error('Saved preview grids failed SHA-256 verification');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function init() {
  const requestedLayout = new URLSearchParams(location.search).get('layout');
  if ([...layoutSelect.options].some(o => o.value === requestedLayout)) layoutSelect.value = requestedLayout;
  periodSelect.replaceChildren(...mockPeriods.map(p => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
  periodSelect.value = mockPeriods[0].id;
  try {
    const pageConfig = await loadJson('/config.json');
    if (pageConfig.title) { document.title = `stats-map · ${pageConfig.title}`; document.querySelector('#gallery-title').textContent = pageConfig.title; }
    if (pageConfig.subtitle) document.querySelector('#gallery-subtitle').textContent = pageConfig.subtitle;
    const fixtures = [];
    for (const config of pageConfig.geographies) {
      const grids = config.grid_layouts_path ? await loadJson(`/geographies/${config.id}/grids`, config.grid_layouts_sha256) : undefined;
      fixtures.push(galleryFixture(lib, config, await loadJson(`/geographies/${config.id}`, grids?.source_sha256), grids));
    }
    window.__fixtures = fixtures;
    renderAll(fixtures);
    periodSelect.addEventListener('change', () => updateMaps());
    layoutSelect.addEventListener('change', () => updateMaps());
    filterInput.addEventListener('input', filterSections);
  } catch (error) { status.textContent = '加载失败'; root.textContent = error.stack || error.message; console.error(error); }
}
init();
