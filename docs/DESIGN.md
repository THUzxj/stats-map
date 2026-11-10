# 设计文档

stats-map 将地理身份、统计数据、展示方案与来源获取分开。应用提供资源，适配器转换来源协议，共同内核负责校验、计算、布局、绘制和交互。整个目录可以作为独立源码项目使用，默认不读取上级仓库。

入门见[使用指南](USAGE.md)，具体选项见 [API 与行为参考](REFERENCE.md)，发布边界见[独立发布指南](RELEASING.md)。当前验收范围以 [ACCEPTANCE.md](../ACCEPTANCE.md) 为准。

## 资源模型

四类标准资源均为带 `schema_version:1`、`kind`、`id`、`revision` 的 JSON 对象。引用按 ID 与版本精确匹配，不根据地区代码前缀或文件目录推断。

| 资源 | 职责 | Schema |
| --- | --- | --- |
| Geography | 地区身份与层级、坐标空间、GeoJSON 几何、锚点 | [geography](../schemas/stats-map-geography-v1.schema.json) |
| Dataset | 指标、单位、口径、期次、序列、观测、关系及来源 | [dataset](../schemas/stats-map-dataset-v1.schema.json) |
| MapSpec | 地理/数据引用、视图、图层编码、分类、布局与交互配置 | [spec](../schemas/stats-map-spec-v1.schema.json) |
| MapBundle | 组织资源并指定入口方案；支持内嵌或带 SHA-256 的外部资源 | [bundle](../schemas/stats-map-bundle-v1.schema.json) |

可选[地区成员目录](../schemas/stats-map-region-sets-v1.schema.json)由应用提供，用于解析排名范围。完整虚构地图包见 [third-map.json](../tests/fixtures/third-map.json)。`validateBundle` 检查包结构，资源引用与渲染语义在 `loadBundle` / `createMap` 等入口继续校验。Schema 描述静态结构，运行时验证负责版本匹配、编码兼容和统计约束。

## 模块职责与依赖方向

| 目录 | 职责 |
| --- | --- |
| `src/core/` | 资源校验、DatasetView、分类、聚合、坐标投影、状态、加载与地图实例 |
| `src/renderers/` | 图型注册、阶段协议、SVG 几何与统计编码 |
| `src/layouts/` | 地理/格网/Dorling 布局、屏幕包络与本地 Worker |
| `src/components/` | 图例、提示、排名、地区列表、附图、装饰、时间、多图联动和导出 |
| `src/adapters/` | China v1、Euro GeoJSON/TopoJSON/JSON-stat 的来源格式转换 |
| `src/types/`、`types/` | 公开类型原件与包入口类型转导出 |
| `schemas/` | 标准资源结构契约 |
| `tests/` | 能力与语义测试；`fixtures/` 只含虚构样本 |
| `examples/preview/` | 可选真实地图演示的边界、配置与来源；默认画廊使用，库内核不读取 |
| `scripts/` | 构建、检查、包消费验证和本地预览工具 |
| `docs/` | 使用、架构、参考及发布文档 |
| `dist/` | 自动生成的 ESM、浏览器脚本、Worker、CSS、类型、Schema 与许可 |

来源适配器输出标准资源，不复制分类、图型或布局算法。renderer 按编码与能力判断能否绘制，不按来源名称或真实地区代码分支。新增来源通常只增加 adapter；已能提供标准资源的应用可以跳过 adapter。

内核不采集网页、不执行 SQL、不查找宿主目录，也不发布正式观测。`loadBundle` 对外部资源调用应用注入的 resolver，校验原始字节 SHA-256、JSON 内容及资源身份；resolver 自行决定从本地文件、受控 HTTP 或其他存储读取。

## 统计语义

- **零与缺失分开**：有效 `0` 参与数值语义；missing、suppressed、not_available、out_of_scope 等状态独立保留，不补零。
- **原值与显示分开**：分类、图例筛选、排名和符号大小不改写原始观测，格式化不改变 CSV 原值。
- **口径显式**：单位、范围、实绩/预计/目标与复核状态随通道保留，共同量尺比较须检查语义相容性。
- **聚合显式**：按声明的可加总性和无重复基础单位汇总；比例在共同有值基础上合计分子分母后重算，不平均百分比。原报告值与派生汇总分别可追溯。
- **来源完整**：提示、事件和导出携带资源版本、原观测与来源。缺少几何或锚点不删除已登记地区的统计身份。
- **关系独立**：OD 使用 `relations`；地区切片明确方向、锚点及筛选，不冒充原始地区观测，也不补反向关系。

共同 DatasetView 与通道解析服务为绘图、图例、提示、排名和导出提供一致语义。显示范围、选择集合、聚合基础各有独立职责。

## 图型、编码与布局

| 规范类型 | 主要编码 | 默认角色 |
| --- | --- | --- |
| `choropleth` | 数值分类、连续色带、纹理 | base |
| `categorical` | 显式类别 | base |
| `bivariateChoropleth` | 两个数值轴 | base |
| `trivariateChoropleth` | 三元构成 | base |
| `stripeComposition` | 条纹构成 | base |
| `alpha` | 数值颜色 × 透明度 | base |
| `bar` | 分组/堆叠与可选独立柱宽 | base |
| `proportionalSymbol` | 非负大小与可选数值/类别颜色 | overlay |
| `pieChart` | pie/ring/flag/segment/radar/agepyramid/halftone | overlay |
| `waffle` | 格子近似构成 | overlay |
| `mushroom` | 两个同口径数值半圆 | overlay |
| `sparkline` | line/area/bar 时序 | overlay |
| `coxcomb` | 时间 × 分量，面积或半径尺度 | overlay |
| `flow` | 有向 OD、直线/曲线/空间桑基 | overlay |

一张地图最多一个主题 base 图层，可叠加兼容 overlay。`listRenderers()`、`capabilities()` 提供可查询的能力；别名及子模式详见参考文档。

四种布局共享地区身份和统计通道：`geographic` 按坐标投影，`grid-square` / `grid-hex` 使用格网，`dorling` 依据实际符号屏幕包围圆求解位移。Dorling 使用固定种子；浏览器可通过同源模块 Worker 求解，Node 或 `worker:false` 使用同步实现。无法容纳时返回碰撞/溢出诊断，保留统计尺寸。

面几何的符号锚点必须显式登记，或通过 `anchor_policy:{method:'interior-point',version:1}` 声明派生；默认不会使用顶点均值。格网、变形布局不展示未经定义的物理比例尺。

## 渲染、状态与生命周期

`createMap(container, options)` 创建可挂载实例；`createMap(bundle)` 可在无 DOM 环境计算及导出 SVG/CSV。MapFrame 管理资源引用、spec、选择与视图，组件通过事件订阅同一实例。

renderer 阶段协议为 `validateEncoding → prepare → render`，后续绘制可用 `update`。`hitTest` / `describe` 接入公共交互与提示，`destroy` / `services.onDispose` 清理帧资源。自定义 renderer 用 `registerRenderer` 注册，MapSpec 只保存声明参数；重开方案前由应用注册实现。

更新先验证候选主图与附图，全部成功后提交并清理旧帧；失败清理候选，保留原方案、图形与资源。快速布局请求与销毁会取消旧 Worker。`unmount()` 解除 DOM 绑定，`destroy()` 释放帧、监听、Observer、控制器与 Worker。

语言、主题、动态偏好按实例解析。标签、图例、排名与装饰共享测量/布局结果；碰撞与空间不足通过 diagnostics 暴露。键盘、触屏和鼠标使用相同地区身份与原始通道证据。

## 分发与能力边界

运行时无第三方包依赖；Node 构建使用本包锁定的 esbuild 与 TypeScript。ESM、全局 StatsMap 浏览器脚本和逐图型入口共享同一实现，逐图型导入不承诺只包含该图型的体积。浏览器部署须保留完整 dist 的 Worker 相对路径。

PNG 需要浏览器 Canvas，Node 返回 `EXPORT_UNAVAILABLE`。特殊字体、极密集组合、其他浏览器与性能基准属于专项验证；不以全部参考示例的视觉等价作为日常完成条件。默认代表矩阵为 22 例，子模式由能力级测试验证。

[upstream-coverage.json](../upstream-coverage.json) 的外部审计路径仅是原宿主中的历史证据位置，不是运行或构建输入。独立项目的当前验证以自身源码、测试和构建产物为准。
