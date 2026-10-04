# 前端开发与后端联调文档

> 此文件保留 2026-10-03 历史基线，已被 [当前前端接口与联调说明](docs/接口联调/前端接口与联调说明.md) 替代。当前开发及联调以新文档为准；下文“无会话 / 进度 / 执行图”等旧边界不适用于当前版本。分类文档从 [文档中心](docs/README.md) 进入；正文中的旧来源引用保留历史信息。

更新日期：2026-10-03。适用版本：当前 Novid 后端。接口、字段、校验和状态来自实际 Controller、契约 DTO、业务服务及数据实现；验证依据为 [后端独立复测报告](backend-retest-2026-10-03.md)。本文区分已有能力与前端展示建议，不以架构规划代替已实现接口。

示例账户、ID、时间和令牌均为占位数据，联调必须使用实际返回值。本文不包含环境凭证。

## 1. 开发范围与页面安排

架构文档默认轻量 HTML + 原生 JavaScript；以下协议也适用于其他前端框架。

| 页面／区域 | 当前可以开发的内容 | 相关接口 |
|---|---|---|
| 登录、首次改密、账户设置 | 登录、当前身份、修改密码、退出 | `/auth/*` |
| 知识库 | 新建、编辑、启用／禁用、删除；ADMIN 切换读取范围 | `/knowledge-bases` |
| 文档 | TXT／Markdown 上传、列表、原文、目录、小片、修订、删除、重处理 | `/documents` |
| 知识问答 | 单轮问答、回答引用、SSE 展示、准备保存笔记 | `/chat`、`/chat/stream`、`/notes/prepare` |
| 笔记确认 | 完整内容和来源预览，批准／拒绝 | `/approvals/{id}` |
| 报告任务 | 创建 FAQ／研究报告、查询状态、暂停／恢复／取消、下载 | `/tasks`、`/artifacts/{id}` |
| 个人偏好 | 查看、添加、编辑、删除 | `/memories` |
| 运行摘要 | 本人运行状态、模型标识、尝试次数和时间 | `/runs` |
| 用户管理（ADMIN） | 创建普通用户、显示一次临时密码、禁用／启用、调整角色 | `/admin/users` |
| 统计卡片 | 授权文档总数、待处理数、就绪数 | `/knowledge/statistics` |

以下能力当前没有完整后端支持：会话列表及历史多轮上下文、视频生成、动态计划展示、费用明细、完整执行图、模型配置管理、共享成员、全文搜索列表、审计查询。聊天可以在当前页面展示本地消息，但后端每次只收到当前问题，不能提示用户“已记住上一轮对话”。

任务、确认、产物**没有列表接口**；本地可保存本用户已经获得的 taskId／approvalId／artifactId，用于重新查询已知记录。此方式不能恢复其他浏览器创建的记录，不能作为完整服务端任务中心。退出或切换账户时清除这些本地记录及私人内容缓存。

## 2. 接入约定

### 2.1 地址、认证与响应

- 业务 API 前缀：`/api/v1`。默认后端地址为 `http://localhost:8080`，实际端口以启动配置为准。
- 仅 `POST /api/v1/auth/login` 与 `GET /actuator/health` 无需认证。健康检查地址不在 `/api/v1` 下；健康成功不保证模型、ES、Worker 全部可用。
- 认证头：`Authorization: Bearer <token>`。token 是不透明随机值，不是 JWT；不通过 Cookie、URL 参数或请求正文传递。
- JSON 使用 camelCase。成功直接返回对象或数组，**没有** `{code,data}` 包装。
- 返回 void 的现有业务接口成功为 **HTTP 200、空响应体**；上传和任务登记为 202。空响应不得直接调用 `response.json()`。
- 时间字段是 ISO-8601 UTC 字符串，如 `2026-10-03T08:00:00Z`；前端转换为用户时区展示。
- 数值 ID 当前以 JSON number 返回。Java long 若将来超过 JavaScript 安全整数范围，需要协调后端改为字符串，不能在已发生精度丢失后用 `String(id)` 补救。字符串 ID 如 traceId、approvalId、sectionId、chunkId 保持原样。
- 未知 JSON 字段会被拒绝。不要把整个响应对象原样作为 PATCH 请求，也不要附加 userId、requesterUserId、modelId、endpoint、密钥、预算等字段。`ownerUserId` 仅能用于下文明确列出的范围筛选，不用于指定新资源归属。

### 2.2 同源与开发代理

当前后端不开放跨域 CORS。开发服务器应把浏览器同源的 `/api` 请求代理到后端；如需健康检查，一并代理 `/actuator/health`。部署也采用同域反向代理。代理须传递 Authorization、multipart 请求体与 SSE 响应，SSE 路径关闭响应缓冲并允许足够的响应等待时间。

不要把浏览器跨域预检失败当成登录或模型故障。MySQL、ES、模型地址与凭证全部留在后端；前端只配置 API 地址。

### 2.3 分页、列表与版本

分页参数 `page` 从 **0** 开始，范围 0～10000；`size` 默认 20，范围 1～100。返回裸数组，没有 total／hasNext／totalPages。

文档列表先分页，再过滤来源已经无权读取的文档，因此中间页也可能不足 size 甚至为空。不要以“返回不足一页”作为可靠的最后一页依据；界面可以提供明确的上一页／下一页，当前后端不支持精确总页数。

| 版本字段 | 用途 | 前端提交位置 |
|---|---|---|
| 知识库 `version` | 编辑和删除冲突检查 | PATCH 正文／DELETE 查询参数 |
| 文档 `documentVersion` | 原文内容版本 | PATCH 正文／DELETE 查询参数 |
| 文档 `activeProcessingRevision` | 当前内容版本的已激活索引代次，可为 null | 展示、判断索引激活变化；不由客户端指定 |
| 记忆 `version` | 修改和删除冲突检查 | PATCH 正文／DELETE 查询参数 |
| 任务 `stateVersion` | 状态变化序号 | 仅展示／比较；actions 不接收该字段 |

修改后使用响应中的新版本覆盖本地状态。409 时重新查询、让用户核对后重试，不自动覆盖。记忆的版本不匹配当前返回 403，不能统一当作 409。

### 2.4 幂等键与重复提交

仅文档上传、任务创建必须带 `Idempotency-Key`，格式为 `[A-Za-z0-9_.:-]{1,128}`。可以在一次新操作开始时生成 `crypto.randomUUID()`，网络结果不确定时用**同一个键和同一组参数**重试；用户改变文件、目标、主题、范围或文档集合时生成新键。

同用户、同 API、同键同参数返回既有资源；同键不同参数为 409 OPERATION_CONFLICT。不同 API 的键空间独立。后端保留去重记录至少七天，当前未自动清理，不承诺无限期 exactly-once。

其他创建接口（知识库、记忆、notes/prepare）不具备上述键去重。reprocess／retry 每次都会登记新处理代次，不能自动重复发送。task actions 也不是幂等设置：重复 pause／resume／cancel 可能为 409；网络中断后先查任务状态。

## 3. 登录、角色与资料范围

### 3.1 登录流程

1. 登录，保存返回的 token、expiresAt 和 user。没有默认教学账号或公开注册接口；由管理员提供账号，测试时的随机账号已清理。
2. `user.passwordChangeRequired=true` 时只进入改密流程。此时仅可调用 me、password、logout；业务接口为 403 PASSWORD_CHANGE_REQUIRED。
3. 改密成功后**当前及其他旧 token 全部失效**，清理本地登录状态，重新登录。
4. 页面恢复时通过 me 核验身份。令牌有效期八小时；没有 refresh token／续期接口。
5. 退出时撤销当前 token，并清除本地状态。禁用、角色调整、密码变更都会使已有登录失效。

用户名为 3～64 个 `A-Za-z0-9_.-` 字符。新密码为 12～64 个 Java／JS UTF-16 单元，且不超过 **72 个 UTF-8 字节**；中文密码也须检查字节长度。登录密码最多 72 UTF-8 字节。除正文码点上限外，文档中的字符长度限制按 Java String 长度理解，可用 JavaScript `.length` 对应；UTF-8 字节用 `new TextEncoder().encode(value).length`。

业务请求 401 通常需清除登录并引导重新登录；登录 401 应提示凭证错误。**改密时原密码错误也会返回 401**，不要立即断言当前 token 已失效，可调用 me 复核。登录按账号有五分钟窗口限流，连续登录请求可能触发 429，避免自动反复重新登录。

### 3.2 权限矩阵

| 操作 | USER | ADMIN |
|---|---|---|
| 读取／检索知识资料 | 本人启用且未删除的库 | 默认 SELF，可显式 ALL／SELECTED 读取他人启用库 |
| 创建、编辑、上传、修订、删除知识资料 | 本人资源 | 仍限本人资源 |
| 读取本人禁用库元数据、重新启用库 | 允许，需已知库 ID | 同样仅本人 |
| 删除禁用库中的本人文档／来源撤销的本人笔记 | 允许，需已知 ID 和文档版本 | 无他人写入旁路 |
| 偏好、确认、任务、报告、运行摘要 | 仅本人 | 同样仅本人 |
| 用户管理 | 不允许 | 允许；最后有效 ADMIN 不可禁用或降级 |

禁用库不出现在知识库列表，文档读取／检索也受阻；owner 仍可通过已知 ID 读取库元数据并重新启用。目前没有“包含禁用库”的管理列表或禁用库文档列表参数。禁用操作前应保留库 ID 或提供已知 ID 的恢复入口；不能假设刷新列表后仍能找回全部禁用库。

按钮展示可依据 `user.role`、资源 `ownerUserId` 与 `user.id`；最终权限由每次后端请求决定。知道 ID 不等于可以读取，不存在与无权资源通常都返回 403，不应据此猜测他人数据是否存在。

### 3.3 Scope 的两种传递形式

问答和任务 JSON 使用 `scope` 对象：

```json
{"mode":"SELECTED","knowledgeBaseIds":[12,18],"ownerUserId":null}
```

知识库／文档列表使用查询参数：

```text
GET /api/v1/documents?scopeMode=SELECTED&knowledgeBaseIds=12,18&page=0&size=20
GET /api/v1/knowledge-bases?scopeMode=ALL&ownerUserId=7&page=0&size=20
```

- SELF 默认本人；knowledgeBaseIds 应为空，ownerUserId 省略或为本人。
- SELECTED 最多 100 个正数库 ID，空数组表示**零范围**。包含越权或禁用库时整体拒绝，不会静默过滤其中几个 ID。
- ALL 仅 ADMIN；knowledgeBaseIds 必须为空。ownerUserId 可进一步筛选某个用户的知识库，但不能把 SELF 变为其他用户范围。
- `GET /knowledge/statistics` 仅接收 scopeMode、knowledgeBaseIds，不支持 ownerUserId 筛选；问答和任务的 scope 支持该字段。
- 个人资源不接收 scope。前端缓存按用户及完整范围隔离；切换账号、范围或遇到授权撤销时清理相关内容。

## 4. 全部已实现 HTTP 接口

下表路径均相对 `/api/v1`；标有空的响应为 200 空正文。字段类型见第 5 节。PATCH 不是任意字段局部更新，应只发送表中列出的字段；boolean 字段显式发送 true／false，避免缺省被解析为 false。

### 4.1 账户

| 方法 | 路径 | 发送内容 | 成功响应 |
|---|---|---|---|
| POST | `/auth/login` | JSON `{username,password}` | 200 LoginResult |
| POST | `/auth/logout` | 无正文，仍需认证头 | 空 |
| GET | `/auth/me` | 无 | 200 UserSnapshot |
| POST | `/auth/password` | JSON `{oldPassword,newPassword}` | 空；旧登录撤销 |
| POST | `/admin/users` | JSON `{username}`，只能创建 USER | 200 CreatedUser |
| GET | `/admin/users` | page、size | 200 UserSnapshot[] |
| PATCH | `/admin/users/{id}` | JSON `{enabled,role}`，role 为 USER／ADMIN | 200 UserSnapshot |

CreatedUser 中 temporaryPassword 只在创建响应返回一次。提供明确的临时密码展示／复制流程，不依赖之后从列表再次取回；不存在密码重置或用户删除接口。

### 4.2 知识库、文档与统计

| 方法 | 路径 | 发送内容 | 成功响应 |
|---|---|---|---|
| POST | `/knowledge-bases` | JSON `{name,description}` | 200 KnowledgeBaseSnapshot |
| GET | `/knowledge-bases` | scopeMode、knowledgeBaseIds、ownerUserId、page、size | 200 KnowledgeBaseSnapshot[] |
| GET | `/knowledge-bases/{id}` | 无 | 200 KnowledgeBaseSnapshot |
| PATCH | `/knowledge-bases/{id}` | JSON `{version,name,description,enabled}` | 200 KnowledgeBaseSnapshot |
| DELETE | `/knowledge-bases/{id}` | query `version` | 空 |
| POST | `/documents` | multipart `file`、`knowledgeBaseId`；Idempotency-Key | 202 DocumentSnapshot |
| GET | `/documents` | scopeMode、knowledgeBaseIds、ownerUserId、page、size | 200 DocumentSnapshot[] |
| GET | `/documents/{id}` | 无，始终读取当前内容版本 | 200 DocumentContent |
| GET | `/documents/{id}/source` | 无 | 200 UTF-8 text/plain 附件 |
| GET | `/documents/{id}/sections` | page、size | 200 SectionSnapshot[] |
| GET | `/documents/{id}/chunks` | page、size | 200 ChunkSnapshot[] |
| PATCH | `/documents/{id}` | JSON `{documentVersion,title,text}` | 200 DocumentSnapshot |
| DELETE | `/documents/{id}` | query `documentVersion` | 空 |
| POST | `/documents/{id}/index-actions` | query `action=retry` 或 `action=reprocess`；无正文 | 空 |
| GET | `/knowledge/statistics` | scopeMode、knowledgeBaseIds | 200 KnowledgeStatistics |

库名称 1～200、description 必须是字符串且最多 2000，可传空串。文档标题最多 200；正文非空白、最多 100 万 Unicode 码点且最多 10 MB UTF-8 字节，禁止二进制控制字符。每用户最多 100 个未删除知识库；上传接口检查本用户未删除文档总数的 10000 上限，计数包括已保存笔记。达到这些配额会返回 DOCUMENT_LIMIT_EXCEEDED。

上传白名单为 `.txt`／`.md`／`.markdown`，UTF-8，可有 BOM；文件 1 字节～10485760 字节，文件名不超过 200 且不能含路径分隔符。允许 MIME 为 text/plain、text/markdown、text/x-markdown、application/octet-stream。浏览器 MIME 为空时可将同一 File 的字节包装为允许的 text/plain／text/markdown Blob，保留文件名；后端仍校验扩展名和 UTF-8。上传 FormData 时不手工设置 Content-Type，浏览器负责 multipart boundary。

### 4.3 问答、笔记确认、偏好与运行摘要

| 方法 | 路径 | 发送内容 | 成功响应 |
|---|---|---|---|
| POST | `/chat` | JSON `{question,scope}`；scope 可省略 | 200 AiResult |
| POST | `/chat/stream` | 同上；Accept: text/event-stream | 200 SSE，或非 2xx JSON 错误 |
| POST | `/notes/prepare` | JSON `{knowledgeBaseId,title,content,sourceDependencies}` | 200 ApprovalSnapshot；尚未保存文档 |
| GET | `/approvals/{id}` | 无 | 200 ApprovalSnapshot |
| POST | `/approvals/{id}/decision` | JSON `{approved}`，显式布尔值 | 200 ApprovalSnapshot |
| GET | `/memories` | 无，无分页参数 | 200 MemorySnapshot[] |
| POST | `/memories` | JSON `{content}` | 200 MemorySnapshot |
| PATCH | `/memories/{id}` | JSON `{version,content}` | 200 MemorySnapshot |
| DELETE | `/memories/{id}` | query `version` | 空 |
| GET | `/runs` | page、size | 200 TraceSnapshot[] |
| GET | `/runs/{id}` | 无 | 200 TraceSnapshot |

question 非空白且最多 2000 字符；以去除首尾空白后的“统计”开头，会走程序统计，不调用聊天模型。偏好 content 非空白且最多 2000 字符，每人最多 100 条。笔记 title 最多 200，content 使用文档正文限额；sourceDependencies 必须有 1～32 项，所有 ID 和版本为正数，元素不能为 null。

### 4.4 FAQ／研究报告任务与产物

| 方法 | 路径 | 发送内容 | 成功响应 |
|---|---|---|---|
| POST | `/tasks` | JSON `{taskType,topic,scope,documentIds}`；Idempotency-Key | 202 TaskSnapshot |
| GET | `/tasks/{id}` | 无 | 200 TaskSnapshot |
| POST | `/tasks/{id}/actions` | JSON `{action}`，pause／resume／cancel | 200 TaskSnapshot |
| GET | `/artifacts/{id}` | 无 | 200 UTF-8 text/markdown 附件 |

taskType 为 `FAQ` 或 `RESEARCH_REPORT`；topic 非空白、最多 1000 字符；documentIds 为 1～6 个正数 ID，元素不能为 null，所选文档必须在授权范围内。任务读取原文，不要求文档已经完成向量索引。NOTES_VIDEO 返回 503 MEDIA_CAPABILITY_UNAVAILABLE，前端不提供可用的视频生成入口。

没有 `GET /tasks`、任务 SSE、任务步骤详情、终态 resume／retry 或产物 JSON 元数据接口。失败后用户明确选择重新生成时，以新幂等键创建新任务；不要自动重试模型任务。

## 5. 返回字段与前端类型

以下 TypeScript 定义仅用于前端理解与类型声明，不代表后端另有这些类型的查询接口。字段均存在，标注 `| null` 的字段可返回 null。

```ts
type Id = number;
type Role = "USER" | "ADMIN";
type ScopeMode = "SELF" | "SELECTED" | "ALL";
type TaskStatus = "QUEUED" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED";

interface ScopeRequest {
  mode: ScopeMode;
  knowledgeBaseIds: Id[];
  ownerUserId: Id | null;
}
interface ApiError { code: string; message: string; retryable: boolean }
interface UserSnapshot {
  id: Id; username: string; role: Role; enabled: boolean;
  permissionVersion: number; passwordChangeRequired: boolean;
}
interface LoginResult { token: string; expiresAt: string; user: UserSnapshot }
interface CreatedUser { user: UserSnapshot; temporaryPassword: string }
interface KnowledgeBaseSnapshot {
  id: Id; ownerUserId: Id; name: string; description: string;
  enabled: boolean; deleted: boolean; version: number;
}
interface DocumentSnapshot {
  id: Id; knowledgeBaseId: Id; ownerUserId: Id; title: string;
  format: "txt" | "md" | "markdown"; documentVersion: number;
  ingestionStatus: "RECEIVED" | "READY" | "FAILED";
  activeProcessingRevision: number | null;
}
interface SourceDependency { knowledgeBaseId: Id; documentId: Id; documentVersion: number }
interface DocumentContent {
  document: DocumentSnapshot; text: string; sourceDependencies: SourceDependency[];
}
interface SectionSnapshot {
  sectionId: string; parentSectionId: string | null; ancestorSectionIds: string[];
  headingPath: string; ordinal: number; startOffset: number; endOffset: number;
}
interface ChunkSnapshot {
  chunkId: string; sectionId: string; contextParentId: string;
  chunkIndexInSection: number; chunkIndexInParent: number;
  startOffset: number; endOffset: number; rawText: string;
  embeddingText: string; chunkHash: string;
}
interface KnowledgeStatistics { documentCount: number; receivedCount: number; readyCount: number }
interface EvidenceBundle {
  evidenceId: string; document: DocumentSnapshot; processingRevision: number;
  sectionId: string; headingPath: string; matchedChunkIds: string[];
  includedChunkIds: string[]; startOffset: number; endOffset: number; text: string;
}
interface AiResult {
  status: "SUCCESS" | "NEEDS_INPUT"; answer: string; citations: EvidenceBundle[];
  traceId: string; modelId: string; modelAttempts: number; mock: boolean; error: string | null;
}
interface ApprovalSnapshot {
  approvalId: string; operationId: string; actorUserId: Id; knowledgeBaseId: Id;
  targetVersion: number; title: string; content: string;
  sourceDependencies: SourceDependency[]; expiresAt: string;
  status: "WAITING" | "APPROVED" | "REJECTED"; documentId: Id | null;
}
interface MemorySnapshot { id: Id; userId: Id; content: string; version: number }
interface TraceSnapshot {
  traceId: string; actorUserId: Id; status: "SUCCESS" | "NEEDS_INPUT" | "FAILED";
  modelId: string; attempts: number; mock: boolean; createdAt: string;
}
interface TaskSnapshot {
  taskId: Id; requesterUserId: Id; taskType: "FAQ" | "RESEARCH_REPORT"; status: TaskStatus;
  stateVersion: number; modelAttempts: number; completedSteps: number;
  errorCode: string | null; artifactId: Id | null;
}
```

这些枚举描述当前实现。遇到未来未知状态时显示原状态或“未知状态”，停用可能有副作用的按钮，不自动当作成功。

上传 202 示例：

```json
{
  "id": 101, "knowledgeBaseId": 12, "ownerUserId": 7,
  "title": "学习笔记.md", "format": "md", "documentVersion": 1,
  "ingestionStatus": "RECEIVED", "activeProcessingRevision": null
}
```

`GET /documents/101` 的外层是 `{document,text,sourceDependencies}`，不是 DocumentSnapshot 本身。format 是文档存储格式，title 是标题／上传文件名；没有文件大小、上传时间、generated、处理百分比或入库错误详情字段。

AiResult 的 SUCCESS 表示已交付回答，NEEDS_INPUT 表示当前范围没有可用证据，是正常 200 而非请求失败。当前失败通常通过非 2xx JSON 或 SSE error 交付，不返回 `AiResult.status=FAILED`。mock=true 显示测试结果标识；modelId 是后端内部目标 ID，如 primary／program／none，不一定是供应商模型名称。程序统计可为 mock=false、modelAttempts=0、无 citations。

运行摘要不包含原问题、答案、Token 用量、价格、完整执行步骤；`GET /runs/{traceId}` 仍返回同样的摘要形状，不能据此绘制完整执行图。失败响应也不保证带 traceId。

## 6. 页面流程与状态处理

### 6.1 上传、修订与索引

1. 用户选择本人启用库与文件，完成大小／扩展名检查并生成幂等键。
2. 上传得到 202 后展示“资料已登记，索引尚未就绪”，保存 DocumentSnapshot。
3. 建议每 2～3 秒查询已知文档详情，适当退避；页面退出或无登录时停止轮询。等待过久提示“处理尚未完成”，不擅自把文档变为失败。
4. `ingestionStatus=READY` 且 activeProcessingRevision 非 null 后，展示目录／小片并可用于检索。无激活代次时 sections／chunks 为 409 INDEX_NOT_READY。
5. FAILED 时可展示重处理按钮；当前详情没有入库 errorCode，不能提供后端不存在的精确失败原因。

**对外文档状态不是内部任务状态。** 内部领取会进入 PROCESSING，但 DocumentSnapshot 当前不暴露该变化；新上传可能一直显示 RECEIVED，直到 READY 或 FAILED。不要要求从详情先读到 PROCESSING 才允许进入 READY。

修订内容使 documentVersion 增加、新版本登记索引；旧版本的目录／引用不能直接套用到新正文。retry 与 reprocess 当前行为相同：创建新 processing revision，不改变 documentVersion。

重处理已 READY 的文档时，旧激活索引可继续可用，状态仍可为 READY。请求前记录 activeProcessingRevision，之后观察它增大才可确认新代次激活；新代次失败时旧 READY 仍可能保留。当前无处理批次详情接口，前端只能展示“已请求重处理／等待新代次”，不能仅凭 READY 宣告重处理成功，也不能显示编造的进度。

删除或禁用先在权威数据中生效；ES 清理由后台队列完成，界面按 API 成功更新资源即可，不等待 ES 物理删除。禁用库正文和文档列表不可读，删除本人文档可以按之前获得的 ID 与 documentVersion 调用；需要重新查询正文时先恢复库权限。

### 6.2 引用与原文定位

回答中的 `[E1]` 对应 citations 的 evidenceId。展示标题、库 ID、documentVersion、headingPath 与原文范围；matchedChunkIds 是召回小片，includedChunkIds 是实际交付上下文，后者可能更多。citations 是交付给模型的证据集合，不保证每一项都被答案文本引用。

offset 为 Java／JavaScript **UTF-16 索引，起点包含、终点不包含**，原文范围可用 `text.slice(startOffset,endOffset)`。用 DocumentContent.text 的原始内容定位，不在渲染后的 Markdown HTML、重新规范化换行的文本或不同内容版本中套用 offset。

当前文档详情和 source 下载始终返回当前版本，没有历史版本读取参数。证据版本与当前版本不同时，展示证据自身的 text 和版本标识，提示原文已更新；不要假设 `?documentVersion=1` 能取历史内容或在新正文上高亮旧位置。章／片 ID 是不透明字符串，目录可以用 parentSectionId 建树，但加载分页目录后再整合。

报告使用 `[D101v1]` 形式的版本引用，下载的是 Markdown 文本，当前没有产物 JSON 来源列表接口；不能假设报告引用都属于文档当前版本。

### 6.3 保存 AI 笔记的确认流程

1. 从回答 citations 的 document 元信息取得真实 SourceDependency，按 documentId＋documentVersion 去重，保留全部实际使用来源；无来源的程序统计不能直接走这个笔记接口。
2. 用户选择**本人启用**目标库，核对 title、content 和来源，调用 notes/prepare。
3. 展示 ApprovalSnapshot 完整预览；GET approvals/{id} 可重新核验来源。prepare 只创建确认记录，不代表笔记保存成功。
4. 用户批准时只发送 `{ "approved": true }`；拒绝发送 false。确认接口不接收修改后的内容、目标、operationId 等字段。
5. 只有响应 status=APPROVED 且 documentId 非 null 才展示保存成功；新笔记也需要索引，不能立即宣称可检索。

示例 prepare：

```json
{
  "knowledgeBaseId": 12,
  "title": "本次问答总结",
  "content": "根据资料整理的笔记正文。",
  "sourceDependencies": [{"knowledgeBaseId":12,"documentId":101,"documentVersion":1}]
}
```

确认期限 30 分钟。WAITING／APPROVED／REJECTED 是当前存储状态；过期不会保证自动变成 EXPIRED，界面依据 expiresAt 展示倒计时，最终以后端 410 为准。目标库 version 变化或来源／权限变化会使确认无效，需要重新准备；修改预览内容也必须生成新确认记录。服务端会展开派生来源，返回列表可能不同于提交列表，应展示返回的完整来源。

重复批准已成功的同一确认会返回既有事实并重新核验来源，不创建第二份笔记；拒绝已批准的确认、再次处理已拒绝记录会冲突。不要复用 prepare 来模拟批准重试，更不能在客户端移除来源约束。

### 6.4 报告任务

创建示例：

```json
{
  "taskType":"RESEARCH_REPORT", "topic":"梳理资料中的备份规则",
  "scope":{"mode":"SELECTED","knowledgeBaseIds":[12],"ownerUserId":null},
  "documentIds":[101,102]
}
```

| status | 页面提示 | 可发起操作 | 是否停止常规轮询 |
|---|---|---|---|
| QUEUED | 等待执行 | pause、cancel | 否 |
| RUNNING | 正在生成；显示 completedSteps／3 | pause、cancel | 否 |
| PAUSED | 已暂停 | resume、cancel | 可停止或降低频率 |
| SUCCEEDED | 已完成 | 下载 artifactId 对应报告 | 是 |
| PARTIAL | 已完成部分覆盖；提示阅读报告中的覆盖说明 | 下载 artifactId 对应报告 | 是 |
| FAILED | 失败，展示 errorCode；可由用户另建新任务 | 无原任务状态操作 | 是 |
| CANCELLED | 已取消 | 无原任务状态操作 | 是 |

建议每 2～3 秒轮询 GET tasks/{id}，网络故障后退避；模型耗时不应导致前端自动重复创建。后台当前是固定三角色步骤，completedSteps 表示完成步数，不代表精确百分比或当前正在执行哪个角色。PARTIAL 是有产物的终态，不是继续等待的中间态。

pause／cancel 撤销后端提交新结果的执行权，但正在远程生成的模型请求可能继续消耗费用；浏览器关闭或 AbortController 也不等于任务取消。只有显式调用 cancel 才发起任务状态取消；没有退款或远程取消确认字段。

下载使用 **artifactId**，不是 taskId。下载时重新核验本人及全部来源；原先成功的任务在来源禁用／删除后仍可能为 403，前端需显示“产物当前不可访问”，不得绕过检查继续展示旧缓存。

### 6.5 当前联调环境的开关

最近复测时真实 MySQL、ES、DeepSeek 和 embedding 均可用，但 `.env` 的 `INGESTION_WORKER_ENABLED`、`TASK_WORKER_ENABLED` 保持 false，验收通过是受控触发正式流水线／Worker 的结果。前端通过正式 API 上传／创建任务后，若联调环境仍沿用此配置，将停留在 RECEIVED／QUEUED；这不证明前端轮询有问题。

联调前由后端负责人确认可用账号、原知识索引已初始化、SEARCH_ENABLED 以及需要的 Worker 开关，再重启后端。前端没有修改开关、初始化索引、触发后台批次或读取 Worker 状态的接口。清理自动消费沿用入库 Worker 开关；关闭时由后端维护入口处理。

## 7. SSE 协议与可复制客户端示例

`POST /chat/stream` 使用带 Bearer 的 fetch 读取流。原生 EventSource 不适用于当前 POST＋认证头协议；没有 GET 订阅、Last-Event-ID 续传或自动重连去重能力。

当前服务先完成问答、汇聚和授权复核，才发送 progress／delta／citation／done。用户可能等待一段时间才收到第一个事件；先显示本地“正在处理”，不显示虚构的后端阶段。delta 为已校验全文的分段输出，每段最多 512 个 UTF-16 单元，**不是模型原生 Token 流**；没有心跳事件。

| event | data | 客户端行为 |
|---|---|---|
| progress | `{"stage":"validated"}` | 已完成后端校验 |
| delta | `{"text":"回答片段"}` | 追加文本 |
| citation | 一个 EvidenceBundle | 按 evidenceId 收集引用 |
| done | 完整 AiResult | 以其 answer／citations 覆盖最终结果，避免再次追加全文 |
| error | `{"code":"MODEL_INVALID_OUTPUT","message":"..."}` | 显示失败并结束；没有 done，也不保证 retryable 字段 |

事件有字符串 id，从 1 递增，但仅对本次响应有效。鉴权、权限、参数失败可直接返回非 2xx JSON；部分模型／基础设施失败返回 HTTP 200 + SSE error。HTTP 200、收到 done 都不能单独证明传输正常结束：应等待正常 EOF；无 done 也无 error 的断流属于结果不确定，不自动重发模型请求。

以下代码面向当前协议，可复制到前端请求模块。所有相对路径假设同源代理已设置；token 由登录状态注入。示例不处理 UI 或令牌持久化。

```javascript
const API_BASE = "/api/v1";

async function checkResponse(response) {
  if (response.ok) return;
  let detail = {};
  try { detail = await response.json(); } catch { /* 非 JSON 代理错误 */ }
  throw Object.assign(new Error(detail.message || `HTTP ${response.status}`), {
    httpStatus: response.status, code: detail.code || "HTTP_ERROR",
    retryable: detail.retryable === true
  });
}

// JSON 接口；空正文成功返回 undefined。登录时不传 token。
async function api(path, { method = "GET", token, json, key, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${API_BASE}${path}`, {
    method, headers, signal,
    body: json === undefined ? undefined : JSON.stringify(json)
  });
  await checkResponse(response);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function uploadDocument(file, knowledgeBaseId, token, key, signal) {
  const form = new FormData();
  form.set("knowledgeBaseId", String(knowledgeBaseId));
  const allowed = ["text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"];
  const upload = allowed.includes(file.type.toLowerCase()) ? file
    : new Blob([file], { type: /\.(md|markdown)$/i.test(file.name) ? "text/markdown" : "text/plain" });
  form.set("file", upload, file.name);
  const response = await fetch(`${API_BASE}/documents`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
    body: form
  });
  await checkResponse(response);
  return response.json();
}

async function readChatStream(request, token, onEvent, signal) {
  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request)
  });
  await checkResponse(response);
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    throw new Error("没有获得 SSE 响应");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", result, completed = false;

  function drainFrames() {
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(pending))) {
      const frame = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      let event = "message";
      const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
      if (!data.length) continue;
      const payload = JSON.parse(data.join("\n"));
      if (event === "error") {
        onEvent(event, payload);
        throw Object.assign(new Error(payload.message || "问答失败"), { code: payload.code });
      }
      if (event === "done") { result = payload; completed = true; }
      onEvent(event, payload);
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read(); // 断流即抛错，不把已收到 done 当成正常 EOF
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      drainFrames();
    }
    pending += decoder.decode();
    drainFrames();
    if (!completed || pending.trim()) throw new Error("响应未完整结束，请核对后决定是否重新提问");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// 原文传 /documents/{id}/source；报告传 /artifacts/{artifactId}。
// filename 可从 Content-Disposition 解析，或使用前端已知的安全文件名。
async function download(path, filename, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  await checkResponse(response);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

调用 SSE 时可用 AbortController 管理页面生命周期与客户端等待时限，例如设置约 90 秒的等待上限；后端在线预算为 60 秒，单次模型至多 30 秒。用户中断阅读不保证取消已发出的模型调用。

下载地址不能直接放到需要登录的 `<a href>`／iframe 中期待浏览器自动附带 Bearer，也不能把 token 加到 URL。报告预览可用同样的认证 fetch 读取 text，再安全渲染 Markdown。资料及模型文本不可信，使用 textContent 或经过净化的 Markdown 渲染，禁用原始 HTML；不要把回答直接传给 innerHTML。

原文下载的服务端附件名为 `document-{id}.txt`，报告为 `report-{taskId}.md`。原文下载是当前版本的 UTF-8 文本，上传时的 BOM 已移除，不保证与上传文件字节完全相同；前端可提供合理的下载文件名，但不能据此增加历史版本能力。

## 8. 错误处理

普通错误格式：

```json
{"code":"OPERATION_CONFLICT","message":"文档版本已变化","retryable":false}
```

| HTTP | code | 前端处理 |
|---|---|---|
| 401 | AUTH_REQUIRED | 登录失效／凭证错误；按第 3 节区分登录和改密场景 |
| 403 | PASSWORD_CHANGE_REQUIRED | 引导首次改密 |
| 403 | ACCESS_DENIED | 显示当前不可访问，清除相应私人内容缓存；不要自动扩大范围 |
| 400 | INVALID_ARGUMENTS | 校验参数、未知 JSON 字段、枚举、ID；保持用户输入 |
| 400 | UNSUPPORTED_DOCUMENT_TYPE、DOCUMENT_PARSE_FAILED | 格式／编码／正文问题，提示修改文件 |
| 400 或 413 | DOCUMENT_LIMIT_EXCEEDED | 大小、文本、文档／知识库／偏好配额等；查看 message，不能都解释成上传过大 |
| 409 | OPERATION_CONFLICT | 版本、同键异参、重复状态操作、用户名重复、最后管理员保护等；按操作重新查询核对 |
| 409 | APPROVAL_CONFLICT | 确认已处理或目标变化，重新预览／准备 |
| 409 | INDEX_NOT_READY | 当前内容版本尚无激活结构；等待处理 |
| 409 | STALE_EXECUTION | 执行权变化；刷新服务端状态，不自动重放写操作 |
| 410 | APPROVAL_EXPIRED | 确认过期，重新 prepare |
| 429 | RATE_LIMITED | 登录窗口／未完成任务配额／并发等限制，退避；不假设一定带 Retry-After |
| 504 | MODEL_TIMEOUT | 提示本次未获得结果，由用户决定是否重试 |
| 503 | MODEL_UNAVAILABLE、NO_COMPATIBLE_FALLBACK、SEARCH_UNAVAILABLE | 服务／模型暂不可用，不降级展示伪造答案 |
| 503 | MEDIA_CAPABILITY_UNAVAILABLE | 视频能力未完成，不进入付费／生成流程 |
| 400 | MODEL_INVALID_OUTPUT、CONTEXT_MAPPING_INVALID、BUDGET_EXCEEDED | 本次结果未通过约束／预算；不是成功回答，也不应只显示“输入框错误” |
| 400 | MODEL_ROUTE_NOT_FOUND、MODEL_CAPABILITY_MISMATCH | 后端模型配置／能力不匹配，提示联系后端检查 |
| 500 | INTERNAL_ERROR | 服务暂不可用，保留草稿，提供手动重试 |

上述是常见错误，不要求前端枚举所有未来 code。未知错误显示安全 message 与 code，不展示内部堆栈。普通错误的 retryable 表示后端类别可重试，不授权前端自动重新生成付费任务；SSE error 缺少该字段时不擅自当成 true。

## 9. 前端联调验收清单

- [ ] 同源代理正常；登录和健康检查无需 Bearer，业务请求缺少 Bearer 为 401。
- [ ] 临时密码登录进入改密页；改密后旧 token 不能继续使用；退出／换账号清除私人缓存。
- [ ] USER 不能使用 ALL；ADMIN 默认 SELF，跨库只读，写入他人库按钮不可用；私人记录不跨用户。
- [ ] 列表按 0 基分页、裸数组解析；文档短页不假定结束；无 total 字段也不伪造总页数。
- [ ] 上传限制、UTF-8、multipart 与幂等键正确；202 显示待处理；已启用 Worker 的环境能变为 READY。
- [ ] 文档编辑／删除提交最新 documentVersion；库与偏好各自使用正确 version；冲突刷新后由用户核对。
- [ ] 禁用库的列表消失、owner 元数据恢复、已知文档删除行为符合权限；来源撤销后清除不可读内容。
- [ ] 单轮 JSON／SSE 均正确；NEEDS_INPUT 作为正常空证据结果；SSE 分片、完整 EOF、非 2xx JSON 和 200 error 都能处理。
- [ ] 引用按版本和 UTF-16 范围定位；历史证据不在当前新版正文上误高亮；Markdown 无原始 HTML 执行。
- [ ] prepare 未宣称已保存；approve 后获得 documentId；过期、拒绝、目标变更和重复批准有正确反馈。
- [ ] FAQ／研究报告正确创建与轮询；暂停／恢复／取消按状态启用；PARTIAL 可下载并说明覆盖；下载用 artifactId。
- [ ] 带认证下载成功；来源失效后的下载 403 正确展示；URL 中无 token。
- [ ] Worker 关闭时不把长期 RECEIVED／QUEUED 当成前端故障；没有开发不存在的列表、刷新令牌、会话、视频、费用和执行图接口。

## 10. 后端实现依据

接口发生变化时，优先核对以下源码，再同步本文与前端契约：

- [账户接口](../Novid/lab-web/src/main/java/com/example/ailab/web/controller/AccountController.java)、[知识接口](../Novid/lab-web/src/main/java/com/example/ailab/web/controller/KnowledgeController.java)。
- [问答与个人资源接口](../Novid/lab-web/src/main/java/com/example/ailab/web/controller/AssistantController.java)、[任务接口](../Novid/lab-web/src/main/java/com/example/ailab/web/controller/TaskController.java)。
- [HTTP 请求校验](../Novid/lab-web/src/main/java/com/example/ailab/web/dto/Requests.java)、[错误映射](../Novid/lab-web/src/main/java/com/example/ailab/web/exception/ApiExceptionHandler.java)、[Bearer 认证](../Novid/lab-web/src/main/java/com/example/ailab/web/security/BearerTokenFilter.java)。
- [返回契约目录](../Novid/lab-contract/src/main/java/com/example/ailab/contract/dto)、[现有 API 概览](api.md)、[实施状态](implementation-status.md)。

本文未新增或修改后端接口，也未启用 Worker 或写入测试数据。

文档核对：37 个业务 Controller 路由无遗漏、17 个返回契约字段一致、5 个 JSON 示例解析通过；JavaScript 示例语法及 10 个本机行为场景通过，包括空成功正文、multipart MIME、UTF-8／CRLF 分片、SSE error、无 done 和 done 后异常断流。检查不访问外部服务，不代表前端页面已完成浏览器端验收。检查证据保存在忽略目录 `var/frontend-doc-check/validation-summary.json`。
