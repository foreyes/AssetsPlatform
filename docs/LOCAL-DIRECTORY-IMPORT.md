# 将本地 GLB 文件夹转换为独立审阅工作区

此工具创建**不可覆盖的目录快照**，不是已有集合的增量更新器。此工具面向已经有权使用一批自包含 GLB 2.0 模型的资产维护者。它补齐手动编写目录 JSON 的步骤，不扫描 Google Drive，不提取 Unity 工程，不执行原游戏或资产脚本，不上传或发布文件。源文件夹只读；输出是独立、可搬迁的本机审阅器，和公开源码/构建分开存放。

## 创建与打开

需要 Node.js 18+，不需要 npm 安装。在 AssetsPlatform 仓库根目录运行：

```sh
npm run import:directory -- --source /absolute/path/to/glbs --output /absolute/path/to/new-review-workspace --id my-models --label "我的模型"
cd /absolute/path/to/new-review-workspace
node validate-workspace.mjs
node server.mjs
```

如需审阅 GLB 文件**内部定义和显式引用**，可在首次导入时加 `--index-glb-dependencies`：

```sh
npm run import:directory -- --source /absolute/path/to/glbs --output /absolute/path/to/new-indexed-workspace --id my-models --index-glb-dependencies
```

这是可选的元数据索引；不加开关时仍是每个 GLB 一个模型资源和一个物件，目录结构与原导入行为不变。JavaScript 调用者可传 `importDirectory({source, output, id, indexGLBDependencies: true})`。两次运行须使用不同的全新输出目录，不会向现有快照补写索引。

输出的父目录必须已存在，输出目录必须尚不存在，且不能位于本仓库或源文件夹内，也不能包含源文件夹。Windows 可使用带引号的绝对路径。ID 必须以小写字母开头，随后只含小写字母、数字和连字符，最多 64 字符。路径中的空格需要 shell 引号。

浏览器打开 `http://127.0.0.1:8768/`。备用启动方式是 `python3 serve.py`。支持现有通用页面的筛选、渲染风格、选择、审阅结论、备注与 JSON/CSV 导出；GLB 内的动画不自动声明为已验证可播放。输出不依赖原仓库或原模型路径，不含账号/共享后端。

## 输入与失败规则

- 递归读取可见 `.glb` 文件（扩展名不区分大小写）；隐藏条目跳过，其他文件不会复制。可见符号链接拒绝，不遍历其目标。
- 最多 512 个模型、10,000 个可见/枚举目录条目、32 层子目录、累计 256 MiB 模型字节；单模型最多 64 MiB，并沿用 `apps/reviewer/viewer.mjs` 的 JSON、几何、图片预算与扩展限制。
- 只接受恰好一个 JSON 区块和一个 BIN 区块的 GLB（长度/对齐检查、重复区块拒绝），以及内嵌 buffer 和内嵌图片；不下载外部依赖。不支持必需 Draco/meshopt 扩展。正常解析的模型仍可能有未实现材质通道等警告，见输出报告。
- 每个模型须通过实际浏览器使用的 CPU GLB 解析器；生成的描述与目录须在创建输出前通过共享 schema 校验。显示名称取去除首尾空格的文件主名，空白名称使用 `Model <路径摘要前12位>`，不修改源文件。任一文件失败，整批失败，不输出一部分冒充完成；不会覆盖已存在的输出。生成过程失败会清理本次创建的输出。进程被强制终止时可能留下不完整目录，检查后手动移除或选择新输出路径。
- 这不是对恶意并发修改文件夹的安全隔离器。导入期间不要修改源文件、输出父目录或程序文件；仅对你授权处理的本机目录运行。

可选索引只读取已经通过上述 GLB 约束和 CPU 解析的字节，不接受外部依赖；内部关系索引若含越界的节点、mesh、材质、纹理或图像引用，会使整批导入失败，不输出不完整关系表。索引最多产生 10,000 条资源记录，`assets/catalog.json` 的序列化内容最多 16 MiB；超限同样在创建输出目录前失败。该预算独立于模型文件的 256 MiB 总预算。

## 输出文件与身份

```text
new-review-workspace/
  index.html, app.mjs, viewer.mjs, *.css
  shared/, adapters/               # 通用界面、加载、审阅与渲染代码
  server.mjs, serve.py             # 仅本机 HTTP 服务
  validate-workspace.mjs           # 所有登记目录、物件/资源及 GLB 的 CPU 校验
  LICENSE, THIRD_PARTY_NOTICES.md
  README.txt
  project-directory.json          # 唯一登记的导入目录
  import-report.json              # 相对源文件名、摘要、CPU 统计、警告
  library/
    project-config.json           # 项目/数据集身份、独立存储键、能力
    assets/
      catalog.json               # 技术模型条目
      objects-catalog.json       # 一模型一物件；不猜测组合关系
      render-profiles.json
      preview-pending.svg
      <relative-path-sha256>.glb
```

开启可选索引后，`catalog.json` 在原文件级 `mesh-<相对路径SHA256>` 记录之后，增加 `mesh-definition`、`primitive`、`material`、`texture`、`image`、`node`、`scene` 类型的**元数据记录**。它们都不拥有独立模型 URL；点击它们不能被理解为对单个图元或材质作了 GPU 预览。`objects-catalog.json` 仍严格每 GLB 一个文件级物件，物件 `assetIds` 明确连接本文件索引记录，而不是猜一个 Prefab、组合物件或动画控制器。`import-report.json.dependencyIndex` 区分 `files`、`meshDefinitions`、`primitiveDefinitions`、`meshNodeInstances` 和 `primitiveNodeInstances` 等定义/实例计数；实例指**显式的 glTF 节点→mesh 引用**，不是文件数，也不把没有显式引用的定义断言为“未使用”。

内部记录的 ID 使用文件的相对路径 SHA-256、内部类型和 glTF 数组下标组合。图元另含 mesh 与图元两级下标。例如 `gltf-primitive-<路径摘要>-0-1` 表示 `/meshes/0/primitives/1`，其中 `internalLocation` 保留该 JSON 位置；源节点/材质的空名使用 `node 2`、`material 0` 一类显示回退，同名定义仍是不同 ID，不会按名称去重。移动或重命名文件会改变所有相关 ID，文件内容改变会改变数据集 ID，但在路径和数组下标不变时内部 ID 不变。数组重排会改变内部对象与 ID 的对应关系；不要将这些 ID 用作跨版本业务对象身份。

关系是 glTF 文件中可核验的引用：节点有父子/场景根关系和 mesh 定义 ID，mesh 定义有图元 ID，图元有显式材质 ID，材质的核心贴图槽有纹理 ID，纹理有内嵌图像 ID。一个图像被多个纹理引用时只记录一份图像定义，引用保持共享。图元没有显式材质时记录 `materialId: null`，不制造一个材质定义。每条内部记录的 `derivedFrom` 指向确实包含它的文件级模型记录，并含源文件相对路径、`sourceFileSha256` 与定义 JSON 的 `definitionSha256`；图像额外有内嵌字节的 `contentSha256`。定义摘要只覆盖该 JSON 定义本身，不能代替源文件摘要来证明几何或图像字节未变；来源关系仅说明 GLB 内嵌事实，不证明原始游戏、Unity Prefab 或导出前资产的血缘。无法由核心 glTF 引用确认的未知扩展依赖不推断为已闭合；纹理若只有未知扩展图像源，其 `imageId` 为 `null`，不伪造核心图像关系。

文件级模型资源与物件在开启索引时另带 `animationFacts`：`sourceTracks` 只表示 GLB JSON 是否声明了结构上可定位的核心节点动画 channel；无 channel 为 `false`，有 channel 但无法确认其结构时留未知。`skeletonPresent` 只表示 GLB 的 `skins` 数组是否非空。每个已确定值都有 `glTF-json-parser` 与 `sha256:<文件摘要>#/animations` 或 `#/skins` 来源定位。它们**不**证明曲线字节已转为本审阅器格式、骨骼绑定正确、GPU 可播或人工验证；`bindingConfirmed`、`conversionSupported`、`playbackVerified` 不由此工具设置。默认（未开启索引）不添加这些字段。

**图片拆出未实现。** 开关只索引内嵌 PNG/JPEG 的位置、格式、长度和摘要，图片仍留在 GLB 中，不额外生成 PNG/JPEG 文件或图片 URL；不要将 `image` 记录误认为独立可下载资产。将来若提供拆出功能，须另设开关并遵守当前工作区资源根、图片格式与字节/像素预算。

每个模型的物件/技术资源 ID 由相对路径 SHA-256 派生，并使用不同前缀；同名但位于不同子目录的模型不会冲突。这里的稳定性仅限相对路径不变；重命名或移动模型会改变条目 ID。尚未提供持久映射侧车来保留重命名前的身份，不可将此规则等同于长期业务实体 ID。数据集身份由有序相对路径及内容 SHA-256 清单派生。相同项目 ID、文件路径和字节重新导入会得到相同身份；任一模型内容或路径增删改变会生成新数据集与新审阅存储键，防止旧结论被静默应用到变更后的模型。更改显示 label 不会更改身份。

审阅记录仍保存于浏览器的来源和存储键，不会写回输出目录。迁移时先在旧工作区使用“导出目录”备份全部审阅，再移动完整工作区，最后在相同项目/数据集身份下导入 JSON。单独 JSON 不含模型；换端口、浏览器或机器不会自动同步记录。内容变化后的新数据集不能直接导入旧 v2 审阅备份；本工具不提供强制覆盖身份的迁移选项。

## 隐私与验证边界

输出包含你选择的模型、文件名和模型内嵌元数据，应按原资产权利保持私有。`import-report.json` 保存相对路径但不保存源绝对路径。此工具不会修改公开构建白名单、源码目录登记或远端仓库；根 `npm run build` 构建登记的自制示例，而导入工作区只复制通用运行时代码，不复制 `demo-*` 或 `animation-example/` 公开练习 fixture。不要将完整输出放进公开 Git 仓库或公开站点。

自动测试使用自制立方体，覆盖实际 HTTP 启动、目录加载器/适配器/CPU 解析闭合、统计字段、占位图、稳定身份、内容变更隔离、已存在输出保护、畸形/外部模型拒绝、路径/符号链接/预算边界。另用自制两 mesh 节点、两材质、两纹理共享一 PNG 的 GLB fixture 检查索引的关系闭合、共享、空名/同名、定义/实例/文件计数、确定性、源只读与默认模式不变。运行 `node --test tests/import-directory.test.mjs tests/glb-dependency-index.test.mjs`；完整回归运行 `npm test`。这些测试不证明真实浏览器 WebGL、像素、材质外观、移动设备或资产许可证已经验证。

独立输出可运行 `node validate-workspace.mjs` 重查所有登记目录的描述、身份、物件/资源表和引用 GLB，不假设模型叫 cube.glb。该命令不校验 GPU、任意附件完整性或托管账号；缺失模型会返回非零退出码。源码仓库的旧 `verify.mjs` 只验证随包自制示例，不能替代此命令。
