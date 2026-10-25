# 数据接入契约

本文描述当前独立索引式前端实际读取的文件，同时说明当前校验与格式限制。路径相对 `apps/reviewer/`；现有可运行示例 `demo-a/` 是完整最小模板。

## 目录登记与身份

根 `project-directory.json` 包含 schema、defaultProject 与 projects。每个项目至少有唯一 id、label、config、assetRoot。config 为同源配置路径；assetRoot 相对配置文件解析，不能跨入其他已登记项目的资源根。

```json
{
  "schema": "asset-review-project-directory/1",
  "defaultProject": "demo-a",
  "projects": [
    {"id":"demo-a","label":"示例目录 A","config":"demo-a/project-config.json","assetRoot":"./"}
  ]
}
```

项目描述 `project-config.json` 的 id 必须与登记值相同，datasetId 标记数据集，dataKind 使用 indexed。config 下配置 slug、label、reviewKey、renderPreferenceKey、importFormat、exportPrefix、defaultProfile、compareProfile、importLimitMiB、sharedSelections 和 capability flags。请复制示例完整结构，而不是只复制上述字段片段。

每个目录的 reviewKey 与 renderPreferenceKey 必须不同，物件/资源 ID 应全目录稳定且唯一。加载器会拒绝键碰撞、重复/冲突物件资源 ID，以及补充数据中的保留 ID；修正数据后再重新加载。

## 目录文件结构

```text
my-project/
  project-config.json
  assets/
    catalog.json
    objects-catalog.json
    canopy-rules.json
    render-profiles.json
    models/example.glb
```

- `catalog.json`：version 与 assets 数组；资源字段包括 id、name、type、category、modelUrl。也可使用 assetShards，但当前是并行读取，不适合无限大分片集合。
- `objects-catalog.json`：version 与 objects 数组；物件字段包括 id、name、category、modelUrl、assetId、description。assetId 可指向技术资源。稳定 ID 不随显示名变化。
- `canopy-rules.json`：当前加载器允许缺省并采用空规则；建议显式提供空配置：

```json
{"version":1,"flatCanopySourceMaterialIds":[]}
```

- `render-profiles.json`：渲染说明；代码对这一读取允许缺省，但完整模板仍应提供。实际通用参数定义在 `shared/common-render-profiles.mjs`。说明文本不能自动创造不存在的渲染算法。

modelUrl 相对项目资源根，例如 `assets/models/example.glb`。资源 URL 必须经过解析器，不以展示来源链接代替实际可读取模型 URL。来源链接不自动赋予读取/分发权限。

## 模型和能力

独立示例读取自包含 GLB：buffer 内嵌，图片使用支持的内嵌形式，不依赖外部贴图路径。它不是完整 glTF 2.0 扩展实现；未知 required extension 被明确拒绝，当前只接受实现完整的 unlit 与 emissive-strength 必需扩展。具体骨骼、morph、动画和材质限制见产品手册。增加按钮或 capability flag 不能使不支持的数据变为可播放。

目录不得携带要执行的 viewer JavaScript。运行代码由平台提供并审阅，不信任资产包提供的模块路径。

## 审阅与备份 v2

review 记录形态：

```json
{"status":"check","comment":"检查材质边缘","updatedAt":"2026-10-25T00:00:00.000Z"}
```

状态为 pending、keep、check、skip。导出以 format、version:2、projectId、datasetId、reviews 和 selected 等字段组织，精简 assets 索引不包含模型字节。导入仅接收当前已知 ID，备注最大保留 10000 字符，文件默认上限 25 MiB。默认合并导入中，相同 ID 的导入记录覆盖当前记录，选择取并集。

v2 强制核对 projectId/datasetId，拒绝不匹配。旧 v1 必须明确确认迁移；取消不会修改状态，明确声明的不匹配身份不能绕过。

精确替换入口另要求 `version: 2`、`scope: full-catalogue`，且 `selected` 必须为无重复的已知字符串 ID 数组。`reviews` 的键必须是安全的已知 ID；每条仅接受 `status`、可选字符串 `comment`（最多 10,000 字符）、可选字符串或 null `updatedAt`。未知 ID、额外记录字段或不合规值整份拒绝；不沿用合并导入的静默清洗。合法空记录/选择可在明确确认后清空当前状态。

该入口仅在 `sharedSelections === false` 且无 `selectionStorageKey` 时启用，以单次写入 `reviewKey` 同时保存审阅和选择。保存成功前不修改内存；取消、校验失败或存储失败不替换原状态。没有自动回滚检查点，调用者须先导出完整备份。不是跨标签页事务，也不修改资产文件或托管状态。操作步骤见 [产品手册](PRODUCT-MANUAL.md#精确恢复完整审阅备份仅独立前端单键本地目录)。

## 托管静态增量入口

以下是 reference/hosted 当前实现的约束，不适用于宣称独立前端具备上传后台：

| 约束 | 当前值 |
|---|---:|
| 单文件 | 1 MiB |
| 单清单文件数 | 2048 |
| 声明总量 | 256 MiB |
| 清单 | 512 KiB |
| 分块 | 32 KiB |
| JSON 文件数 | 8 |
| MCP 请求上限 | 768 KiB |
| 动态数据集目录上限 | 128 |

该入口仅支持受限 GLB、PNG、JSON；静态 GLB 校验拒绝 skin 等不在此输入契约内的能力。项目范围当前为源码里的四个显式白名单，不是任意项目注册服务。可播放动画不因 JSON 元数据存在而自动支持。

清单必须绑定路径、字节数、内容摘要与基线版本；finalize 前完成文件校验，D1 原子切换活动版本。完整协议见 ARCHITECTURE.md 与后端审查。文件摘要用于完整性，不承担隐私清理、来源授权或渲染一致性保证。

## 浏览器输入预算

模型单次下载 64 MiB、JSON chunk 8 MiB、accessor 合计 8M 数值、实例顶点 1M、展开索引 3M、图片编码合计 32 MiB、图片像素合计 32M，单边最大 8192。具体值以 `apps/reviewer/viewer.mjs` 的 PREVIEW_LIMITS 为准。

目录 JSON 默认单次原始 64 MiB/解码 128 MiB、页面会话累计各 512 MiB；配置只能在硬上限内调整。项目描述单个 2 MiB/累计 16 MiB，项目最多 128；分片默认最多 256、并发 4（硬上限分别 1024/8）。这限制输入而非保证浏览器总堆峰值。模型、描述和目录请求都禁止重定向。
