# 静态审阅器架构

AssetsPlatform 的可运行部分在 `apps/reviewer/`，目标是在同一界面审阅不同**已登记的静态资产目录**，而不执行原制作软件或游戏。根目录 `scripts/build-public.mjs` 按显式白名单复制静态文件到 `dist/reviewer`；本项目没有部署式后台、云存储或身份服务。架构边界见 [公开范围](PUBLIC-SCOPE.md)。

## 模块与依赖

| 层 | 路径 | 职责 |
|---|---|---|
| 项目登记与输入边界 | `project-directory.json`、`shared/project-loader.mjs`、`shared/project-schema.mjs` | 选择已登记项目、核对身份、结构和资源根；目录数据不能提供要运行的代码。 |
| 静态数据适配 | `adapters/indexed-data.mjs` | 读取物件目录、资源目录和可选证据；不操作 DOM 或审阅状态。 |
| 资源路径与预算 | `shared/resource-url.mjs`、`shared/json-budget.mjs` | 校验相对路径、跨目录边界与下载/解码预算。 |
| 页面与筛选 | `app.mjs`、`shared/catalogue-summary.mjs`、`shared/shell-controller.mjs` | 视图、筛选、分页与详情；不因项目名称切换代码。 |
| 浏览器预览 | `viewer.mjs`、`shared/viewer-adapter.mjs`、`shared/common-render-profiles.mjs` | 有界读取 GLB、独立图片展示与六种通用检视预设。 |
| 审阅与语义 | `shared/workbench.mjs`、`shared/selection-state.mjs`、`shared/semantic-*.mjs` | 选择、备注、备份、候选审阅、分类/标签筛选与本地回滚。 |

页面从登记文件取得 `projectId` 和 `datasetId`，经数据适配取得稳定 ID 的物件与资源。搜索、预览和审阅分别读同一目录数据；预览失败不会改写源事实或审阅结论。项目/数据集切换会使旧异步文件读和预览结果失效，不允许晚到结果应用到新目录。

## 数据与证据

物件是用户审阅的单位；技术资源可能被多个物件引用。目录项的 `modelUrl`、原图、缩略图和关联资源各有不同含义。内部 GLB 依赖索引只表达 glTF 引用闭合，不推断更早工程的资源血缘。动画侧车的源轨道、绑定、转换、人工播放验证分开；源骨骼存在或渲染器接受 clip 都不足以证明可播放。

本地审阅和语义侧车按项目/数据集身份隔离。导出 JSON 是记录与索引，不备份模型字节。外部候选是未信任数据，仅受控词表、证据与人工决定后才改变有效语义；它不能写动画播放验证。详见 [数据契约](DATA-CONTRACT.md)、[语义标注](SEMANTIC-ANNOTATIONS.md)。

## 能力限制与故障

浏览器 GLB/图片检查不等于 GPU 像素一致、材质完整或源引擎运行。仅显示已实现的通用检视方式；同一 GLB 可比较参数化显示，但源字节不变。失败应给出可解释状态，取消旧请求并释放 GPU 资源；测试应覆盖资源预算、重定向、损坏输入、空目录、取消和备份身份不匹配。自动测试之外仍需真实浏览器验收，见 [验证说明](VALIDATION.md)。
