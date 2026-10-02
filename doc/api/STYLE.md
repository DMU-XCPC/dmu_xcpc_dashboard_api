# 契约编写规范（doc/api）

本目录是**唯一事实源**。所有实现（Go 服务端、TypeScript 客户端、前端、机器人）
以这里的 OpenAPI 文档对齐。任何行为变更都先改契约。

校验命令（在仓库根目录）：

```sh
npm run api:lint      # redocly lint doc/api/openapi.yaml
npm run api:build     # lint + 汇总成 build/openapi.bundled.{yaml,json}，供客户端测试使用
npm run api:bundle    # 只汇总，不做 lint
```

`api:lint` 必须零 error 通过。

## 1. 文件布局与引用形式

```
doc/api/
  openapi.yaml                  根文档：info/servers/tags/security/paths 索引/securitySchemes
  README.md                     设计说明：实体、语义与时序行为
  STYLE.md                      本文件
  paths/<domain>.yaml           路径项（Path Item），每个文件含若干命名键
  components/
    schemas/<domain>.yaml       Schema（顶层为 components.schemas.<Name>），例如
                                common.yaml / identity.yaml / roster.yaml / quotas.yaml …
    parameters/common.yaml      共享查询参数与请求头
    responses/common.yaml       共享错误/条件响应
    headers/common.yaml         共享响应头
```

- 根文档的 `paths` 只做 `$ref` 转发：`/accounts: { $ref: paths/accounts.yaml#/accounts }`。
  键名已在根文档中固定，**不要新增或改名**（新增端点需同时改根文档）。
- 跨文件引用一律相对当前文件，例如在 `paths/foo.yaml` 中：
  `$ref: ../components/schemas/roster.yaml#/components/schemas/Team`
- 同文件内引用：`$ref: '#/components/schemas/Team'`
- 只允许 JSON 表示：`application/json`、`application/problem+json`，
  CSV/JSON 导出用 `text/csv` 与 `application/json`。
  **任何地方都不得出现 XML 媒体类型或 `xml:` 关键字**——本项目明确不支持 XML。
- OpenAPI **3.1.0**：schema 是 JSON Schema 2020-12，可用 `type: [object, 'null']`、
  `const`、`pattern`、`examples`。

## 2. 命名

- Schema 名：`UpperCamelCase`，全局唯一。请求体用 `<动词>Request`，列表响应用
  `Paged<Entity>`，枚举用单数名词。  **保留名（定义在 common.yaml 与 identity.yaml，禁止在别处重定义）**：

  `AccountStatus` `Capabilities` `ChangeOp` `ChangePasswordRequest` `ClubCode` `ClubMembership`
  `ClubMembershipStatus` `Credential` `CredentialKind` `CursorPageMeta` `Date` `Duration`
  `Id` `IssuedCredential` `Job` `JobKind` `JobProgress` `JobState`
  `Judge` `Label` `LabelSet` `LoginRequest` `LogoutRequest` `Me`
  `Meta` `PageMeta` `Principal` `PrincipalKind` `PrincipalProfile` `PrincipalProfileWrite`
  `PrincipalRef` `Problem` `ProblemCode` `RefreshRequest` `ResetPasswordRequest` `ResourceChange`
  `Scope` `ScopeSet` `SortOrder` `TeamRef` `Timestamp` `TokenPair`
  `UpdateMeRequest` `ValidationError` `Visibility`

- 字段名：`snake_case`。时间字段以 `_at` 结尾（`Timestamp`），日期以 `_on`/`_date`
  或直接用 `Date`；布尔字段用 `is_`/`has_` 或形容词（`pinned`、`verified`）。
- 每个对象 schema 都要有 `description`（中文，说明语义而不只是复述字段名）。
- 每个 schema 至少给一个 `examples`（schema 级，数组）；每个请求体或响应体至少给一个
  `example`（媒体类型级，单值）。两者含义不同，示例都必须能通过校验；相关规则
  （`no-invalid-media-type-examples` 等）的开关在仓库根目录的 `redocly.yaml` 里。

## 3. 每个 operation 必须包含

```yaml
tags: [<根文档中已声明的 tag>]     # 有且仅有一个 tag
operationId: <唯一，lowerCamelCase>
summary: <一句话中文>
description: |
  <语义：做什么、前置条件、副作用、幂等性、并发与错误分支>
parameters: [...]                   # 路径参数必须在此声明
requestBody: {...}                  # 有请求体时必需，且 required: true
responses:
  '2xx': {...}
  '401': {$ref: ../components/responses/common.yaml#/components/responses/Unauthenticated}
  ...
x-idempotent: true|false
x-consistency: strong|eventual
x-freshness-bound: PT15M            # 仅 x-consistency: eventual 时给出；本例是 15 分钟
```

- 每个 operation 必须声明 `security`。三种方案定义在根文档 `openapi.yaml` 的
  `components.securitySchemes`：`bearerAuth`、`apiKeyAuth`、`streamTokenAuth`；
  省略即沿用根文档的 `bearerAuth`。
  公开匿名端点写 `security: [{}]`。
- 每个 operation 至少一个 4xx 响应。注意：`operation-singular-tag`、`request-mime-type`、
  `response-mime-type` 三条在本仓库的 `redocly.yaml` 里是关闭的，由 `client/test/contract.test.ts`
  的断言承担（lint 不会拦），改契约时别以为 lint 通过就万事大吉。
- 4xx/5xx 一律引用 `../components/responses/common.yaml` 中的共享响应，
  不要重复内联 Problem 结构。
- 写操作（POST/PUT/PATCH/DELETE）必须引用
  `../components/parameters/common.yaml#/components/parameters/IdempotencyKey`
  （`/auth/login`、`/auth/refresh`、`/auth/logout`、`/auth/me/password`、
  `POST /stream/tokens` 例外，它们在 description 中说明为何豁免）。
  豁免的判据是"重放本身不可能成功或没有意义"（口令修改、令牌签发/撤销），
  此时要求幂等键反而会误导客户端去重试。请求头参数放在 `parameters` 里。
- 需要并发控制的写操作加 `IfMatch` 参数，并在 200/409/412 中说明 `revision` 语义。
- 读单个资源返回 `ETag` 响应头（引用共享 header），并支持 `IfNoneMatch` 参数与
  `304`（引用 `NotModified`）。

## 4. 字段与值约定

- 时间：仅 UTC RFC 3339，`Timestamp`。
- 分页：偏移分页用参数组件 `Page` 与 `Size`（组件名大写，它们定义的就是查询参数
  `page` 与 `size`），响应 `allOf` 组合 `PageMeta` 并加 `items`；
  大流量集合（提交记录、审计、变更流）用 `Cursor`+`Limit` 与 `CursorPageMeta`。
- 增量同步：列表端点加 `UpdatedSince` 参数；对应资源必须有 `updated_at` 与 `revision`。
- 权限：scope 字符串 `资源:动作`。**只有这些资源前缀**：
  `account` `member` `team` `oj` `ingest` `crawler` `scoreboard` `stats`
  `announcement` `channel` `quota` `config` `audit` `ops` `metrics` `sync`
  `profile`，以及通配 `*`。动作只允许 `read` `self` `write` `manage` `assign`
  `publish` `claim` `read_pii` 与 `*`。
  例外只有一个：资源 `profile` 的动作是**字段组名** `display` `contact` `academic`
  `clubs`，表示"可以自助修改自己档案的哪一组字段"，只由 `/auth/me*` 消费。
  另外注意 `stream` 是**模块名而不是 scope 资源**：SSE 主题校验的是目标资源自己的 `*:read`
  （例如订阅 `announcements` 主题需要 `announcement:read`），所以它不出现在上面的前缀清单里。
  命名原则：**资源名用读者一眼能对上的词**——榜单是 `scoreboard` 而不是有歧义的
  `board`（本系统还有"新闻板"）；指标用 `metrics:read`，不要把名词塞进动作位
  （`ops:metrics`）。
- 状态机字段（`status`/`state`）必须用枚举并在 description 中写清合法迁移与非法迁移
  返回的错误码。
- 破坏性/危险操作（`DELETE`、`finalize`、`approve`）要说明是否可撤销以及撤销端点。

## 5. 错误码

`ProblemCode` 枚举是唯一错误码来源（见 `components/schemas/common.yaml`）。需要新错误码时
**先加到 common.yaml 的枚举**，再在路径中引用；不要发明未登记的 code。

状态码使用规则：

| 状态 | 何时 |
| --- | --- |
| 400 | 语法/参数无法解析（时间格式、未知枚举） |
| 401 | 缺凭证、凭证无效/过期/已撤销 |
| 403 | 已认证但 scope 不足，或不可见 |
| 404 | 不存在，或存在但不可见 |
| 409 | 唯一性冲突、状态机冲突、配额耗尽、幂等键复用、去重冲突 |
| 412 | `If-Match` 不匹配（并发修改） |
| 413 | 体积或批量条数超限 |
| 415 | 非 `application/json` |
| 422 | 语义校验失败（带 `errors[]`） |
| 429 | 限流（带 `Retry-After`） |
| 503 | 依赖不可用/维护中（带 `Retry-After`） |

## 6. `x-` 扩展（机器可读的时序提示）

- `x-idempotent`：同一请求重复发送是否安全（配合 `Idempotency-Key`）。
- `x-consistency`：`strong` 表示响应已包含本次写入的效果；`eventual` 表示
  可能滞后于已接受的写入（如榜单、统计、OJ 采集结果）。
- `x-freshness-bound`：`eventual` 时的最大可接受滞后（ISO-8601 duration），
  例如榜单 `PT15M`、统计 `PT1H`。
- `x-cacheable`：只读且可安全缓存的端点（客户端离线缓存依据）。

## 6.1 扩展字段的固定含义

- `x-idempotency-exempt: true`：**幂等豁免的唯一出处**。标了它的写操作不声明也不要求
  `Idempotency-Key`（登录、刷新、登出、改自己的口令、签发流令牌）；文档里的豁免清单必须与它一致。
- `x-idempotent`：`true` 表示**同一个 `Idempotency-Key` 重放会返回首次结果**、不会重复
  产生副作用。有真实外部副作用但换新键就会再次执行的操作（例如渠道连通性测试）同样标
  `true`，并在描述里写明"换新键会再次发送"。
- `x-consistency`：`strong` 表示响应已包含本次写入的效果；`eventual` 表示可能落后于最新
  写入，此时**必须**同时给出 `x-freshness-bound`。
- `x-freshness-bound`：ISO-8601 时长，取值与正文描述一致（写了 `PT15M` 就不在正文里改口
  说"5 分钟"）。
- `x-cacheable`：表示可以按新鲜期缓存这份响应；**不等于**支持条件请求。只有单资源读带
  `ETag` 时才配 `If-None-Match` 与 `304`。
- `revision` 与 `ETag` 的关系只在术语表定义一次，端点描述里不要反复解释；没有 `revision`
  字段的资源不要返回 `ETag`。

## 7. 写作风格

- 描述用中文。协议术语保留英文原词（scope、ETag、SSE、Webhook、JSON Pointer），
  概念一律用中文：写"幂等"而不是 idempotency，写"最终一致"而不是 eventual。
- **同一事物只用一个中文名**：采集器程序叫"采集器"，模块名才写 `crawler`；不要混用"爬虫"。
  成员名单的英文标识符是 `roster`，正文一律写"成员名单"，不写"名册"。
- 自助端点的 scope 用 `profile:<字段组>` 形式（`display`/`contact`/`academic`/`clubs`），
  它们**只作用于调用者本人**，由 `/auth/me*` 消费；管理路径一律用 `member:manage`。
- **summary 写成"动词 + 宾语"**，同一模块内句式一致；不要出现英文缩写与需求代号
  （例如写"列出榜单定义"，不写"列出 scoreList 榜单定义"）。
- 字段第一次出现时就地给一句定义，不要让读者去别的文件里找（例如"自然键"、"物化"。
- 说明"谁可以调用"，以及"调用后会发生什么"，即副作用、事件与任务。
- 涉及时序的地方明确写出：是否立即生效、何时可见、如何重放、如何检测丢事件。
- 不要写实现细节，例如表名与内部队列名；只写对外可观察的行为。

### 7.1 括号与夹注的限制

描述是给人在渲染文档里读的。括号夹注堆多了会破坏排版与扫读，因此：

- **`summary` 一律不使用括号**。它是列表里最容易被扫到的一行，写成"动词 + 宾语"即可。
- **描述首行的括号不超过 1 个**，首行尽量是一句完整的话。
- 单个描述的括号总数不超过 7 个；超过说明该拆句或改列表。
- 括号只留两类短对照：英文或标识符对照，例如 `（`acc_` 前缀）`；单值补充，例如
  `（默认 `false`）`。
- 不要把条件说明、枚举清单或多句解释塞进括号：
  - 枚举改成顿号或列表：`（rating、解题数、活跃度）` → `，包括 rating、解题数、活跃度`
  - 条件改成句子：`（否则返回 401）` → `，否则返回 401`
  - 默认值写成 `，默认 X`
- 不允许嵌套括号与半截括号：`（（`、`））`。

`client/test/contract.test.ts` 会按上述限制校验全部 description 与 summary。
