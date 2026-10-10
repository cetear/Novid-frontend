# Novid 前端 · 知识工作台

2026-10-09：已按资料驱动 V2 更新自测、整编和 PPT，支持可选备注、自动数量及内容计划。实现见 [V2 更新记录](docs/开发维护/development-2026-10-09-v2.md)，当前结果见 [V2 真实联调](docs/测试验收/live-integration-2026-10-09-v2.md)。[同日早期联调](docs/测试验收/live-integration-2026-10-09.md)保留为独立批次。

基于 Vue 3、TypeScript、Pinia 和 Element Plus 的单工程 SPA，支持知识资料、引用问答、本人会话、笔记确认、学习自测 / 资料整编、PPT / 视频制作、运行检查和账户管理。正式应用直接调用后端 `/api/v1`，协议依据为 [前端接口与联调说明](docs/接口联调/前端接口与联调说明.md)。

完整文档入口：**[docs 文档中心](docs/README.md)**。

## 快速启动

要求 Node.js 24（至少 24.12.0，小于 25），pnpm 11.19.0：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

开发地址默认 `http://127.0.0.1:5173`；后端默认 `http://localhost:8080`，通过同源代理访问。账号由后端管理员提供，刷新后需要重新登录。代理配置、目录职责和部署参考见 [开发与部署](docs/开发维护/开发与部署.md)。

## 文档导航

| 用途 | 入口 |
| --- | --- |
| 功能与权限 | [前端功能介绍](docs/使用说明/前端功能介绍.md) |
| 操作步骤与常见提示 | [前端使用说明](docs/使用说明/前端使用说明.md) |
| 接口与功能边界 | [后端协议](docs/接口联调/前端接口与联调说明.md)、[联调边界](docs/接口联调/integration-gaps.md) |
| 测试命令与验收报告 | [测试与验收指南](docs/测试验收/测试与验收指南.md) |
| 最新真实模型联调 | [2026-10-09 V2 联调报告](docs/测试验收/live-integration-2026-10-09-v2.md) |
| 开发记录 | [2026-10-09 V2 开发记录](docs/开发维护/development-2026-10-09-v2.md) |

## 验证

```powershell
pnpm type-check
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
pnpm docs:check
```

真实预检使用 `pnpm test:backend`；真实浏览器与模型联调使用 `pnpm test:e2e:live`，需要受控账号，会产生实际模型调用和合成测试资源。账号提供、测试清理和证据记录见测试指南。

同日早期批次的入库、问答、会话、笔记、资料整编、费用与权限结果保留在原报告中；资料驱动 V2 采用独立验收记录。2026-10-04 的旧报告和运行图成功属于当时环境，不能代替当前验收。
