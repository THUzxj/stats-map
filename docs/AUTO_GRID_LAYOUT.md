# 自动地理格网布局设计

2026-11-11。状态：首版已实现，采用接入时离线生成、随 Geography 保存、运行时只读的模式。渲染入口不导入求解器，preview 的两种格网均读取保存的位置表。

实现入口是 Node 专用的 `stats-map/preparation`，源码在 `src/preparation/`；持久化字段为 `Geography.grid_layouts`。命令及重用/失效规则见[接入指南](ADDING_MAPS.md#离线准备格网位置)。本页保留完整设计，以下部分属于后续增强：三地区循环置换、Pareto 多方案选择界面、真实连通分量指标和大规模性能评估。首版保存最佳方案及所有候选的分项评分，不承诺全局最优或达到手工模板质量。

## 目标与输入输出

生成类似 eurostat-map grid cartogram 的布局：每个地区用一个等大的方格或六边形表示，保留大致地理轮廓、东西南北和局部关系，允许空格。格子面积不编码地区面积或统计数值。

输入是地区 ID、地理锚点、坐标系/投影、可选邻接表、固定格点和求解参数；输出是 `region_id → [column, row]`、质量指标、诊断及算法版本。切换指标、年份、选择状态、颜色、窗口宽高都不改变格点分配。一个地区包含多个几何片段时仍只占一个格子。

| 条件 | 性质 | 处理 |
| --- | --- | --- |
| 每个参考范围内的地区恰有一个位置 | 硬约束 | 成功结果的 ID 集合必须与输入完全相同 |
| 同一格点只能分配给一个地区 | 硬约束 | 一对一匹配保证，后续操作保持 |
| 方格/六边形使用各自的整数格点 | 硬约束 | 不以连续坐标避让代替格点分配 |
| 手工固定的位置保持不动 | 硬约束 | 移除已占用格点后求解其他地区 |
| 大致地理位置、方位、邻接 | 软目标 | 优化后报告位移、反向和邻接损失 |
| 布局紧凑，仍可保留海域或间隔 | 软目标 | 控制候选容量和紧凑度，不要求填满矩形 |

不能承诺原始拓扑完全保留：一个格子最多有 4 个或 6 个边邻居，某些地区的邻接度更高；投影、离散化、岛屿和固定位置还会引入其他冲突。算法需要给出有解释的折中，不把质量分数当作地理正确性的证明。

## 与已有实现的关系

- 当前 [grid.js](../src/layouts/grid.js) 使用显式 `positions`，缺失位置按地区列表顺序逐行填充；[resolve.js](../src/layouts/resolve.js) 尚未为格网布局提供锚点。
- eurostat-map 的 [getGridLayout / parseGridLayout](https://github.com/eurostat/eurostat-map/blob/b866ca20b3346c0037215ecaeaa7deb74d9d6c8f/src/core/cartograms.js#L196-L238) 读取预置或自定义位置表。本方案生成的就是这类位置表，但不复制其中的地区模板。
- 本地 Bertin 参考源码的 [simulation-squares.js](https://github.com/neocarto/bertin/blob/2e53107c5357ac826a23f8ec7ba03afff16ce0cf/src/helpers/simulation-squares.js) 可以借鉴地理位置初始化和碰撞避让思路；其输出是连续位置。其 [grid.js](https://github.com/neocarto/bertin/blob/2e53107c5357ac826a23f8ec7ba03afff16ce0cf/src/helpers/grid.js) 进行空间格网重采样，会重新分配数值。本方案保留地区身份和原始统计通道，不做数值重采样。
- McNeill、Hale 的 [Generating Tile Maps（2017，作者机构存档摘要）](https://ora.ox.ac.uk/objects/uuid%3A058b39b9-be2e-41d1-86b6-8029ca1bb92d) 讨论从地理形状生成不同类型的 tile map，并生成、排名多个候选。本方案同样保留候选及分项评分，具体求解步骤是面向 stats-map 的工程提案，不声称复现该论文。

## 总体流程

1. 固定布局参考范围，解析地理锚点并投影。
2. 建立可选真实邻接图，以及用于局部方位评分的空间近邻关系。
3. 枚举少量网格容量、长宽比和相位，允许候选中有空格。
4. 对每个候选，求“地区到格点”的最小费用一对一匹配。
5. 通过移入空格、交换位置优化方位、邻接和紧凑度。
6. 用完整目标函数比较候选，返回最佳布局及至多三个具有不同取舍的方案。
7. 导出已解析位置表；正常渲染只使用该表，不重复求解。

## 1. 参考范围与地理锚点

### 稳定的参考范围

`referenceRegionIds` 指定本次布局的完整身份集合。默认在请求生成布局时冻结当前 `viewRegionIds`，后续图例筛选、选择和无数据状态只影响显示，留下原有空位，不重新紧缩。改变行政层级或显式改变参考范围时才生成新计划。

一般选择一个层级或互不包含的地区集合。父级和其子级同时出现时报告混合层级诊断，除非调用方明确允许；不自动合并、不使用统计值判断成员资格。

### 复用锚点契约

使用现有 `resolveAnchors` / `anchorIndex`：显式登记的符号锚点优先；点几何可使用自身位置；面几何只有在明确的 `anchor_policy` 下才派生内部点。不能擅自使用顶点均值或从地区编码猜位置。

首版严格模式：没有可用锚点且没有固定格点的地区，返回 `GRID_MISSING_ANCHOR` 及 ID 列表，保留旧布局。缺少锚点但已有固定格点的地区可以参与，标记为手工定位，不计入依赖锚点的质量指标。不得静默丢掉地区或把顺序排版伪装成自动地理布局。

### 投影与尺度

复用现有投影注册表和 `projectPoint`，在固定的虚拟坐标框内计算，排除实际 viewport。保持投影方向，不使用 PCA 旋转、不允许镜像；屏幕坐标中 y 向下。仅作平移和统一缩放，不分别拉伸 x、y。

将投影后的锚点记为 `p_i`。对每个候选格点集合 S，用同一个比例 `a` 和平移 `b` 得到目标 `t_i = a * p_i + b`，使锚点包围框适合候选中心的范围。只在源跨度非零的轴上计算比例；二维输入不能选零宽或零高的候选。所有锚点重合时使用确定性的中心目标并报告退化输入。

跨投影切缝的数据需要调用方提供合适的投影/中心或已展开坐标。无法可靠识别的切缝不自动修复；提供范围异常诊断。远离主体的地区仍有自己的锚点，不随意搬到某个角落。

## 2. 方格与六边形共用求解器

内部区分“整数格点坐标”“用于距离评分的平面坐标”“最终像素坐标”。只替换格点生成器、邻居函数和距离函数，匹配与优化内核共用。

### 方格

格点为整数 `(c, r)`，平面位置 `h(c, r) = (c, r)`。边邻接采用上下左右 4 邻接；格点距离为 `|dc| + |dr|`。角接触不计为保留的边邻接。

### 六边形

内部用轴向整数 `(q, u)`：

```text
h(q, u) = (sqrt(3)/2 * q, u + q/2)
neighbors = [(1,0), (1,-1), (0,-1), (-1,0), (-1,1), (0,1)]
d_hex = (abs(dq) + abs(du) + abs(dq + du)) / 2
```

单位平面距离等于相邻格子中心的距离。输出转换为当前 renderer 使用的奇数列下移格式：`column = q`、`row = u + floor(q/2)`。这与现有 `x = 1.5 * cell * column`、`y = sqrt(3) * cell * (row + parity(column)/2)` 只差统一尺度。

没有固定位置时，先在轴向坐标里整体平移，再转换为非负列、行；不能直接平移 offset 列而忽略奇偶性。存在固定位置时保留其坐标框架，负列的奇偶函数必须使用数学模 `((c % 2) + 2) % 2`；现有 JS `%` 对负数的行为需要在接入时处理。

## 3. 真实邻接与空间近邻分开

当前 Geography 公共格式没有统一邻接表。首版允许调用方传入带来源说明的邻接边集；来源适配器不实现另一套优化算法。

- `E_adj`：调用方提供的真实地理邻接，按无向边去重，排除自环。记录 `completeness: 'complete' | 'partial'`。
- `E_near`：从投影锚点构建的少量最近邻关系，只用于保持局部方位。不能称为行政邻接，也不用于声称真实连通分量。
- 无邻接表时仍可生成布局，跳过真实邻接损失和虚假邻接惩罚，相关质量指标为 `null`。
- 只有声明为 complete 的邻接图，才把“两个地区落在相邻格子但原图中无边”计作新增邻接。partial 图中缺少边表示未知。

使用真实邻接图时，报告最大度超过 4/6、地理连通分量被拆散、不同分量产生格边接触等信息；不强迫所有地区连成一个块。由共享拓扑弧推导邻接可作为后续共同地理工具，浮点坐标容差和点接触规则需要单独验证，不作为首版前置条件。

## 4. 候选网格

单次配置一种形状。建议先评估三个占用率 `rho ∈ {0.55, 0.70, 0.85}`：目标容量 `M = ceil(N / rho)`。这是候选搜索参数，不保证最终包围框空格比例与它相同。

为每个 M 枚举整数行列，按实际平面跨度与锚点包围框的长宽比选两个最接近的候选；必要时扩大候选范围。用固定的半格基向量平移改变锚点与格子的相位，可增加种子，但总候选数由 `maxCandidates` 限制，例如先评估上限 12。占用率和候选数均为待实验校准的初值。

候选域首先使用完整格点矩形，令容量不少于 N；由匹配自行留空。首版不将原始多边形面积转换为地区可占格子数量。固定位置必须加入候选范围；若加入后超过 `maxCells` 或操作预算，明确返回预算/约束错误，不分配超大矩阵。

对空集合直接返回空计划；一个地区直接生成一个位置；共线输入可使用条状候选。近似圆形或完全重合的输入采用固定平局规则，不用地区标签推测方位。

## 5. 初始解：矩形最小费用匹配

对每个候选建立 `N_free × M_free` 费用矩阵：

```text
C[i, s] = huber(norm(h(s) - t_i), delta = 2)
huber(x, delta) = x*x                         if x <= delta
                  2*delta*x - delta*delta     otherwise
```

固定格点先占用，从矩阵移除对应地区和格点。重复固定位置、非整数格点和未知地区 ID 是输入错误。使用支持矩形矩阵的 Hungarian / 最小费用匹配，分配所有自由地区到不同格点。此时只保证该候选上的位置费用最优，不保证后面的完整目标函数全局最优。

地区先按 ID 的固定码点顺序排序，格点按规范坐标排序；相同费用由算法的稳定遍历顺序决胜，不用随机数，也不通过较大的 ID 费用扰动改变原目标。

允许 M 大于 N 是关键：它让地理轮廓附近保留空格，避免最后一个地区只能被塞到远处。不能以逐地区“吸附最近空格”的贪心策略作为正式初始解，因为结果会依赖输入顺序。

## 6. 完整质量目标与局部改良

记 `s_i` 为分配给地区 i 的格点，`z_i = h(s_i)`。在所有候选中使用同一组权重和单位格间距：

```text
E = w_pos * E_pos + w_dir * E_dir
  + w_adj * E_adj + w_false * E_false + w_compact * E_compact
```

| 分项 | 定义 | 用途 |
| --- | --- | --- |
| `E_pos` | 有锚点地区的 `mean(huber(norm(z_i - t_i), 2))` | 大致位置；Huber 减少单个远端地区主导总分 |
| `E_dir` | 对显著分离的地区对，平均方位 hinge 损失 | 抑制东西/南北反转，同时允许接近同纬/同经的地区并排 |
| `E_adj` | 已知真实邻接边上 `mean(max(0, d_lattice(s_i,s_j)-1)^2)` | 尽量让原本相邻的地区保持格边相邻 |
| `E_false` | 新增格边数 / `max(1, 全部已占格边数)` | 仅在 complete 邻接图下抑制虚假相邻 |
| `E_compact` | 全部理想格子外包矩形面积 / 总格子面积 − 1 | 轻度抑制无谓空隙和过长尾部，不强制连通 |

方位分项的具体规则：对某轴 `delta = t_j - t_i`，若 `abs(delta) >= 0.5`，加入 `max(0, 0.25 - sign(delta)*(z_j-z_i))^2`；否则跳过该轴。x、y 分开判断再取平均。这里的 0.5/0.25 以格间距为单位，是首轮实验参数；投影 y 向下的约定适用于所有判断。

小样本可以使用所有地区对；大样本改用确定性的空间近邻和东西南北极值配对，限制评分图规模。完整方位反转率仍需另行评估，不能把稀疏优化目标中的零反转解释为全局零反转。

没有对应边/配对的项取 0；对外指标中区分“没有可计算对象”和“损失为零”。平方格单位面积为 1，六边形在上述单位中心距离下的面积为 `sqrt(3)/2`；外包矩形包含格子的完整理想轮廓，不能只算中心跨度。该指标不依赖 renderer 当前的格子留白样式。

可试的初始权重为 `(1, 0.6, 1, 0.2, 0.1)`，顺序对应上述五项。它们只是起点，必须与位置匹配基线对照；没有邻接数据时相应项关闭，不假造边补足分数。

### 离散局部搜索

保持格点唯一性和固定位置，依次考察：

1. 将一个地区移入附近的空格，搜索半径从 1 到 2 个格步。
2. 交换两个未固定地区的位置；优先考察空间近邻、真实邻接和当前格点近邻对。
3. 需要时用有上限的三地区循环置换跳出二交换局部极小；作为增强项单独衡量收益。

每轮选择完整 E 降幅最大的合法操作，按规范 ID/格点顺序打破平局；只接受严格下降。不允许仅为改善邻接而无条件恶化位置与方位。无改进或达到固定迭代/操作数预算时停止，保留历史最佳解，返回收敛/预算状态。墙钟超时可取消请求，但不用于决定可复现的最终分配。

每个初始候选都保留原解与改良解，结果至少不差于该候选初始解的完整 E。这个保证不等于邻接率、位移等每个单项都不变差。

### 候选选择

默认选完整 E 最低者；并可返回位置优先、邻接优先等最多三个非支配候选，附相同口径的分项指标。分数相同按候选配置及位置表的规范顺序决胜。不要把“最优”解释为所有可能网格上的全局最优；实际选择范围受候选和局部搜索预算限制。

## 7. 伪代码

```text
generateGridPlan(geography, referenceIds, options):
    ids = canonicalSort(unique(referenceIds))
    validateScopeAndPins(ids, options.positions)
    anchors = resolveAnchorsUsingDeclaredPolicy(geography, ids)
    requireAnchorOrPinForEveryId(ids, anchors, options.positions)
    points = projectInFixedCoordinateFrame(anchors, options.projection)
    graphs = prepareKnownAdjacencyAndSpatialPairs(ids, points, options.adjacency)
    best = null
    alternatives = []
    for candidate in enumerateBoundedLattices(points, ids, options):
        targets = fitWithUniformScale(points, candidate)
        assigned = rectangularMinCostAssignment(ids, targets, candidate, pins)
        initial = evaluateFullObjective(assigned, targets, graphs)
        improved = boundedDiscreteRefinement(assigned, targets, graphs, pins)
        result = betterOf(initial, improved)
        alternatives.add(result)
        best = deterministicBetter(best, result)
    if best is null: return structuredConstraintOrBudgetError()
    return plan(best, boundedParetoAlternatives(alternatives), diagnostics)
```

## 8. 接入 stats-map 的提议

当前 Node API 可直接用于接入阶段；`knownEdges`、`scope` 等由调用方提供：

```js
import { generateGridPlan } from 'stats-map/preparation';

const plan = generateGridPlan(geography, {
  type: 'grid-hex',
  referenceRegionIds: scope,
  anchorPolicy: spec.anchor_policy,
  projection: spec.layout?.projection,
  adjacency: { edges: knownEdges, completeness: 'partial' }, // 可省略
  positions: {}, // 可选固定格点
  algorithmVersion: 1,
  maxCandidates: 12,
});

map.setLayout({ type: 'grid-hex', positions: plan.positions });
```

上例展示单个计划的底层接口。正式接入应调用 `prepareGridLayouts`，把两种形状的计划保存到 Geography 后再分发。已有指纹相同的表直接复用；失效表必须显式重新生成。浏览器、preview 服务、期次与布局切换不会调用生成器。实际绘制、hitTest、导出共用已存位置，Euro/China 适配器只保留输入中的位置表。

实际求解文件位于 `stats-map/src/preparation/`：`grid-auto.js` 负责编排、`assignment.js` 负责匹配、`grid-quality.js` 负责评分；`src/layouts/grid-lattice.js` 负责两种格点，`saved-grid.js` 只验证并选择保存的位置。现有 `gridLayout` / `hexGridLayout` 的顺序和显式位置调用保留；同时修正了负数奇数列偏移与六边形尺寸相对格距过小的问题。

计划至少包含：

```text
positions, shape, reference_region_ids,
algorithm: { name, version, resolved_parameters },
input_fingerprint, anchor_provenance, adjacency_provenance,
candidate_frame, target_transform, output_translation,
quality: { displacement_mean, displacement_p95,
           cardinal_reversal_rate, cardinal_tie_rate,
           adjacency_recall, adjacency_precision, occupied_cell_count,
           occupied_bbox_area, retained_component_count },
diagnostics, search: { candidates, operations, stop_reason }
```

`candidate_frame`、`target_transform` 和 `output_translation` 保存候选范围、目标坐标的统一缩放/平移以及输出归一化。评分时地区位置和目标位置始终处于同一坐标框架，输出表整体平移不能改变质量分数。

指标口径：位移以所选候选的一格中心间距为单位；方位反转率和并排率分别统计源坐标显著分离的 x/y 轴比较，分母相同。邻接召回为“保留的已知真实格边 / 已知真实边”，partial 图只评价已知正例；邻接精确率为“已知真实格边 / 全部已占格边”，只在 complete 图下有意义。空分母返回 `null`。连通分量保留数指真实连通分量中，其成员在格边图上的诱导子图仍连通的数量，单个地区的分量计为连通；这个指标与逐条真实邻接保留率分开报告。

缓存键包括参考 ID、锚点/地理版本、投影参数、真实邻接、固定位置、算法版本和全部已解析参数；排除统计数据、期次和 viewport。相同键复用计划。新增/删除地区会得到新键，不承诺增量更新完全不动；需要稳定的旧位置时将其显式固定。

导出时保存完整 `positions` 作为重开依据，算法参数与质量信息属于可追溯元数据；重开不依赖未来版本再次求解。元数据如何进入正式 schema 应在实现时单独声明，不把额外字段偷偷塞进现有格式。

## 9. 复杂度与预算

矩形匹配在 N 个地区、M 个候选格点下约需 `O(N^2*M)` 时间、`O(N*M)` 费用存储；当 M 与 N 同阶时是立方级。B 个候选按 B 倍计算。邻接、近邻和方位图只存与当前操作相关的边，增量更新局部搜索分数；紧凑度需要维护外包框的极值计数。

先用 N 为 30、100、300、1000 的虚构形状测量实际耗时、内存和质量，之后确定默认预算、同步阈值与 Worker 策略，不在设计阶段承诺毫秒级速度或任意大规模实时求解。大规模可再比较稀疏最小费用流，但裁剪候选格点后必须有可行性检测与扩展回退，不能只检查总格点数。

首版可提供 Promise 接口和操作预算；如增加 Worker，沿用现有销毁/取消与过期请求保护。运行时仍应离线且无新增第三方包依赖；通用匹配实现需通过小规模精确对照。

## 10. 实施与关闭检查

实现按以下边界检查；首版不包含上述列明的后续增强。浏览器对本包 src 预览进行检查，独立包入口另做分发验证，不自动更新宿主和 skill 资源。

| 步骤 | 交付 | 对应检查 |
| --- | --- | --- |
| A：最小生成器 | 两种格点、锚点/投影、一对一匹配、固定位置、计划导出 | 小规模穷举费用对照；身份完整；格点唯一；六边形转换/邻接；固定位置冲突；退化与缺失输入 |
| B：质量优化 | 可选邻接、方位损失、多候选、离散改良和诊断 | 与同候选位置匹配基线比较；完整 E 不增加；complete/partial 图语义；不可能邻接和局部极小案例 |
| C：应用接入 | 生成入口、缓存、异步生命周期、方案重开、可选候选预览 | 当前格网 renderer/hitTest 针对性测试；方格/六边形各一个浏览器案例，检查窄屏、切期和重开位置稳定 |

虚构样本放在 `stats-map/tests/fixtures/`：有明显方位的少量地区、稠密中心和稀疏外围、狭长链、分离小岛、对称布局、共线/重合锚点、高度数中心及部分固定位置。真实来源案例只放允许的 examples/catalog/data 中，不能为某个地区写规则。

确定性检查需改变地区输入顺序、对象键顺序、期次和 viewport；相同参考范围及输入指纹必须输出相同位置表。对笛卡尔或投影后的虚构输入，额外检查平移、统一缩放后的对应关系；这项检查不要求经纬度经过非线性投影后仍满足线性变换不变性。

质量报告至少对照“当前按列表排版”“仅位置匹配”“完整优化”三组，分别给出位移、方位反转/并排率、真实邻接召回和新增邻接，不用一个综合分遮蔽明显反向。方位对近似同经/同纬的容差必须写明；大样本抽样评估要记录抽样方案。

硬约束错误、丢地区、重复格点、固定位置漂移、输入顺序影响、切换期次导致重排均阻断生成器完成。质量阈值在上述虚构基准上校准后冻结；当前没有实验，不预先声称“邻接保留 90%”或达到手工模板质量。通过算法检查也不等于地图已具有人类可识别性，需再查看代表性结果。
