# 贡献指南

本仓库的运行入口是 `apps/reviewer/`。贡献范围为通用静态资产审阅、标准 GLB/2D 输入、可核验的预览状态、本地审阅和语义侧车；不接受某个来源工程的专有恢复逻辑或真实素材。架构和格式分别见 [架构](docs/ARCHITECTURE.md) 与 [数据契约](docs/DATA-CONTRACT.md)。

使用 Node.js 18+，无需 `npm install`。本地运行 `npm start`，测试依次运行 `npm test`、`npm run build`、`npm run test:build`，并在真实 WebGL 浏览器检查受影响交互。文件测试不能代替视觉、GPU、辅助技术与用户操作验证。

保持数据适配、页面状态、渲染及审阅存储分离；路径经资源解析器校验；目录 JSON 与模型是数据，不作为 JavaScript、安装器或命令执行。跨项目/数据集迁移须显式校验身份和版本。例子使用自制或许可明确的内容，不提交私人资源、凭据、用户备注、机器绝对路径、站点身份或整个工程。

修改后运行 `node scripts/update-source-manifest.mjs` 更新源码文件长度和 SHA-256，再执行测试。公开构建仍由 `scripts/public-build-inputs.json` 独立控制；源码清单不自动授予发布范围。PR 应说明目的、改动、证据、未验证项与兼容风险。代码与文档按 [MIT](LICENSE) 许可贡献，第三方内容保留自身许可。
