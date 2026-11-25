import { chinaDataset, chinaGeography, chinaSouthChinaSeaInset, createMap } from 'stats-map';

const mount = document.querySelector('#map');
const geographySelect = document.querySelector('#geography');
const displaySelect = document.querySelector('#map-display');
const source = document.querySelector('#source');
const selection = document.querySelector('#selection');
const instruction = '点击地图上的地区查看模拟指标。';
const samples = {
  china: { title: '中国省级边界', level: 'province' },
  hainan: { title: '海南市县边界', level: 'city-county' },
};
let map;

async function loadSample(id) {
  const { title, level } = samples[id];
  const response = await fetch(new URL(`../preview/geometry/${id}.geojson`, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const geojson = await response.json();

  const regions = geojson.features
    .filter(({ properties }) => properties?.name && properties.adcode != null)
    .map(({ properties }) => ({
      code: String(properties.adcode),
      name: properties.name,
      level,
    }));

  const prepared = chinaSouthChinaSeaInset(chinaGeography({
    id, title, regions, features: geojson,
  }));

  const dataset = chinaDataset({
    id: `${id}-demo`,
    title: '地区模拟数据',
    scope_note: '演示用模拟数据',
    periods: [{ id: 'demo', label: '演示期' }],
    metrics: [{ id: 'demo_value', label: '模拟指标', unit: '模拟单位', aggregation: 'none' }],
    records: regions.map(({ code }, index) => ({
      region_code: code,
      period: 'demo',
      values: { demo_value: 10 + (index * 17) % 90 },
    })),
  }, prepared.geography);
  return { ...prepared, dataset };
}

const loaded = new Map();
function showSample(id) {
  const { geography, dataset } = loaded.get(id);
  map?.destroy();
  map = createMap(mount, {
    geography, dataset, responsive: true, locale: 'zh-CN',
  });
  const labels = new Map(geography.regions.map(({ id, label }) => [id, label]));
  const values = new Map(dataset.observations.map(({ region_id, value }) => [region_id, value]));
  source.href = `../preview/geometry/${id}.source.json`;
  selection.textContent = instruction;
  map.on('selectionchange', ({ ids }) => {
    selection.textContent = ids.map(id => `${labels.get(id)} ${values.get(id)} 模拟单位`).join('、') || instruction;
  });
  updateDisplay();
}

function updateDisplay() {
  const { inset } = loaded.get(geographySelect.value);
  const mode = displaySelect.value;
  const insets = inset && mode !== 'full'
    ? [mode === 'hidden' ? { ...inset, visible: false, controls: false } : inset]
    : [];
  map.setSpec({ ...map.spec, insets });
}

try {
  await Promise.all(Object.keys(samples).map(async id => loaded.set(id, await loadSample(id))));
  const params = new URLSearchParams(location.search);
  if (loaded.has(params.get('map'))) geographySelect.value = params.get('map');
  const display = params.get('south-sea');
  if (['inset', 'hidden'].includes(display)) displaySelect.value = display;
  showSample(geographySelect.value);
  geographySelect.disabled = displaySelect.disabled = false;
  geographySelect.addEventListener('change', () => showSample(geographySelect.value));
  displaySelect.addEventListener('change', updateDisplay);
} catch (error) {
  selection.textContent = `地图加载失败（${error.message}）。`;
}
