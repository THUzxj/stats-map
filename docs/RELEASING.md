# 独立发布指南

stats-map 的运行、开发、构建、默认预览和 npm 打包输入均位于本目录，可以整体移出宿主仓库后使用同一套命令。

## 依赖边界

| 能力 | 所需输入 | 上级仓库依赖 |
| --- | --- | --- |
| 运行与公共类型 | 本包源码、类型或构建后的 dist | 无；无第三方 runtime dependency |
| 构建 | 本包源码、Schema、类型、许可、覆盖账本，锁定 esbuild/TypeScript | 无；首次安装工具通常需 registry |
| Node 测试与默认矩阵 | 本包 tests 和虚构夹具 | 无；默认 22 例矩阵 |
| 默认 preview | scripts/preview、源码、模拟数据生成器及包内 examples/preview 的真实边界 | 无；不读取外层 examples/catalog |
| 包消费验证 | npm 缓存、临时目录、实际 tarball、精确构建工具 | 无；离线验证需预先具备缓存 |
| 可选浏览器 smoke | Python、Playwright 和已安装的 Chromium/Chrome | 无宿主源码依赖；需额外测试环境 |
| 静态资源部署 | dist 和调用方指定的新/空目录 | 无固定宿主路径 |
| 可选自定义数据 preview | 调用方显式指定 config/data-root | 仅在选择时读取这些输入 |

覆盖账本与验收说明保留原宿主的历史审计路径，仅是证据定位字符串，程序不读取，不要求复制。上游参考克隆不参与构建或打包；原宿主 GitHub Actions、Python 数据桥接与 skill 同步不是本包独立运行条件。

本次修正了两个耦合：preview 不再默认读取外层真实地图目录，资源复制不再固定写入兄弟宿主。旧 `publish` npm script 已更名 `export:assets`，避免 `npm publish` 的同名生命周期钩子执行本地部署。

## 源码仓库与开发

保留 src、types、schemas、scripts、tests、docs、examples/preview、包配置/锁文件、`.nvmrc`、README、验收范围、覆盖账本和许可文件。`.gitignore` 排除 node_modules、生成 dist、tarball 与临时目录；不要将旧安装包或 consumer-temp 当作源码。

在项目根目录运行：

```sh
npm ci
npm run check
npm test
```

局部修改按 [ACCEPTANCE.md](../ACCEPTANCE.md) 选择测试。文档核对链接，preview 检查路由与实际显示，包入口/清单/构建变化验证 tarball。

可选浏览器 smoke：安装 Python Playwright 及 Chromium 后运行 `npm run test:browser`；已有 Chrome 可传 `npm run test:browser -- --channel chrome`，`-- --output <目录>` 保存证据。它不属于生产依赖，不由 `npm test` 自动执行。

## 构建候选包

```sh
npm run build
npm run verify-package
npm pack --ignore-scripts
```

显式 build 后 pack 跳过生命周期，避免重复构建。日常单独 `npm pack` 或 `npm publish` 会通过 `prepack` 自动构建，确保包含产物。

`verify-package` 在系统临时目录离线安装实际 tarball，验证主入口、图型/适配器子路径、浏览器脚本/CSS/Worker及严格 NodeNext 类型消费，再从包内源码重建并比较 manifest 和文件 SHA。默认用声明的 TypeScript，也可用 `STATS_MAP_TSC` 指定 `tsc.js`。所需精确工具版本必须已在 npm 缓存；该命令不会代替首次依赖准备。

`package.json.files` 发布 dist、源码、类型、Schema、工具、文档、许可、三个虚构夹具及 examples/preview 内的真实边界与来源说明。完整 Node 测试在源码仓库执行；npm 包不包含整个测试套件。

`npm pack --dry-run --ignore-scripts` 可检查内容。维护者核对版本、文件、文档及许可，确认发布凭据和包名后执行 `npm publish`。本次整理不代表已上传 registry，也未确认公共包名可用性或归属。

## 静态资源部署

部署无需 registry，保留完整 dist 即可。也可显式导出：

```sh
npm run export:assets -- --target /path/to/new-site-assets/stats-map
```

目标须与源码目录分离，已有非空目标会被拒绝。替换站点目录与原子切换由宿主负责；此命令不递归删除旧目标、不推断宿主位置、不上传服务。`scripts/publish.js` 仅保留为实现文件名，不再绑定 npm publish 生命周期。

dist/manifest.json 记录大小与 SHA-256，产物只由构建生成。经典脚本和 ESM 的 Worker 均依赖完整相对路径，不要只复制顶层 JS。

## 脱离宿主验证

复制源码到宿主仓库之外的新目录，排除 node_modules、dist、tarball 和临时目录，不建立指向宿主的符号链接。依次检查：

1. `npm ci`（完整缓存可用 `--offline`）、`npm run check`、`npm test`。
2. `npm run preview`：画廊、最小示例及本地模块/夹具请求。
3. `npm run build`、`npm run verify-package`：消费 tarball 并从包内源码重建。
4. 从安装包运行 preview，确认默认夹具和文档也在分发清单。

独立构建与功能验证不等于已发布 npm、部署站点或完成全部浏览器性能/视觉验证。记录实际环境和结果即可，无需重放原宿主的历史验收链。

## 本次验证记录（2026-11-10）

在 Windows、Node 25.7.0、npm 11.10.1 下，将源码复制到宿主仓库外的临时目录并排除生成物，验证结果如下；本轮没有重跑 Node 22 基线。

| 检查 | 结果 |
| --- | --- |
| 离线安装开发依赖、结构检查、独立构建 | 通过 |
| tarball 安装、公开入口、包内源码重建、129 个 manifest 文件 SHA、严格类型消费 | 通过 |
| `npm pack` 自动 prepack 构建 | 通过 |
| 安装包 preview 与文档/样本/模块的 12 条 HTTP 路由 | 通过 |
| Chrome 画廊的 28 个面板、期次/布局/筛选；最小示例的键盘选择与 Dorling 切换 | 通过；无页面异常、外部请求或失败响应 |
| 全库 Node 测试 | 两项已有失败，在原宿主目录也可复现，不能称为全绿 |

两项失败分别位于 `tests/locale-theme.test.js` 的显式锚点保留断言，以及 `tests/symbol-color.test.js` 的 Dorling 图例避让断言。它们不涉及仓库外文件依赖；本次未改动相应 adapter 或布局实现。正式发布评估须保留这一限制，不能用包独立性通过代替功能全量通过。

同日后续调整：默认画廊已改为包内中国与欧洲真实边界；虚构预览保留为 `preview:synthetic`。真实样本与检查入口见[示例说明](../examples/preview/README.md)，仍不读取宿主目录或默认联网。
