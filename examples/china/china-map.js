import { chinaDataset, chinaGeography, createMap } from 'stats-map';

const selection = document.querySelector('#selection');

try {
  const response = await fetch(new URL('../preview/geometry/china.geojson', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const geojson = await response.json();

  const regions = geojson.features
    .filter(({ properties }) => properties?.name && properties.adcode != null)
    .map(({ properties }) => ({
      code: String(properties.adcode),
      name: properties.name,
      level: 'province',
    }));

  const geography = chinaGeography({
    id: 'china-provinces',
    title: '中国省级边界',
    regions,
    features: geojson,
  });

  const dataset = chinaDataset({
    id: 'china-demo',
    title: '省级模拟数据',
    scope_note: '演示用模拟数据',
    periods: [{ id: 'demo', label: '演示期' }],
    metrics: [{ id: 'demo_value', label: '模拟指标', unit: '模拟单位', aggregation: 'none' }],
    records: regions.map(({ code }, index) => ({
      region_code: code,
      period: 'demo',
      values: { demo_value: 10 + (index * 17) % 90 },
    })),
  }, geography);

  const map = createMap(document.querySelector('#map'), {
    geography, dataset, responsive: true, locale: 'zh-CN',
  });
  const labels = new Map(geography.regions.map(({ id, label }) => [id, label]));
  const values = new Map(dataset.observations.map(({ region_id, value }) => [region_id, value]));
  const instruction = '点击地图上的地区查看模拟指标。';
  selection.textContent = instruction;
  map.on('selectionchange', ({ ids }) => {
    selection.textContent = ids.map(id => `${labels.get(id)} ${values.get(id)} 模拟单位`).join('、') || instruction;
  });
} catch (error) {
  selection.textContent = `地图加载失败（${error.message}）。`;
}
