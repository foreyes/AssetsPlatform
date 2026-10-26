# 本地语义标注侧车契约

本文面向接入 `apps/reviewer` 静态审阅器的开发者与审阅人员，定义 `apps/reviewer/shared/semantic-annotations.mjs` 的输入、结果和信任边界。它实现 [AssetsPlatform #6](https://github.com/foreyes/AssetsPlatform/issues/6) 的**确定性事实、候选审阅与查询基础层**；不调用 AI、收费 API、网络或浏览器存储，也不自动读取或上传私人资产。调用方负责授权范围内的本地持久化和 UI。

## 身份与事实

`createAnnotationState({projectId,datasetId})` 建立与目录绑定的 JSON 侧车。稳定 `item.id` 在同一目录内唯一，显示名称、同源 mesh、共享材质或贴图均**不能**替代该 ID。跨项目或数据集的候选/备份被拒绝。先以 `reconcileInputs(state,items)` 处理目录；返回 `changed`、`unchanged`、`missing` 与修订号。目录输入改变时，只有变化项的旧建议标为 `stale`、标注提示 `needsReview`；没变的项保持缓存。`inputFingerprint(item)` 使用排序 JSON 的 FNV-1a 64 位摘要，是本地变更检测键，**不是**安全签名或内容授权证明。规则版本 `controlled-v1` 随侧车保存；版本不匹配应显式迁移，不隐式套用旧建议。

`extractDeterministicFacts(item)` 输出稳定 ID、技术类型、表现维度与五个分开的动画事实。`item.type` 是技术类型（如 `mesh`、`texture`），不等于内容分类。维度沿用 `shared/preview-status.mjs` 的 `2D`、`3D`、`mixed`、`unknown`；可由 `semanticDimension`/`dimension`/`representationDimension`/`facets.dimension` 显式指定。否则明确独立图片（`isIndependentImage`、`isSprite` 或 sprite/UI role）且有原图为 2D，有 `modelUrl`/`modelAsset` 为 3D；两者兼有为 mixed。`isObject` 且有 `imageUrl`/`originalUrl` 原图、无模型时也按独立 2D 物件处理。只有 thumbnail/previewUrl 并不足以断言 2D。3D 模型依赖的普通 PNG 纹理没有因此变成“2D 物件”：纹理资源自身维度仍 unknown。

动画事实分别为 `sourceTracks`、`skeletonPresent`、`bindingConfirmed`、`conversionSupported`、`playbackVerified`。每个输入用 `item.animationFacts.<事实>={value:true|false,evidence:[{source,reference}]}` 表示，缺少可定位证据时结果为 `null`（未知），而非 false。`playbackVerified` 另要求 `verifiedBy:'human'`；本模块不从骨骼存在推导轨道或可播放，也不把 renderer 接受 clip 当源证据。来源、绑定、转换、播放证据须分别记录，审阅器现有 `shared/animation-contract.mjs` 的播放准入仍是独立安全边界。

## 受控语义与审阅

语义候选仅允许 `field:'category'|'tag'|'dimension'`，值分别取模块导出的 `CATEGORIES`、`TAGS`、`DIMENSIONS`。内容分类允许 `food → item`、`firearm → weapon → item` 等由 `CATEGORY_PARENTS` 控制的祖先筛选；不在原始记录重复写入父标签。标签代表用途/属性，和分类可并存。分类、标签与技术类型/表现维度独立；来源目录中的模糊 `category` 或文件名**不会自动升格为已接受语义**。共享贴图、同 mesh 变体及组合子组件都分别审阅。

候选 JSON 格式如下；`method`/`version` 可标记人工准备的 Agent 批次，但模块本身不运行模型。输入名称、图片文字及候选证据都是**数据**，不能解释成指令。

```json
{
  "identity":{"projectId":"demo-a","datasetId":"demo-a-v1"},
  "ruleVersion":"controlled-v1",
  "proposals":[{
    "assetId":"object-demo-a",
    "field":"category","value":"food",
    "inputFingerprint":"fnv1a64:<使用 inputFingerprint(item) 实际生成>",
    "method":"local-agent","version":"model-or-rule-version",
    "evidence":[{"source":"local-thumbnail","reference":"preview:object-demo-a"}],
    "confidence":0.72,"conflicts":[]
  }]
}
```

在 `reconcileInputs` 后用 `importProposals(state,payload,items)` 导入，返回新候选 ID、过期项和忽略项；整批先校验再写入，`confidence` 仅供排序，不代表已验证事实。候选不能改写动画事实或播放验证。`reviewProposal(state,id,'accept'|'reject',{locked})` 才产生人工决策；拒绝不会被相同输入的重跑覆盖，锁定拒绝跨输入变化保留。锁定接受逐条保留，因此接受同一物件的多个分类/用途标签不会互相覆盖；输入变化后仍生效但提示复核。批量版 `reviewProposals(state,ids,decision,{locked})` 对所有 ID 预校验、仅创建一个检查点。`setSemanticOverride(state,assetId,field,value,{locked:true})` 直接设置该字段的人工更正，批量版 `setSemanticOverrides(state,assetIds,field,value,{locked:true})` 同样只建一个检查点；更正值替换该字段的生效候选值，锁定覆盖项不被候选覆盖。冲突维度候选不猜一个胜者，而显示 `needsReview`。未贴语义标签是允许的结果。

## 查询与批量范围

`effectiveSemantics(item,state)` 返回生效分类（含祖先）、直接分类、tags、dimension、technicalType、animation、unannotated 与 needsReview。`semanticMatches(item,state,query)` 的每个维度默认 `['food','plant']` 为**同维度 OR**，多个维度共同为 **AND**；维度筛选写 `dimensions:['2D']`。某维度也可写 `{any:[...],all:[...],exclude:[...]}`，分别代表至少一个、全部、排除全部；`all:['food','item']` 可利用继承匹配食物。顶层 `any:[子查询,...]` 是明确的子查询 OR，仍与顶层其他条件 AND。另有 `unannotated:true`、`unknown:true`（表现维度未知）、`animation:{sourceTracks:true|null}`；未知动画不等于 false。

`filterSemanticItems(items,state,query,{scope,page,pageSize})` 返回 `{items,total,matched,page,pageSize,pageCount,scope}`。`scope:'catalog'` 为全目录、`'matched'` 为全匹配集合、`'page'` 为当前匹配页；调用方**必须**用用户选择的 scope 做批量操作，不能把当前页误当全匹配，也不能将 `matched` 覆写为 `total`。零结果保持 `matched:0`。

## 导出、回导与回滚

`exportAnnotations(state)` 产生可审计 JSON：身份、规则版本、修订号、各资产输入摘要/事实/候选/决策/覆盖、最近 20 个检查点。`importAnnotations(state,backup,items,{mode:'merge'|'replace'})` 拒绝项目/数据集或规则不匹配；变化输入项的建议标 stale 并提示复核。默认 `merge` 中当前本地审阅决策、拒绝与更正优先于导入值；`replace` 只替换**已知 ID** 的侧车项，调用方应在明确确认及导出当前侧车后使用。`restoreAnnotationState(backup,{projectId,datasetId},items)` 用于浏览器本地保存的完整侧车回读：严格核对检查点、保留修订与历史，并对当前目录重新计算事实；不同于外部文件 merge。`rollbackAnnotations(state,revision)` 恢复仍保留的检查点，产生新修订，但不把历史事实当成当前播放证据；超过 20 次修改的旧检查点须从用户另存的导出文件恢复。这些操作不备份源 GLB/PNG 或项目文件。证据 reference 可能含本地路径，分享导出文件前应由用户审查；勿放入公开 issue。

最小可执行验证：`node --test apps/reviewer/tests/semantic-annotations.test.mjs`。合成用例覆盖独立 2D 食物图、3D 食物、植物、枪械、共享纹理、同 mesh 变体、仅骨骼无轨道、查询组合、分页和回导；这些是契约回归，不代表对任何真实资产已完成分类评估。真实数据上线前应按类型报告误标、漏标及未知率，并对每个自动动画事实核对其源证据。
