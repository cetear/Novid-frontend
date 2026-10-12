# 2026-10-13 模型调用归档真实联调

本轮使用 8080 真实后端、受控账号和真实模型，验证最新调用归档协议。既有续跑实现与上一轮记录保留；未更改后端配置、账号、权限角色或协议原文。

## 测试资料与任务

先查询 50 条本人历史运行，未发现新归档。新建合成知识库 #163、Markdown 文档 #182，等待真实入库 READY；创建且只创建一个要求一道简答题的自测任务 #216。

任务最终 SUCCEEDED，模型尝试 12 次。运行 ID `fc1007ad-434c-4b12-9757-61da5c04e316`，最终图摘要包含 42 个节点。观察初期图为空，但独立调用列表已返回可用归档；节点详情也按真实 spanId 成功读取。

## 真实归档与页面验证

成功读取摘要图、节点详情、调用列表、业务节点过滤和单次调用详情，响应 no-store。调用列表实际为 `{call,input,output}` 数组，前端按此校验。

用于全文验收的调用 `94556d0e-ca21-4029-8bea-4b3771c53f93` 属于 `reading_rp00001`，提供方 SUCCESS、本地校验 PASSED，输入与输出 READY。

| 正文 | 实际 UTF-8 字节 | UTF-16 长度 | 1024 单位分页数 | 核验 |
| --- | ---: | ---: | ---: | --- |
| INPUT | 15362 | 12900 | 13 | 各页拼接与完整下载一致，SHA-256 匹配归档 checksum |
| OUTPUT 原始响应 | 9187 | 8013 | 8 | 各页拼接与完整下载一致，SHA-256 匹配归档 checksum |
| OUTPUT 模型文本 | — | 1402 | 1 | 返回 MODEL_TEXT，真实页面切换后显示相同提取文本 |

size=51 与非法 cursor 返回 400。未采集调用全文返回 409 MODEL_CALL_PAYLOAD_UNAVAILABLE，不能当成空内容。

真实 Chrome 页面验证了查询调用、查看完整归档、读取首页、响应／模型视图切换、长标识换行与 375px 页面无溢出。该真实浏览器用例通过。

## 来源撤销与清理

任务已成功后逻辑删除仅本轮创建的知识库 #163（实际 DELETE 返回 200），其文档 #182 随之失效。最初清理测试误设为 204，在删除已完成后断言失败；随后复查已撤销来源，未重复创建资料或运行模型。

重新核验调用仍返回 200 元数据，但 input/output 状态为 ACCESS_REVOKED，preview、正文引用和 diagnostic 已清空。真实页面不再显示正文或诊断，读取／下载按钮禁用。直接分页正文返回 403；下载返回 409 MODEL_CALL_PAYLOAD_UNAVAILABLE。第二个真实浏览器用例通过。全部联调登录令牌已注销。

## 验证范围与限制

真实调用列表共 12 条，其中 6 条具备完整 READY 归档，另 6 条仍为 RUNNING／SKIPPED、NOT_CAPTURED；即使任务成功也不能认定每条调用全文都已归档，前端按实际状态展示。

本轮未制造真实本地校验失败或数据库归档损坏。HTTP 成功但校验失败、诊断摘录、截断标志、500 损坏清理、网络迟到响应与权限撤销清理等异常由模拟回归覆盖，不能计为对应真实故障复现。本轮未重新验收整编保存、PPT 或成功续跑闭环。

## 复现与证据

只读扫描使用 `node scripts/check-model-calls.mjs`。`node scripts/create-model-call-fixture.mjs` 会新建真实资料和付费模型任务，须明确执行，仅供受控联调，不由页面或默认测试自动调用。

创建合成资料后可运行 `pnpm exec playwright test tests/e2e/live-model-calls.spec.ts --project=live`。验收完成再运行 `pnpm exec playwright test tests/e2e/live-model-calls-cleanup.spec.ts --project=live`，清理后全文验证须使用新的合成批次，不能把撤销结果当正常读取失败重试模型。

忽略版本控制的证据文件：`var/live/model-calls-2026-10-13.json`、`model-calls-fixture-2026-10-13.json`、`model-calls-verification-2026-10-13.json`、`model-calls-cleanup-2026-10-13.json`。这些文件不记录登录凭证。

最终检查：96 项单元测试（12 文件）、30 项完整 Chrome 契约回归、上述两个真实 Chrome 用例通过；类型检查、生产构建、ESLint、格式检查和差异空白检查通过。文档链接检查仍报告协议原文已有的 24 个后端相对路径缺失，本轮自有文档未新增缺失目标。
