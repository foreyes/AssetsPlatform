# 自制 1 秒刚性节点动画：接入、诊断与验收

本示例是 AssetsPlatform 仓库自行生成的 glTF 2.0 资产，用于练习**从项目目录到动画侧车再到实际浏览器复验**的接入路线，不是任何游戏或 Unity 工程的提取物。入口是 `apps/reviewer/project-directory.json` 中的 `animation-example` 项目；其项目配置在 `apps/reviewer/animation-example/project-config.json`。本文适合已能在本机运行 Node.js 18+、可用 WebGL 的接入者。以下相对路径均从仓库根目录起算。

## 1. 生成并核对输入

```sh
node apps/reviewer/animation-example/generate.mjs
node --test apps/reviewer/tests/animation-example.test.mjs
```

生成器只写 `apps/reviewer/animation-example/assets/`，不访问网络、不需要 npm 安装、不执行外部游戏或私有 viewer；重复运行生成的文件应逐字节相同。已随仓库附上生成结果，命令用于重新生成和检查。**再次运行会覆盖该目录内手工修改的动画目录，把临时 `ready` 记录还原为 `pending`**；先在仓库外保存真实验收记录及临时目录副本。主要文件：

| 路径 | 作用 |
|---|---|
| `apps/reviewer/animation-example/assets/linear-translation.glb` | 自包含 GLB 2.0；双节点层级、一个矩形网格和真正的 glTF `LINEAR` 平移轨道 |
| `apps/reviewer/animation-example/assets/linear-translation.animation.json` | 平台播放所用的数据侧车；GLB 内含动画本身**不会**自动解锁平台播放 |
| `apps/reviewer/animation-example/assets/catalog.json` | 网格资源 `mesh-synthetic-linear` |
| `apps/reviewer/animation-example/assets/objects-catalog.json` | 物件 `object-synthetic-linear`，`sourceId` 与 GLB/侧车同一源对象 |
| `apps/reviewer/animation-example/assets/animation-catalog.json` | `objects[]` 中的待验证动画记录；起始不授予播放资格 |
| `apps/reviewer/animation-example/assets/actions-catalog.json` | 必须是 `{ "version": 1, "objects": [] }`；本示例没有动作别名或状态流程 |

`project-config.json` 的 `config.animationCatalogUrl` 与 `config.actionsCatalogUrl` 分别指向上述两个目录文件。`config.verifiedAnimation: true` **只允许适配器读取目录**，不是验证结论；`animation-catalog.json` 的记录仍为 `status: "pending"`，三个验证标记为 `false`，`verifiedPlayableClipIds` 为空。所以初始 UI 正常显示静态模型，但不会出现可播放控件。这是预期的 fail-closed 行为，不是示例坏了。

### 核心绑定

- GLB `extras.sourceId`、物件 `sourceId` 和侧车顶层 `sourceId` 都是 `synthetic:linear-translation:object`。动画目录记录的 `objectId` 是 `object-synthetic-linear`，其 `sourceId` 同上。
- 侧车 `schemaVersion: 1`、`coordinateSystem: "glTF"`。它与自制 glTF 轨道同为 glTF 坐标；没有 Unity 到 glTF 的隐式变换。
- GLB 节点 0 是根 `SyntheticRoot`，`extras.sourceId: synthetic:linear-translation:root`；节点 1 是子网格 `MovingQuad`，`extras.sourceId: synthetic:linear-translation:mesh`。侧车 `nodes[]` 的 `id` 与这两个节点各自的 `extras.sourceId` 精确一致，`glbNodeIndex` 分别为 0 和 1，`parentId` 分别为 `null` 与根节点 ID。不要按显示名或猜测的层级路径绑定。
- 侧车静态 TRS（translation / rotation / scale）必须与 GLB 静态节点矩阵一致：根是 `[0,0,0] / [0,0,0,1] / [1,1,1]`，子节点是 `[0,0.25,0] / [0,0,0,1] / [1,1,1]`。子节点平移轨道在 `t=0` 为 `[0,0.25,0]`，在 `t=1` 为 `[1,0.25,0]`，两键以 `LINEAR` 插值；片段 ID 是 `synthetic-linear-1s`，时长 1 秒，不循环。
- 所有目录路径相对于该项目的 `assetRoot`，不是相对于 `assets/animation-catalog.json`。`modelUrl` 与 `dataUrl` 分别写作 `assets/linear-translation.glb` 和 `assets/linear-translation.animation.json`。

模型没有 skin、JOINTS、WEIGHTS、运行时状态机、morph 或事件；它是**刚性节点动画**，不是蒙皮动画。对这类记录，`skinBindingVerified: true` 的具体含义应是“已核查所有受影响网格均为刚性、没有未恢复的 glTF skin，且节点/网格/层级绑定正确”，**不**是“测试过蒙皮”。如果有实际 skin，则须另行核查关节层级、权重、逆绑定矩阵和变形数值，不能套用本刚性结论。

## 2. CPU 数值与错误绑定诊断

前述测试直接调用公开源码 `apps/reviewer/viewer.mjs` 的 `parseGLB` 和 `createSourceAnimation`；它验证生成结果的字节一致性、GLB 轨道、侧车绑定，以及 t=0、0.5、1 秒的采样。解析器为了固定镜头，把静态几何按中心和尺度归一化。本例原始第一个网格顶点为 `[-0.25,-0.2,0]`；静态节点加上 Y=0.25 后，解析所得中心约 `[0,0.25,0]`、尺度为 4。因此该顶点的**归一化** X 在 t=0、0.5、1 秒分别为 `-1`、`1`、`3`，Y 约为 `-0.8`；未经归一化的节点世界平移 X 则为 `0`、`0.5`、`1` 米。CPU 测试容差为 `2e-5`，主要用于覆盖 float32 表示误差，不是通用视觉验收阈值。

测试还分别把顶层 `sourceId`、子节点 `glbNodeIndex`、静态 translation、`parentId` 改错，期待 `createSourceAnimation(...).clips` 变空并在 `diagnostics[].reason` 给出对应错误。实际接入时若无法播放，先检查浏览器控制台/动画限制提示，再对照以下规则：

| 错误 | 排查对象 |
|---|---|
| “源对象 ID 不匹配” | 物件、GLB `extras.sourceId`、侧车顶层及动画记录的源对象 ID |
| “源节点绑定不匹配” | `nodes[].id` 是否等于目标 GLB `nodes[glbNodeIndex].extras.sourceId`，索引是否重复、在当前场景中可达 |
| “源静态变换与 GLB 矩阵不匹配” | 静态 TRS 是否是目标 GLB 节点的静态姿势；不要填动画终点 |
| “源父节点与 GLB 层级不匹配” | `parentId` 是否与 GLB 实际父子关系一致，根节点为 `null` |

测试只证明这组自制输入在 Node.js CPU 路径下得到上述结果；**不证明真实 WebGL 绘制、按钮交互、GPU 像素或其他来源资产已验证**。

## 3. 真实 WebGL 验证与转为 ready

1. 在一台可用 WebGL 的浏览器所在机器上，从仓库根目录运行 `npm start`（或 `node apps/reviewer/server.mjs`），按终端显示的本地地址打开 `/?project=animation-example`。使用 HTTP 服务，不要直接打开 `file://`。确认显示蓝色矩形静态物件；初始无可播控件是正确的。
2. 因目录仍是 `pending`，先打开 `/animation-example/validate-webgl.html`：这是仓库自制的隔离复验页，直接调用公开 `viewer.mjs` 加载同一 GLB/侧车，不改变目录门禁，也不伪装已验证。用页内播放、暂停、定位、停止控件检查起点、50% 中点和终点图像；浏览器开发工具确认 WebGL 上下文建立、GLB 与侧车请求成功且没有上下文丢失。确认蓝色矩形沿 X 正向平滑移动、没有错误消失或材质变化。记录浏览器/系统/GPU、时间、输入 GLB 与侧车 SHA-256、截图或捕获证据、观察和未验证项。仅本地服务器与 CPU 测试成功**不能**填 `pixelVerified: true`。
3. 仅当节点绑定、来源曲线/GLB 轨道和上述真实 WebGL 图像检查**都已完成且有可复核记录**，先在仓库外保存原动画目录副本与验收记录，再**临时**编辑 `apps/reviewer/animation-example/assets/animation-catalog.json` 中对应记录：置 `status: "ready"`、`skinBindingVerified`、`sourceCurvesVerified`、`pixelVerified` 为 `true`，将 `verifiedPlayableClipIds` 设为 `["synthetic-linear-1s"]`。`playableClipIds` 保持同一列表；每个可播放 ID 必须在已验证列表中。此修改是验证结论，不是让按钮出现的技巧。若任何检查失败，保持 `pending` 和 `false`，修复后复验。
4. 刷新同一浏览器页面。打开自制物件的详情，确认出现唯一片段，然后使用“▶ 播放”观察从 0 到 1 秒；“Ⅱ 暂停”使时间和画面停住；拖动定位条至 50% 应显示约 `0.50 s` 与中间位置；“停止”应暂停并回到 `0.00 s`。重复播放时如选择“仅一次”，应在 1 秒终点停止；停止按钮并不删除侧车或重置浏览器审阅记录。对比视图打开时也核查两视图同一时间姿势。实际 UI 文案以当前前端为准。
5. 保存步骤 2/4 的人工证据及临时 `ready` 目录副本，然后运行 `node apps/reviewer/animation-example/generate.mjs` **恢复仓库自带的 `pending` 基线**，再运行 `node --test apps/reviewer/tests/animation-example.test.mjs`。这个测试刻意要求初始目录保持 `pending`，不能在临时 `ready` 改动尚在时运行并期待通过；真实验收结果应留在独立证据记录中，不把本仓库演示目录永久改写成未经共同复核的产品声明。记录实际检查范围只覆盖“自制刚性节点 LINEAR 平移”的加载、绑定、数值和 WebGL 预览，不外推为 Animator 状态机、动画事件、物理、IK、蒙皮或 morph 的完整恢复。

`animation-catalog.json` 是平台的**声明性门禁记录**，不是证据存储的替代。可用 `apps/reviewer/animation-example/validation-record.template.json` 另存一次验证记录，填入实际测得值和截图位置；模板中 WebGL 结果为 `null`。本仓库交付时**没有**真实 WebGL 人工验收记录，保持 `pending`；即使 CPU 数值检查通过，也不可预填 GPU 结论。

## 4. 普通 glTF 与原引擎曲线的责任边界

本例的 `LINEAR` 侧车直接描述自制 glTF 坐标下的关键帧，与 GLB `animations[0]` 的时间和值一致。对一般 glTF 输入，数据提供者仍须证明侧车 ID、节点索引、静态姿势与真实 GLB 一致，以及所选择的插值（`STEP`、`LINEAR`、`CUBICSPLINE`）忠实于源数据；平台不会仅凭 GLB `animations[]` 自动生成可信侧车或把它标记 ready。

`UNITY_CANONICAL` 指某些上游工作流的 Unity 原始标量曲线表示，不是普通 glTF 插值。**公开播放器不解码或执行它**；若侧车轨道声明 `interpolation: "UNITY_CANONICAL"`，该片段会被拒绝而不是退化为近似 `LINEAR`。来自 Unity 或其他引擎的合法资产，须由**来源提供者在接入之前**核查原始曲线、源时间、属性、绑定、坐标转换与误差，并导出为自包含 GLB 及 glTF 坐标下的可验证 `STEP`、`LINEAR` 或 `CUBICSPLINE` 侧车。浏览器只消费并校验已转换数据，不从专有标量系数推断运行时状态机、IK、事件、物理或脚本。本自制 glTF 示例不使用也不验证 `UNITY_CANONICAL`，不可把两类数据直接混用。
