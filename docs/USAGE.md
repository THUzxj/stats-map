# 使用指南

本文面向独立使用 stats-map 的应用开发者。参数细节见 [API 与行为参考](REFERENCE.md)，资源和模块职责见[设计文档](DESIGN.md)。

## 环境与第一次预览

需要 **Node.js 22 或以上**；`.nvmrc` 固定开发基线为 22.22.0，`packageManager` 记录 npm 11.10.1。预览只需要 Node 与 npm，地图样本已包含在包内，不需要 Python、数据库或构建工具。

在源码项目根目录（本仓库中为 `stats-map/`）执行：

```sh
npm run preview
```

打开 `http://127.0.0.1:4173/preview/`：画廊展示 14 类图型，可切换子模式、六个模拟期次和四种布局。左侧为中国的 34 个具名省级地区，右侧为欧洲视窗内 41 国，分别经 China 与 Euro 协议转换。边界为真实归档轮廓，数值、类别和 OD 均为模拟数据；欧洲样本不含海外部分，并非欧洲全覆盖。范围、来源与 SHA-256 见[真实边界示例说明](../examples/preview/README.md)及面板中的来源链接。

需要纯虚构轮廓时运行 `npm run preview:synthetic`。通用测试继续使用虚构夹具；真实地图的专项核查入口为 `node examples/preview/verify.js`。

`http://127.0.0.1:4173/preview/quickstart.html` 是可运行的最小示例，直接消费标准 MapBundle。实现位于 [quickstart.html](../scripts/preview/quickstart.html)，数据位于 [third-map.json](../tests/fixtures/third-map.json)，包含正值、有效零与缺失。

预览无需 `npm ci` 或 build，通过本机 HTTP 加载包内源码。按 `Ctrl+C` 停止；自定义端口用 `npm run preview -- --port 4174`。不要直接用 `file://` 打开 HTML，模块和 Worker 需要 HTTP。

使用自己的轮廓时，参考[默认画廊配置](../examples/preview/gallery.json)或[虚构画廊配置](../scripts/preview/config.json)，显式提供配置与数据根目录：

```sh
npm run preview -- --config /path/to/gallery.json --data-root /path/to/assets
```

配置的 `geographies[].path` 及可选 `source_path` 相对 `--data-root`，不得越出该目录；`adapter` 为 `euro` 或 `china`，并声明 ID/名称字段和投影。此入口仅供本地开发，服务只监听 `127.0.0.1`。

## 安装与构建

源码项目可整体复制成独立仓库。命令均在本目录运行：

```sh
npm ci
npm run build
```

构建生成 `dist/`，不读取上级目录。运行时无需保留 `node_modules/`，源码重建则需要锁定的开发工具。首次 `npm ci` 通常需要 npm registry；完整缓存可用 `npm ci --offline`。

生成可安装 tarball：

```sh
npm pack
```

`prepack` 自动运行构建。在其他项目安装生成的 `stats-map-1.0.0.tgz`：

```sh
npm install /path/to/stats-map-1.0.0.tgz
```

这里使用本地 tarball，不预设同名包已在公共 registry 发布。发布步骤见[发布指南](RELEASING.md)。

## 前端项目：ESM

先提供非零高度的容器：

```html
<div id="map" class="stats-map" style="height:480px"></div>
```

在支持 npm 模块和 CSS 导入的前端入口中：

```js
import { createMap, validateBundle } from 'stats-map';
import 'stats-map/style.css';

// 将 tests/fixtures/third-map.json 复制为应用公开的 bundle.json，
// 或提供自己的内嵌标准地图包。
const response = await fetch('./bundle.json');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const bundle = await response.json();
validateBundle(bundle);
const map = createMap(document.querySelector('#map'), { bundle, responsive: true });
map.on('selectionchange', () => console.log(map.getState().selection));
// 应用卸载时：map.destroy();
```

也可使用 `{geography, dataset, spec}` 或多数据集 `datasets` 构造地图。单独调用 `validateBundle` 不代替资源引用及图层语义校验，创建和替换状态时会继续验证。

## 普通网页：无需前端打包工具

将构建后的**完整** `dist/` 复制到站点 `assets/stats-map/`，将虚构样本或自己的内嵌 MapBundle 保存为 `bundle.json`，通过 HTTP 打开：

```html
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<link rel="stylesheet" href="./assets/stats-map/stats-map.css">
<div id="map" class="stats-map" style="height:480px"></div>
<script src="./assets/stats-map/stats-map.iife.js"></script>
<script type="module">
  const response = await fetch('./bundle.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bundle = await response.json();
  const map = StatsMap.createMap(document.querySelector('#map'), {
    bundle, responsive: true
  });
  window.addEventListener('pagehide', () => map.destroy(), { once: true });
</script>
</html>
```

经典脚本同步提供 `globalThis.StatsMap` 并发送 `stats-map-ready` 事件。CSS 作用于调用方标记的 `.stats-map` 容器。也可从 `./assets/stats-map/index.js` 直接导入 ESM。

Dorling 的模块 Worker 相对脚本/模块 URL 定位到 `src/layouts/dorling-worker.js`，不要只部署单个 JS 文件；Worker 与模块需要同源可访问。npm 工具链可解析 `stats-map/browser`、`stats-map/style.css`、`stats-map/worker`，资源复制方式由应用构建配置负责。

## 准备数据

最简单的输入是全内嵌 MapBundle，无需 loader。生产数据可按[资源模型](DESIGN.md#资源模型)分别提供 Geography、Dataset 与 MapSpec，结构以本包 [schemas](../schemas/) 为准。

接入新的地区轮廓和统计表，见[添加新地图的接口指南](ADDING_MAPS.md)：包含完整虚构示例、字段对应、坐标与锚点、来源转换及离线检查。

Geography 声明坐标空间、层级、精确地区 ID、几何和版本；Dataset 声明单位、指标、口径、序列、期次和观测；MapSpec 绑定版本并设置图层。不能依靠 ID 前缀、数组位置或名称猜测对应关系。

外部资源地图包需先解析；resolver 返回原始字节或文本：

```js
import { loadBundle, createMap } from 'stats-map';

const response = await fetch('./bundle.json');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const descriptor = await response.json();
const base = new URL('./resources/', document.baseURI);
const bundle = await loadBundle(descriptor, async (path, ref, { signal }) => {
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('Resource is outside the allowed directory');
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
});
const map = createMap(document.querySelector('#map'), { bundle });
```

外部条目必须登记 SHA-256 与资源身份，校验以实际返回字节为准。离线宿主可注入文件 resolver；库无默认网络服务地址，不扫描宿主文件。

来源转换可选 `stats-map/adapters/euro` 的 `euroBundle/euroGeography/euroDataset`，或 `stats-map/adapters/china` 的对应函数。真实边界、来源与范围由应用提供。Euro 数值默认不可加总，需明确声明 aggregation 才启用相应汇总。

## 配置、交互与组件

```js
map.setLayout({ type: 'grid-hex' });
map.setView({ period_id: 'next-period' }); // 替换为数据中声明的 ID。
map.setSelection(['area-a']);            // 替换为 Geography 中的 ID。
map.setLocale('zh-CN');
map.setTheme('dark');
map.on('regionclick', event => console.log(event));
map.on('error', error => console.error(error));
```

`setData/setGeography/setBundle/setSpec/setLayers` 等更新先验证再提交，失败保留旧状态。`responsive:true` 使用 ResizeObserver 跟随容器尺寸。

图型与角色见[设计文档](DESIGN.md#图型编码与布局)。用 `listRenderers()` 查询，或从 `stats-map/renderers/pieChart` 等子路径取得 `createLayer`。面积符号要求非负大小，有符号数值可用于颜色。Polygon 上符号/流线需登记锚点或声明面内点策略。

```js
import { TimeController, RankingChart } from 'stats-map';

// 分别提供应用自己的 #time 和 #ranking 容器。
const time = new TimeController(map, { interval: 1200 });
time.mount(document.querySelector('#time'));
const ranking = new RankingChart(map, { limit: 20 });
ranking.mount(document.querySelector('#ranking'));
```

多图联动用 `MapLink`，分页比较用 `SmallMultiples`，故事章节用 `StoryMap`，详细约束见参考文档。调用控制器 `destroy()` 或销毁地图释放资源；`unmount()` 只解除相应 DOM 绑定，不等于暂停播放。

## 导出与清理

```js
const svgText = map.export('svg');
const csvText = map.export('csv');
const resolvedSpec = map.exportSpec({ resolved: true });
const state = map.getState();
const pngBlob = await map.exportImage('png'); // 需要浏览器 Canvas。
map.destroy();
```

SVG/CSV 可在 Node 中用 `createMap(bundle)` 导出；Node 中 PNG 返回 `EXPORT_UNAVAILABLE`。方案保存引用与展示状态，重开时仍需相符的 Geography/Dataset，它不是全部数据的自动打包。resolved 方案固定实际阈值和量尺；CSV 保留原值、状态、单位、范围、版本与来源。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 端口占用 | 使用 `--port` 改端口 |
| 地图空白或没有尺寸 | 设置非零高度，检查控制台与资源引用 |
| 模块或 Worker 加载失败 | 使用 HTTP，保留完整 dist 路径，检查同源与 MIME |
| Polygon 上符号/流线没有位置 | 提供锚点或声明 `anchor_policy` |
| 空观测没有数值 | 检查 status，不能把 missing 当作 0 |
| 更新配置抛错 | 检查错误 code/details，修正后重试；旧图保留 |
| 空期次没有值 | 核对实际 period_id 与数据集时间域，不按数组下标补齐 |

开发和包验证命令见[发布指南](RELEASING.md)，按变更选择检查，不串联全部历史回归。
