# 静态目录数据契约

本文面向准备自包含 GLB 或独立图片目录的维护者。路径相对于 `apps/reviewer/`；`demo-a/` 和 `demo-b/` 是自制最小模板，`animation-example/` 是自制 glTF 轨道练习。静态审阅器只读取登记的同源目录文件，不运行目录携带的 JavaScript、脚本或程序。

## 项目与稳定身份

根 `project-directory.json` 的每个 `projects[]` 项提供唯一 `id`、`config` 和 `assetRoot`。配置文件的 `id` 必须与登记一致，并给出非空 `datasetId`、`dataKind:'indexed'`、renderer、审阅与偏好存储键。存储键不得互相冲突。`projectId`/`datasetId` 绑定本地备份；更换输入集合时应更换数据集身份，不能靠显示名区分。模型和物件的 `id` 在目录中稳定、唯一，不由名称自动生成跨版本同一性。

```json
{
  "schema":"asset-review-project-directory/1",
  "defaultProject":"demo-a",
  "projects":[{"id":"demo-a","label":"示例 A","config":"demo-a/project-config.json","assetRoot":"./"}]
}
```

资产根下至少有 `assets/catalog.json`（`version` 与 `assets` 数组）、`assets/objects-catalog.json`（`version` 与 `objects` 数组）和所引用的 GLB/图片。资源可以含 `id`、`name`、技术 `type`、`modelUrl`、独立 `imageUrl`、`previewUrl` 与来源字段；物件可以含 `id`、`name`、`assetId`、`modelUrl`、描述和受控证据。`assetId` 是资源引用，不把技术资源自动视作完整物件。模型文件和索引都要在本项目资源根内；URL 经 `shared/resource-url.mjs` 解析，不因 JSON 内有路径便赋予访问或分发权。目录可用有限数量的 `assetShards`；错误或重复 ID 使加载失败。

可选 `assets/canopy-rules.json` 缺省为空规则；`assets/render-profiles.json` 用于显示证据，不使不存在的渲染算法变为可用。六种核心浏览器预设定义于 `shared/common-render-profiles.mjs`：GLB 材质、白模、三阶明暗及三个自定义中性/冷/暖检视方式。参数只影响查看，不改写 GLB 或推断来源外观。

## 预览与验证状态

可预览表示提供了当前适配器支持的数据入口，不等于 GPU、外观、完整性或其他引擎导入已验证。模型的 PNG 依赖仍是技术纹理；独立物件原图必须有明确身份和原图路径，缩略图不能顶替原图。静态模型有骨骼不等于有源轨道，有源轨道不等于绑定正确或播放通过。动画事实及人工验证分别记录，见 [自制动画示例](ANIMATION-EXAMPLE.md) 与 [语义侧车](SEMANTIC-ANNOTATIONS.md)。

本地审阅记录的状态为 `pending`、`keep`、`check`、`skip`，备注上限 10,000 字符。v2 备份包含 `projectId`、`datasetId`、`reviews`、`selected`；身份不匹配时拒绝导入。旧 v1 仅经明确确认合并迁移。精确替换要求同身份完整范围、单存储键目录和再次确认，先持久化后更新内存；不是跨标签页事务。JSON 导出只含索引和记录，不含 GLB/图片字节。

## 输入预算与限制

当前前端限制单次模型下载 64 MiB、JSON chunk 8 MiB、accessor 合计 8M 数值、实例顶点 1M、展开索引 3M、图片编码合计 32 MiB、像素合计 32M、图片单边 8192。目录 JSON 默认原始 64 MiB/解码 128 MiB，会话累计各 512 MiB；描述单个 2 MiB/累计 16 MiB；项目最多 128；分片默认最多 256、并发 4（硬上限 1024/8）。这些是资源上限，不是内存或恶意文件安全保证。实际实现以 `viewer.mjs` 和 `shared/json-budget.mjs` 常量为准；修改限额须同步测试和文档。

本地 GLB 入口要求自包含 glTF 2.0 且受支持扩展闭合；不接受外部 buffer/image 引用，未知必需扩展拒绝。目录请求和模型下载拒绝重定向。详见 [本地目录导入](LOCAL-DIRECTORY-IMPORT.md)。
