# AssetsPlatform 资产整理与接入规范

版本 1.1　2026 年 10 月 25 日

## 1 目的与交付定义

本文供执行资产整理的 Agent 或工程师使用。输入是一份用户有权处理的新项目资产；输出是一个可以通过本机 HTTP 直接打开、由 AssetsPlatform 读取的完整资产审阅工作区。执行者必须整理文件、建立稳定身份和来源记录、闭合模型依赖并完成校验，而不是只生成目录建议、截图或一份没有模型字节的索引。

本规范采用 **本地静态 indexed 接入**作为默认交付。它不要求加入现有四个游戏项目，也不要求上传、共享或改动托管站点。完整物件是审阅单位，技术资源是它依赖的模型、材质、贴图等；本文的 entity 指完整物件概念，对应 `objects-catalog.json` 的记录，**不是**把 `dataKind` 改为 `entity`。

合格交付至少包含：可运行工作区、有效 JSON 目录、自包含 GLB 模型、来源和限制说明、文件 SHA-256 清单、验证记录。未转换资源可以作为元数据条目保留，但必须标为无预览；不得用立方体、旧截图或另一物件的模型冒充该资源。

### 1.1 实现基线与状态

本文依据 AssetsPlatform 2026 年 10 月 25 日源码中的 `apps/reviewer/`、`docs/DATA-CONTRACT.md`、`docs/PRODUCT-MANUAL.md` 和托管参考 `reference/hosted/`。代码路径均相对于 AssetsPlatform 仓库根目录；输出工作区另行说明。

- **冻结基线已有**：indexed 目录加载、自包含 GLB CPU 解析与 WebGL 预览代码、本地审阅、JSON 导入导出、项目路径及身份隔离。
- **仓库源码已包含的新增工具**：`scripts/import-directory.mjs`、`apps/reviewer/validate-workspace.mjs` 提供本地文件夹导入与通用输出校验，已随完整平台源码提交到 [foreyes/AssetsPlatform 的 `bbc29631` 提交](https://github.com/foreyes/AssetsPlatform/commit/bbc29631e6ebdb8273ebd9416647d5a31395b56a)，该提交的 CI 测试与构建通过；这不等于真实浏览器/GPU 验收或正式版本发行。早先冻结包不包含这两个工具。使用本文命令前仍须检查所取得的源码是否含有这些文件；文件缺失时使用第 9.3 节手工整理路线和第 17 节校验脚本，不得把新工具能力归于早先冻结包。
- **不在本规范承诺内**：任意原始工程自动恢复、原游戏执行、Unity Shader 忠实移植、动画一键恢复、GPU 像素一致性、任意新项目直接接入托管后台。

“必须”是交付门槛；“建议”是默认做法；“示例”不代表项目事实。未执行的检查写为“未验证”，不得写为“通过”。

## 2 先选择运行范围

| 项目 | 本地静态工作区 | 现有托管增量入口 |
|---|---|---|
| 新项目身份 | 可登记自选唯一项目 ID | 源码仅允许四个项目白名单 |
| 数据格式 | indexed JSON 与受限自包含 GLB | 受限静态 GLB、PNG、JSON |
| 单文件约束 | GLB 最大 64 MiB，另有解析预算 | 每个文件最大 1 MiB |
| 用户状态 | 当前浏览器本地审阅记录 | 依赖托管应用，不能由资产包推定 |
| 运行与发布 | 本机服务器，不自动上传 | 需要独立授权、身份与存储配置 |
| 动画 | 默认关闭，需专门证据链 | 静态导入契约不能接收 skin 等能力 |

默认选择左列。四个托管项目是 CozyIsland、HamstersAway、ParadiseMarsh 和 Sulfur；新增任意项目需要受审查的代码或配置变更，目录整理本身不授予后台写入或站点发布权限。不要通过冒用现有项目 ID 绕过白名单。

本地 64 MiB 模型通过解析，不代表它能通过托管的 1 MiB 文件门槛。不要把 GLB 随意切成几个文件来规避限制；分块传输不改变完整文件大小限制。

## 3 工作目录与保密边界

输入与输出必须分离。原始资产目录只读；转换在私有暂存区进行；对外可交付内容由显式清单选择。下列目录名是本规范约定，不是平台自动扫描的目录。

```text
AssetMigration/
  raw-private/                 原始工程和原始资产 只读 不交付
  work-private/
    inventory.jsonl            原始资产清点与权限状态
    id-registry.json            稳定 ID 对照表
    dependencies.json           转换前依赖与缺失项
    conversion-log.jsonl        工具版本 参数 与导出记录
    quarantine/                不合规项及原因 不进入运行目录
    review-backups/             私人审阅备份 不公开
  staged-glb/                  已闭合且经过授权的 GLB 输入
  releases/
    2026-10-25-01/
      AssetsPlatform/          最终本地审阅工作区
  delivery-notes/              交付说明及私有验收证据
```

`AssetsPlatform/` 中允许可信平台提供的运行代码；`library/` 或其他资产根内只放数据，不携带项目自带的 JavaScript viewer、安装器或启动脚本。不得运行资产包内的 `.exe`、`.dll`、`.bat`、`.ps1`、`.sh`、宏、`package.json` scripts、Unity 编辑器扩展或游戏启动器。若转换确实需要另行运行受信工具，记录工具来源并遵守用户授权，不把该需求解释成执行原游戏的授权。

以下内容不得进入可交付工作区：凭据、令牌、Cookie、签名下载 URL、个人账户或伙伴名单、用户主目录路径、私有部署标识、原始游戏二进制、整个工程、无关参考项目、缓存、`.git`、`.env`、`node_modules` 和未审查脚本。模型内部的 `extras`、节点名称、材料名称、`asset.extras` 与导出器元数据也要检查。哈希、文件后缀和 CPU 解析不能代替隐私及许可检查。

**“可交付”不等于“公开许可”。** 权利仅限用户私人使用的资产，工作区继续保持私有。不得因导入完成而上传公开仓库、创建新共享受众或改动既有访问名单。

## 4 清点与来源证据

对每个源对象记录原项目稳定标识、资源类型、源定位、权限依据、依赖、转换结果及失败原因。Unity 资产优先使用项目内的 GUID 与 local file ID；提取数据可使用归档摘要、序列化文件标识及 Path ID。文件名只能作为定位辅助，不能单独证明两个对象相同。

私有清点行示例，字段属于整理台账，不是平台导入 schema：

```json
{"sourceKey":"sample-project:guid-001:mesh-1","sourceRelativePath":"Assets/Models/Cube.fbx","kind":"mesh","rights":"owner-authorized-private-use","decision":"convert","dependencies":[],"outputResourceId":"sample-project-res-cube","outputObjectId":"sample-project-obj-cube"}
```

不得把用户电脑绝对路径写进可分享 JSON。需要保留详细源路径时放在私有台账；可交付来源证据用脱敏相对路径、稳定源标识和内容摘要。对于未知许可，记录 `rights-unknown` 并隔离，不推定可发布。

平台可显示 `sourceId`、`originalName`、`provenance.sourceFile`、`provenance.pathId`、`provenance.sourceObjectSha256` 等来源字段。只有实际存在且核验过的信息才填；未知统计不填零，未知来源不编造 GUID。

**来源与模型供给必须分开：** `sourceUrl` 或 Drive 链接表示来源/下载证据；`modelUrl` 必须指向当前资产根内实际可读取的模型字节。链接有权限不代表模型已经下载、闭合或具备再分发权。浏览器审阅 JSON 导出也是索引，不是模型备份。

## 5 稳定身份和更新规则

### 5.1 身份层级

| 字段 | 表示什么 | 何时允许改变 |
|---|---|---|
| `projectId` 与描述的 `id` | 原项目或独立资产库身份 | 换成另一项目时，不随名称或目录位置变化 |
| `datasetId` | 审阅隔离的数据集身份 | 建立新快照或不兼容审阅边界时 |
| 物件 `id` | 完整物件的逻辑身份 | 原对象被替换成语义不同对象时 |
| 资源 `id` | 技术资源的逻辑身份 | 资源身份改变时，不因显示名修改而改变 |
| `sourceId` | 可追溯的源对象身份 | 源身份确实改变时 |
| 目录 `version` | 本次目录内容版本 | 每次被接受的目录内容更新 |
| 文件 SHA-256 | 此文件的精确字节身份 | 任意字节改变就重新计算 |

项目 ID 建议为小写 ASCII 短名，新增 CLI 强制 `^[a-z][a-z0-9-]{0,63}$`。资源和物件使用不同前缀，例如 `sample-project-res-cube` 与 `sample-project-obj-cube`。同一目录的所有物件、资源及补充资源 ID 不得重号；不得使用 `__proto__`、`prototype`、`constructor`。

使用 `id-registry.json` 持久保存“源身份 → 平台 ID”。禁止每次随机生成 ID，禁止以当前数组序号作 ID，禁止仅因翻译显示名、移动输出目录或重新压缩模型而换成另一个逻辑对象。跨项目建议也保持唯一前缀，避免手工合并时冲突。

### 5.2 两种数据集策略不能混用

**候选 CLI 的快照策略是默认安全路线。** 物件/资源 ID 由源 GLB 相对路径的 SHA-256 派生，使用不同前缀。相同项目 ID、相对路径和字节重复导入，得到相同数据集与对象身份；显示 label 改变不影响身份。相对路径移动会改变资源/物件 ID。任一模型内容或路径增删改变，会生成新的内容摘要型 `datasetId` 和存储键；这刻意阻止旧审阅结论自动套到新模型上。它没有 ID 重命名映射或跨快照审阅迁移功能。

**人工维护的长期数据集策略是可选高级路线。** 使用固定 `datasetId`，通过私有 ID 台账维护逻辑对象身份，并递增目录 `version`。仅修改显示信息且对象未变时保留所有 ID。模型、材料、依赖或语义发生变化时，须先导出审阅备份，列出受影响 ID，重新审阅这些条目。当前平台不按每条模型哈希自动标记“旧结论失效”；不能验证结论有效性或无法可靠重置时，创建新 `datasetId` 和新存储键。不要把它称为已实现的自动增量迁移。

描述中的 `reviewKey`、`renderPreferenceKey`，以及存在时的 `selectionStorageKey`，必须在所有登记项目间唯一。新数据集需新审阅键。保持同样的文件夹名称不足以保持浏览器记录；浏览器来源、端口和配置键也参与隔离。

## 6 模型和依赖整理

### 6.1 格式转换规则

| 输入资源 | 默认交付形式 | 必须保留的限制说明 |
|---|---|---|
| GLB 2.0 | 通过解析的自包含 GLB | 不是完整 glTF 扩展实现 |
| 外置 glTF 与 bin/图片 | 经受信工具导出成单个自包含 GLB | 所有依赖闭合后才可预览 |
| FBX OBJ Blend 等源模型 | 原件留私有区，导出 GLB | 原导出器、单位、坐标和材质转换记录 |
| Unity prefab 或组合对象 | 将获授权的静态层级导成组合 GLB | 不自动恢复脚本、物理、IK 和游戏逻辑 |
| 材质 Shader 动画音频等 | 来源/依赖元数据；有支持的派生预览才加路径 | 收录不等于独立播放器或原引擎效果 |
| 缺失依赖或未知专有格式 | 隔离，或明确无预览的元数据条目 | 不造模型，不造完成状态 |

导出时统一记录长度单位、朝向、坐标变换、枢轴、层级和缩放处理。优先以米与 glTF 约定输出；不要为“摆正预览”偷偷改源物件含义。镜像、负缩放、法线、UV、材质槽和组合位姿都应列入视觉检查。

必须保留模型 BIN 内容；图片必须内嵌 `bufferView` 或采用渲染器支持的 PNG/JPEG base64 data URI。外部 buffer URI 不接受；外部贴图不下载。不要只把 `.gltf` 改名为 `.glb`，也不要只改文件后缀声称转换成功。

### 6.2 本地渲染的真实边界

- 仅 GLB 2.0 子集；支持三角形、三角带、三角扇、节点变换及部分材质通道。点/线拓扑不可当作已预览成功。
- 必需扩展只接受 `KHR_materials_unlit` 和 `KHR_materials_emissive_strength`；Draco、meshopt 及其他未知必需扩展拒绝。未知可选语义可能只给警告，仍需人工核查。
- 只使用 UV0；法线贴图没有应用。源材质模式不等于 Unity 原 Shader、场景灯光、后处理或所有 PBR 通道准确复原。
- morph 仅可显示基础几何，不支持其动画恢复；骨骼解析能力不代表运行时 IK、物理、事件或脚本。
- 新项目默认 `verifiedAnimation: false`。GLB 中有 animation 数组、动画引用或播放按钮代码，不构成“可播放动画”验收。

要启用专门动画路线，必须另有实际侧车数据与证据：记录 `status: "ready"`、真实模型和数据路径、`skinBindingVerified`、`sourceCurvesVerified`、`pixelVerified`，且所有 `playableClipIds` 在 `verifiedPlayableClipIds` 内；记录还须匹配物件 `id/sourceId`。这些布尔字段是证据声明，**不得为了出现按钮手工改成 true**。本规范最小示例不启用动画，也不提供伪动画示例。

### 6.3 依赖闭合

完整物件可以使用 `assetId` 关联主资源，或用 `assetIds` 等关联多个已存在资源；组合模型可用 `assemblyModelUrl`，它优先于普通 `modelUrl`。不得让关联指向未登记 ID。不能可靠恢复组合时，保留真实的单模型物件并明确“一模型一物件”，不要猜测原 prefab 层级。

完成以下闭合检查：所有目录 JSON 存在；所有模型、图片、证据及元数据引用都在本项目授权根内；GLB 内所有 buffer/image 依赖满足自包含限制；所有关联资源 ID 存在；文件实际类型、字节数、哈希与台账一致。删除原始目录或断开原工程访问后，输出仍须独立读取。这里的“独立”不等于脱离浏览器 HTTP 或不需要 WebGL。

## 7 最小可运行工作区

目录结构如下。平台运行文件来自可信 AssetsPlatform 发布或候选工具，不从资产包获取。`models/cube.glb` 只用于可信平台源码自带立方体的接入示例，真实项目必须替换成真实模型并更新全部引用。

```text
AssetsPlatform/
  index.html
  app.mjs
  viewer.mjs
  style.css
  player-layout.css
  project-panels.css
  server.mjs
  serve.py
  shared/                      可信平台模块
  adapters/                    可信 indexed 适配器
  validate-workspace.mjs        新增候选校验工具
  LICENSE
  THIRD_PARTY_NOTICES.md
  project-directory.json
  package-manifest.json         本规范的交付台账 平台不自动读取
  checksums.sha256
  library/
    project-config.json
    assets/
      catalog.json
      objects-catalog.json
      render-profiles.json
      canopy-rules.json
      preview-pending.svg        平台自带占位图 不是资产验收截图
      models/
        cube.glb
```

下面六个 JSON 文件是完整示例，不含省略号。它们描述一个自制立方体，字段与当前 indexed 加载器相符。示例 ID、名称和证据声明必须按目标项目改写；`renderer.kind: "three"` 是当前配置约定，不表示独立 viewer 使用完整 Three.js GLTFLoader。

### 7.1 根目录登记

文件 `AssetsPlatform/project-directory.json`：

```json
{
  "schema": "asset-review-project-directory/1",
  "defaultProject": "sample-project",
  "projects": [
    {
      "id": "sample-project",
      "label": "自制立方体示例",
      "config": "library/project-config.json",
      "assetRoot": "./"
    }
  ]
}
```

登记的 `assetRoot` 相对配置文件解析；描述中的 `assetRoot` 必须得到同一根。项目 ID 必须与配置相同。多项目时追加登记项，每项独立根和存储键，不让资源跨项目共用路径来绕过隔离。

### 7.2 项目描述

文件 `AssetsPlatform/library/project-config.json`：

```json
{
  "id": "sample-project",
  "datasetId": "sample-library-v1",
  "assetRoot": "./",
  "dataKind": "indexed",
  "renderer": {
    "kind": "three",
    "module": "viewer.mjs",
    "compare": true
  },
  "config": {
    "slug": "sample-project",
    "label": "自制立方体示例",
    "reviewKey": "sample-project:sample-library-v1:reviews",
    "renderPreferenceKey": "sample-project:sample-library-v1:profile",
    "importFormat": "asset-review-sample-project",
    "exportPrefix": "SampleProject",
    "defaultProfile": "material",
    "compareProfile": "toon",
    "verifiedAnimation": false,
    "importLimitMiB": 25,
    "sharedSelections": false,
    "capabilities": {
      "animationFilters": false,
      "research": false,
      "effects": false,
      "weaponSpotlight": false,
      "sourceEvidenceOnlyProfiles": false
    },
    "auditSections": [
      {
        "title": "自制示例",
        "text": "仅用于接入验证的立方体，不是游戏素材。动画未启用；GPU 外观未验证。"
      }
    ]
  },
  "typeLabels": {
    "mesh": "模型",
    "object": "物件"
  },
  "categoryLabels": {
    "demo": "示例"
  },
  "defaultProfiles": [
    {
      "id": "material",
      "label": "源材质",
      "mode": "material",
      "implemented": true,
      "description": "使用当前渲染器支持的 GLB 颜色和贴图。",
      "parameters": {}
    }
  ]
}
```

`importFormat` 是审阅备份格式标签，不是模型格式。不要在后续修订随意改变它。`renderer.module` 是兼容字段，资产包无权选择执行陌生模块；当前独立入口使用可信平台自己的 viewer。

### 7.3 技术资源目录

文件 `AssetsPlatform/library/assets/catalog.json`：

```json
{
  "version": "2026-10-25.1",
  "assets": [
    {
      "id": "sample-project-res-cube",
      "sourceId": "sample-project-source-cube-mesh",
      "name": "自制立方体模型",
      "type": "mesh",
      "category": "demo",
      "modelUrl": "assets/models/cube.glb",
      "provenance": {
        "sourceFile": "self-authored/cube",
        "label": "平台自制示例，不含商业游戏资产"
      }
    }
  ]
}
```

### 7.4 完整物件目录

文件 `AssetsPlatform/library/assets/objects-catalog.json`：

```json
{
  "version": "2026-10-25.1",
  "objects": [
    {
      "id": "sample-project-obj-cube",
      "sourceId": "sample-project-source-cube-object",
      "name": "自制立方体",
      "category": "demo",
      "modelUrl": "assets/models/cube.glb",
      "assetId": "sample-project-res-cube",
      "assemblyStatus": "自制静态示例",
      "description": "用于检查目录与审阅流程，不代表原游戏外观。"
    }
  ]
}
```

### 7.5 材质规则与渲染说明

文件 `AssetsPlatform/library/assets/canopy-rules.json`：

```json
{
  "version": 1,
  "flatCanopySourceMaterialIds": []
}
```

文件 `AssetsPlatform/library/assets/render-profiles.json`：

```json
{
  "profiles": []
}
```

这两个文件当前可缺省，但规范要求显式提供，避免不同打包器出现不同回退。不要把某个现有游戏的特殊树冠规则复制到新项目；说明文字也不能创造未实现的渲染算法。

### 7.6 本规范附加交付台账

`package-manifest.json` 是本规范定义的治理文件，平台不会自动读取它，也不是托管上传 manifest。记录示例：

```json
{
  "schema": "assets-platform-package/1",
  "projectId": "sample-project",
  "datasetId": "sample-library-v1",
  "releaseId": "2026-10-25-01",
  "profile": "local-indexed-static",
  "catalogVersion": "2026-10-25.1",
  "checksumFile": "checksums.sha256",
  "rights": "self-authored-demo",
  "verification": {
    "structure": "passed",
    "cpuModels": "passed",
    "gpuVisual": "not-verified",
    "animation": "not-enabled"
  },
  "knownLimits": [
    "No original Unity shader equivalence",
    "Review state is browser-local"
  ]
}
```

实际项目只有完成对应检查后才可写 `passed`。来源、转换工具、参数、遗漏项和验证日志可另附私有记录，不用把所有原始台账放到本机静态服务根下。

## 8 路径和 URI 规则

所有新资产路径采用相对于项目 `assetRoot` 的正向斜线，如 `assets/models/rock.glb`。建议可交付文件名仅使用 ASCII 字母、数字、短横线、下划线和点；显示中文放在 `name/label`。不要写 Windows 盘符、反斜线、绝对用户路径或临时下载路径。

当前解析器拒绝 `..` 遍历、编码路径分隔符、跨登记项目路径、未知协议、凭据和本地资源查询参数；模型、配置和目录请求禁止重定向。不要依赖 `%2f`、多次 URL 编码、符号链接或 `file:` URL。为可搬迁性，新整理数据不使用绝对 HTTP 地址或逻辑 `/assets/` 兼容映射。

来源与下载链接若确需外部 HTTPS 地址，先在项目描述 `externalOrigins` 登记精确 origin，例如 `https://example.org`，仅将它用于 `sourceUrl`、`licenseUrl` 或已支持的下载链接；不能用它允许外部 `modelUrl` 请求。未知或带签名凭据的链接不进入工作区。仅登记 origin 不会授予服务端账户权限。

字段名以 `Url/URL/Uri/URI` 结尾通常会被资源解析器处理。不要把原始 Windows 路径塞进这类字段；来源字符串使用明确的 `sourceFile` 或私有台账字段。保留的 URL 字段必须实际可解析，不写空字符串；无值时省略或使用允许的 `null`。

大目录可使用 `catalog.json.assetShards`，每个分片必须是资源记录数组，路径也经过资源解析器。规范默认先用单个 `assets` 数组；只有确需分片时才引入，并按稳定顺序生成。`assetShards` 会替代内联资源读取，不要期待两者自动合并。

## 9 可执行整理流程

### 9.1 输入检查与转换

1. 确认用户明确指定的原项目、可读目录、使用权限、输出目录与目标运行范围。不扫描无关磁盘或云目录。
2. 创建独立私有工作区，原件保持只读。建立清点台账、ID 台账和依赖表，记录无法处理的格式及授权缺口。
3. 在受信工具中转换已获授权的模型，闭合贴图与 buffer，记录转换器版本、设置、坐标及材质降级。未取得所需工具或权限时报告具体阻塞，不执行包内脚本代替。
4. 把合格 GLB 放入 `staged-glb/`；固定相对路径。私有台账、备份和隔离文件不放入这里。
5. 检查每个 GLB 的来源、隐私、依赖、尺寸与格式。任何未知限制写入交付说明。

### 9.2 候选 CLI 路线

先在可信 AssetsPlatform 源码根确认以下文件存在：`scripts/import-directory.mjs`、`apps/reviewer/validate-workspace.mjs`。该路线是新增候选能力，不修改原仓库目录登记、不修改公开构建白名单、不上传数据。

在仓库根执行，按实际位置替换绝对路径。输出父目录必须已存在，输出目录必须尚不存在，输出不能位于源文件夹或平台仓库内，也不能包含源文件夹。

```sh
npm run import:directory -- \
  --source /absolute/AssetMigration/staged-glb \
  --output /absolute/AssetMigration/releases/2026-10-25-01/AssetsPlatform \
  --id my-project \
  --label "我的项目"
```

Windows 使用带引号的绝对路径，按所在 shell 的续行规则执行；也可把上面命令写成一行。需要 Node.js 18 或更新版本，不需要运行 `npm install`。

CLI 递归接收可见 `.glb`，忽略隐藏条目及其他文件，拒绝可见符号链接。每批最多 512 个模型、10,000 个枚举目录条目、32 层子目录，累计模型字节最多 256 MiB；单模型不超过 64 MiB。任何模型失败则整批失败，不将部分成功伪装成完成。已有输出不覆盖；中断残留须核查后换新路径或经授权清理。

输出提供完整静态运行代码、一个 `library/`、自动目录与 `import-report.json`。CLI 是一模型一物件，不推断组合关系；它不复制源文件夹内的证据、原工程、音频或其他格式。报告含相对源名、摘要、CPU 统计及警告，不记录源绝对路径；相对名称和模型元数据仍可能敏感。

### 9.3 手工整理路线

先取得完整可信平台源码包，确认它包含 `apps/reviewer/index.html`、`shared/`、`adapters/`、`viewer.mjs` 和服务器。若只有 README 或缺运行文件，停止此路线并向平台维护者索取完整已审查源码包；本文不声称仅凭目录 JSON 就能重新实现平台。

以下 Bash 命令从已取得的源码中只复制必要运行文件，且拒绝覆盖已有输出。先将 `PLATFORM` 和 `OUT` 替换为实际绝对路径；输出父目录须已存在，并确认输出与原件、源码无包含关系。

```sh
set -eu
PLATFORM=/absolute/path/to/trusted/AssetsPlatform
OUT=/absolute/AssetMigration/releases/2026-10-25-01/AssetsPlatform
APP="$PLATFORM/apps/reviewer"
test -d "$APP/shared"
test ! -e "$OUT"
mkdir "$OUT"
for f in index.html app.mjs viewer.mjs style.css \
  player-layout.css project-panels.css server.mjs serve.py \
  LICENSE THIRD_PARTY_NOTICES.md; do
  cp "$APP/$f" "$OUT/$f"
done
cp -R "$APP/shared" "$OUT/shared"
cp -R "$APP/adapters" "$OUT/adapters"
mkdir -p "$OUT/library/assets/models"
cp "$APP/demo-a/assets/preview-pending.svg" \
  "$OUT/library/assets/preview-pending.svg"
```

按第 7 节把六个 JSON 完整保存到各自标注的路径。仅做本文示例的烟雾检查时，可复制平台自制立方体：

```sh
cp "$APP/demo-a/assets/cube.glb" "$OUT/library/assets/models/cube.glb"
```

真实项目必须删除示例条目，改写身份、名称、来源和模型路径，再放入真实 GLB；不得保留立方体却声称项目迁移完成。将第 17 节脚本保存为输出根的 `validate-workspace.mjs`。不要把整个源码仓库或原工程当作工作区交付。

这是维护者整理数据的路线，不是网页拖入任意 Unity `Assets/` 后自动转换。可加入已核验的组合物件、材料或其他元数据条目；没有预览的条目必须不提供虚假 `modelUrl`。每次改动后运行通用校验，并检查对象与资源的关联完整性。

冻结源码的 `apps/reviewer/verify.mjs` 对登记目录硬读 `assets/cube.glb`，只适用于随包样例，不是任意项目校验器。不要为通过该测试把真实模型冒名为立方体。根 `npm run build` 同样仅按白名单构建自制样例，不会自动打包新增私有目录；不能用它代替资产工作区交付。

## 10 验证命令和验收顺序

### 10.1 自动检查

在包含新增候选工具的可信源码根运行回归：

```sh
node --test tests/import-directory.test.mjs
npm test
```

这些是程序回归，不代表目标模型或 GPU 已验收。在生成的工作区根运行：

```sh
node validate-workspace.mjs
```

候选工具或第 17 节脚本以当前登记目录及模型为对象，不依赖名为 `cube.glb` 的特例。结果只证明登记 indexed 目录及 `modelUrl/assemblyModelUrl/materialModelUrl` 的 CPU 解析；不自动核查任意证据附件、全部关联 ID、外部来源可访问性、隐私或许可，必须补做对应闭合与人工检查。错误必须修复后重跑，不能删校验条件。

启动工作区：

```sh
node server.mjs
```

浏览器访问 `http://127.0.0.1:8768/`。备用命令为 `python3 serve.py`，需要 Python 3。不要双击 HTML 使用 `file:`；不要将本机开发服务器改成公网监听并声称已配置身份保护。

### 10.2 文件摘要

在内容已经定稿的工作区根，使用 Bash 与 GNU 工具生成 SHA-256 清单；路径来自前述无换行的安全文件命名约定：

```sh
find . -type f ! -name checksums.sha256 -print0 \
  | LC_ALL=C sort -z \
  | xargs -0 sha256sum > checksums.sha256
sha256sum -c checksums.sha256
```

清单刻意不对自身求哈希。生成后不再修改任何被列出的文件；如有修改，重新生成并复核。收件方解包后再次执行 `sha256sum -c checksums.sha256`。Windows 若没有这些工具，使用受信 SHA-256 工具逐项计算与清单比对，不把不同算法的摘要当作 SHA-256。压缩包最终摘要记录在包外的交付说明中。

### 10.3 真实浏览器检查

至少检查一个最小模型和每类有差异的模型；所有自动告警项必须逐项处理。记录浏览器、设备、WebGL 可用性及具体检查范围：

- 项目登记、目录切换、搜索、筛选、完整物件与技术资源关系。
- 模型旋转、缩放、相机重置；单位、轴向、组合位姿、UV、透明、材质与法线差异。
- 每类预览失败有真实错误，不回退旧图假装成功；未预览资源显示未知状态。
- 选择、备注和审阅状态保存，刷新后恢复；关闭详情和快速切换不混入上一物件。
- 同目录 v2 审阅备份可导入；不同目录/数据集备份拒绝；导入前备份当前状态。
- 在副本或迁移目标运行完整工作区，原工程不可用时模型仍能读到。

没有 WebGL 或浏览器工具不可用时，记录“CPU/目录检查通过，GPU 与真实交互未验证”，保留待验列表。图片存在、代码中有按钮或 CPU parser 通过，都不能替代这一步。

## 11 预算与超过限制的处理

本地 viewer 的单模型硬限制来自 `apps/reviewer/viewer.mjs` 的 `PREVIEW_LIMITS`：

| 项目 | 最大值 |
|---|---:|
| GLB 下载 | 64 MiB |
| GLB JSON chunk | 8 MiB |
| accessor 数值总量 | 8 × 1024 × 1024 |
| 节点 与层级深度 | 4096 与 128 |
| 材质 图片 primitive | 2048 张材质 128 张图片 4096 个 primitive |
| 实例顶点 与展开索引 | 1,000,000 与 3,000,000 |
| 图片编码合计 | 32 MiB |
| 图片像素合计 | 32 × 1024 × 1024 |
| 图片单边 | 8192 像素 |

目录 JSON 默认每次原始下载 64 MiB、解码 128 MiB，会话累计分别 512 MiB。项目描述单个 2 MiB、累计 16 MiB；项目最多 128；资源分片默认最多 256、并发 4，硬上限分别 1024 和 8。这些是输入预算，不保证所有浏览器总内存或帧率安全；设备纹理尺寸限制还可能更低。

托管入口另有硬限制：单文件 1 MiB、单清单最多 2048 文件、声明总量 256 MiB、清单 512 KiB、传输块 32 KiB、JSON 文件最多 8、MCP 请求 768 KiB、动态数据集目录最多 128。托管只接受其受限 GLB/PNG/JSON，不能把本地 validator 结果当作托管 ready 收据。

超限时优先减少无用节点、独立导出合理物件、降低派生预览贴图或生成明确标注的预览 LOD；原件留私有区，记录变更和信息损失。不要悄悄增大硬上限、丢依赖或降低质量后仍标为原模型。

## 12 增量更新 审阅迁移和回滚

每次交付建立新的 release 目录，保留上一份工作区与摘要清单。先比对源台账、输出文件哈希与目录版本；列出新增、修改、删除和未变项。内容不变的资源可以复用已验证字节，但每个最终工作区仍必须闭合。

**重复导入和幂等性：** 同一输入在 CLI 下重建到不同的新路径，身份与模型字节应一致；不要求整个 ZIP 字节一致，因为压缩时间戳可不同。CLI 不覆盖已存在目录，不能将“第二次拒绝覆盖”误报成导入损坏。若输入内容改变但相对路径未变，资源/物件 ID 保持，数据集 ID 按快照策略改变。路径改名导致 ID 改变必须记录，不冒称已追踪重命名。

**本地审阅迁移：** 先在旧工作区使用“导出目录”备份全部审阅；“导出审阅 JSON”只含所选条目，不是全部备份。新 v2 备份绑定 `format/projectId/datasetId`，只接收当前已知 ID；同 ID 审阅被导入值覆盖，选择集合取并集。备注最多保留 10,000 字符，默认导入上限 25 MiB。CSV 不能恢复审阅，JSON 不含模型字节。

旧 v1 需要用户明确确认所属项目后迁移；取消不得修改状态。显式声明了错误身份的旧文件不能靠确认绕过。不要手改备份中的 `projectId/datasetId` 强行导入，也不要修改导出版本伪装成兼容。不同快照间需要迁移时，交付 ID/内容差异清单，保留旧备份，请用户决定重审；当前工具不提供安全的跨身份自动合并。

**回滚：** 本地只切换回上一份已验证工作区和对应浏览器审阅备份，不覆盖原始资产。相同来源和端口下还须核对存储键，不能假定回滚目录自动回滚浏览器状态。托管使用基线约束及活动版本切换，当前没有通用回滚/删除工具；不得承诺重复旧 manifest 就能回滚。涉及托管修改须走单独授权与后端验证流程。

## 13 错误 隔离和终止条件

每个失败记录应包含 `sourceKey`、相对输入路径、阶段、错误原文、是否可修复、采取的措施和下次需要的动作。建议错误分类如下，分类属于本规范台账，不是平台现成错误码。

| 分类 | 处理 |
|---|---|
| 权利或隐私未知 | 放入私有隔离区，等待授权或脱敏证据 |
| 路径越界或符号链接 | 修正输入结构，不解除路径保护 |
| 缺失贴图 buffer 或关联资源 | 补齐授权依赖并重新导出，不允许假闭合 |
| 不支持格式或扩展 | 用受信工具转换或保留无预览元数据 |
| 模型预算超限 | 生成明确降级的派生预览，记录差异 |
| JSON 结构 ID 或存储键冲突 | 修正生成器/台账，再全量校验 |
| 浏览器或 GPU 不可用 | 保留待验证项，不能宣布视觉通过 |
| 输出已存在或中断残留 | 不覆盖；核查并使用新的版本目录 |

CLI 任一模型失败会整批停止。若用户允许部分资产交付，可以从暂存输入中移出已记录的失败项后重新创建新输出，但必须报告原输入总数、成功数、隔离数及完整失败清单；不得把失败项静默丢失。终止条件是合格工作区交付，或遇到明确需要用户信息/授权的阻塞；不要无限重试同一失败，也不要改安全边界绕过拒绝。

## 14 交付验收清单

- [ ] 输入范围与权利已确认，原件未改；没有执行游戏、包内脚本或未经授权工具。
- [ ] 工作区独立可运行；私有原件、台账和审阅备份不在静态服务根内。
- [ ] 根登记、项目描述、目录和模型真实存在；最小示例 JSON 已替换为目标项目事实。
- [ ] project/dataset/物件/资源身份策略清楚，存储键无冲突，源身份对照可追溯。
- [ ] 所有资源关联、模型和外部依赖闭合；来源链接与模型字节分开。
- [ ] 资源类型、材料降级、动画状态、坐标与预算限制写明；无伪造验证标记。
- [ ] 通用校验及必要回归通过，目标模型 CPU 解析结果和告警已记录。
- [ ] 隐私、元数据与许可证人工检查完成，未新增共享受众或公开发布。
- [ ] SHA-256 清单复核通过；新版本和上一版本可区分，回退材料保留。
- [ ] 重复输入身份稳定性检查完成；变化项和重命名影响有差异清单。
- [ ] 审阅备份和恢复按同身份规则验证；旧 v1 未经确认不迁移。
- [ ] 浏览器/GPU/视觉/交互项有真实结果；未验证项、隔离项和阻塞如实列出。

交付报告必须列明：项目与数据集 ID、release ID、对象/资源/模型数量、总字节、摘要清单位置、启动命令、验证范围、已知限制、隔离清单、是否具备公开许可。不要只给“迁移成功”。

## 15 可直接复制给另一个 Agent 的任务

```text
请按随附 AssetsPlatform 资产整理与接入规范执行一次新项目迁移。

输入项目：填写稳定项目名称和已有 projectId 如有
授权读取范围：填写明确的本地目录或已授权资源集合
可信完整平台源码包：填写位置与版本
输出父目录：填写已存在且不在输入或源码内的位置
目标 profile：local-indexed-static
身份策略：默认 CLI 内容快照；改用长期数据集须说明理由
资产权限：填写私人使用或明确再分发依据

要求：
1. 原始目录只读；不执行原游戏、包内脚本或编辑器扩展。
2. 先建立私有清点、ID、依赖和转换台账，列出权限/格式缺口。
3. 用受信工具产出自包含 GLB，明确材质、动画和坐标降级。
4. 有候选 CLI 时按规范导入；没有时从可信完整源码包按规范手工整理。
5. 交付完整可运行 AssetsPlatform 工作区，不只给索引或模型链接。
6. 来源证据与 modelUrl 分开；物件/资源 ID 不冲突，依赖全闭合。
7. 执行实际存在的校验命令、SHA-256 复核和可用浏览器检查。
8. 新建版本目录，不覆盖原件或旧交付；先备份再迁移审阅。
9. 不改 projectId/datasetId 绕过身份校验，不伪造动画或 GPU 验证。
10. 不上传、不公开、不改共享名单；托管接入不是本任务的默认授权。
11. 对失败项隔离并报告，不能静默丢失或用占位模型冒充。
12. 返回工作区路径、启动命令、ID、计数、摘要及验证/未验证清单。

如被阻塞，写明具体动作、目标、原因、已完成范围与所需输入；
继续不依赖该阻塞的安全工作，不请求解除系统安全限制。
```

## 16 实现依据与检查定位

无需原聊天即可使用本文。下列仓库文件用于复核实际代码行为；发行版升级时应优先复查这些定义，而不是沿用本文旧数值。

- `apps/reviewer/shared/project-loader.mjs`：根目录登记、描述加载、indexed 限制与授权根建立。
- `apps/reviewer/shared/project-schema.mjs`：描述、稳定 ID、目录结构与存储键冲突检查。
- `apps/reviewer/shared/resource-url.mjs`：路径解析、项目隔离、外部来源 origin 与 URL 字段转换。
- `apps/reviewer/adapters/indexed-data.mjs`：四类目录文件、分片和可选动画目录读取。
- `apps/reviewer/viewer.mjs`：GLB 解析、`PREVIEW_LIMITS`、必需扩展及材质能力边界。
- `apps/reviewer/shared/animation-contract.mjs`：动画证据门槛，不是自动验收器。
- `apps/reviewer/shared/workbench.mjs` 与 `review-import.mjs`：审阅身份校验、合并、旧版确认及备注长度。
- `scripts/import-directory.mjs` 与 `docs/LOCAL-DIRECTORY-IMPORT.md`：新增候选 CLI 输入、失败与快照身份规则。
- `apps/reviewer/validate-workspace.mjs`：新增候选输出校验；检查范围以命令报告为准。
- `scripts/build-public.mjs` 与 `scripts/public-build-inputs.json`：公开构建仅复制明确白名单，不打包私有项目。
- `reference/hosted/incremental-candidate/` 与 `reference/hosted/lib/asset-pilot-mcp.mjs`：托管参考契约、分块及版本切换；不是本地运行依赖。

本文只交付 Markdown。自制立方体可从可信平台源码的 `apps/reviewer/demo-a/assets/cube.glb` 取得；它用于验证最小契约，不含商业游戏资产，也不能作为其他项目的来源、外观或许可证明。


## 17 不依赖新增 CLI 的本地校验脚本

将下面完整代码保存为手工工作区根的 `validate-workspace.mjs`，再执行 `node validate-workspace.mjs`。这是本文随附源代码，不依赖远端仓库已经发布新增 CLI；它只读取工作区数据，调用已复制的可信平台 loader 与 CPU parser，不启动服务器、不下载、不上传、不修改资产。

该脚本用于小型到中型接入包，采用额外保守的 JSON 预算：单文件 16 MiB，整次校验读取合计 64 MiB，反复读取也计入。它不是第 11 节浏览器预算的重新定义。超过脚本预算时应分批/缩小工作区或让维护者审查专门验证流程，不能据此宣称浏览器本身拒绝所有此类目录。

它不执行 GPU，也不替代附加证据、关联 ID、许可、隐私或人工视觉检查。运行前保持目录不被并发修改，拒绝符号链接并不构成对恶意并发修改的完整沙箱。

```js
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProject,loadProjectData} from './shared/project-loader.mjs';
import {parseGLB,PREVIEW_LIMITS} from './viewer.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const base='http://workspace.invalid/';
function read(url,limit) {
 const u=new URL(url,base);
 if(u.origin!==new URL(base).origin || u.search || u.hash) throw Error('Nonlocal workspace URL: '+url);
 const relative=decodeURIComponent(u.pathname).slice(1);
 if(relative.split('/').some(p=>!p||p==='..'||p.startsWith('.'))) throw Error('Unsafe workspace path');
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep))throw Error('Workspace path escapes root');
 let current=root;for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Workspace symlink refused');}
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error('Workspace file budget exceeded: '+relative);
 return fs.readFileSync(file);
}
let totalJSON=0;
const fetchJSON=async url=>{const bytes=read(url,16*1024*1024);totalJSON+=bytes.length;if(totalJSON>64*1024*1024)throw Error('Aggregate workspace JSON budget exceeded');return JSON.parse(bytes.toString('utf8'));};
try {
 const directory=await fetchJSON(base+'project-directory.json');
 const results=[];
 for(const entry of directory.projects||[]) {
  const project=await loadProject({fetchJSON,location:{href:base,search:'?project='+encodeURIComponent(entry.id)}});
  const data=await loadProjectData(project,fetchJSON), objects=data.objectCatalog.objects ?? data.objectCatalog.assets, items=[...data.catalog.assets,...objects];
  const modelURLs=new Set(items.flatMap(item=>[item.modelUrl,item.assemblyModelUrl,item.materialModelUrl].filter(Boolean)).map(url=>project.config.resourceResolver.resolve(url)));
  const models=[];
  for(const url of modelURLs){const g=parseGLB(read(url,PREVIEW_LIMITS.downloadBytes));models.push({path:new URL(url).pathname,vertexCount:g.vertices,triangleCount:g.triangles,warnings:g.warnings});}
  results.push({projectId:entry.id,datasetId:project.config.datasetId,resources:data.catalog.assets.length,objects:objects.length,models});
 }
 if(!results.length)throw Error('No projects registered');
 console.log(JSON.stringify({passed:true,scope:'registered indexed catalogs and referenced GLB CPU parsing',gpu:'not-verified',projects:results},null,2));
} catch(error){console.error('Workspace validation failed: '+error.message);process.exitCode=1;}
```
