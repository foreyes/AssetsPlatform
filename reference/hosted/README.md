# 托管实现参考源码

本目录用于完整平台的架构审查，不是独立可部署的服务包。它来自现有托管实现，保留路由、事务存储、数据模型、前端和预览核心的代码结构。

## 为什么与可运行演示分开

现有平台将静态浏览器界面、可信身份网关、Worker、D1 元数据和 R2 文件存储组合在一起，并包含固定数据批次的历史兼容路径。公开分发不能携带其实际游戏资产、用户身份、存储键清单或部署配置。仅删掉这些文件后，原构建流程也不会自动变成通用开源部署流程。

## 明确排除

- lib/generated 中的私有发布与对象存储计划 JSON。
- 原始模型、图片、音频、资源索引、批次归档、用户审阅数据及执行回执。
- 站点身份和访问名单、账号凭据、运行时缓存、构建产物和原仓库 Git 历史。
- 原生渲染器的专属数据映射和固定供应指纹；第三方 vendor 闭包不在本参考片段中。
- 工程外的导出工具与私有输入文件。

所保留 package.json/配置描述原实现的依赖，不是本仓库的安装承诺。部分 import 指向上述排除文件，故本目录不能作为独立构建入口；根目录 npm start 只启动 apps/reviewer。

## 要成为可部署后台还需要什么

1. 将固定项目白名单、发布计划和供应指纹改为显式配置及生成器，并提供公开合成数据。
2. 提供独立身份 provider，不直接信任客户端可伪造的身份请求头；说明网关信任边界。
3. 定义数据库和对象存储初始化、迁移、环境变量与权限配置，不包含真实密钥。
4. 消除对原私有数据目录和仓库外工具的隐式依赖。
5. 在干净 checkout 上验证安装、构建、最小数据导入和恢复；再提供容器或部署模板。
6. 补齐依赖许可与源文件归属审查。

这些工作尚未完成；不要将本目录上传服务器后直接对公网暴露。代码审查记录保留现状，不通过大规模改写掩盖发现的问题。

## 增量发布边界与恢复

活动目录最多接纳 128 个增量 project/dataset scope，另加 Entity 和部署时审核的固定样本。Worker 与托管前端共享该预算；finalize 在同一 D1 batch 内检查基线和新 scope 容量，争抢最后一个名额时只有一个新 scope 可提交。已登记 scope 在满额时仍可更新或重放。目录超限时明确失败，不截断；历史上已经超过 128 个活动 scope 的部署原本即不可用，本修复不会删除数据或自动恢复它们，需要运维明确选择提高预算并验收全部消费者，或制定归档/迁移策略后再恢复目录。

`ingest_versions` 是不可变的已发布收据，验证 manifest SHA、清单文件数与总字节数。begin、status 和 finalize 的 `ready` 表示请求版本已发布，独立于它是否仍为活动版本。重放历史版本不会切回活动指针。`activeVersion`、`activeRevision` 是同一次数据库读取观察到的活动状态；`revision` 仅当请求版本仍为活动版本时返回该 revision，否则为 null。旧 schema 没有保存历史激活 revision，因此不会将新版本的 revision 冒充历史版本的 revision，也不需要迁移。未提交的旧基线仍报冲突。丢失 finalize 响应后 transport 使用收据协调，即使其他版本已成为活动版本。

条件 R2 put 的成功结果才计入 created；竞争失败者也必须回读验证，丢失响应时沿用不完整创建计数标记。

公开快照的针对性验证：`node --test reference/hosted/incremental-candidate/publication.test.mjs`（仓库根目录，Node 22.13+）。测试使用 SQLite D1 替身、内存条件 R2 和合成 JSON 包；缺失的生成 resolver 转到规范源码，renderer 导入仅占位且不执行。覆盖目录预算、并发 admission、历史收据与丢响应恢复、条件写入计数及 Python CLI。它不代表真实 Cloudflare D1/R2 并发、GPU、完整 hosted 构建或部署验收。

本地 `incremental-candidate/export_local.py` 需要 Python 以及 PATH 中可用的 Node.js 22.13+（与 hosted package 的 Node 版本要求一致）。它继续使用调用者指定的外部 importer、store 和 out；dataset 在加载 importer 前精确校验，随后在调用输出路径/写文件 helper 前，通过 `validate-manifest.mjs` 校验完整 prospective manifest。CLI 与 hosted 导入共享无 renderer/生成数据依赖的 `manifest-contract.mjs`，统一文件名、scope、结构、元数据、依赖、分块与容量约束。失败不生成输出；该本地预检不替代 hosted 对实际文件内容、目录引用和 GLB 的完整验证。
