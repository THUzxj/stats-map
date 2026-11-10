// Mock statistics for any caller-supplied geography. No real statistical values,
// place identifiers, or source-specific drawing algorithms live in this fixture.
export const mockPeriods = Array.from({ length: 6 }, (_, order) => ({ id: `p${order + 1}`, label: `模拟第 ${order + 1} 期`, order }));
const kinds = ['one', 'two', 'three', 'total'];
const labels = { one: '模拟分量 A', two: '模拟分量 B', three: '模拟分量 C', total: '模拟总量' };
export function mockValues(index, period) {
  if (index === 9 || index === 3 && period === 2) return [null, null, null, null];
  if (index === 5) return [0, 0, 0, 0];
  const a = 12 + (index * 17 + period * 13) % 89;
  const b = 8 + (index * 29 + period * 7) % 79;
  const c = 6 + (index * 11 + period * 19) % 69;
  return [a, b, c, a + b + c + 12];
}

export function galleryFixture(lib, config, collection, savedGrids) {
  const features = collection.features.map((feature, i) => {
    const id = String(feature.properties?.[config.id_property] ?? feature.id ?? i);
    const name = feature.properties?.[config.label_property];
    const reference = !name || ['reference', 'boundary', 'decoration'].includes(feature.properties?.role);
    return { ...feature, id, properties: { ...feature.properties, region_id: id, name: name || id, role: reference ? 'reference' : 'region' } };
  });
  const regions = features.filter(f => f.properties.role === 'region').map(f => ({ code: f.id, name: f.properties.name, level: config.level }));
  let geography;
  if (config.adapter === 'euro') geography = lib.euroGeography({ type: 'FeatureCollection', features }, { id: `gallery-${config.id}`, geographyTitle: config.label, anchorPolicy: { method: 'interior-point', version: 1 } });
  else if (config.adapter === 'china') geography = lib.chinaGeography({ id: `gallery-${config.id}`, title: config.label, regions, features: { type: 'FeatureCollection', features } }, { anchorPolicy: { method: 'interior-point', version: 1 } });
  else throw new Error(`Unknown preview adapter: ${config.adapter}`);
  // Resolve anchors once, retaining source center or derived-point metadata.
  geography.anchors = [...lib.resolveAnchors(geography).anchors.values()];
  geography.regions.sort((a, b) => a.id.localeCompare(b.id));
  if (savedGrids) {
    if (savedGrids.schema_version !== 1 || savedGrids.geography_ref?.id !== geography.id || savedGrids.geography_ref?.revision !== geography.revision) throw new Error('Saved grid catalog does not match preview geography');
    geography.grid_layouts = savedGrids.grid_layouts;
    lib.validateGeography(geography);
  }
  const ids = geography.regions.map(r => r.id);
  const source = { id: 'mock', title: 'MOCK · 确定性模拟统计数据，不代表真实地区状况' };
  const scope = '演示用模拟数据；各来源按排序序号使用同一规则，不代表真实地区的统计水平。';
  let dataset, series;
  if (config.adapter === 'euro') {
    const input = { id: ['kind', 'geo', 'time'], size: [kinds.length, ids.length, mockPeriods.length], dimension: {
      kind: { category: { index: kinds, label: labels } }, geo: { category: { index: ids } }, time: { category: { index: mockPeriods.map(p => p.id) } },
    }, value: kinds.flatMap((_, k) => ids.flatMap((id, i) => mockPeriods.map((p, t) => mockValues(i, t)[k]))), source };
    dataset = lib.euroDataset(input, geography, { id: `mock-${config.id}`, title: 'MOCK 模拟指标', unitId: 'mock-unit', unitLabel: '模拟单位', periods: mockPeriods, scopeNote: scope, aggregation: 'sum' });
    series = Object.fromEntries(dataset.series.map(s => [s.dimension_values.kind, s.id]));
    for (const s of dataset.series) s.label = labels[s.dimension_values.kind];
  } else {
    dataset = lib.chinaDataset({ id: `mock-${config.id}`, title: 'MOCK 模拟指标', scope_note: scope, source, periods: mockPeriods,
      metrics: kinds.map(id => ({ id, label: labels[id], unit: '模拟单位', aggregation: 'sum' })),
      records: ids.flatMap((region_code, i) => mockPeriods.map((period, t) => ({ region_code, period: period.id, values: Object.fromEntries(kinds.map((id, k) => [id, mockValues(i, t)[k]])), evidence: [{ source_id: 'mock', locator: `ordinal/${i}/period/${t}` }] }))),
    }, geography);
    series = Object.fromEntries(kinds.map(id => [id, id]));
  }
  dataset.dimensions ??= [];
  dataset.dimensions.push({ id: 'mock-classes', values: ['A', 'B', 'C'].map(id => ({ id, label: `模拟类别 ${id}` })) });
  dataset.metrics.push({ id: 'mock-category', label: '模拟分类', value_type: 'category', aggregation: 'none', category_dimension_id: 'mock-classes' });
  dataset.series.push({ id: 'category', label: '模拟分类', metric_id: 'mock-category', unit_id: dataset.units[0].id, scope_id: 'default', measure_type: 'unspecified', review_status: 'unspecified' });
  series.category = 'category';
  for (const [i, region_id] of ids.entries()) for (const [t, period] of mockPeriods.entries()) dataset.observations.push({ id: `category-${i}-${t}`, series_id: 'category', region_id, period_id: period.id, status: mockValues(i, t)[0] == null ? 'missing' : 'value', value: mockValues(i, t)[0] == null ? null : ['A', 'B', 'C'][(i + t) % 3] });
  // JSON-stat numeric cells do not carry categories or OD. Both are explicit
  // canonical mock resources attached after the source protocol is decoded.
  const routes = [[0, 7, 80], [7, 0, 32], [2, 12, 60], [12, 18, 45], [18, 2, 23], [7, 18, 40], [0, 0, 15], [5, 7, 0], [9, 12, null]];
  dataset.relations = mockPeriods.flatMap((p, t) => routes.map(([from, to, value], i) => ({ id: `od-${t}-${i}`, origin_region_id: ids[from % ids.length], destination_region_id: ids[to % ids.length], series_id: series.one, period_id: p.id, status: value == null ? 'missing' : 'value', value: value == null ? null : value + (value ? t * 3 : 0), evidence: [{ source_id: 'mock', locator: `od/${i}/${t}` }] })));
  for (const observation of dataset.observations) observation.evidence ??= [{ source_id: 'mock', locator: observation.id }];
  lib.validateGeography(geography);
  lib.validateDataset(dataset, geography);
  return { config, geography, dataset, series };
}

const variant = (id, label, options = {}, classification) => ({ id, label, options, ...(classification ? { classification } : {}) });
export const galleryTypes = [
  { type: 'choropleth', label: '分级设色', note: '颜色表示分量 A；比较分档、连续色带与纹理。', variants: [
    variant('threshold', '固定阈值', {}, { method: 'threshold', thresholds: [25, 50, 75] }),
    ...['quantile', 'equinter', 'ckmeans', 'jenks'].map((method, i) => variant(method, ['分位数', '等距', 'CKmeans', 'Jenks'][i], {}, { method, classes: 4 })),
    variant('continuous', '连续色带', { colorMode: 'continuous', colorDomain: [0, 110] }),
    variant('dot', '点纹理', { texture: 'dot' }), variant('square', '方格纹理', { texture: 'square' }),
  ] },
  { type: 'proportionalSymbol', label: '比例符号', note: '分量 A 控制符号大小；两侧使用相同最大值。', variants: ['circle', 'bar', 'square', 'star', 'diamond', 'wye', 'cross', 'triangle', 'spike', 'custom'].map((shape, i) => variant(shape, ['圆', '柱', '正方形', '星', '菱形', 'Y 形', '十字', '三角形', '尖峰', '自定义轮廓'][i], { shape, ...(shape === 'custom' ? { customShape: { viewBox: [0, 0, 10, 10], path: 'M5 0 L10 4 L8 10 L2 10 L0 4 Z' } } : {}) })) },
  { type: 'categorical', label: '分类地图', note: '使用显式模拟类别 A、B、C；类别没有数值大小顺序。', variants: [variant('category', '三种类别')] },
  { type: 'bivariateChoropleth', label: '双变量设色', note: '颜色同时表达分量 A 与 B；两轴使用相同的固定阈值。', variants: [variant('bivariate', '3 × 3 双变量', {}, { method: 'threshold', thresholds: [35, 65] })] },
  { type: 'alpha', label: '透明度地图', note: '分量 A 控制颜色，分量 B 控制透明度；透明度范围按各侧分布计算。', variants: [variant('alpha', '颜色 × 透明度')] },
  { type: 'trivariateChoropleth', label: '三元设色', note: '颜色表示 A、B、C 的相对构成，零总量保留独立状态。', variants: [variant('ternary', '三元连续', { mode: 'ternary' }), variant('sextant', '六分区 / 均值中心', { mode: 'sextant', meanCentering: true })] },
  { type: 'stripeComposition', label: '条纹构成', note: '在地区轮廓内以彩色条纹表示三个模拟分量的占比。', variants: [variant('stripe', '条纹')] },
  { type: 'pieChart', label: '饼图与构成符号', note: '同一组构成数据的不同表达；总量含 12 单位“其他”。', variants: [
    ...['pie', 'ring', 'flag', 'segment', 'radar', 'agepyramid', 'halftone'].map((mode, i) => variant(mode, ['饼图', '圆环', '旗帜', '分段', '雷达 / 份额', '人口金字塔', '半色调'][i], { mode })),
    variant('radar-absolute', '雷达 / 绝对值', { mode: 'radar', radarValueMode: 'absolute' }), variant('total-sized', '饼图 / 总量缩放', { mode: 'pie', sizeBy: 'total' }),
  ] },
  { type: 'sparkline', label: '地图迷你时序图', note: '展示六个模拟期次，保留断线；共用固定纵轴。', variants: ['line', 'area', 'bar'].map((mode, i) => variant(mode, ['折线', '面积', '柱形'][i], { mode })) },
  { type: 'flow', label: '流向地图', note: '少量显式 mock OD 路线，含双向、内部流、有效零与缺失。', variants: [variant('curved', '曲线', { mode: 'curved' }), variant('straight', '直线', { mode: 'straight' }), variant('sankey', '空间桑基', { mode: 'sankey' }), variant('merged', '合并双向', { mode: 'curved', reciprocalMode: 'merged', nodeShape: 'donut' })] },
  { type: 'coxcomb', label: '玫瑰图', note: '六个期次 × 三个分量；可对照面积与半径尺度。', variants: [variant('area', '按面积缩放', { scaleMode: 'area' }), variant('radius', '按半径缩放', { scaleMode: 'radius' })] },
  { type: 'mushroom', label: '蘑菇图', note: '两半圆分别表示分量 A 与 B，使用共同单位和大小尺度。', variants: [variant('horizontal', '水平', { orientation: 'horizontal' }), variant('vertical', '垂直', { orientation: 'vertical' })] },
  { type: 'waffle', label: '华夫图', note: '格子数近似表达构成；悬停可读原值。', variants: [variant('waffle', '固定尺寸', { cells: 25, columns: 5 }), variant('total-sized', '总量缩放', { cells: 25, columns: 5, sizeBy: 'total' })] },
  { type: 'bar', label: '地图柱形图', note: '并列或堆叠比较 A、B、C；两侧共用数值量尺。', variants: [variant('grouped', '并列', { mode: 'grouped' }), variant('stacked', '堆叠', { mode: 'stacked' }), variant('width', '堆叠 / 总量柱宽', { mode: 'stacked', widthSeriesId: '$total' })] },
];

export function gallerySpec(lib, fixture, item, choice, period = 'p1', layout = 'geographic') {
  const { geography, dataset, series, config } = fixture;
  let encoding;
  if (item.type === 'flow') encoding = { relation_series_id: series.one };
  else if (['bivariateChoropleth', 'alpha'].includes(item.type)) encoding = { x: { dataset_id: dataset.id, series_id: series.one }, y: { dataset_id: dataset.id, series_id: series.two } };
  else if (['trivariateChoropleth', 'stripeComposition', 'pieChart', 'waffle', 'bar', 'coxcomb', 'mushroom'].includes(item.type)) encoding = { series_ids: (item.type === 'mushroom' ? ['one', 'two'] : ['one', 'two', 'three']).map(id => series[id]) };
  else encoding = { series_id: series[item.type === 'categorical' ? 'category' : 'one'] };
  const options = { stroke: '#ffffff', strokeWidth: 0.6, otherLabel: '其他（模拟）', ...choice.options };
  if (['proportionalSymbol', 'mushroom'].includes(item.type)) Object.assign(options, { maxValue: 110, maxRadius: 16, fill: '#327d9b', stroke: '#245d74', fillOpacity: 0.85 });
  if (['pieChart', 'waffle', 'coxcomb', 'bar'].includes(item.type)) Object.assign(options, { totalSeriesId: series.total, totalMaximum: 270, componentMaximum: 110, size: item.type === 'coxcomb' ? 32 : 28, maxValue: item.type === 'bar' && choice.options.mode === 'grouped' ? 110 : 270, maxWidthValue: 270 });
  if (item.type === 'sparkline') Object.assign(options, { size: 30, yDomain: [0, 110], stroke: '#327d9b' });
  for (const key of Object.keys(options)) if (options[key] === '$total') options[key] = series.total;
  const layer = { id: 'theme', type: item.type, title: item.label, encoding: { dataset_id: dataset.id, ...encoding }, options, classification: choice.classification ?? { method: 'threshold', thresholds: [25, 50, 75] } };
  // A neutral context layer, rendered by the library, behind point glyphs.
  const needsBase = lib.getRenderer(item.type).defaultRole === 'overlay';
  const base = { id: 'context', type: 'choropleth', role: 'base', legend: false, tooltip: false, encoding: { dataset_id: dataset.id, series_id: series.one }, options: { colors: ['#e9eef0'], noDataColor: '#e9eef0', stroke: '#bdcbd1', strokeWidth: 0.65 } };
  if (needsBase) layer.role = 'overlay';
  return { schema_version: 1, kind: 'stats-map/spec', id: `gallery-${config.id}-${item.type}`, revision: 'r1', title: `${config.label} · ${item.label} · MOCK`, geography_ref: { id: geography.id, revision: geography.revision }, dataset_refs: [{ id: dataset.id, revision: dataset.revision }], locale: 'zh-CN', view: { period_id: period }, layout: { type: layout, padding: 28, projection: { id: config.projection }, ...(layout === 'dorling' ? { radius: 13 } : {}) }, layers: needsBase ? [base, layer] : [layer], legend: { visible: false }, theme: { base: 'light', background: '#f8fafb', numericColors: ['#d2e9ee', '#91c6d1', '#4a9daf', '#246278'], compositionColors: ['#397f9e', '#e4a25b', '#9d88bc'], categoryColors: ['#397f9e', '#e4a25b', '#9d88bc'] }, decorations: { sources: 'MOCK · 所有统计值均为模拟' }, interaction: { reducedMotion: true } };
}
