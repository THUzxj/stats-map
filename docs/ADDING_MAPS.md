# 添加新地图的接口指南

本文说明如何把新的地区轮廓和统计数据接入 stats-map。新增地图通常只需提供标准资源，复用现有图型和交互。安装与浏览器部署见[使用指南](USAGE.md)。

## 选择接入方式

| 手中已有的输入 | 接入方式 |
| --- | --- |
| 标准 Geography、Dataset、MapSpec | 直接调用 `createMap(container, { geography, dataset, spec })` |
| 内嵌 MapBundle | 调用 `createMap(container, { bundle })`；Node 中可用 `createMap(bundle)` |
| 带外部文件的 MapBundle | 先用 `loadBundle(descriptor, resolver)` 校验并加载，再创建地图 |
| 其他格式的轮廓、表格或服务响应 | 在应用或来源 adapter 中转成标准资源，再走上述入口 |
| 需要一种新的绘图算法 | 使用 `registerRenderer`，见[Renderer 扩展协议](REFERENCE.md#renderer-扩展协议) |

接入新地理范围无需注册地图名称，也无需改 renderer、统计核或布局。来源 adapter 是普通转换模块，没有必须实现的地图注册类；网络与文件读取由应用负责。已有 Euro/China 格式可使用 `stats-map/adapters/euro`、`stats-map/adapters/china`，其公开函数和选项见[类型声明](../src/types/index.d.ts)。

## 离线准备格网位置

新地图完成 Geography 标准化后，在接入时生成一次方格和六边形位置，并随地图资源保存。Node 专用入口不在浏览器渲染入口中：

```js
import { prepareGridLayouts } from 'stats-map/preparation';
import { writeFile } from 'node:fs/promises';

const result = prepareGridLayouts(geography, {
  projection: { id: 'equirectangular' },
  // 面几何需显式锚点，或通过 anchorPolicy / geography.anchor_policy 允许派生。
  anchorPolicy: { method: 'interior-point', version: 1 },
});
await writeFile('geography.prepared.json', JSON.stringify(result.geography));
```

也可在包根目录执行 `npm run prepare:grids -- --input geography.json`，原文件将保存新增的 `grid_layouts`。需要另存时增加 `--output geography.prepared.json`；算法选项可用 `--options options.json` 提供。默认按每个 level 分别生成两种形状；自定义范围使用 `referenceRegionIds` 和 `scopeId`，不要把父级与其子级混在一个格网范围中。

以后直接加载已准备的 Geography，使用 `{type:'grid-square'}` 或 `{type:'grid-hex'}`，渲染器自动选择覆盖当前视图的最小已存范围。`layout.grid_layout_id` 可显式选择某张表；`layout.positions` 可显式覆盖，二者不能同时提供。已有表无法覆盖当前范围时返回 `GRID_SCOPE_MISMATCH`；完全没有保存表的旧 Geography 保留原顺序排版行为。

接入命令重复运行时，通过输入指纹校验并复用已有表，返回 `generated:0` 和复用数量，不再求解。地理锚点、投影、固定格点或求解选项改变时，返回 `GRID_STALE_LAYOUT`；只有显式增加 `--force`（API 为 `regenerate:true`）才重新生成。普通绘制、期次切换、viewport 改变、服务器启动均不运行算法。生成和保存只改变地理布局元数据，不改观测、统计口径或来源。

每个已存计划包含地理版本引用、参考地区集合、整数位置表、算法版本、输入 SHA-256、质量和停止原因。Schema 与运行时共同校验身份覆盖、格点唯一性和引用；方案的 `exportSpec({resolved:true})` 会保存显式位置，以便重开。

本包 preview 的原始边界保持原字节，位置使用旁置目录文件。接入画廊后执行 `npm run prepare:preview-grids`；自定义配置可传 `--config <file> --data-root <directory>`。该显式命令生成/复用位置并登记文件 SHA-256，页面只读加载，并核对位置表与原轮廓字节的绑定。具体位置文件由各地图配置的 `grid_layouts_path` 指定，运行程序无需从 examples 推测路径。

## 四类资源如何对应

所有资源使用 `schema_version: 1`，都有非空 `id` 和 `revision`。这个版本属于地图库资源协议，与宿主采集作业的版本无关。

| 资源 | 最小内容与关联 |
| --- | --- |
| Geography | `kind: 'stats-map/geography'`；`title`、`levels`、`regions`、`coordinate_space`、GeoJSON `features` |
| Dataset | `kind: 'stats-map/dataset'`；`title`、`scope_note`、`geography_ref`、`periods`、`units`、`metrics`、`scopes`、`series`、`observations` |
| MapSpec | `kind: 'stats-map/spec'`；`geography_ref`、`dataset_refs`、`layers`；通常显式提供 `view` 和 `layout` |
| MapBundle | `kind: 'stats-map/bundle'`；`resources` 容纳资源，`spec_ref` 指向入口 MapSpec |

资源引用必须同时匹配 `id` 与 `revision`。观测的 `region_id`、Feature 的 `properties.region_id`、锚点和选择操作使用同一组 `regions[].id`；不能按名称、代码前缀或数组位置猜测。Feature 自己的 `id` 是几何身份，可以与地区 ID 不同，一个地区也可以对应多个 Feature。

完整字段以本包 Schema 为准：[Geography](../schemas/stats-map-geography-v1.schema.json)、[Dataset](../schemas/stats-map-dataset-v1.schema.json)、[MapSpec](../schemas/stats-map-spec-v1.schema.json)、[MapBundle](../schemas/stats-map-bundle-v1.schema.json)。

## 最小完整示例

下面是三个虚构区域的标准地图包，含正值、有效零与缺失。保存为应用中的 `new-map.mjs`，在已安装 stats-map 的 ESM 项目中使用；示例无需远程地图服务。

```js
import { validateBundle } from 'stats-map';

const ref = resource => ({ id: resource.id, revision: resource.revision });
const areas = [
  { id: 'area-a', label: '区域 A', x: 0, value: 12 },
  { id: 'area-b', label: '区域 B', x: 2, value: 0 },
  { id: 'area-c', label: '区域 C', x: 4, value: null }
];

export const geography = {
  schema_version: 1,
  kind: 'stats-map/geography',
  id: 'fictional-areas', revision: 'r1', title: '虚构区域',
  levels: [{ id: 'area', label: '区域' }],
  regions: areas.map(({ id, label }) => ({ id, label, level_id: 'area' })),
  coordinate_space: { type: 'cartesian', units: 'unit', y_direction: 'up' },
  anchor_policy: { method: 'interior-point', version: 1 },
  features: {
    type: 'FeatureCollection',
    features: areas.map(({ id, x }) => ({
      type: 'Feature', id: `outline-${id}`,
      properties: { role: 'region', region_id: id },
      geometry: {
        type: 'Polygon',
        coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]]
      }
    }))
  },
  sources: [{ id: 'synthetic-outlines', title: '虚构轮廓，仅用于接口示例' }]
};

export const dataset = {
  schema_version: 1,
  kind: 'stats-map/dataset',
  id: 'fictional-counts', revision: 'r1', title: '虚构数量',
  scope_note: '三个虚构区域的模拟数量，无真实统计含义',
  geography_ref: ref(geography),
  periods: [{ id: 'p1', label: '示例期次', order: 0 }],
  units: [{ id: 'count', label: '个', dimension: 'count' }],
  metrics: [{ id: 'count', label: '数量', value_type: 'number', aggregation: 'sum' }],
  scopes: [{ id: 'all', description: '三个虚构区域' }],
  series: [{
    id: 'count', metric_id: 'count', unit_id: 'count', scope_id: 'all',
    measure_type: 'actual', review_status: 'unreviewed',
    source_refs: ['synthetic-values']
  }],
  observations: areas.map(({ id, value }) => ({
    id: `observation-${id}`, series_id: 'count', region_id: id, period_id: 'p1',
    status: value === null ? 'missing' : 'value', value
  })),
  sources: [{ id: 'synthetic-values', title: '虚构数值，仅用于接口示例' }]
};

export const spec = {
  schema_version: 1,
  kind: 'stats-map/spec',
  id: 'fictional-view', revision: 'r1',
  geography_ref: ref(geography), dataset_refs: [ref(dataset)],
  view: { level_ids: ['area'], period_id: 'p1' },
  layout: { type: 'geographic' },
  layers: [{
    id: 'counts', type: 'choropleth', role: 'base',
    encoding: { dataset_id: dataset.id, series_id: 'count' }
  }]
};

export const bundle = {
  schema_version: 1,
  kind: 'stats-map/bundle',
  id: 'fictional-bundle', revision: 'r1', spec_ref: ref(spec),
  resources: [geography, dataset, spec].map(resource => ({ storage: 'inline', resource }))
};

validateBundle(bundle);
```

在前端入口挂载，页面需先提供非零高度的容器：

```html
<div id="map" class="stats-map" style="height:480px"></div>
```

```js
import { createMap } from 'stats-map';
import 'stats-map/style.css';
import { bundle } from './new-map.mjs';

const map = createMap(document.querySelector('#map'), { bundle, responsive: true });
map.on('selectionchange', () => console.log(map.getState().selection));
// 页面或组件卸载时调用 map.destroy()。
```

`validateBundle` 校验资源结构；`createMap` 继续核对跨资源引用、地区身份和图层编码。也可将 `bundle` 序列化为 JSON，按[普通网页用法](USAGE.md#普通网页无需前端打包工具)交给全局 `StatsMap.createMap`。独立 JSON 样本见 [third-map.json](../tests/fixtures/third-map.json)。

## 换成自己的轮廓和数据

先准备显式的地区 ID 对照，再分别替换示例中的 `regions`、`features` 和统计表。轮廓缺失的地区仍可登记在 `regions`，保留统计身份；不要为了绘图删除它的观测。

### 地区、几何和坐标

- `levels[].id` 自行定义；每个地区的 `level_id` 必须存在。层级通过 `parent_id` 指定，父节点须登记且不能成环，核心不推断上下级关系。
- 每个 Feature 提供唯一 `id`；统计地区的 `properties` 显式填写 `role: 'region'` 和 `region_id`。参考线、外边界或装饰使用 `reference`、`boundary`、`decoration` 角色。
- `features` 是 GeoJSON FeatureCollection，不是裸坐标数组；Polygon 的每个环须闭合且至少四个位置。TopoJSON 可先用主入口的 `decodeTopology(input, { objects: [...] })` 转为 FeatureCollection，再建立地区映射。
- 经度/纬度坐标声明 `{ type: 'geographic', crs: 'OGC:CRS84', units: 'degree' }`，位置顺序为经度、纬度。需要时在 `spec.projection` 设置 `{ id: 'mercator' }`；内置另有 `equirectangular`。
- 已投影的平面坐标声明 `type: 'cartesian'`、`units: 'metre'`（或 `kilometre`、`unit`）和 `y_direction: 'up'`（或 `down`）。库不根据 CRS 名称自动重投影，不同坐标系统需在接入前统一，锚点使用同一坐标空间。
- 面上的符号、标签和流线需要锚点：可沿用示例的面内点策略，或提供 `anchors: [{ region_id: 'area-a', role: 'symbol', point: [0.5, 0.5], method: 'provided' }]`。不声明策略时不会自动取面顶点均值；诊断见 `geometryStatus` 和 `map.render().diagnostics`。

### 指标和观测

- 每条 series 明确 `metric_id`、`unit_id`、`scope_id`、`measure_type` 和 `review_status`；不同范围、实绩/预计/目标和复核状态使用不同序列。
- 每条 observation 有唯一 `id`，且 `(series_id, region_id, period_id)` 组合唯一。数值为有限 JSON number；有效零写 `status: 'value', value: 0`，缺失写 `status: 'missing', value: null`，其他状态见 Schema，不能用 0 代替缺失。
- `periods[].order` 是唯一整数，时间展示据此排序；`view.period_id` 使用实际登记的期次 ID。
- 指标的 `aggregation` 显式选择 `sum`、`ratio` 或 `none`。只有语义允许时才用 `sum`；百分比不能直接求和或平均。跨层级汇总另需 `aggregation_bases`，父子关系本身不保证可加总，细节见[统计语义](DESIGN.md#统计语义)。
- 使用 `sources`、序列 `source_refs` 和观测 `evidence` 保存原文、文件 SHA 与原件定位信息；只有真实核验后才标记 `reviewed`。类别指标需登记类别 dimension；OD 放在 `relations`，不能伪装成地区 observation。

图型编码可继续使用示例的分级设色，或按[图型表](DESIGN.md#图型编码与布局)替换图层。一张图最多一个主题 base，可加兼容 overlay；布局支持 `geographic`、`grid-square`、`grid-hex` 和 `dorling`。

## 加载、版本更新与来源适配

小地图优先用全内嵌 bundle。大资源可改用 `storage: 'external'` 条目，提供 `ref: { kind, id, revision }`、相对 POSIX `path` 和原始文件字节的 64 位十六进制 `sha256`。`loadBundle` 的 resolver 签名为 `(path, ref, { signal })`，返回原始字节或文本，不能返回解析后的对象；完整用法见[准备数据](USAGE.md#准备数据)。

统计期次或指标更新且地理身份不变时可调用 `map.setData(dataset)`；替换整套地图用 `map.setBundle(bundle)`。轮廓或地区身份变更时为 Geography 更新 revision，同步修改 Dataset/MapSpec 引用，再作为一套 bundle 替换。不要把同一个 `id + revision` 复用于不同内容。更新在提交前校验，失败保留旧状态；方案重开仍需相符的资源版本。

需要重复转换一种来源协议时，将 decoder 写在应用模块中，或为本库新增 `src/adapters/<platform>.js` 及相应类型声明。转换函数接收输入对象和显式配置，输出并校验标准资源；可以仿照现有 `euroGeography/euroDataset/euroBundle` 分为三步，但函数名和类结构不是运行时要求。外部应用的 adapter 可直接从自己的文件导入，无需修改本库 exports。

adapter 只处理来源字段、状态、坐标声明和兼容差异，保持来源证据，不复制绘图、分类或统计实现。真实地区配置与材料保存在调用方数据目录；本仓库内按约定放入 `catalog/`、`data/` 或 `examples/`，通用测试只放虚构样本。

## 在本地预览和检查

自己的 bundle 可直接接到上述网页入口。若要使用内置图型画廊的模拟统计数据，复制[虚构画廊配置](../scripts/preview/config.json)，将 `geographies[]` 的 `path`、`id_property`、`label_property`、`level`、`projection` 和来源说明替换为自己的配置，然后在 stats-map 目录执行：

```sh
npm run preview -- --config /path/to/gallery.json --data-root /path/to/assets
```

画廊入口使用 GeoJSON 轮廓及 `euro`/`china` 来源转换，不是任意标准 bundle 的通用加载器。其 `adapter`、`id_property` 等字段属于预览配置，不是 `createMap` 或 `euroGeography` 的通用参数；画廊数值是模拟值，生产统计数据使用自己的 Dataset。

新资源先在 Node 中离线检查，无需构建或访问外部站点。把以下内容保存为应用中的 `check-map.mjs`，与 `new-map.mjs` 同目录，执行 `node check-map.mjs`：

```js
import assert from 'node:assert/strict';
import { createMap } from 'stats-map';
import { bundle } from './new-map.mjs';

const map = createMap(bundle);
try {
  assert.match(map.export('svg'), /data-region-id="area-a"/);
  assert.equal(map.summary('fictional-counts', ['area-b'], 'count', 'p1').value, 0);
  assert.equal(map.summary('fictional-counts', ['area-c'], 'count', 'p1').value, null);
  assert.match(map.export('csv'), /missing/);
  console.log('新地图资源、SVG、零值与缺失检查通过');
} finally {
  map.destroy();
}
```

接入真实数据后把检查 ID 和预期值换成相符样本，再在浏览器核对范围、来源、选择、提示和需要使用的导出。新增 adapter 时补最小转换合同测试；仅补文档时检查链接与示例即可，无需串联全部构建和历史回归。检查范围以[验收约定](../ACCEPTANCE.md#按变更选择检查)为准。
