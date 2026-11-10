# API 与行为参考

本文由原 README 迁移，保留详细选项、统计语义与生命周期说明。入门见 [使用指南](USAGE.md)，架构见 [设计文档](DESIGN.md)，独立分发见 [发布指南](RELEASING.md)。

新增地理范围或来源数据的完整流程见[添加新地图的接口指南](ADDING_MAPS.md)；新增绘图算法见下文的 Renderer 扩展协议。

## 目录

- [入口、分发与开发](#入口分发与开发)
- [Renderer 扩展协议](#renderer-扩展协议)
- [比例符号与独立颜色通道](#比例符号与独立颜色通道)
- [构成图、总量缩放与尺寸图例](#构成图总量缩放与尺寸图例)
- [时序、三元与分量事件](#时序三元与分量事件)
- [多图联动、分页比较与故事](#多图联动分页比较与故事)
- [图例筛选、例外与跨数据集编码](#图例筛选例外与跨数据集编码)
- [来源适配与时间播放](#来源适配与时间播放)
- [图层角色、视图范围与响应式行为](#图层角色视图范围与响应式行为)
- [包验证、导出与 profile](#包验证导出与-profile)
- [装饰与附图](#装饰与附图)
- [排名、分布与成员目录](#排名分布与成员目录)
- [本地化与主题](#本地化与主题)
- [标签、图例与装饰布局](#标签图例与装饰布局)
- [锚点策略与 Dorling](#锚点策略与-dorling)
- [地区列表、提示与时间刷选](#地区列表提示与时间刷选)
- [流向图与关系证据](#流向图与关系证据)
- [双向合并、分类节点与标签](#双向合并分类节点与标签)
- [OD 地区切片与独立投影导出](#od-地区切片与独立投影导出)

## 入口、分发与开发

通用、离线优先的统计地图内核。运行时只接收标准 Geography、Dataset、MapSpec 和 MapBundle 资源；来源适配器负责把 Euro/China 或其他来源转换为这些资源。核心不携带地区默认值，也不会把缺失观测补成零。

当前目标与检查规则见 [ACCEPTANCE.md](../ACCEPTANCE.md)：按通用能力完成和代表案例验收，不要求上游逐例视觉等价。修改时运行相关测试；默认集成矩阵22例，旧414例矩阵由 `npm run test:matrix:expanded` 手动运行。构建、发布、宿主资源/skill同步、独立包及历史浏览器回归按变更边界或交付节点选择，不随每次修改全部重跑。

2026-11-09：当前必需范围已验收，最后的renderer阶段协议及受影响候选版本交付已关闭。当前结果见`upstream-coverage.json`的`current_completion`；验收范围与后续专项以ACCEPTANCE.md为准。

```js
import { createMap, validateBundle } from 'stats-map';
const map = createMap(document.querySelector('#map'), { bundle });
map.render();
```

也可以用 `createMap(bundle)`，或传入 `{geography, dataset, spec}` 构造运行时地图。主要实例方法包括 `setBundle`、`setData`、`setGeography`、`setView`、`setLayers`、`setLayout`、`setSelection`、`exportImage` 和 `destroy`；事件通过 `on/off` 管理。

普通网页也可直接加载`dist/stats-map.iife.js`，无需`type="module"`或宿主打包工具；它同步提供`globalThis.StatsMap`并发送`stats-map-ready`事件。可选样式位于`dist/stats-map.css`，选择器仅作用于调用者标记的`.stats-map`容器。部署时保留完整dist目录：普通script中的Dorling Worker相对script URL定位到`src/layouts/dorling-worker.js`，ESM则相对自身模块定位；均为同源本地资源，不使用blob Worker或远端CDN。npm消费者可解析`stats-map/browser`、`stats-map/style.css`和`stats-map/worker`取得这些资源。

```html
<link rel="stylesheet" href="./stats-map/stats-map.css">
<div id="map" class="stats-map"></div>
<script src="./stats-map/stats-map.iife.js"></script>
<script>
  // bundle由调用者提供，符合MapBundle契约。
  const map = StatsMap.createMap(document.querySelector('#map'), {bundle});
</script>
```

14个规范图型分别提供`stats-map/renderers/<type>`入口，例如`import pie from 'stats-map/renderers/pieChart'`。每个入口导出默认对象及具名`type/createLayer/render`：`pie.createLayer(encoding, options, {id:'composition'})`生成图层，`pie.render({geography,datasetView,spec,layer,...})`调用同一`renderSvg`并固定该图型；`createLayer`默认角色与registry一致。入口共用ESM模块及统计/交互服务，不复制算法；当前通用SVG模块包含全部绘图分支，按图型导入不承诺包体积只包含该图型。

源码构建支持Node22及以上，`.nvmrc`记录22.22.0，构建和类型检查使用锁定的esbuild/TypeScript开发依赖，运行时仍无第三方依赖。开发者先执行`npm ci`再构建；离线重建需本机缓存已包含锁定的构建工具。`npm run verify-package`默认使用包声明的TypeScript执行严格消费检查，也可用`STATS_MAP_TSC`指定测试编译器。分发包含EUPL全文、第三方说明及生成helper的MIT许可；不读取主仓库参考克隆来构建。

原宿主的持续集成对代码/契约变更默认仅在Node22.22.0运行结构及Node测试，集成矩阵仍为22例；README和验收说明改动不启动构建。需要额外证据时，在GitHub Actions手动选择独立的`browser`（4个代表例）、`package`（构建/tarball重建/类型消费）、`compatibility`（Node24）或`expanded-matrix`（历史414例），不会把它们串成每次修改的门槛。该工作流位于原宿主，不包含在本包；独立仓库可按发布指南配置相同命令。宿主资源发布与skill同步不由此工作流触发。

可在本地安装Python Playwright后执行`npm run test:browser`；默认使用已安装的Playwright Chromium，已有Chrome可传`-- --channel chrome`。`--output <目录>`可保存本批证据。该命令访问本机测试HTTP服务，不访问外部站点；浏览器检查不由`npm test`自动触发，也不是生产运行依赖。

支持 geographic、grid-square、grid-hex 和确定性 Dorling 布局；14 个 renderer 的 registry、模式和能力缺口可通过 `listRenderers()`、`capabilities()` 查询。PNG 导出必须在浏览器 Canvas 环境执行，Node 中会返回结构化 `EXPORT_UNAVAILABLE` 错误。

## Renderer 扩展协议

`registerRenderer(definition)`把应用提供的绘制器接入主图、附图和`renderSvg`；`listRenderers()`同时列出内置与自定义定义，`RENDERER_TYPES`保留14个内置类型。注册必须提供唯一`type`及`render`函数；可声明`aliases`、`defaultRole`、`modes`和`capabilities.layouts`。名称或别名冲突会在写入注册表前整体拒绝，不能覆盖内置入口。MapSpec只记录类型及声明参数，重开时由应用预先注册对应实现。

同步阶段为`validateEncoding(context) → prepare(context) → render(context, prepared)`；后续绘制可实现`update(context, prepared, previousResult)`替代render。验证返回false或抛错即拒绝。缺省验证/准备/清理为空操作，缺省拾取/描述返回null，缺省update重新调用render。内置绘制器也经过此链，既有统计/编码校验仍由共同核心执行。

context提供解析后的spec/layer、DatasetView及各通道视图、统计期与汇总上下文、viewport/projection、布局/锚点、selection和presentation；`services.project/classify`复用坐标及分类服务。绘制返回`{svg, diagnostics?, collisionRadii?, anchors?}`，svg为完整SVG文档。Dorling测量时`context.phase==='measure'`，collisionRadii按region_id提供有限、非负的屏幕包围圆，准备与清理同样会执行。`data-region-id`标记由共同服务补齐键盘可访问性、原值/来源说明和地区事件，不需要另写一套选择状态。

`hitTest(context, prepared, point, result)`返回`{regionId, point?, distance?}`或null，`map.hitTest`按绘制顺序调用，附图传入其局部屏幕坐标。`describe(context, prepared, target, result)`返回`{title, rows:[{label,value}]}`或null，可通过`map.describe`查询，也用于共同tooltip；null沿用共同描述。`destroy(context, prepared, result)`释放该帧资源，可能收到准备失败时的undefined。准备期间可用`services.onDispose(fn)`登记清理，即使prepare中途抛错也执行。

每次更新准备独立候选，previousResult仅供读取；输出不得借用会在清理时失效的资源。所有主图/附图成功后统一替换并清理旧帧；任一阶段失败只清理候选，保留旧方案、画面及资源。`setSpec/setData/setGeography/setBundle`和选择/分区更新均遵循此规则。地图销毁清理全部帧，unmount仅解除DOM绑定，仍可离线导出；直接`renderSvg`在返回前清理其临时帧。公开协议类型从主入口及`stats-map/renderers`导出，最小虚构实现见源码测试的`tests/fixtures/protocol-renderer.js`。

所有加载、汇总和分类均为纯本地操作，网络、文件路径和 SQL 由宿主注入的 loader 负责。按需运行 `node --test tests/<相关文件>.test.js`、`npm run check`、`npm run test:matrix`；阶段集成可运行 `npm test`，需要产物时运行 `npm run build`。`upstream-coverage.json` 记录固定上游提交和当前能力证据。

`tests/adapter-matrix.test.js` 默认用22个虚构案例验证14类图型、轮换的四种布局及 Euro JSON-stat/China v1/第三方平面资源；各子模式的算法由专项测试覆盖。历史414个组合及135个Dorling配置的证据继续保留，按需重放。category/OD 是显式标准格式扩展，不能据此声称数值来源协议原生提供这些数据。浏览器检查选择受影响交互、图形边界或导出代表例，不再要求完整交叉矩阵。

## 比例符号与独立颜色通道

大小符号与大小图例共用尺度。`options.shape` 支持 circle、bar、square、star、diamond、wye、cross、triangle、spike；bar/spike 以固定宽度编码高度，其他符号默认编码面积。`custom` 形状只接受 `customShape:{viewBox:[x,y,width,height],path:'闭合 SVG path 数据'}`。Mushroom 的 `orientation` 为 horizontal 或 vertical，两个 series 必须有共同单位、总体与实绩/复核口径。

比例符号的 `maxRadius`（默认 20px）、`maxValue` 控制大小尺度；`minRadius` 只给正值设显示下限，零仍为零、缺失仍缺失。设置下限后图例明确说明，低值区间不再严格按面积比例显示。`offset:{x,y}` 为按当前符号半径相乘的屏幕偏移系数，正 y 向下；地图与图例使用相同偏移。`width` / `barWidth` 为 bar 半宽，`spikeWidth` 为 spike 完整底边宽度（省略时沿用半宽的 1.1 倍）。`strokeWidth`（默认 1px）、`strokeOpacity`、`fillOpacity` 控制描边和填充，透明度为 0–1。所有符号采用圆角连接；Dorling 碰撞半径和图例保留框包括偏移后的实际图形和描边。自定义 path 的描边不随内部 path 缩放改变宽度。配置在替换地图前验证，非法尺寸、透明度和偏移返回 `INVALID_ENCODING`。

比例符号可声明 `encoding:{dataset_id:'amounts',size:{series_id:'amount'},color:{dataset_id:'scores',series_id:'score'}}`，也可沿用顶层单一 series_id/单元素 series_ids 表示大小，再增加 color。具名通道继承顶层 dataset_id 和 relation_slice；明确的 size 始终先于 color，不依赖 JSON 字段顺序。同名 series ID 在各自数据集中解析。大小要求非负 number；颜色可用有正负号的 number 或显式 category。缺少大小时不生成数值符号，颜色缺失时保留大小并用 noDataColor；有效 0 不替换为缺失。类别例外仍只处理大小缺失，不替代有效大小的缺失颜色。

`layer.classification` 对比例符号只控制颜色；`options.colorMode` 为 classified（默认）、continuous 或 diverging，数值颜色使用 colors，连续/发散色带要求六位十六进制色值。`colorDomain:[min,max]` 和发散 `center` 冻结颜色范围。类别颜色使用 categoryColors 的数组或类别 ID 映射，也可提供 colors 数组；类别不接受连续色带。主题的 numericColors/categoryColors 按颜色通道类型选择，显式配置优先。图例并列展示大小和颜色的指标、单位，分别说明两种缺失；类别与数值分档可筛选，保持原大小、选择和观测，色带不生成离散档位按钮。

提示及事件 `channels[].channel` 标明 size/color，并保留各自单位、范围、实绩/复核状态、原始观测、关系切片与来源。默认播放驱动、排名和 CSV 仍选择大小通道；指定 datasetId/seriesId 可导出颜色原值。两个通道可以使用不同的显式 OD 切片。小多图分别冻结共同大小最大值与颜色分类/色域；数值轴必须有相同单位、范围及实绩/复核含义，类别轴必须有一致字典。空期次保留固定量尺，解析方案导出后可离线重开。重复/含糊的大小声明、额外大小序列和非法颜色配置在替换状态前拒绝。自动 Dorling 图例避开完整符号包络；显式固定图例发生遮挡时报告 LEGEND_COLLISION，空间不足时保留诊断，不缩小统计尺寸。

## 构成图、总量缩放与尺寸图例

构成图使用 `encoding:{dataset_id,series_ids}`，`options.totalSeriesId` 指定同口径总量，`showOther:false` 可隐藏“其他”但不会重新归一化已知分量。类别顺序与颜色由 `categoryOrder`、`colors` 提供。缺失、零总量与分量超总量分别显示；waffle 以 `cells/columns` 控制近似格子数，提示保留原值。pieChart 的 `mode` 支持七种模式；radar 的 `radarValueMode` 区分 share/absolute，`sizeBy:'total'` 可按共同总量尺度调整符号面积。bar 的 `mode` 为 grouped/stacked，`widthSeriesId` 可绑定独立柱宽指标。Coxcomb 按 period.order 顺序绘制时间×类别堆叠，`scaleMode:'area'|'radius'` 明示尺度，`rings:false` 关闭参考环。

`sizeBy:'total'` 适用于 pieChart 的全部七种模式及 waffle：名义宽、高或半径乘以 `sqrt(total/totalMaximum)`，agepyramid 的高度和 halftone 的圆心间距、半径一起缩放。份额仍控制内部构形；radar absolute 另外保留分量共同量尺。bar 和 Coxcomb 直接使用各自的数值量尺，拒绝额外的 `sizeBy`。有效正值不能使用零最大值；零总量和缺失保留状态标记。`innerRadius` 为屏幕像素的固定内半径，限制在实际外半径内。

总量缩放默认生成最大总量的1/4、1/2、1三个图形尺寸参照，复用地图的尺寸、描边和模式；Dorling的`layout.radius`也参与相同的名义尺寸计算。参照采用中性色和等份分量，表示名义尺寸；实际份额、固定内半径和radar absolute分量量尺仍决定填充形状，不能把参照当成各地区实际墨迹面积。`options.sizeLegend:false`关闭参照，`options.sizeLegend:{title:'总量参照',values:[25,50,100]}`自定标题和严格递增的正值；自定义数值沿原尺度外推，不改写`totalMaximum`。未启用`sizeBy:'total'`时不接受参照对象。全零或没有有效总量时不生成正值参照；小多图的空面板保留共同总量域的参照。颜色分量筛选与状态项独立保留，参照不产生地区或分量交互目标；SVG/PNG及resolved方案保留同一量尺。

构成符号支持 `stroke/strokeWidth/strokeOpacity/fillOpacity`，描边使用圆连接并计入 Dorling 包围范围。圆形扇区默认白色 0.5px 描边，其他模式默认无描边。waffle 的 `cellPadding` 是格子步长的空隙比例（默认0.08，范围 `[0,1)`），随总量尺寸一起缩放；`cornerRadius` 是屏幕像素圆角，最大为格子边长的一半。bar 使用 `gap`（默认0.5px）和 `cornerRadius`。flag/segment 的 `orientation` 仅接受 horizontal/vertical；stripeComposition 仍允许数值角度。无效尺寸、透明度、格子配置在空期和空地区范围中也会被拒绝。

## 时序、三元与分量事件

Sparkline 的 `mode` 为 line/area/bar，默认共同纵轴；`scale:'local'` 会明确标注独立纵轴。period.start 完整时按实际时间间隔定位，其他情况按声明的 order；`view.time_window:[起始期ID,结束期ID]` 限定窗口，`yDomain:[min,max]` 锁定纵轴。缺期断线，保留每个有效期点的原值和单位。三元图支持 `meanCentering`、`mode:'sextant'`，以及可选 HCL 色彩参数；总和为零不参与归一化。

分量事件 `componentclick/componenthover` 包含 region_id、series_id、period_id、value、share，与 regionclick/regionhover 和 relationclick/relationhover 分开。`interaction.componentClickSelectsRegion:true` 可让分量点击同时选择地区。

## 多图联动、分页比较与故事

```js
import { MapLink, SmallMultiples, StoryMap, TimeController } from 'stats-map';
const link = new MapLink([mapA, mapB], { selection: true, hover: true, zoom: true });
const time = new TimeController(mapA, { interval: 1200 });
time.mount(document.querySelector('#time'));
const panels = new SmallMultiples(container, bundle, [
  { id: 'first', period_id: 'T1', title: 'First' },
  { id: 'second', period_id: 'T2', title: 'Second' }
], { pageSize: 2 });
const story = new StoryMap(mapB, [
  { id: 'intro', caption: 'Introduction', view: { period_id: 'T1' } },
  { id: 'detail', caption: 'Detail', view: { period_id: 'T2' }, selection: ['area-a'] }
]);
// 调用各控制器的 destroy() 释放联动监听、计时器和分页实例。
```

联动只在同版本地理布局间同步缩放；跨地理/格网布局只同步地区身份。小多图固定比较分类域，按页延迟创建实例，缺期显示无数据。故事章节使用纯数据配置和纯文本图注，前后切换从原始 spec 推导。各能力以相关语义测试和代表浏览器行为验证，不将所有来源/布局/选项的交叉穷举作为完成条件。

`MapLink` 的所有通道只在同一 Geography ID/revision 间传播；重叠或循环的多个联动器对每次操作只更新各地图一次。不同格网/地理布局可共享选择和悬停；缩放只同步地理布局。目标更新失败发送含 cause、控制器/实例身份和 channel 的 `LINK_FAILED`，其余目标继续更新。销毁地图会解除对应联动订阅。

`SmallMultiples.showPage(page)` 先创建下一页，成功后才替换旧页并释放旧地图、Worker及监听；失败保留旧页。分页保留键盘焦点，末页转到可用的前页按钮。共享数值域要求同一比较轴有共同单位、范围、实绩/预计/目标与复核语义，否则报告 `INCOMPARABLE_PANELS`；`sharedDomain:false` 可分别展示独立量尺。`StoryMap` 的章节切换保留实例语言/主题，事件同步触发的新章节优先于旧切换；控件拒绝无效章节时恢复当前值、显示错误并发送 `error`。`storychange` 带 controller_id，来源列表为独立快照。`unmount()` 解除故事控件，`destroy()` 同时解除地图订阅。

固定比较分类会保存 `classification.resolvedDomain:[min,max]`（双变量分别保存在 axes 中），只用于保留共同图例范围，不能代替当前期观测。该字段要求 threshold 方法；即使共同域为一个常量且当前期为空，图例也保留该常量说明。无固定域的全空双变量图例不生成分类格子；固定阈值/透明度范围的空期次继续展示共同量尺，并保留缺失说明。

## 图例筛选、例外与跨数据集编码

每层生成独立图例；`layer.title`/`layer.legend.title` 设置标题，`layer.legend:false` 隐藏该层图例。`spec.legend` 支持 `visible/x/y/columnWidth`，图例超出纵向空间时换列。数值分类、类别、二维格子和构成图例可用鼠标或 Enter/Space 筛选，Escape 清除当前层筛选。状态保存在 `view.legend_filters`；`map.setLegendFilter(layerId, keys|null)` 和 `toggleLegendFilter` 提供相同 API。键为 `class:0`、`category:<id>`、`bivariate:0:1`、`component:<series_id>`、`missing/zero/conflict`。筛选淡化其他图形，保留原始值、构成分母、分类域与地区选择；空数组表示全部淡化，null 清除筛选。`legendfilterchange` 与 `selectionchange` 分开发送。连续色带、尺寸、三元和流量量尺暂不提供离散格子筛选。

`encoding.exception:{dataset_id?,series_id}` 给 choropleth、proportionalSymbol 和 pieChart 添加独立类别例外通道；对应 series 必须是 category。只有数值缺失或构成不完整时使用例外，有效 0 不会被替换。`options.exceptions.categoryColors` 配置类别颜色；例外图例与数值/尺寸/构成图例并列，筛选键为 `exception:<category_id>`。符号例外用固定尺寸方块，不暗示数值大小。

双变量、alpha 与比例符号的 size/color 可把各通道绑定到不同 Dataset；同名 series ID 按 `dataset_id` 分别解析，图例保留各自单位。构成型 renderer 的所有分量目前要求位于同一 Dataset，跨数据集组合返回 `UNSUPPORTED_ENCODING`。图层 `aggregation` 可覆盖地图默认汇总上下文。

## 来源适配与时间播放

Euro adapter 接受 FeatureCollection、TopoJSON（`topologyObjects` 可选对象名）、显式地区父子关系和 JSON-stat 稠密数组或稀疏索引对象。每个单位类别对应独立 unit；来源与原 flag 保留。未声明统计可加总性时默认 `aggregation:'none'`；可通过 `units[id].aggregation` 或全局 `aggregation:'sum'` 配合 `aggregationBases` 显式声明。投影坐标必须提供 `coordinateSpace:{type:'cartesian',...}`，未知 CRS 不作为经纬度绘制。内置 equirectangular/Mercator；应用可用 `registerProjection(id, forward)` 注册纯投影函数，JSON 方案只保存投影 ID 和数值参数。

`StoryMap.mount(container)` 提供章节选择、前后切换、纯文本图注和来源列表。`TimeController` 跟随外部 `setView/setData/setBundle` 更新；播放失败会暂停并发送 `error`，包含 `PLAYBACK_FAILED` 和原始 cause。地图地区/分量/边有可聚焦的统计说明，Enter/Space 可触发对应点击；事件 `channels` 包含数据版本、单位、范围、原始观测与来源。

时间播放可用 `datasetId` 指定驱动数据集，默认选择首层第一个非异常通道的数据集，再回退至首个 dataset_ref。时间域按该数据集的 period.order 排序，保留无观测期次；全图使用相同的 period_id，不按数组下标对齐不同数据集。`timechange` 包含驱动数据集 ID/版本、期次列表、索引、controller_id，以及未声明当前期次的 `unavailable_dataset_ids`；该列表不表示观测缺失或被抑制。零值、空期次和来源的缺失状态保持原义。

更换数据/Bundle 或驱动时间域会暂停播放，已排队的旧回调失效。显式驱动数据集消失时控件禁用并报告 `UNKNOWN_DATASET`，重新提供该数据集可恢复。`interval` 至少 16ms；`loop` 控制末期回到首期。可成对注入 `setInterval/clearInterval` 以接入调度器。`unmount()` 移除控件，保留独立播放；`pause()` 停止播放，`destroy()` 释放计时器、控件和订阅。所有播放按钮可安全放入表单。

## 图层角色、视图范围与响应式行为

图层角色由 renderer 能力声明决定：`choropleth`、`categorical`、双变量/三变量、`stripeComposition`、`alpha` 和 `bar` 是唯一主题 `base` 候选；比例符号、构成符号、时序和流向图是 `overlay`。省略 `role` 时使用该默认值，显式声明不兼容角色会以 `UNSUPPORTED_LAYER_COMBINATION` 拒绝；最多一个 base 层。

`view.level_ids` 按 Geography 登记层级过滤，与可选 `view.region_ids` 取交集；空数组形成空视图，未知或重复层级拒绝。`viewRegionIds(geography,spec)` 返回同一有效地区集合。绘图、投影/拾取、布局、标签、排名/地区列表及自动数值域共用该集合；过滤不改写原观测、父子关系、持久选择或汇总基础。附图省略 region_ids 时继承主图范围，显式 region_ids 可以单独显示其他层级。默认 CSV 仍导出原始序列；需要限定导出范围时显式传入 regionIds。

小多图共享数值分类/连续色域、双变量两轴、alpha 透明度域、符号最大值、构成/雷达最大值、柱高/柱宽、时序纵轴和流量/节点尺度；局部 sparkline 纵轴仍需显式 `scale:'local'`。`panel.encodings[layerId]` 可覆盖该面板通道。超出 `pageSize` 时显示前后页控件，`controls:false` 可隐藏；翻页销毁旧实例。三元图复用所有面板数据计算的共同中心；极端密集布局按需另立专项，已发现的实际碰撞按影响修复。

地图选项 `responsive:true` 使用 ResizeObserver 跟随容器尺寸，保留标准化缩放/平移；销毁与重新挂载会解绑 observer。容器须有明确的非零高度。双指在同一图面内缩放和平移，单指保留地区点击；手势不会产生额外选择，取消/销毁会清理指针。`touch:false` 可关闭地图触摸手势并保留宿主的 touch-action。Chrome 原生触摸输入已验证，更多移动浏览器与复杂组合仍需专项验收。

## 包验证、导出与 profile

运行 `npm run verify-package` 会在临时目录离线安装实际 tarball，验证公开子路径导入、包内源码重建、文件 SHA 和严格 NodeNext 类型消费；默认使用包声明的锁定TypeScript，也可通过 `STATS_MAP_TSC` 指定 `tsc.js`。这项分发验证在相应边界变化或候选交付时选用。`loadBundle(bundle,resolver,{signal})` 支持取消；resolver 返回原始字节或文本，哈希和 JSON 内容都以这些字节为准，额外的已解析对象不能替代原文。

`export('spec')` / `export('json')` 保存当前实际阈值、颜色/大小/透明度/时间域和三元中心；`exportSpec({resolved:true})` 返回同一解析后的对象，`exportSpec()` 保留原声明。CSV 追加单位、范围、实绩/复核状态、数据/几何版本、来源和原 flag 字段，原始值与证据不换算，重复地区只导出一次。`setSpec/setData/setBundle` 在替换前验证渲染语义，失败保留原实例状态与图形。

`spec.profile` 接受已内嵌的展示默认值；显式方案字段优先，嵌套对象逐字段合并、数组整体替换。profile 不得提供 dataset_refs、layers、aggregation 等统计字段；`profile_ref` 只记录原配置身份，内核不访问外部配置。`resolveProfile(spec)` 可单独取得合并结果。语言、主题、消息和数值格式均按实例解析，随方案导出。

## 装饰与附图

`spec.decorations` 配置标题、副标题、单位、来源、水印、地区标签、地点与 annotation。文本始终转义；文本项可用 `{text,position:[x,y],fontSize,color,anchor}`。`labels:true` 使用地区名称和 label 锚点，`labels:{region_ids,offset,text}` 可限范围、调整偏移和文字。地点/annotation 项使用 `region_id`、地理 `point` 或屏幕 `position`，支持 `offset/leader/marker`。非地理布局不沿用地理 point。`reference` 可设置非统计几何的描边；Point/MultiPoint、线和 GeometryCollection 与主题面共用路径服务。标签之后单独绘制选中描边，筛选和透明度不遮蔽选中状态。

`scalebar:true|{distance,latitude,position}` 中 distance 一律为米；平面空间须显式使用 m/km 等已知物理单位。内置经纬投影显示指定纬度的近似比例尺；格网、Dorling、未知平面单位和无物理尺度的投影返回 `SCALEBAR_UNAVAILABLE` 诊断并隐藏比例尺。`graticule:true|{step:[经度步长,纬度步长],color}` 只在地理坐标布局显示。

附图使用 `spec.insets:[{id,x,y,width,height,region_ids?,layout?,decorations?,visible?,minimap?}]`，矩形 y 是开关标题行的位置，图面从 y+20 开始；尺寸均为 SVG 像素。各附图有独立投影、裁剪和纹理标识，地区选择仍共用一套身份；滚轮和双指手势只改变所在图面。`toggleInset(id,visible?)`、`setInsetTransform(id,{zoom,pan})` 提供同样控制，transform 保存到方案。`minimap:true` 显示主图视窗，点击定位主图；自定义投影不绘制未经验证的视窗框，变形布局不显示地理视窗框。

## 排名、分布与成员目录

```js
import { RankingChart, buildRanking } from 'stats-map';
const ranking = new RankingChart(map, { seriesId: 'amount', direction: 'descending', limit: 20 });
ranking.mount(document.querySelector('#ranking'));
const model = buildRanking(map, { seriesId: 'amount' });
// 地图销毁时会释放组件；也可主动调用 ranking.destroy()。
```

排名按原始观测值排序，保留负值、零值、并列名次、单位和缺失状态，不用汇总值或构成百分比代替。分类通道显示不适用说明。`spec.ranking:{seriesId,periodId,layerId,datasetId,regionIds,direction,limit,x,y,width,rowHeight}` 控制来源、范围和排名，默认 descending；兼容 `ascending:true`，显式 direction 优先。并列按地区 ID 稳定排列，`limit` 之后的有效地区记为 hidden，不计入 missing。按钮支持键盘选择与地图 hover/selection 联动，指定期次/指标的 SVG 排名事件与提示读取该排名的原始通道。

`resolveRegionSet(catalog, groupId, geography)` 按精确地区 ID 解析可选的成员目录配置；`applyRankingRegionSet(spec, geography, catalog, groupId)` 将结果写入 `ranking.regionIds`，同时在 `ranking.regionSet` 保存目录/地域版本、完整名单、不可用成员、原显式范围和来源。该目录遵循 `schemas/stats-map-region-sets-v1.schema.json`，由调用方提供，包内不读取地区目录、不按 ID 前缀扩展下级地区。空交集保持空排名。显式 ranking.regionIds 与名单取交集；切换分组继续使用原显式范围。地域中没有的成员返回 `REGION_SET_UNAVAILABLE_MEMBERS`，与已入选地区的统计 missing 分开。成员筛选先于分布阈值和 limit，不改变地图范围、原始观测或 CSV。

Euro 调用方可提供 `euroBundle(input, {regionSets: catalog, countryGroup: groupId})`，也可将别名放在输入 `options.spec.ranking.countryGroup`；同时提供时必须一致。未知分组或缺少目录会报错。规范方案不接受未解析 countryGroup，输出只保存通用排名范围及快照。`buildRanking(map)` 和 `new RankingChart(map)` 继承 spec.ranking，可覆盖展示选项；更改已解析成员范围时应重新调用解析函数。导出的方案可独立离线重开；同版本地域上的数据更新保留分组，更换地域版本时须重新解析并一并提交匹配的数据和方案。

SVG 排名按内容测量：标题/副标题、单位/期次、完整地区名、独立数值列、正负条形和缺失说明共同生成绘图计划。`title/subtitle/labelFontSize/shapeHeight/rowHeight/boxPadding/boxOpacity` 设置展示，`decimals` 固定数值标签小数位；不接受可执行 labelFormatter，其他数字格式来自 spec.number_format。数值面图的条形复用所选图层的分类/连续颜色，其他图型使用图层 fill 或主题 accent，可显式 color 覆盖。`position:'top right'|'bottom right'|'top left'|'bottom left'` 按实际尺寸放置，显式 x/y 分别优先；y 保留首行基线约定（面板顶部为 y−15）。`height` 是 SVG 面板高度预算，按统一比例缩小文字与纵向间距并保留横向数值量尺；不设 height 则完整展开，过大返回 RANKING_OVERFLOW。`onlyApplyOpacityWhileZoomed:true` 在未缩放时使用不透明背景，缩放时使用 boxOpacity。`map.render().rankingLayout` 返回实际绘图计划和缩放因子，图例/装饰/标签使用同一实际面板边界避让。过窄的 width 会扩展至字号与内边距所需的最小宽度。

`mode:'auto'|'bars'|'histogram'` 默认 auto；有效排名超过 `barLimit`（默认40）时改为原值分布，不把地区数当作原始统计量。`bins` 设置1–100个等距分箱，默认按平方根规则且最多20箱；相邻浮点数造成的重复边界合并。区间左闭右开，最后一箱含最大值；常数域只有一箱，缺失不进入分箱。`buildRanking()` 始终保留 rows、missing、hidden 和原始 observation；`bins` 另含 lower/upper/upperInclusive/count/region_ids，分箱不改写数值或来源。独立 `RankingChart` 默认每页40个地区，`pageSize` 可调整；分布和逐地区按钮切换展示，`setMode(mode)`、`showPage(index)` 提供相同控制。翻页保留全体排名与共同量尺，数据变少时收敛到有效页；HTML height 使用滚动容器保留可交互文字尺寸。SVG/PNG 导出按方案 mode 绘制，独立 HTML 分页不改写地图方案。上游字段映射仅作兼容参考，不要求逐例视觉等价。

## 本地化与主题

`spec.locale`（或 `view.locale`）使用 BCP 47；未声明时依次使用 Geography 的 `default_locale` 和环境 Intl 默认语言。`map.setLocale('fr-FR')`、`setTheme('dark')` 可运行时切换。内置 en/zh/fr/de 消息，其余语言回退英文；`messages:{missing:'自定义文案'}` 仅接收纯文本。`number_format` 为 Intl.NumberFormat 选项，默认保留最多六位有效数字；明确设置小数位后使用该精度。显示格式不改变原始观测或 CSV。资源名称可附 `labels`/`titles:{'fr-FR':'…',fr:'…'}`，按完整 locale、语言、原名称依次回退；Euro/China 适配器保留这些字段。

主题支持 light、dark、high-contrast，或 `{base:'dark',background:'#111827',text:'#f3f4f6',accent:'#60a5fa',numericColors:[…]}`。颜色 token 均为六位十六进制；可选 categoryColors/compositionColors/bivariateColors 分别提供分类、构成及九色双变量色板。图层显式颜色优先；地图、图例、缺失/零/冲突状态及控制器共用实例主题，不写全局 CSS。`interaction.reducedMotion:true|false|'auto'` 记录减少动态效果偏好，auto 跟随挂载环境；时间播放由用户手动启动。已解析方案保存有效 locale、消息、主题和动态效果偏好。

## 标签、图例与装饰布局

标签默认以确定性规则避开图例、排名、附图、固定装饰及其他标签；`labels:{collision:'avoid'|'hide'|'none',maxWidth:120,maxOffset:40,step:10,priority:{'area-a':2},leader:true}` 控制换行与放置。选择中的地区优先。无法放下的标签省略并返回 `LABEL_COLLISION`；没有锚点返回 `MISSING_LABEL_ANCHOR`。`map.render().decorations.labels` 提供实际位置、可见性和包围框；文字完整保留在资源/方案中。文字宽度使用保守 Unicode 估算，特殊字体与极密集布局仍须检查。普通图例条目、状态说明、构成备注、标题/来源支持换行；专用二维/三元/尺寸量尺共用可测量的绘图计划。

专用图例的测量与绘制共用布局模型。二维矩阵的 X/Y 编号对应下面的完整系列名、单位和分类标签；三元顶点编号对应完整分量名。透明度、时间和流量说明支持换行，尺寸/蘑菇与流节点量尺保留实际半径并增加所需宽高。`measureLegend(model,{width,title})` 返回 width、height、titleHeight、contentHeight；`legendHeight` 返回正文与状态总高度。width 最小64像素；二维/三元图例至少96像素，大尺寸符号可能要求更宽。文字测量为保守估算，自定义 path 的尺寸基于其声明 viewBox，路径越出该范围时不能据此保证内容边界。

`legend:{width:180,gap:10,collision:'avoid',x:12,y:20}` 设置自动图例排布，默认 avoid；它避开标题、来源、Logo、比例尺、排名、附图及其他图例。主 legend.x/y 是首选起点；图层 `legend:{x,y,width}` 为固定位置，先为其保留空间。`collision:'none'` 保留依次排列的显式展示方式。`map.render().legendLayout.panels` 提供实际 bounds，diagnostics 返回 `LEGEND_COLLISION` 或 `LEGEND_OVERFLOW`；无法容纳时保留完整内容和数值尺度。减小 width 会换行增加高度，调用方可增加画布或调整图层配置；装饰之间的排布与诊断见下文。图例布局不改写方案、分类断点、筛选或地区选择；独立 SVG/PNG 保留相同排版。

装饰共用一次测量与放置，主图和附图采用相同逻辑。`decorations.layout:{padding:6,gap:6,collision:'avoid'}` 控制画布边距、间距与自动避让；自动项避开其他装饰、地点标记、固定图例、排名和附图。标题、副标题、来源、单位、Logo、比例尺、地点和 annotation 可设置 `priority`（有限数值，较高者先放置）及 `collision:'avoid'|'fixed'|'none'`。提供 `position` 时默认 fixed，其他项默认 avoid；显式设置 avoid 可将该位置作为首选点。fixed 保留位置并报告冲突，none 保留位置并关闭该项诊断，但仍为其他内容保留空间；全局 collision:none 关闭装饰自动放置与诊断。水印不占用避让空间。

`decorations.geographicBackground:{fill:'#eef2f5',stroke:'#a7b0b8',strokeWidth:.6}` 在主题图层下绘制同色的全部地理分区；按 geographic、Dorling、方格或六边格布局绘制相应轮廓，不绑定统计值，也不参与交互命中。工作台会为 choropleth 以外的图型自动启用；单独 choropleth 保持原有填色表现。背景随 SVG/PNG 导出和附图渲染。

`map.render().decorations.layout` 返回各项的 `id/kind/bounds/dx/dy/displaced` 及诊断；附图结果在 `insets[].decorations.layout`。`DECORATION_COLLISION`/`DECORATION_OVERFLOW` 保留完整内容和尺寸，供调用方增大画布或调整配置。注记可提供稳定的 `id`，同一数组内不得重复；移动文字时保留原始锚点和标记，并默认绘制引线（leader:false 可关闭）。非地理布局无法使用地理 point 时返回 `DECORATION_POINT_UNAVAILABLE`，屏幕 position 仍可用；缺少锚点返回 `MISSING_DECORATION_ANCHOR`。比例尺位移不改变物理长度；文字使用保守字形余量，特殊字体仍须实测。主图预排版和最终绘制复用同一结果，导出与交互显示一致。

文本项的 `maxWidth` 控制换行；来源页脚向上展开。`decorations.logos:[{id:'mark',alt:'组织名称',href:'data:image/png;base64,…',position:[20,20],width:40,height:40}]` 注入 Logo，并参与标签避让。仅接受内嵌 PNG/JPEG/WebP/GIF（编码文本最多 8 MiB），验证 MIME 签名；SVG/PNG 导出无需外部图片请求。alt 为必填纯文本，也可用 labels 提供翻译。

## 锚点策略与 Dorling

地理面不再默认使用顶点均值生成锚点。Geography 或 MapSpec/profile 可显式设置 `anchor_policy:{method:'interior-point',version:1}`，MapSpec 优先；缺省等同 `{method:'none',version:1}`。已登记的同角色锚点优先，label 可回退到已登记的 symbol；唯一的 Point 坐标可直接作为锚点，多点或线不自动取平均。面内点算法在同地区所有 feature、MultiPolygon、GeometryCollection 中选扣除洞后坐标面积最大的主面，再用有界扫描线搜索内部点；不会借用邻区或使用顶点均值。算法在来源坐标空间运行，提供面内位置，不声称是地理面积重心、地理面积排名或最佳视觉标签位置。

`resolveAnchors(geography,{role:'symbol',policy,regionIds})` 返回 anchors Map 和诊断；记录包含 method/version、derived、geography_ref、source_feature_ids 与主面索引。`anchorIndex`/`screenAnchors` 使用同一策略，`derive:false` 禁用派生；旧 `derive:true` 应改为明确 method/version。同地区/角色的重复登记拒绝。`geometryStatus(geography,{policy})` 与 `map.render().geometry` 分开报告有几何、有边界、有符号/标签锚点；空几何不能充当可用边界。渲染诊断带 layer_id/inset_id，缺原值、缺边界和缺锚点不会相互替代。解析后的 spec 保存有效策略，SVG metadata 保存实际锚点及出处。策略不改写 Geography，也不改变观测、统计覆盖或 CSV。

格网中的地区不需要地理面；重复 feature 不会复制格网单元。Dorling 只使用已有或按显式策略得到的锚点，无锚点地区返回缺口，不随机生成地理位置。仅有登记锚点的地区参与投影 fit 和点拾取，但不会成为面边界；选择/悬停时用锚点环提示身份，零值仍保持零面积。该默认行为变更意味着：旧的 polygon 符号/流线方案须补充登记锚点或明确派生策略，不能依赖原来的静默均值。

`layout:{type:'dorling',seed:1,iterations:100,strength:.5,gap:2,tolerance:.1,padding:20}` 使用实际 renderer 的屏幕像素包围圆，并对多层取并集。比例符号、构成图、时间图、例外标记、流节点及堆叠端口/内部回环均参与测量；编码尺寸和图例量尺不因位移而缩小。主题圆半径默认12；构成/时间图默认尺寸36，显式 layout.radius 时默认尺寸为其两倍，图层 size/radius 可覆盖。customShape 路径使用实际路径边界测量，支持 Dorling 和大小图例；viewBox 只控制编码缩放，不裁切超出它的路径。`svgPathBounds(path,{closed:true})` 校验纯路径语法并返回 minX/minY/maxX/maxY，支持绝对/相对 M/L/H/V/C/S/Q/T/A/Z、隐式重复参数、平滑反射控制点和旋转椭圆弧。`compileSvgPath` 将弧确定性展开为每段不超过90度的切向三次贝塞尔曲线，其他路径保留原始字符串；svgPathBounds 返回该实际绘制路径的导数极值边界。地图与图例均绘制同一编译结果，避免浏览器弧半径修正与测量精度不同。圆弧展开的最大径向近似误差小于半径的0.0273%，旋转椭圆按其仿射轴缩放该误差，原始spec路径保留；碰撞圆保守包围缩放后的实际边界矩形。每个子路径必须闭合，拒绝无效参数、弧标志、非有限或无法有限表示的几何和SVG标记。自定义符号使用不随路径缩放的描边，与内置符号保持相同屏幕描边约定；小于/超出 viewBox 的路径仍沿用原大小量尺，不自动重缩放。

地区按 ID 排序，重合锚点使用固定 seed；浏览器通过本地模块 Worker 求解，Node 或 `worker:false` 同步求解。数据、时间域、编码、布局或视口变化重算；图例筛选继续保留相同位移，快速替换和销毁会取消旧 Worker。`map.render().layout` 返回 status、seed、iterations、strength、gap、bounds、tolerance、max_overlap、collision_pairs 和 overflow_region_ids，浏览器结束时发出 layoutend；错误发出 source 为 dorling 的 error 事件并标记 failed。无法容纳时返回 `DORLING_COLLISION`/`DORLING_OVERFLOW`，保留尺寸供调用方增大画布或调整编码。缩放只改变中心位置，像素尺寸固定；缩小时可能重新重叠，指标随当前视图更新。SVG metadata 保存实际布局及指标。包围圆约束不涵盖文字、跨节点流线或图例/装饰避让。

附图可声明 geographic、grid-square、grid-hex 或 dorling，渲染、选择及 hitTest 共用实际布局位置；Dorling 附图同步求解。minimap 概览仅在主图与附图都为 geographic 时有效，其他布局继续执行普通地区点击。`dorlingLayout`、`dorlingMetrics`、`prepareDorling` 与 `resolveScreenLayout` 提供相同离线算法入口。135 个来源/内置配置已通过真实 Worker、SVG 边界采样和独立导出检查，证据见 `data/audits/stats-map/dorling_glyphs_20261108/`。

## 地区列表、提示与时间刷选

```js
import { RegionList, buildRegionList, resolveAnchors } from 'stats-map';
map.setSpec({...map.spec,anchor_policy:{method:'interior-point',version:1}});
const list=new RegionList(map,{layerId:'base'});
list.mount(document.querySelector('#region-details'));
const rows=buildRegionList(map).rows;
// 即使没有几何/锚点，地区的原值、缺失状态、单位、统计期和来源仍在清单中。
// 按钮支持键盘选择、焦点保留和地图 hover/selection 联动；map.destroy() 释放组件。
```

`RegionList` 不要求数值排名，也可显示类别；模型保留原始 observation/evidence/source_flag、数据版本和口径字段。地区范围来自 view.region_ids 或 options.regionIds，图例筛选不删去清单原值。地图替换导致显式筛选失效时，清空旧行并显示错误；不让旧地区与新数据混合。地区清单是独立 HTML 组件，不自动纳入 SVG/PNG，宿主按需挂载。

挂载地图后默认显示实例独立的 tooltip：鼠标悬停或键盘 focus 打开，Escape 关闭，触屏点击打开、外部点击关闭。面板可以移入阅读、滚动，按可视窗口约束位置；不改变选择规则。`interaction.tooltip:false` 禁用全部提示，图层 `tooltip:false` 只禁用该层。提示保留地区/起终点、指标、单位、统计期、范围、实绩/预计/目标、复核状态、来源、原始标记、证据与数据版本；标签作为文本显示。`buildTooltip(map,{layer_id,region_id,period_id?,series_id?,inset_id?})` 返回同一模型；流边使用 relation_id 及起终点身份。

提示的 channels.observation 与绘图采用相同 aggregation；声明 rollup 时另保留 reported_observation、贡献观测和覆盖，ratio 展示分子/分母与共同覆盖。“其他”保留显式总量与分量推导，分量提示不自动选中地区；流节点分别显示筛选前后的流入/流出/内部流，不使用地区总量代替。Sparkline 提示包含放大小图、共同/独立纵轴和各期原值；缺期与有效零同样可拾取。tooltip 为临时 HTML，独立 SVG/PNG 保留原有统计描述，不自动导出面板。

```js
import { TimeBrush, buildTooltip } from 'stats-map';
const brush=new TimeBrush(map,{datasetId:'amounts'});
brush.mount(document.querySelector('#time-window'));
brush.setRange('T1','T3');
const details=buildTooltip(map,{layer_id:'base',region_id:'area-a'});
// brush.reset() 显示全部期次；brush.destroy() 释放组件，map.destroy() 也会自动释放。
```

TimeBrush 的拖动轨道按 period.start 的实际间隔排列（缺少完整 start 时按声明 order），保留未出现观测的期次；两个原生 range 控件支持键盘和辅助技术。鼠标/触屏拖动仅在放开时提交，Escape、pointercancel、失去指针捕获或窗口失焦取消预览。提交写 `view.time_window:[起始期ID,结束期ID]`，也可读取 `{start_period_id,end_period_id}`；null/缺省表示全域。范围包含两个端点，限制 sparkline/Coxcomb 的时间域与图例，不改写 active period_id、选择、原始观测或播放顺序。`timebrushinput` 报告拖动预览，`timebrushchange` 报告提交；非法范围拒绝且保留原方案，DOM 控件显示错误并发出 error 事件。TimeController 继续负责逐期切换与播放，两种控件可以并列挂载。


## 流向图与关系证据

流向图通过 `encoding:{dataset_id:'amounts',relation_series_id:'trips'}` 读取原始 OD 关系。`options.mode` 支持 `straight`、`curved`、`sankey`；空间桑基图保留地理节点位置，默认在每侧同时堆叠流入/流出端口，画填充带状路径。`stack:false` 关闭端口堆叠；`order:'angle'|'value-ascending'|'value-descending'|'id'` 为可复现顺序，`stackGap` 控制端口间距。`nodeGap` 与 `curvatureSettings:{gapX,padX,padY,bumpY,curvature}` 控制节点留白和中间符号的局部绕行。复杂密集图仍可能交叉；此布局不移动节点，不作全局无碰撞保证。不同节点锚点重合时画回环并返回 `COINCIDENT_FLOW_ANCHORS`，无锚点边返回 `MISSING_ANCHOR`。

`reciprocalMode:'midpoint'` 将双向正流量分别画为中点到各自目的地的半条路线，保留两条原始关系 ID、方向、各自值与来源；默认 `separate`。中点是派生绘图位置，不能当作新地区。`minWidth` 与 `maxWidth` 对正值使用同一线性量尺，0始终为0宽，图例与绘图共享 `flowWidth`。`gradient`、`endColor`、`opacity`、`opacityGradient`、`widthGradient`、`widthGradientSettings:{startRatio,minStartWidth,samples}`、`outline`/`outlineColor`/`outlineWidth`、`arrows`/`arrowScale` 控制带和线；samples 为8–256，每段曲线采用同样采样数，带宽按路径长度插值。箭头关闭时带状路径保留完整末端宽度。节点保留 `circle`/`donut`、`showNodes`/`showInternal`、`topLocations`、筛选前后汇总。

`bundling:true`（或0–1吸引强度）在细分路线内部控制点上执行确定性的有界力松弛，固定所有端点，仅吸引邻近、同方向的相容路线；不合并关系、不改变数值。`bundleSettings` 默认 `{iterations:80,subdivisions:8,alphaDecay:.035,chargeStrength:12,distanceMax:40,linkStrength:.2,linkIterations:1,compatibilityThreshold:.6}`，distanceMax 是屏幕像素，null 表示不限距离。它与空间桑基模式分别使用；同时启用会返回 `UNSUPPORTED_ENCODING`。求解最多20000控制点、800万候选比较/估算力工作量，超过限制返回 `FLOW_BUNDLE_LIMIT`；可减少细分、迭代、路线或距离。公开 `bundleFlowPaths(routes,settings,{signal})` 支持调用前/迭代间取消检查，整个算法同步完成，不创建计时器或后台任务。它实现本库的确定性相容性束化语义，不声称与上游 D3 force 轨迹一致。

`flowModel`、`flowLayout`、`flowSvg`、`flowWidth`、`bundleFlowPaths` 从主入口及 `stats-map/renderers` 导出。`renderSvg(...).flowLayout` 和 `map.render().renders[i].flowLayout` 返回原始边身份、数值宽度、中心线采样、两侧端口区间、派生中点和束化参数，便于离线核查。`map.export('csv',{layerId:'flows'})`/`exportRelations(view,seriesId,periodId,regionIds?)` 导出全部原始 OD 记录，包括被绘图筛选排除的边、0与缺失；regionIds 仅保留两个端点都在集合内的记录。CSV 带单位、范围、实绩/预计/目标、复核状态、数据/地理版本、来源、证据和原始标记。线型和束化永远不替换这些原始记录。


## 双向合并、分类节点与标签

`reciprocalMode:'merged'` 明确启用合并展示：同一无序端点对的已通过筛选的原始 value 边相加，画一条无方向箭头的展示路线。自环继续保留原始关系身份。过滤先作用于原始边，再求显示合计；默认最大线宽域取显示路线合计，图例标题为“显示路线合计”。不存在、缺失和有效0的反向关系不会互相补造；提示列出每条已登记方向的原值、状态和是否参与显示合计。地图节点的流入/流出/内部流仍按原始有向边统计，CSV 继续导出原始记录。

合并路线使用 `route_id`、`endpoint_region_ids`、`source_relation_ids`；不能将 route_id 当作原始 relation_id，也不能把路线合计当作其中一个方向的值。SVG 用 `data-flow-route-id` 和 JSON 数组身份属性，原始边仍用 `data-relation-id`。`routeclick`/`routehover`/`routefocus` 事件与 relation 事件分开，路线操作默认不改变地区选择。事件的 channels.route 为 `{type:'flow-route-sum',route_id,endpoint_region_ids,value,source_relation_ids}`，channels.relations 保留实际参与合计的记录，channels.registered_relations 另保留未显示或缺失的已登记反方向；observation/reported_observation 为 null，避免伪造原始观测。所有数值、来源与身份从当前数据/方案重新解析，不信任旧 DOM 的合计属性。

`buildTooltip(map,{layer_id:'flows',route_id,period_id?,inset_id?})` 返回相同模型，derived.type 为 `flow-route-sum`；显示合计、两个方向的独立证据和原始标记。键盘焦点在重绘、数值更新、筛选和语言切换后按 route_id 与附图范围恢复；路线消失或切换到分离模式时旧提示关闭。触屏提示在原生 click 时打开，避免 focus 阶段的浮层遮住点击目标。独立 SVG 的可访问说明也包含各方向原值和来源，HTML 提示不写入图片。`flowLayout.edges[].layout_key` 为绘图内部身份，束化路径 Map 使用此键，以避免任意原始关系 ID 与派生路线 ID 恰好相同。

`topLocations` 为非负整数，0或省略关闭；`topLocationsType:'sum'|'origin'|'destination'` 默认 sum，分别按跨地区流入加流出、流出、流入排序，不把内部流计入。排名先限定 `view.region_ids`（两个端点都必须在范围内），再按分数降序、地区 ID 字符序打破并列；排名在 `minValue`、内部流开关和 top 边过滤之前固定。默认保留任一端点属于 top 集合的边；`filterTopLocations:false` 保留其他边，仅使用 top 排名配色。`before` 仍为该系列/期次全部原始有效边，`filtered` 是范围和全部过滤条件生效后的边。

路线与 donut 共用类别：origin 按 top 起点，destination 按 top 终点，sum 优先 top 终点、再 top 起点，否则为 Other。`topColors`（或 theme.categoryColors）按排名分配；Other 使用 `color`，内部流使用 `internalColor`。合并路线的各原始方向属于同一类别时使用该类别，不同则使用单独 `mixed` 类别及 `color`，图例明确列出；不能按规范化端点的任意方向给整条合计归类。合并路线不使用箭头、颜色/透明度渐变或宽度渐变。有向分类路线启用 gradient 时从 regionColors[0]（禁用地区填色时仍使用默认净流出色）渐变到类别色；未启用 top 配色时继续使用 color→endColor。

`regionColors:[净流出色,净流入色]` 默认 `['#bbd7ee','#c7e3c6']`，`regionColors:false` 关闭地区填色；`regionLabels:[净流出名称,净流入名称]` 覆盖图例的本地化名称。净流量为 **过滤后原始有向边的流入减流出**，内部流单列且只计一次，净流量为0或无有效记录的地区不覆盖底图颜色。地理布局填 Polygon/MultiPolygon，格网和 Dorling 填各自的地区单元；锚点不冒充行政边界。图例、路线和节点统计来自同一过滤结果。

节点大小编码流入+流出+内部：`nodeSizeScale:'area'|'radius'` 默认 area，`minNodeRadius` 默认0，`maxNodeRadius` 默认12，`maxNodeValue` 可显式锁定共同域。正值半径为 `minRadius + scale(min(1,value/maxValue))*(maxRadius-minRadius)`，area 用平方根，radius 用线性；有效0始终0半径。自动域包含过滤后所有节点（包括缺少绘图锚点的节点），图例共享 `flowNodeRadius`；small multiples 和 resolved spec 继续锁定共同最大值。

`nodeShape:'donut'` 按流入/流出/内部及地区类别分组，内部边只归入内部一次；`model.breakdowns` 中每个分组有 channel、key、value 和 `source_relation_ids`。地区类别 key 使用 JSON 标签元组，真实地区 ID “Other”/“Internal”不与派生组冲突。SVG 同时提供 `data-flow-channel`/`data-flow-category`；节点事件 channels.flow_breakdown 与 tooltip.derived 的 type 为 `flow-node-breakdown`，region_id 为节点，category_region_id 为类别地区（派生类别为 null），relations 保留原始记录，observation/reported_observation 为 null。数值、来源及标签从当前数据、方案和语言重新解析；提示列出所有分组并保留所选分组的独立证据，分组消失关闭旧提示，重绘按地区+方向+类别+附图保持焦点。CSV 仍仅导出原始关系。

`nodeLabels:true` 显示节点名，也可配置 `{content:'name'|'value'|'name-value',offset:[x,y],fontSize,maxWidth,collision:'none'|'hide'|'avoid',maxOffset,step}`。offset 为从节点右侧边缘起算的屏幕像素；默认 `[3,0]`。复用通用换行与标签排布，避开节点、端口、线路采样边界、主图图例、排名和附图保留框；普通地区标签再避开已放置的 flow 标签。无法放下时返回 `FLOW_LABEL_COLLISION`，可在 `flowLayout.labels` 核查位置/可见性。`flowSvg(model,anchors,namespace,{width,height,obstacles})` 支持独立调用时传入屏幕范围和额外障碍。密集路径的采样边界是保守局部避让，仍不保证所有图型组合的全局无交叉。


## OD 地区切片与独立投影导出

关系数据也可作为地区通道：`encoding.relation_slice` 支持 `{axis:'origin'|'destination',region_id?,include_internal?,top?}`。origin 固定起点，将终点作为地图地区；destination 固定终点，将起点作为地图地区。省略 region_id 时使用 `view.relation_region_id`；显式 region_id 固定该通道，后续交互不覆盖它。`include_internal` 默认 true；`top` 为正整数，按有效原始值降序、partner ID 字符序排序（保留负值、0，不按绝对值排名），在 `view.region_ids` 与内部关系开关之后取前 N。未选中、范围外和内部排除显示为 out_of_scope，并保留 reported_status/reported_value 与 excluded_reason；未登记的 OD 对是 missing，已登记的 suppressed 等状态保持原样。

```js
map.setSpec({...map.spec,
  view:{...map.spec.view,relation_region_id:anchorId},
  layers:[{id:'partners',type:'choropleth',encoding:{
    dataset_id:datasetId,relation_series_id:seriesId,
    relation_slice:{axis:'origin',include_internal:false,top:10}
  }}],
  interaction:{...map.spec.interaction,relationRegionOnClick:true}
});
map.setRelationRegion(nextAnchorId);
const rawOD=map.export('csv');
const displayedSlice=map.export('csv',{relationSlice:true});
```

点击、键盘 Enter/Space、触屏、附图、RankingChart 和 RegionList 遵循相同的锚点切换设置，独立于 selection；未开启时继续选择地区。`relationregionchange` 报告 region_id、previous_region_id、source、inset_id；`regionclick` 保留点击发生时的通道与证据。`getState/loadState` 保存交互锚点；resolved spec、跨期图和 small multiples 的共同域使用各方案实际切片。附图按自身地区范围独立筛选 partner，共享交互锚点。

所有绘图、图例、可访问说明、排名、列表与提示读取同一投影。事件通道 `relation_slice` 与 tooltip.derived 的 type 为 `relation-region-slice`，包含 anchor、真实起终点、源关系 ID、显示值、reported 值与排除原因。`reported_observation` 是原始 OD 记录（未登记时 null），`relations` 保留该记录，`observation` 是声明式投影，不能冒充地区原始观测。比例指标使用已报告的 OD 数值，不用地区分子分母重算；切片不补反方向、不回退地区 observations、不将缺失变为0，也不自动汇总多个 partner。

直接或具名通道均可声明切片；顶层设置由普通具名通道继承。bivariate/alpha 及比例符号 size/color 的两个通道可分别使用不同切片；其他组合图要求各组件采用同一有效切片，其 totalSeriesId/widthSeriesId 同样读取 OD。exception 保持地区类别观测。flow 与地区 aggregation basis 不兼容切片；类别关系不受支持。地区 renderer 使用 relation_series_id 时必须明确 relation_slice。`stats-map/core` 导出 `relationSlice`、`relationSliceView` 与 `validateRelationSlice`，可离线使用。

CSV 默认导出完整原始 OD，保留未显示的关系；显式 `{relationSlice:true}` 导出独立投影表，其列保留方向、anchor/partner、原关系 ID、显示与 reported 状态/值、排除原因、证据、单位、范围、实绩/预计/目标、复核状态和资源版本。省略 regionIds 时输出所有登记地区，包含缺失与排除项。通道选择可用 layerId/datasetId/seriesId；不将投影 CSV 称为原始地区观测。
