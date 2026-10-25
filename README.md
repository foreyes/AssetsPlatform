# AssetsPlatform

**一套界面，审阅不同资产目录。** 在浏览器中查看物件、检查模型与渲染风格、整理选择，并保存审阅结论和备注。

[产品手册](docs/PRODUCT-MANUAL.md) · [架构说明](docs/ARCHITECTURE.md) · [接入契约](docs/DATA-CONTRACT.md) · [修复与复审](docs/CODE-REVIEW.md) · [贡献指南](CONTRIBUTING.md) · [MIT 许可](LICENSE)

## 项目定位

AssetsPlatform 面向游戏开发者、美术和技术美术。目录差异通过数据和适配器表达，不为每个项目另做页面；渲染方式用于检查同一模型，不改写原始资产。

当前发布分为两部分：

| 部分 | 用途 | 独立运行 |
|---|---|---|
| `apps/reviewer` | 本地静态审阅器、自制示例、浏览与审阅工作流 | 是，无账号和 npm 运行依赖 |
| `reference/hosted` | 现有 Worker / D1 / R2 / MCP 托管实现的脱敏代码参考 | 否，未分发私有输入和宿主集成 |

根目录的构建只发布静态审阅器，不会偷偷打包托管后台或真实资产。这不是 Unity 编辑器、游戏运行器或任意工程的一键转换服务。

## 快速开始

推荐 Node.js 24；本地服务最低 Node.js 18。无需 `npm install`。

```sh
git clone https://github.com/foreyes/AssetsPlatform.git
cd AssetsPlatform
npm start
```

打开 **http://127.0.0.1:8768/**。示例目录 A/B 各含一个自行生成的立方体，不含商业游戏模型、贴图或音频。目录切换后，布局和操作保持一致。

也可使用 Python 3：

```sh
cd apps/reviewer
python3 serve.py
```

只监听本机；不要直接双击 HTML，也不要把开发服务器当作公网身份服务。完整安装、操作、迁移和排障说明见[产品手册](docs/PRODUCT-MANUAL.md)。

## 可以做什么

- 在同一页面切换已登记的资产目录。
- 区分供人审阅的“物件”和底层“技术资源”，搜索、筛选、排序与分页。
- 查看详情、来源、层级和适配器支持的模型信息。
- 切换源材质、白模、三阶卡通、自然柔光、双阶冷影和双阶暖调。
- 使用支持的 A/B 视图、线框和动画能力；没有相关数据时不伪装为可播放。
- 保存个人选择、审阅状态和备注；导出 JSON/CSV。
- 使用项目/数据集绑定的 v2 备份；默认合并导入，单键本地目录可明确确认后精确替换恢复完整备份；旧 v1 只支持确认后合并迁移。
- 加载自己准备的自包含 GLB 目录，不执行资产包脚本。

3D 依赖 WebGL。预览风格不是原游戏 Shader 的完全复现；源材质也受当前格式适配器支持范围约束。JSON 导出包含索引与审阅记录，不包含模型字节，不是工程备份。

## 添加目录

已有自包含 GLB 文件夹时，可使用 `npm run import:directory -- --source <模型文件夹> --output <仓库外的新工作区> --id my-models` 生成独立本机审阅器，无需手写目录 JSON。详见[本地目录导入](docs/LOCAL-DIRECTORY-IMPORT.md)。不会修改公开构建或上传模型。


复制 `apps/reviewer/demo-a/`，给目录、数据集、物件和存储键设置独立身份，再登记到 `project-directory.json`。更新资源目录、物件目录及模型路径。不要只改显示名称而复用原目录的存储键。

[数据接入契约](docs/DATA-CONTRACT.md) 给出具体文件、字段、预算和兼容规则；[可运行示例](apps/reviewer/demo-a/project-config.json) 是最小完整参考。无需配置私有云盘、站点 ID 或账户凭据。

## 构建与测试

```sh
npm test       # 需要 Node.js 和 Python 3
npm run build # 生成 dist/reviewer，确定性静态构建
```

测试覆盖身份隔离、旧备份确认、路径/重定向、输入预算、两种本地服务器围栏与构建闭合。构建采用显式文件白名单，并输出内容摘要和能力说明；不会将整个仓库作为站点发布。

CI 运行相同命令，使用只读仓库权限与固定版本的官方 Actions。验证分层及本轮结果见 [VALIDATION](docs/VALIDATION.md)。CPU、DOM 测试替身与 HTTP 检查不能替代真实 GPU 和人工操作验收。

## 架构概览

```text
目录登记 → 描述/身份校验 → 数据适配 → 通用界面
                                ├→ 预览适配器 → WebGL
                                └→ 本地审阅状态 → JSON / CSV

可选托管体系：可信身份入口 → Worker / MCP → D1 元数据 + R2 不可变内容
```

- 页面与数据适配分离，项目名称不决定首页布局。
- 审阅身份、资源根和本地存储空间分别验证。
- 资源下载与 JSON 解压均有预算；未知必需模型扩展明确拒绝。
- 托管导入先校验内容，再原子切换活动版本；旧校验收据不能直接冒充新策略结果。

详细模块职责、数据模型、事务时序、信任边界和演进取舍见[架构说明](docs/ARCHITECTURE.md)。

## 当前边界

- 独立前端不含多人账号、共享选择后台或任意文件夹自动转换。
- 托管参考依赖可信网关，显式配置只声明信任契约，不提供通用密码学身份认证。
- 本轮已修复并复审已复现的数据隔离和输入问题；真实浏览器重跑因运行工具不可用而未完成，GPU/音画效果仍未验收。
- 项目仍在演进，不能把有界测试通过理解为无缺陷、安全认证或完整自托管能力已经交付。

## 文档导航

- [产品手册](docs/PRODUCT-MANUAL.md)：功能、操作、导入导出、预览限制和排障。
- [架构说明](docs/ARCHITECTURE.md)：组件、数据流、数据库和安全边界。
- [数据契约](docs/DATA-CONTRACT.md)：新增目录与规范化输入。
- [代码审查闭环](docs/CODE-REVIEW.md)：发现、修复、再审查与保留限制。
- [分发范围](docs/EXPORT-SCOPE.md)：公开内容与排除内容。
- [安全说明](SECURITY.md)、[贡献指南](CONTRIBUTING.md)、[第三方说明](THIRD_PARTY_NOTICES.md)。

## 许可

项目自有代码及文档采用 **MIT**，见 [LICENSE](LICENSE)。第三方代码保留各自许可；项目许可不授予任何商业游戏素材的权利。代码来源与依赖范围见第三方说明。

文档组织参考 [Immich](https://github.com/immich-app/immich/blob/main/README.md) 的产品/功能/安装入口，以及 [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/README.md) 对可复用组件与托管产品的明确区分；无文案复制或项目关联。
