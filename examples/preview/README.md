# 真实边界预览样本

`npm run preview` 默认并列展示中国省级地图与欧洲国家地图。这里只保存预览配置、真实边界及来源说明；库内核不读取此目录，通用测试仍使用虚构夹具。所有统计值、类别、期次与 OD 路线均由同一确定性模拟规则生成。

| 样本 | 范围与出处 | 来源与字节校验 |
| --- | --- | --- |
| [中国边界](geometry/china.geojson) | DataV GeoAtlas 全国省级边界归档，34 个具名地区；无名称附属几何仅作参考 | [来源记录](geometry/china.source.json) |
| [欧洲边界](geometry/europe.geojson) | Eurostat / GISCO 2024、1:60M，欧洲视窗内 41 国；不含海外部分，并非欧洲全覆盖 | [来源记录](geometry/europe.source.json) |

© EuroGeographics for the administrative boundaries。边界样本保留各自来源归属与说明，不以库代码的 EUPL 许可替代来源条款。

本批从已归档文件按字节复制，没有重新请求外部站点。来源记录中的原宿主归档路径只作历史定位，不是预览输入；独立使用只需本包内文件。中国样本保留原始几何；欧洲样本沿用原归档的完整多边形筛选规则与排除记录。

本目录随 npm 包分发，默认预览不需要下载边界，也不读取上级仓库。纯虚构预览仍可使用 `npm run preview:synthetic`，最小示例继续使用虚构群岛标准地图包。

方格与六边形读取同目录下的 `*.grids.json`，保留自动生成的大致地理方位。位置只在接入时用 `npm run prepare:preview-grids` 生成；原边界字节不改。画廊配置登记位置文件及 SHA-256，位置文件另绑定边界 SHA-256。再次运行接入命令会复用已有位置，页面加载、切期和调整窗口不会重新求解。更换边界或算法配置后需在接入阶段显式 `--force`。

可直接打开 `/preview/?layout=grid-square` 或 `/preview/?layout=grid-hex`。真实边界样本暂未提供真实邻接表，因此当前位置优化使用锚点、方位和紧凑度，质量文件中的邻接指标为 `null`，不能解释为邻接关系全部保留。

从 stats-map 项目根目录执行以下命令，可离线核对样本 SHA、来源与代表图型：

```sh
node examples/preview/verify.js
```
