> 历史初审记录：以下发现和行号对应修复前快照。已完成后续修复与复审，当前状态见 [代码审查闭环](CODE-REVIEW.md)。请勿将本页的“未修复”或旧许可状态当作当前结论。

# 前端、产品流程与公开可移植性审查

审查日期：2026-10-25。范围：现有托管工程的 `review-frontend/` 与独立候选。本文 P 路径相对 `apps/reviewer/`，H 路径相对 `reference/hosted/`。仅进行云端只读代码检查、CPU/契约测试及本地报告写入；未编辑生产、未上传、未进行真实 GPU 验收。

## 结论

- 公共交付宜表述为“可运行独立前端 + 经脱敏的托管架构参考”，不能称完整生产系统已独立部署。P `shared/selection-client.mjs:1` 是空 provider，P `shared/viewer-adapter.mjs:1–7` 固定使用包内 GLB viewer，`downloadResource` 返回 unsupported。
- 单一 UI / 数据适配器 / 资源解析器 / 渲染器 / 本地审阅分层方向合理；生产与 portable 能力有本质差异。
- 发布阻断首先是许可与代码来源决策。数据完整性缺口包括跨项目导入身份未校验、未保证资产 ID/存储键唯一。安全不应仅靠前端路径校验或 `npm test` 的文本扫描。

## 分级发现

### F1 — P1：审阅备份未绑定项目/数据集，可能误覆盖其他目录记录（已复现）

证据：P `app.mjs:125` 导出 format/version 与目录版本，不含项目/数据集稳定身份；P `shared/workbench.mjs:5` 的 `parseReviewImport` 仅检查 format/version/reviews 与当前 knownIds；P `app.mjs:130` 直接 `Object.assign(reviews,imported.reviews)`。

复现：两个目录采用同一个 `importFormat`，存在相同稳定 ID。将带 `projectId: "other"`、该 ID 的 keep/备注记录导入当前 workbench，仍成功接受（测试数据完全自制）。真实示例使用不同 ID，所以目前示例演示不会暴露这一问题。

影响：错误目录的备份能够覆盖个人结论与备注；不是跨服务器访问权限突破。建议 v2 导出增加 projectId/datasetId，导入强校验；旧备份采用显式确认迁移，不静默推定身份。加同 ID 双目录回归。

### F2 — 发布门槛：缺少已确认的代码许可/来源授权

证据：P `THIRD_PARTY_NOTICES.md:5` 明确 viewer 代码来源授权待所有者确认；候选没有 LICENSE。说明“无 npm 运行依赖”和“自制立方体”不等于所有源码已可合法再分发。

建议：所有者明确许可证；核验历史源码、渲染公式/第三方片段、样例来源和 notice。不要擅自添加 MIT 以替代授权判断。此项属于发布决策，不是可自行修复的运行时缺陷。

### F3 — P2：数据/配置入口未做完整 schema 与身份唯一性验证

证据：P `shared/project-loader.mjs:5` 检查项目 ID 唯一，`11–14` 直接拼接 descriptor config；P `app.mjs:56–57,65` 将资产 ID 转字符串并建 Map，未拒绝空/重复 ID，也未验证物件与资源 ID 互斥；P `shared/selection-state-f26e30267bd7.mjs:4–10` 完全依赖配置存储键。

影响：重复 ID 会覆盖 Map 条目并共享审阅身份；重复 reviewKey/renderPreferenceKey 会串目录；缺字段可能产生启动异常。不能把 readJSON 成功当成数据格式有效。

建议：在渲染前校验 descriptor、catalog、objects 的版本、必需字段、全目录 ID 唯一、路径类型及存储键唯一；用清晰错误显示失败路径。未来提供 JSON Schema 与生成器验证。

### F4 — P2：README 添加目录清单漏列必需 canopy-rules.json

证据：P `adapters/indexed-data.mjs:12` 用 required 默认 true 读取 `assets/canopy-rules.json`；P README “添加自己的资产目录”未明确该文件必需。`app.mjs:65` 会把缺文件升级为整个目录加载失败。

建议：手册明确空规则文件格式，或将无规则文件读取改为 optional 并回退空集合。此次产品手册已明确必需文件，生产代码未改。

### F5 — P2：Python 备用服务器不具备 Node 服务器的真实路径围栏

证据：P `serve.py:3–8` 直接使用 SimpleHTTPRequestHandler；P `server.mjs:12` 额外检查 fs.realpathSync(target) 是否仍在 root 内。Python 实现未添加对应真实路径检查。

风险条件：目录内出现指向外部文件的符号链接时，Python 静态处理可能提供根外文件；仅监听 loopback 限制了暴露面，但不代表不存在本地客户端/跨来源请求风险。这是静态代码审查结论，本次未用真实私人文件验证。

建议：默认推荐 Node 服务；Python handler 增加 realpath containment 和禁止目录列举/隐含文件策略。两种服务器均应声明仅本地开发用途，不是生产身份边界。

### F6 — P2：GLB 必需扩展处理不是完整 fail-closed

证据：P `viewer.mjs:98` 只拒绝 extensionsRequired 中两个已知压缩扩展，没有统一受支持扩展 allowlist。其他未知必需扩展可继续解析，预览可能缺少关键语义而看似成功。

建议：明确定义支持的必需扩展，遇未知必需扩展拒绝或标记不可忠实预览。对已知可忽略 optional 扩展单独给 warning。不要称 viewer 为通用完整 glTF 2.0 渲染器。

### F7 — P2：总资源预算缺失，单属性限制不足以限制不可信模型消耗

证据：P `viewer.mjs:125–126` 每 accessor 上限 32,000,000 数值但分配 Float64Array，单 accessor 理论可达约 256 MB；多个 accessor、图片解码、整体 fetch 和 JSON 解析没有在此处形成总量预算。P `app.mjs:64` 读 JSON/gzip 全量缓存，P `adapters/indexed-data.mjs:8` 对分片 Promise.all。

影响：恶意或意外超大自定义目录可能导致页面卡顿或内存耗尽。未进行压力测试，不主张已复现浏览器崩溃。

建议：总下载字节、解压后字节、图像像素、顶点/节点/材质数、并发分片等预算；复杂解析移至 worker；错误应保留列表和审阅状态。

### F8 — P2：验证脚本比其“externalDependencies:0”输出更窄

证据：P `verify.mjs:7–10` 用正则检查少量敏感内容和静态 import 文件存在；末行硬编码 `externalDependencies:0`、`gpuVerified:false`，没有完整 URL/动态 import/CSS dependency 遍历和渲染测试。

当前文件检查通过，但不能证明未来修改仍没有网络依赖、许可证风险或私有资料。建议输出区分“声明值”和“测量值”，引入 allowlist 包装器、密钥扫描、哈希闭合、浏览器网络断言与专门负例；不将该输出当成完整供应链审计。

### F9 — P3：同一 app 文件耦合大量功能，portable 保留不可达的专题代码

证据：P `app.mjs:17` 强制关闭研究/特效/武器专题，仍保留其函数与 HTML 对话框；`app.mjs:65` 与 `130` 的超长函数混合加载、状态、DOM、事件、导入和生命周期。

影响：维护、审查和浏览器单元测试困难，API 能力与真实可用能力容易混淆。建议拆成 bootstrap/catalog/review/detail/playback/export controllers，通过 capability registry 组合；保持单一 UI，避免按项目名称分叉。

## 已有防护与有效设计

- P `shared/resource-url.mjs:7–45` 多轮编码检查、禁止危险协议和跨项目路径、同源资源根、显式外部来源 allowlist；资源 URL 与来源链接分离。
- P `shared/resource-url.mjs:64–68` 作用域 generation 与 abort；shell 切换全导航，并在跳转前清理旧工作。仍须用浏览器实测竞态和 bfcache。
- P `app.mjs:27` HTML escape；多处 `textContent` 输出证据；P `shared/workbench.mjs:4` 拒绝 prototype 特殊 key，验证状态并截断备注。
- P `app.mjs:126` CSV 单元格对 `= + - @ tab CR` 开头前置单引号，降低公式注入风险。不是对每种表格软件的完整安全保证。
- P `viewer.mjs:81–130` 校验 GLB magic/version/长度与 buffer/accessor 范围；`749–753` 不加载外部贴图；`164,449–450` 明确骨骼、脚本和 morph 边界。
- P `app.mjs:70` 可播动画要求多个验证字段与片段 ID 集合；静态资产不会单因存在按钮成为可播放。
- H `review-frontend/shared/selection-client.mjs:24–31` 明确区分本地草稿与服务器版本，发布携带 revision，恢复服务器草稿前对 dirty 状态确认；身份来自 session，不使用昵称代替身份。后端授权仍须单独审核。

## 功能与数据结构清单

产品详解见同目录 `PRODUCT-MANUAL.md`。核心数据契约：

1. project-directory：登记 projects/defaultProject；descriptor：id/datasetId/assetRoot/dataKind/renderer/config/labels。
2. catalog：技术资源 assets 或 assetShards；objects-catalog：objects，可关联 assetId、assemblyModelUrl 与来源/关系。
3. render-profiles、canopy-rules：预览配置与材质特殊规则，不代表原 Shader 等价实现。
4. animation/actions：条件读取的验证记录与片段集合，非普通 GLB 动画自动开放。
5. 本地 review v1：reviews[id]={status,comment,updatedAt}，selected；备份含精简 assets 元数据，无模型字节。
6. 托管 selection：当前身份、nickname、ids、revision、server manifest；portable 不含服务实现。

## 实际运行的检查

- 独立 `npm test`：通过，45 files / 2 catalogues；输出明确 gpuVerified:false。
- 用同一 `viewer.mjs.parseGLB` 对两个自制 cube.glb 解析：均通过，各 1 primitive。
- H `node --test review-frontend/tests/resource-url.test.mjs`：36/36 通过，覆盖路径、同源、外链边界、项目切换、取消与原生声明等。
- 自制 same-ID 跨项目导入回归探针：成功复现 F1。

未运行：真实 GPU 像素、完整浏览器交互与移动端可访问性、完整后端权限/API、压力测试、公开仓库远端验证。既有环境记录表明云端 WebGL 无法创建；本次没有把历史结果或代码标记当成新的像素验收。
