# 2026-10-04 目录检查与协议增量开发

本轮以 [前端接口与联调说明](../接口联调/前端接口与联调说明.md) 为唯一协议基线，包含文末 S06 追加约定。沿用现有 Vue 3 + TypeScript + Pinia + Element Plus 单工程，未更换框架。工作区已有未提交文件，本轮未提交 Git 或修改后端环境。

后端启动后的真实索引、模型问答、报告生成与权限验收见 [真实联调记录](../测试验收/live-integration-2026-10-04.md)，下文保留开发阶段的验证结果。

## 目录检查

| 目录 | 职责 |
| --- | --- |
| `src/app` | 启动、身份清理、导航、路由与布局 |
| `src/features/auth / settings / admin` | 登录、改密、用户管理 |
| `src/features/knowledge` | 知识库、文档、范围与引用；本轮增加章节续读、入库进度 / 恢复 |
| `src/features/chat` | 问答 / SSE / 笔记准备；本轮增加 sessionsApi、useSessions 和会话 / 模型 / 工具界面 |
| `src/features/tasks` | 本次登录已知任务；本轮增加进度、覆盖、策略、计划 |
| `src/features/runs` | 本人运行查询；本轮增加图组件及节点 / 时间 / 用量事实模型 |
| `src/shared` | Zod 契约、传输、SSE、安全 Markdown、基础组件 |
| `tests/integration / e2e` | 协议与浏览器验证，测试数据不进入正式应用 |
| `deploy / scripts / docs` | 同源部署参考、后端预检、协议与验证记录 |

## 本轮行为

- S01：会话创建使用固定幂等键；标题改变后换键。本人列表分页、历史 afterSeq 游标、版本删除 / 204。问答同时提交 ID 与版本；冲突、取消、断流先读取服务端版本和历史，由用户决定下一次调用。RESTRICTED 占位不展示旧内容。
- SSE：支持重复 processing 心跳；validated 前不接受草稿。done 覆盖结果并等待正常 EOF，保持已有断流 / 事件顺序校验。
- S02 / S03：章节读取固定 documentVersion / processingRevision，nextOffset 续页；版本冲突清除游标与目录。只向本人请求入库管理状态，展示阶段、批次、期限与已知 / 未知用量。recover 先复核原失败代次；retry / reprocess 由用户明确选择新预算，不自动替代 recover。
- S02 报告：五步进度来自 progress，保留三模型检查点的旧响应兼容；展示并行 currentSteps、Worker、租约、心跳和 coverage，未知覆盖不能称全文已读。轮询遵循 pollAfterMillis 并对读请求失败有界退避。
- S04 / S05：白名单逻辑模型选项、文本 / 结构化校验、只读工具续轮；READ_ONLY 禁止 STRUCTURED。只展示返回的路由快照及工具定义。报告支持 FIXED / PLANNED，后者仅研究报告。plan 的 204 显示尚无计划。
- S06：通过本人 graph API 展示持久节点、parentSpanId 树、实际时间线及 CALL / DEPENDENCY 连线。缺失或未结束节点、遥测丢失均提示不完整；上一执行重新读取。只加总 PROVIDER 的 MODEL / EMBEDDING 叶节点已知用量，SIMULATED 和未知用量不算真实金额。
- 新的 GET 查询均禁用浏览器缓存；身份切换沿用 epoch 及请求中止。敏感内容和令牌仍只在内存中保存。

## 验证环境与边界

| 检查 | 本轮结果 |
| --- | --- |
| 类型检查与生产构建 | 通过，输出 `dist/` |
| ESLint / Prettier | 通过 |
| Vitest | 6 个文件、61 项通过 |
| Chrome 受控浏览器回归 | 13 项全部通过；最后的文档权限清理修改另复测对应文档用例通过 |
| 运行图视觉检查 | 已查看生成截图，节点图、时间线和用量区可读 |

新增浏览器覆盖：会话冲突后不自动重问、使用新版本手动提问、RESTRICTED 清理、204 删除；报告五步与并行步骤 / 计划；原代次恢复 / 固定版本章节续读 / 冲突清理 / 原文下载被拒绝后清理私人内容；实际运行节点、依赖、未知费用与上一执行入口。截图存放于忽略目录 `var/screenshots/`。

终端默认 Node 20 不符合项目要求，使用本机配套 Node 24.19.0 执行验证，不修改机器默认环境。本轮新增受控浏览器用例不等于真实 MySQL / ES / 模型 / Worker 验收。历史真实环境状态保留在 [2026-10-03 联调记录](../测试验收/live-integration-2026-10-03.md)，不能推断当前后端仍为相同状态。

没有接入规划中的 PPT / 视频 / 媒体目录 / 费用或客户端修改计划接口。任务、确认、产物仍无列表；本人会话列表不能恢复这些记录。
