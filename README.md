# AssetsPlatform

AssetsPlatform 是本地静态资产审阅器。它以同一界面浏览已登记的自包含 GLB 模型与独立 2D 原图，分开显示物件、技术资源、预览和审阅结论。仓库仅包含自行生成的示例资产与通用代码；没有账号服务、托管导入后台或资产自动上传。

## 运行

需要 Node.js 18+，无需安装 npm 依赖：

```sh
npm start
```

在本机打开 http://127.0.0.1:8768/。也可在 `apps/reviewer` 运行 `python3 serve.py`。本地服务器只监听环回地址，不是公网身份服务。不要执行资产包携带的脚本或游戏二进制。

`apps/reviewer/project-directory.json` 登记两个自制立方体目录和一个自制线性动画练习目录。3D 预览需要 WebGL。GLB 中的材质在浏览器呈现不等于任意源引擎的效果；未提供预览或验证证据时明确保持未知。

## 功能和边界

- 项目/数据集隔离、搜索、筛选、分页，以及物件和资源分别审阅。
- 六种通用检视预设：GLB 材质、中性白模、三阶明暗、柔和中性、冷调双阶、暖调双阶。这些仅改变浏览器显示，不修改模型或宣称复刻任何来源风格。
- 2D 原图与缩略图区分；普通纹理依赖不自动升级成独立 2D 物件。
- 选择、备注和审阅状态保存在当前浏览器，可按项目/数据集身份导出与回导。
- 本地语义标注：确定性事实、受控类别/标签、人工审阅候选、查询与批量范围；不调用模型或收费 API。候选不自动成为已接受事实或播放验证。
- 可选的 GLB 内部依赖索引与自制动画练习；文件级、定义级和来源关系不代表更早工程的血缘或 GPU 外观已验收。

本应用**不**执行游戏、自动提取源工程、恢复脚本或物理行为，不保证任意原始格式可导入。授权资产的整理仍需由目录维护者在应用外完成。

## 接入与验证

- [产品手册](docs/PRODUCT-MANUAL.md)：界面操作与限制。
- [静态接入契约](docs/DATA-CONTRACT.md) 和 [资产接入标准](docs/ASSET-INGESTION-STANDARD.md)：目录格式、身份与只读输入边界。
- [架构](docs/ARCHITECTURE.md)、[公开范围](docs/PUBLIC-SCOPE.md)、[安全说明](SECURITY.md)。
- [自制动画示例](docs/ANIMATION-EXAMPLE.md)、[本地目录导入](docs/LOCAL-DIRECTORY-IMPORT.md)、[语义标注](docs/SEMANTIC-ANNOTATIONS.md)。
- [验证](docs/VALIDATION.md)、[贡献](CONTRIBUTING.md)、[许可](LICENSE)。

```sh
npm test
npm run build
npm run test:build
```

自动检查不替代真实浏览器、GPU、视觉、授权或无障碍验收；未执行的项目应如实报告。`npm run build` 只复制 `scripts/public-build-inputs.json` 显式列入的静态文件到 `dist/reviewer`，不是发布操作。
