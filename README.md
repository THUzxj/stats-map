# stats-map

通用、离线优先的交互式统计地图库。用一套数据与 API 绘制分级设色、比例符号、构成、时序和流向地图，可嵌入普通网页或前端项目。

- **14 类图型、四种布局**：地理、方格、六边格和 Dorling。
- **数据语义完整**：区分有效零与缺失，保留单位、统计口径、原值和来源。
- **交互与导出**：地区选择、图例筛选、提示、排名、时间播放、附图及多图联动；导出 SVG、PNG、CSV 和可重开的方案。
- **独立使用**：运行时无第三方依赖；支持标准地图包，也提供 Euro/China 来源格式适配器。

## 先看预览

需要 Node.js 22 或以上。在本目录运行：

```sh
npm run preview
```

打开 **[本地画廊](http://127.0.0.1:4173/preview/)**，切换图型、期次和布局；也可打开 **[最小示例](http://127.0.0.1:4173/preview/quickstart.html)**，查看标准地图包的加载与选择交互。按 `Ctrl+C` 停止。

默认画廊分别加载包内的**中国省级真实轮廓**与**欧洲国家真实轮廓**，统计数值均为模拟数据。无需安装依赖或先构建，也不访问外部站点。端口被占用时运行 `npm run preview -- --port 4174`；纯虚构预览用 `npm run preview:synthetic`。

## 数据来源

本库通过 Geography、Dataset 等标准资源接入调用方的数据。包内画廊使用以下归档边界与演示数据：

| 内容 | 来源与范围 | 可追溯记录 |
| --- | --- | --- |
| 中国省级轮廓 | DataV GeoAtlas 全国省级边界归档快照，34 个具名地区；无名称附属几何作为参考图形 | [来源、原始地址与 SHA-256](examples/preview/geometry/china.source.json) |
| 欧洲国家轮廓 | Eurostat / GISCO，2024 年、1:60M、EPSG:4326；从 `eurostat-map` 保存的世界拓扑数据选取欧洲视窗内 41 国的多边形分量，筛选范围与排除记录见来源文件 | [来源、筛选规则与 SHA-256](examples/preview/geometry/europe.source.json) |
| 统计数值、类别、期次与 OD 流向 | 包内确定性模拟规则，用于展示图型、有效零、缺失值和交互；**均为模拟数据，不代表真实统计水平** | [模拟数据生成规则](tests/fixtures/gallery.js) |
| 通用测试与最小示例的轮廓 | 包内虚构地理样本 | [虚构画廊轮廓](tests/fixtures/gallery-geography.geojson)、[最小地图包](tests/fixtures/third-map.json) |

默认预览直接读取随包保存的边界快照。欧洲样本是选定视窗内的展示范围，不含海外部分，也不构成欧洲全覆盖数据集。方格和六边形位置由本库在地图接入时生成并保存，见[自动地理格网](docs/AUTO_GRID_LAYOUT.md)。生产应用的数据范围、统计口径和来源由调用方在资源中声明。

欧洲行政边界署名：**© EuroGeographics for the administrative boundaries**。边界资料保留各自发布方的使用条件；来源说明见[预览样本说明](examples/preview/README.md)，代码许可及第三方说明见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参考项目：eurostat-map

功能设计、主题图类型和示例参考 Eurostat 的开源项目 **[eurostat/eurostat-map](https://github.com/eurostat/eurostat-map)**。该项目围绕 Eurostat 数据提供可定制的专题地图，是本库整理图型、布局、图例与交互能力的重要参考，感谢上游作者与维护者的工作。

## 在项目中使用

从本目录构建安装包：

```sh
npm ci
npm pack
```

`npm pack` 自动构建并生成 `stats-map-1.0.0.tgz`。在你的前端项目中安装它（将路径替换为实际位置）：

```sh
npm install /path/to/stats-map-1.0.0.tgz
```

```html
<div id="map" class="stats-map" style="height:480px"></div>
```

```js
import { createMap } from 'stats-map';
import 'stats-map/style.css';

// bundle.json 由调用方提供；可复制包内
// tests/fixtures/third-map.json 虚构样本开始。
const response = await fetch('./bundle.json');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const bundle = await response.json();
const map = createMap(document.querySelector('#map'), { bundle, responsive: true });
map.on('selectionchange', () => console.log(map.getState().selection));
// 页面或组件卸载时：map.destroy();
```

上例用于支持 npm 模块与 CSS 导入的前端工具。普通网页可直接加载构建后的浏览器脚本，无需打包工具，见[使用指南](docs/USAGE.md)。预览边界、范围与来源见[示例说明](examples/preview/README.md)；生产应用自行提供和管理统计数据、边界及其来源。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/USAGE.md) | 预览、安装、普通网页、数据接入、交互与导出 |
| [添加新地图](docs/ADDING_MAPS.md) | 资源字段、完整接入示例、来源适配、版本更新与检查 |
| [设计文档](docs/DESIGN.md) | 资源模型、模块职责、统计规则、渲染与生命周期 |
| [自动地理格网](docs/AUTO_GRID_LAYOUT.md) | 接入时生成方格/六边形位置，保存后由运行时直接使用 |
| [API 与行为参考](docs/REFERENCE.md) | 从原 README 迁移的完整选项、事件与高级用法 |
| [独立发布指南](docs/RELEASING.md) | 依赖边界、打包、独立验证、静态资源部署 |
| [验收范围](ACCEPTANCE.md) | 按变更选择测试和默认 22 例集成矩阵 |

开发时先 `npm ci`，再按改动运行 `node --test tests/<相关文件>.test.js`、`npm run check` 或 `npm run test:matrix`。完整库测试使用 `npm test`，构建使用 `npm run build`。

采用 [EUPL-1.2](LICENSE) 许可；第三方构建工具说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
