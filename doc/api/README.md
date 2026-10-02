# DMU/ICPC Dashboard API 设计说明

主服务器 HTTP API 的**语义与时序**说明。契约本体在 `openapi.yaml`（分模块的
`paths/*.yaml`、`components/schemas/*.yaml`），编写规范见 `STYLE.md`。
**契约是唯一事实源**；本文解释"为什么这样设计"以及"调用之后会发生什么"。

## 0. 第一次读请看这里

**这份文档是什么**：`doc/api` 是 DMU/ICPC 训练队信息面板**主服务器**的接口契约。
DMU 是学校简称，ICPC 是国际大学生程序设计竞赛，XCPC 是它在国内的系列赛；
**主服务器**指面板的后端服务，前端网页、OJ 采集器、QQ 机器人与第三方都是它的**调用方**，
不在本契约内。契约本身（路径、字段、示例）在 `openapi.yaml` 与分模块文件里；
本文解释语义与时序，即"这个接口什么时候用、调用之后会发生什么"。

**建议阅读顺序**

1. §0.1 术语速查，先把名词对上号，后文不再重复解释；
2. §2.1 按任务找端点，想做什么就查那张表，直接跳到对应端点；
3. §3.1 主体 / 账号 / 成员 / 社团身份，全系统最容易混的一组概念；
4. §4 语义与时序行为，接接口前读对应小节，知道调用后会触发什么；
5. 具体字段与示例，打开 `openapi.yaml`，或运行 `npm run api:docs` 生成单文件 HTML
   文档 `build/docs.html`，用浏览器翻阅。

**契约里的机器可读提示**：每个操作都带 `x-idempotent`（重复调用是否安全）、
`x-consistency`（强一致还是最终一致）与 `x-freshness-bound`（最终一致的最大滞后）。

### 0.1 术语速查

| 术语 | 一句话解释 |
| --- | --- |
| 主服务器 | 本契约描述的后端服务；前端、OJ 采集器、QQ 机器人、第三方都是它的调用方 |
| 契约 | `doc/api` 下的 OpenAPI 文档。它是唯一事实源，服务端实现与客户端都按它对齐 |
| 主体 / principal | 能访问系统的身份，人类账号或机器人账号，共用同一套权限机制 |
| 账号 / account | "主体"在权限视角下的叫法，与主体是同一个对象 |
| service / 非人类主体 | 采集器、QQ 机器人、群聊抽取工具这类程序账号，用长期 API Key 认证 |
| Agent | 外部自动化程序，例如从群聊里抽取通知并主动推送的机器人 |
| 成员 / member | **不是另一种身份**，而是"该主体属于社团"这一资格，由社团注册记录表达 |
| 社团身份 / club | 集训队挂靠的两个社团：海风社团软件部 Safewind，代号 `safewind_software`；ACM/ICPC 学社，代号 `acm_icpc`。可只注册其一 |
| 队伍 / team | 参赛与训练分组，成员按赛季归属 |
| 赛季 / season | 学年区间，形如 `2024-2025`，即 9 月 1 日到次年 8 月 31 日 |
| ISO-8601 时长 | 本系统表示时长的写法：`PT15M` 是 15 分钟，`PT1H` 是 1 小时，`P365D` 是 365 天 |
| scope | 权限字符串，形如 `member:manage`，读作"资源:动作"。授权只认它 |
| 标签 / label | 自由文本，如 `member`、`2023`、`bot`，只用于筛选与组织，**不授予权限** |
| 模板 / template | 预置的一组 scope，定义在 `Config.accounts.templates`，创建账号时用 `template` 一次套用；套用后仍可逐项增删 |
| 自助字段组 | `profile:display`、`profile:contact`、`profile:academic`、`profile:clubs` 四个 scope，决定成员能改自己档案的哪些字段 |
| Role / 角色 | 本系统**没有**角色这个概念：角色退化成标签，授权一律看 scope |
| 凭证 / credential | 访问系统的钥匙：人类用短期 `session` 令牌，机器人用长期 `api_key` |
| 单飞 / single-flight | 同一时刻只发起一次刷新，其余请求等这次结果，避免并发刷爆一次性令牌 |
| 错误类型 | HTTP 报错用 `ApiProblemError`，网络不可达用 `NetworkError`，离线用 `OfflineError`；前者带服务端返回的 `code` |
| 幂等 / idempotent | 同一个请求重复发送，效果与只发一次相同 |
| 幂等键 | 请求头 `Idempotency-Key`，客户端生成；服务端据此识别重复请求并返回首次结果 |
| revision / ETag | 资源版本号。读时配 `If-None-Match`，没变化就返回 `304` 省流量；写时配 `If-Match`，防止并发覆盖 |
| 偏移分页 | `page` 加 `size`，响应带 `total`，适合可以跳页的列表 |
| 游标分页 | `cursor` 加 `limit`，响应带 `next_cursor`，适合持续写入的大列表，不会跳条或重复 |
| 强一致 | 响应已包含本次写入的效果，所见即最新 |
| 最终一致 / eventual | 返回值可能落后于最新写入，例如榜单、统计与采集结果；滞后上界见 `x-freshness-bound` |
| 物化聚合 | 后台定时算好并存下来的结果，如榜单与统计，因此有 `generated_at` 与 `stale` |
| 异步任务 / job | 耗时或有外部副作用的操作：先返回 `202` 与 `Location`，再轮询 `GET /jobs/{job_id}` |
| 限流 | 请求过多时返回 `429` 与 `Retry-After`；响应头 `X-RateLimit-*` 给出剩余配额 |
| OJ | Online Judge，在线评测平台，例如 Codeforces、AtCoder、洛谷 |
| judge | 具体的评测平台标识，例如 `codeforces` |
| handle | 某人在某个 OJ 上的账号名。别与"绑定记录"混：绑定本身是 `OjHandle`，id 前缀 `ojh_`，路径里的 `{handle_id}` 指的是绑定记录，不是账号名 |
| 提交 / submission | 一次向 OJ 交题；`verdict` 是判题结果，`accepted` 即通过，俗称 AC |
| rating | OJ 上的积分。本系统只记录"某时刻的 rating"这个观测值，变化量由服务端派生 |
| 采集器 / crawler | 从 OJ 抓数据的独立程序，三种部署形态见 §4.3 |
| ingest | 采集器把抓到的数据写进主服务器的通道，见 §4.4 |
| 公告 / announcement | 新闻板上的通知，可定时发布、置顶，并广播到 QQ 群 |
| 渠道 / channel | 广播目标，例如 QQ 群或 Webhook |
| 投递 / delivery | 一条公告发往一个渠道的记录；失败会重试，因此是"至少一次" |
| SSE | Server-Sent Events，服务器单向推送的 HTTP 长连接，本系统用它推实时事件 |
| 事件序号 | SSE 事件自带的递增编号，用于检测丢事件与断线补发 |
| 重放缓冲 | 服务器在内存里保留最近一段事件；重连时按序号补发，最多最近 1000 条或 5 分钟内的事件 |
| 基线 / 基线握手 | 增量同步的起点：先发起一次不带 `since` 的请求，只拿到当前游标、不取数据，见 §4.9 |
| 名额池 / quota | 区域赛等比赛的名额集合，总数由管理员设定 |
| 认领 / claim | 队伍申请占用名额；必须经管理员审核通过才真正占用 |
| 候补 / waitlist | 名额已满时仍可提交认领，排在候补队列里等待 |
| 审计 / audit | 谁在什么时候做了什么操作的留痕记录 |
| PII | 个人身份信息，例如学号与手机号；导出与查询会区别对待 |
| 脱敏 / masked_fields | 无权看他人 PII 时，服务端把学号/邮箱/电话/QQ 返回为 `null`，并在 `masked_fields` 里列出被隐藏的字段名，避免与"没填"混淆 |
| 保留期 / retention | 各类数据保留多久；唯一权威出处是 `Config.retention`，其它地方只是引用 |
| 当前赛季 / current_season | 省略 `season` 时服务端采用的赛季，形如 `2024-2025`；`GET /meta` 会回显 |
| 释放认领 / release | 管理员把已批准的名额退回池中（状态变 `released`），队伍自己不能释放已批准名额 |
| TTL / 新鲜期 | 本地缓存副本在多长时间内算新鲜，期内直接使用而不回源 |
| stale-while-revalidate | 先用本地副本立即返回，同时在后台回源刷新 |
| outbox / 离线队列 | 断网时把写请求排队存在本地，恢复网络后按序重放，靠幂等键保证不重复生效 |
| ULID | 一种按时间递增的 26 位标识符，本系统资源 id 中 `<ULID>` 那一段就是它 |
| RFC 3339 | 时间格式标准，形如 `2024-05-06T07:08:09.123Z` |
| RFC 7807 | HTTP 错误响应格式标准（Problem Details）；本系统的错误体是它的扩展，字段有 `type`、`title`、`status`、`code`、`detail`、`errors`，见 §6 |

---

## 1. 范围与定位

本契约只覆盖**主服务器**要提供的接口。下列角色**不属于**契约内容，
而是契约的**调用方**，各自独立部署：

| 角色 | 与主服务器的关系 |
| --- | --- |
| 前端 SPA | 直接用本契约；无服务端渲染需求 |
| OJ 采集器（collector） | 通过 `ingest` 写入、`crawler` 读配置/上报运行；也可与服务器共用数据库 |
| QQ / Agent 机器人 | 通过 `announcements` 推送、`channels` 广播、`stream` 订阅 |
| 群聊抽取工具 | 外部完成识别与摘要，通过 `POST /announcements` 主动推送 |
| 第三方二次开发 | 读公开数据 + 自己的 API Key |

### 功能需求 → 模块对照

下表左列是项目最初提出的功能需求。需求原文不在本仓库内，这里已复述成自解释的句子，
因此不必先读过任何外部文档。右列是对应的契约模块；要按"我要做的事"直接找端点，
看 §2.1。

| 功能需求 | 契约落点 |
| --- | --- |
| 社团成员名单：查人/筛人、填表字段（学号、年级、专业、社团注册）、批量导入、活跃度 | `members`（**成员接口**，见 §2.1 与 §3.1） |
| 账号与访问控制：创建主体（含机器人）、停用、标签与 scope、签发/撤销凭证 | `accounts`、`credentials` |
| 社团人员导出名单，超过 1 年未活跃自动排除 | `roster`（`POST /roster/exports`，默认只保留最近一年活跃过的人 `active_within=P365D`，被排除人数见 `excluded_inactive_count`） |
| 权限不用角色，改用 `资源:动作` 字符串列表；角色退化为标签 | `Scope`/`ScopeSet`/`Label`，见 §5 与 §0.1 |
| 成员绑定 OJ ID | `oj-handles`（绑定 + 归属校验） |
| 采集器爬取提交记录并保存、可公开查询 | `ingest` 写入 + `oj-data` 公开查询 |
| 通过/尝试的题目、rating 记录等近期活动信息 | `OjSubmission`、`OjRatingRecord`（rating 观测；`delta` 由服务端派生）、`OjHandleSummary`（最近聚合）。采集上报的逐次快照样本不对外暴露，只保留最近聚合值 |
| 爬取失败后使用代理服务器（配置项） | `crawler`：`ProxyConfig` + `strategy=…`，仅直连失败后回退；`password` 永不回传 |
| 采集器与主服务的三种关系 | §4.3：共用数据库（不需 API）/ 只走 API / 服务器代管（`POST /crawler/trigger`） |
| 各式榜单，按平台与个人/队伍分别排名，即需求里说的 scoreList | `scoreboards`（榜单定义 + 排名条目 + 条目历史） |
| 训练 trend、热力图、直方图数据 | `stats`（`/stats/trend`、`/stats/heatmap`、`/stats/histogram`、`/stats/summary`） |
| 外部数据接口供二次开发（标准 REST） | §7：公开只读接口 + API Key + 限流 + `GET /openapi.json` |
| 新闻板；Agent/QQ 机器人 broadcast；群聊抽取推送 | `announcements`（状态机 + 定时发布 + `dedup_key`）、`channels`（渠道 + 投递记录）、`stream`（SSE） |
| 区域赛名额分配：管理员设名额、队伍选取、上限 2、**需审核** | `quotas`：`quota_total`、`max_claims_per_team=2`、`pending → approved` |
| 参数配置 config 文件（no fxxking xml） | `config`：配置文件为 TOML/YAML + 运行时 `PATCH /config`；全 API 拒绝 XML（JSON 只用于 API 表示） |
| 服务端用什么语言实现 | 契约与语言无关：任何语言只要满足本契约即可，原始需求倾向 Go |

---

## 2. 通用约定

- **基础路径** `/api/v1`。破坏性变更走 `/api/v2`，不原地修改；`/api/v1` 与 `/api/v2`
  可长期并存，见 §8。
- **表示**：JSON（`application/json`），字段 `snake_case`。错误一律
  `application/problem+json`。**不存在 XML 表示**：配置文件只支持 TOML/YAML（JSON 仅用于 API 表示），
  请求体只接受 `application/json`；发送 `application/xml` 返回 `415`。
- **标识**：`Id` 是不透明字符串，形如 `<前缀>_<ULID>`，例如 `acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0`。
  前缀标明资源类型，整串由服务端生成；客户端只负责原样保存与回传，不要解析或构造它。
  外部平台的原始编号（`submission_id`、`external_id`）是普通字符串，格式由平台决定。
- **时间**：一律使用 UTC 的 RFC 3339 格式并带 `Z`，例如 `2024-05-06T07:08:09.123Z`；
  带时区偏移或本地时间会被 `422` 拒绝。按天聚合（热力图、`bucket=day`）先用查询参数
  `timezone` 把时刻归入当地日历日，再以该日期返回 `date` 字段。例如
  `timezone=Asia/Shanghai` 时，`2024-05-06T16:30:00Z` 归到 `2024-05-07`。
- **赛季**：队伍与名额池都按赛季归年，写作 `2024-2025`（9 月 1 日到次年 8 月 31 日）。
  当前赛季在 `Config.roster.current_season`，并通过 `GET /meta` 的 `current_season` 回显；
  创建时省略 `season` 就用它。
- **列表**：可跳页的列表用偏移分页，`page` 从 1 起、`size` 不超过 200，响应含
  `items`/`page`/`size`/`total`/`has_next`。持续写入的大列表（提交记录、审计、变更流、
  采集器运行）用游标分页 `cursor` 加 `limit`：`cursor` 是服务端签发的不透明位置标记，
  客户端把上一页的 `next_cursor` 原样回传即可继续往下取，响应含
  `items`/`has_more`/`next_cursor`。
- **写操作幂等**：写请求必须带 `Idempotency-Key` 请求头，值是客户端生成的随机串，
  相当于"这次提交的编号"。服务端记住同一主体在同一端点用过的键，窗口长度由
  `GET /meta` 的 `capabilities.idempotency_window` 公布（默认 `PT24H`）：窗口内重复使用
  同一个键，会直接返回第一次的结果并标注 `Idempotency-Replayed: true`，不会重复生效；
  键相同但请求体不同则返回 `409 idempotency_key_reused`。网络超时后重发正是靠它保证安全。
  豁免：`/auth/login`、`/auth/refresh`、`/auth/logout`、`PUT /auth/me/password`、
  `POST /stream/tokens`。**唯一出处是契约里这些操作上的 `x-idempotency-exempt: true`**，
  本清单只是它的可读版本，测试会校验两者一致。
- **条件请求**：读单个资源时响应带 `ETag`，例如 `ETag: "17"`；下次请求带
  `If-None-Match: "17"`，资源没变化就返回 `304` 且无响应体，省掉一次传输。写请求带
  `If-Match` 可防止并发覆盖：版本不一致返回 `412 precondition_failed`，提示调用方重新读取。
  响应体里的 `revision` 就是 `ETag` 去掉引号后的值，上例中为 `"17"`。
- **增量同步**：列表支持 `updated_since`（严格晚于）；`GET /sync/changes` 提供跨资源
  变更游标（§4.9）。
- **限流**：响应带 `X-RateLimit-Limit/Remaining/Reset`；超限 `429` + `Retry-After`。
- **异步任务**：可能超过约 1 秒、或有外部副作用的操作，先返回 `202 Accepted` 与
  `Location: /jobs/{job_id}`，表示"已接受、稍后完成"；客户端再轮询 `GET /jobs/{job_id}`
  （按响应头的 `Retry-After` 决定间隔），直到任务进入终态。任务对象见 §3 的 `Job`。
- **可观测**：所有响应带 `X-Request-Id`，与错误体 `request_id` 一致，便于对日志。
- **能力与时钟探测**：`GET /meta` 返回契约版本、服务端构建号、功能开关（匿名可读、是否
  代管采集器等）与 `server_time`。客户端应先用 `server_time` 估算本机与服务端的时钟偏移，
  因为服务端对客户端提交的时间戳有容忍区间（§4.4），超界会拒绝而不是替你猜。

---

### 2.1 按任务找端点（第一次读先看这里）

| 我想做的事 | 用哪个端点 |
| --- | --- |
| 登录、刷新令牌、登出 | `POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout` |
| 看"我是谁"、改自己的档案或口令 | `GET /auth/me`、`PATCH /auth/me`、`PUT /auth/me/password` |
| **查社团名单、按年级/专业/队伍/是否成员筛人** | `GET /members`（**成员接口**，见 §3.1） |
| 看某人最近有没有活跃、属于哪些社团 | `GET /members/{id}/activity`、`member.clubs`、`activity.by_club` |
| 开学批量导入新生名单 | `POST /members/import` |
| 改某人的档案、打标签、分配权限 | `PATCH /members/{id}`、`PUT /members/{id}/labels`、`PUT /members/{id}/scopes` |
| 导出社团名单，默认排除一年未活跃 | `POST /roster/exports` → 轮询 `GET /jobs/{id}` → 下载 |
| **建账号（含机器人）、停用、发 API Key、查权限** | `POST /accounts`、`POST /accounts/{id}/credentials`、`credentials`（**账号与权限接口**，见 §3.1） |
| 绑定或校验 OJ ID | `oj-handles` |
| 看某人做过的题与 rating 记录 | `GET /oj/submissions`、`GET /oj/rating-history`、`GET /oj/handles/{id}/stats` |
| 采集器写数据、读代理配置 | `POST /ingest/oj/*`、`GET /crawler/config` |
| 让服务器代管抓一次、或上报一次抓取 | `POST /crawler/trigger`、`POST /crawler/runs` |
| 看榜单、触发重算 | `GET /scoreboards`、`POST /scoreboards/{id}/rebuild` |
| 训练 trend、热力图、直方图 | `GET /stats/trend`、`GET /stats/heatmap`、`GET /stats/histogram`、`GET /stats/summary` |
| 发通知、推送公告、广播到 QQ 群 | `POST /announcements`、`POST /announcements/{id}/broadcast`、`channels` |
| 订阅实时事件（前端或机器人） | `POST /stream/tokens` + `GET /stream/events`（SSE） |
| 区域赛名额：设名额、队伍认领、管理员审核 | `quotas`、`POST /quotas/{id}/claims`、`POST /quotas/{id}/claims/{claim_id}/approve` |
| 改服务器参数 | `GET /config`、`PATCH /config` |
| 二次开发：增量同步、拉契约 | `GET /sync/changes`、`GET /openapi.json`、`GET /meta` |
| 查审计、看运维状态与任务 | `GET /audit-logs`、`GET /health`、`GET /jobs` |

---

## 3. 数据实体

实体详细字段以 OpenAPI schema 为准，这里是关系与关键约束。

| 实体 | 说明 | 关键约束 |
| --- | --- | --- |
| `Principal` | 一切主体：人类或 service（机器人/采集器/Agent） | `username` 全局唯一；`scopes` 是授权单位；`labels` 只做组织 |
| `PrincipalProfile` | 填表档案：学号、入学年份、专业、社团注册、邮箱/电话/QQ | `student_id` 唯一；`grade` 由 `enrollment_year` 派生只读 |
| `Credential` | 凭证：`session`（人类）或 `api_key`（机器） | 明文只在签发响应出现一次；可撤销、可过期 |
| `Member` | **不是独立实体**：同一个 `Principal` 在成员名单视角下的另一组字段（+ `clubs`/`activity`/`teams`/`oj_handles`） | `member_id` 就是主体 id（没有 `mem_` 前缀）；社团身份见 `clubs` 与 `profile.club_memberships`；见 §3.1 |
| `Team` | 队伍/分组 | 同 `season` 内名称唯一；成员在同一 season 内不重复归属 |
| `OjHandle` | 主体与平台账号的绑定 | `(judge, handle)` 全局唯一；`verification_token` 仅本人可见 |
| `OjSubmission` / `OjRatingRecord` / `OjProblem` | 采集结果 | 自然键幂等（§4.4）；账号快照按 `(judge, handle, captured_at)` 落库并只保留最近聚合 |
| `Scoreboard` / `ScoreboardEntry` | 榜单定义与排名结果 | **物化**：后台预先算好存下来的快照，因此有 `generated_at` 与 `stale` |
| `Announcement` / `Channel` / `Delivery` | 新闻板、广播渠道、投递记录 | 公告状态机（§4.6）；投递至少一次 |
| `Quota` / `QuotaClaim` | 名额池与认领 | 认领需审核；`max_claims_per_team` 默认 2；`quota_total` 硬上限 |
| `Config` | 生效配置 + `restart_required_fields` | 全量校验、全量应用或全部拒绝 |
| `Job` | 异步任务 | `queued→running→终态`；`expired` 表示产物已清理 |
| `AuditLog` | 审计 | 同步落库，`metadata` 脱敏 |
| `ResourceChange` | 变更流条目 | `upsert`/`delete` + `revision` |

### 3.1 术语与关系：主体 / 账号 / 成员

**先看用途**：`/members` 与 `/accounts` 是**同一个主体的两个入口**，按"你要做什么"选：

- **`/members` = 成员接口（以"人"为中心）**：给"填表、点名、组队、看训练情况"这类页面用——
  拉社团名单、按年级/专业/队伍/是否成员筛人、批量导入新生、看谁最近不活跃、改档案、打标签。
- **`/accounts` = 账号与权限接口（以"身份"为中心）**：给管理界面用——
  创建主体（人类或机器人）、停用/启用、设置 `scopes`、签发与撤销 API Key、查某主体有什么权限。

判断口诀：**管"人"用 `/members`，管"身份与访问"用 `/accounts`**；同一个人的数据只有一份，
两个视角共享同一个 `id` 与 `ETag`（原因见下面的定义）。

本节是这几个概念的**权威定义**；schema 里的描述一律引用这里，避免各自解释。

- **主体（principal）**：能访问系统的身份——人类，或 service（机器人 / 采集器 / Agent）。
  它有唯一 id（`acc_` 前缀）、`username`、`scopes`（**唯一的授权单位**）与 `labels`
  （只用于组织，不授予权限）。契约里"**账号**"与"主体"是同义词；
  `accounts` 是它的**管理与权限视角**，不是另一种对象。
- **成员（member）**：**不是第二种身份**，而是"**该主体是社团的一员**"这一**资格**。
  由此推出三条容易误解的结论：
  1. **成员没有独立 id、没有 `mem_` 前缀**：`member_id` 与 `account_id` 是同一个
     标识空间里的同一个值；也不存在"创建成员/删除成员"端点。
  2. **"属于哪个社团"看 `clubs`，不是布尔值**：它是 `profile.club_memberships` 里状态为
     `active` 的社团集合，可能是空数组、只含一个社团，或两个都有。
  3. `GET /members/{member_id}` 对**任何**主体都返回成员视图；`clubs: []` 只表示
     "当前不属于任何社团"，例如两个社团都已退出或本就是机器人账号，只有主体不存在或
     不可见才 `404`。这样退队成员的历史成绩与队伍引用仍然可解析。
- **社团身份有两个，而且可以只注册其一**：集训队挂靠**海风社团软件部**（英文名
  Safewind，代号 `safewind_software`）与 **ACM/ICPC 学社**（代号 `acm_icpc`）。成员可以只注册其中一个，也可以
  两个都注册；每个社团各有一条注册记录，含自己的注册日期、状态与角色，存在
  `profile.club_memberships` 里。写入口是 `PUT /members/{member_id}/clubs`，整体替换。
  因此**不存在单一名单，也不存在单一活跃度**：
  - 名单：`GET /members?club=acm_icpc` 与 `?club=safewind_software` 是两份不同的名单；
    不传 `club` 时得到的是合并名单。`club_match` 决定匹配方式：`any`（默认，属于其中
    任一）、`all`（同时属于列出的所有社团）、`none`（都不属于）。例如
    `?club=acm_icpc&club=safewind_software&club_match=all` 就是"两个社团都注册了的人"。
  - 活跃度：`Member.activity` 是人级聚合，`Member.activity.by_club` 才是按社团切分的统计范围
    ——只统计该社团在册期间（`registered_at` 之后）的登录、API 调用与 OJ 提交。
  - 导出与看板：`POST /roster/exports`、`scoreboards`、`stats` 都接受 `clubs` 维度，
    可以分别出两份名单与两份训练数据。
  - `Member.clubs` 是当前有效的社团集合，**它是判断"是不是成员"的唯一依据**。
- **成员名单**：说白了就是"社团有哪些人"。`GET /members` 返回这份名单（即 `clubs`
  非空的主体）；`POST /roster/exports` 把同一份名单导出成 CSV/JSON，默认排除一年没活跃过的人。
  英文标识符沿用 `roster`（ICPC 语境里 team roster 就是队员名单），它与 `members`
  是**同一批人的两种操作**（读名单 / 导出名单），不是两套数据。
  加人、去人：`POST /accounts`、`POST /members/import` 创建主体；再用
  `PUT /members/{member_id}/clubs` 登记或退出社团。退出社团只是把该社团置为 `alumni`，
  主体、凭证与历史数据全部保留。标签与成员资格无关，只用于组织与筛选。
- **两个视角看同一主体**：`/accounts` 与 `/members` 读写**同一份** `Principal` 数据，
  共享同一个 `revision` / `ETag`（`activity` 刷新不提升版本号）：

  | | 账号视角 `GET /accounts/{account_id}` | 成员名单视角 `GET /members/{member_id}` |
  | --- | --- | --- |
  | 读取 scope | `account:read` | `member:read` |
  | 写入 scope | `account:manage` | `member:manage` |
  | 可写字段 | `display_name`、`profile`、`status` | `display_name`、`profile` |
  | 视角专属返回 | 凭证相关字段 | `clubs`、`activity`、`teams`、`oj_handles` |

  停用账号、签发/撤销凭证、分配 scope 走 `/accounts`；改档案、看队伍归属与活跃度、
  导出成员名单走 `/members`。任一视图拿到的 `ETag` 都能用于另一个视图的 `If-Match`。
- **队伍与赛季**：`Team.season` 形如 `2024-2025`，表示 **9 月 1 日 – 次年 8 月 31 日**
  这一学年区间（按服务器时区 `Asia/Shanghai` 归年）；`season` 省略的队伍归入
  **当前赛季**，即覆盖今天的那个区间。`Member.teams` 只含当前赛季的队伍，
  跨赛季历史归属请查 `GET /teams?member_id=…`。
- **活跃度有三个来源，按用途选**：

  | 字段 | 时效 | 用途 |
  | --- | --- | --- |
  | `Member.last_active_at`（继承自主体） | 强一致 | 粗粒度判断"最近有没有动静" |
  | `Member.activity.*`（`activity_state`、`*_30d`） | 汇总派生，滞后 ≤15 分钟 | 分级、窗口统计、筛选与导出排除 |
  | `OjHandle.last_submission_at` | 采集侧（滞后见 `crawler`） | 单个平台的最近提交 |

  注意 `Member.last_active_at` 与 `Member.activity.last_active_at` **同名但时效不同**：
  前者来自主体、强一致；后者是汇总任务的派生副本。精确判定用前者。

---

## 4. 语义与时序行为

### 4.1 认证、会话与撤销

```
POST /auth/login ──► TokenPair(access 30m, refresh 30d)
      │                    │
      │                    └─ refresh 单次使用、每次刷新轮换
      ├─ 401 invalid_token ──► POST /auth/refresh ──► 新 TokenPair（旧 refresh 立即作废）
      └─ 重放旧 refresh ─────► 401 invalid_token，整条令牌族失效（视为泄露）
```

- 访问令牌默认 30 分钟，刷新令牌 30 天且**单次使用并轮换**。客户端必须：
  串行化刷新（同一时刻只发一次）；并发请求收到 401 时等待同一次刷新结果后重放；
  刷新失败则清空本地令牌并要求重新登录。
- **撤销传播**：`DELETE /credentials/{id}` 或停用账号后，新请求**立即**被拒；
  已在处理中的请求最多再存活 60 秒（服务端缓存校验结果），这个 60 秒的上界在契约里写明，
  客户端不应假设"撤销后立刻断开正在进行的 SSE"（SSE 最长 60 秒内断开）。
- **机器主体**：机器人/采集器用 `api_key`（`Authorization: Bearer <key>` 或 `X-API-Key`），
  没有独立实体；`kind=service` + 标签，例如 `bot`、`collector`+ 受限 `scopes`。
- **匿名**：当 `GET /meta` 的 `capabilities.public_read=true`，公开可见性资源可匿名读；
  匿名请求的 `effective_scopes` 为空，`ProblemCode` 区分 `unauthenticated`（没带凭证）
  与 `insufficient_scope`（凭证不够）。

### 4.2 人员、权限与活跃度

- **授权单位是 scope**：`资源:动作` 字符串列表（§5）。标签（`member`、`manager`、
  `2023`、`bot`）只用于组织、筛选与批量套用模板，**不产生权限**。
- **模板**（一次性套用，之后可逐项覆盖）：`user`、`manager`、`platform`、
  `collector`（`ingest:write` + `crawler:read` + `oj:read`）、`bot`（`announcement:write`，
  需要自动发布时再加 `announcement:publish`）、`external`（公开读）。
- **禁止权限提升**：`PUT /accounts/{id}/scopes`、`POST /accounts/{id}/credentials`
  只允许授予**请求者自己持有的** scope（除非持有 `*`），否则 `403 insufficient_scope`。
- **活跃度定义**（决定成员名单导出是否排除。先解释两个一致性用语：**强一致**指响应已包含
  本次写入的效果，**最终一致**指返回值可能落后于最新写入）：
  `last_active_at = max(最近成功登录, 最近带凭证的 API 调用, 最近 OJ 提交时间)`。
  派生状态：≤90 天 `active`、≤365 天 `dormant`、>365 天或从未活跃 `inactive`。
  该派生值滞后 ≤15 分钟（`x-freshness-bound: PT15M`）。
- **导出排除**：`POST /roster/exports` 默认 `include_inactive=false`、
  `active_within=P365D`（只保留最近一年活跃过的人），因此"超过 1 年未活跃"的成员被自动排除；
  被排除人数在 `RosterExport.excluded_inactive_count` 中可观测，
  需要全量时显式传 `include_inactive=true`。
- **导出时序**：`202` + `Job` → 轮询任务 → `succeeded` 时 `result.export_id` 指向
  `RosterExport`，其 `download_url` 短时有效，默认 15 分钟，过期需重新获取；
  产物超过保留期后任务与导出变为 `expired`，下载返回 `410 export_expired`。

### 4.3 采集器：三种部署关系

| 模式 | 需要的接口 | 说明 |
| --- | --- | --- |
| (a) 共用数据库 | 无 | 采集器直接写库，但**必须遵守同样的自然键与字段语义**，否则公开查询会出现重复/脏数据 |
| (b) 完全独立、只走 API | `POST /ingest/*`、`GET /crawler/config`、`POST /crawler/runs` | 采集器持 `ingest:write` + `crawler:read` 凭证；配置（含代理）由服务器下发 |
| (c) 服务器代管 | `POST /crawler/trigger`、`GET /crawler/status`、`GET /jobs/{id}` | 仅当 `capabilities.crawler_embedded=true`；否则 `409 crawler_not_embedded` |

**代理回退时序**：先发直连请求；当它超过 `proxy.direct_timeout`（默认 10 秒）或连接失败后，
按 `proxy.strategy` 选择代理重试：

```
直连 ──失败/超时──► strategy=failover   : 按 priority 依次尝试，直到成功
                    strategy=round_robin: 轮转起点，失败顺延
                    strategy=always      : 跳过直连，直接用代理
任一路径成功 ──► 记录 health(state=healthy|unhealthy, latency_ms, last_error)
```

- 代理凭据（`password`）**只写不读**：`GET /crawler/config` 返回 `has_password`，
  永不返回明文；变更 `proxy` 为整体替换。
- 配置变更是**读己之写**：改完再 `GET /crawler/config` 立刻能看到新值；但外部采集器在下一次拉取前仍用旧值，
  滞后上界为 `schedule.interval`，默认 30 分钟；这对"代理失效需要尽快切换"的场景
  是可接受的折衷，必要时把 `interval` 调小或改用服务器代管模式。
- `GET /crawler/status` 是观察面：每平台 `last_success_at`、`lag`、`consecutive_failures`、
  `using_proxy`；`CrawlerRun` 是历史记录（`schedule|manual|api` 触发）。

### 4.4 采集写入通道（ingest）

- **自然键幂等**：提交 `(judge, submission_id)`、rating `(judge, handle, contest_id)`
  （未提供 `contest_id` 的周期性快照退化为 `(judge, handle, at)`；**`delta` 不是上报字段**，
  由服务端按同一账号的相邻记录派生，首条为 `null`）、
  快照 `(judge, handle, captured_at)`、题目 `(judge, external_id)`。重复项计入
  `duplicates`，**不是错误**；配合 `Idempotency-Key` 可安全重放整批。
- **部分成功**：HTTP `200` + `items[]` 逐条结果（`accepted|duplicate|rejected`）。
  单条语义错误（judge 未启用、时间戳超界）只拒绝该条；客户端应只重试 `rejected` 项。
- **rating 模型**：只把 rating 当成"**某时刻的观测值**"存下来（`OjRatingRecord`），
  不把变化量当成原始数据。`delta`、`rating_delta_30d` 以及榜单/统计里的
  `rating_delta` 都是查询时由观测序列派生的展示量——因此历史可随时重算，
  也不会因为某个平台不提供变化量而少记一次 rating。上报只需
  `judge`/`handle`/`rating`/`at`（有比赛时附 `contest_id`）。
- **批上限**：`capabilities.ingest_batch_max`，默认 500。超限整批 `413`，**无副作用**。
- **乱序接受**：不要求按 `submitted_at` 顺序上报；服务端按自然键 upsert。
- **时钟容忍**：`submitted_at` 必须落在 `[now - 3 年, now + 1 天]`，否则该条
  `rejected`（`code=out_of_range`）。
- **物化延迟**：写入后提交查询立即可见（`x-freshness-bound: PT5M`），
  但榜单/统计是物化聚合，落后上界 `PT15M`（榜单）/`PT1H`（统计），
  响应里的 `materialized_at`/`generated_at` 给出聚合可见时刻。
- **公开查询隐私**：`oj-data` 只暴露 OJ 公开数据，不含学号/电话/邮箱等 PII。

### 4.5 榜单与统计

这里的**物化**指后台定时把结果预先算好存下来，因此读到的是一份**快照**，可能落后于最新
写入。响应里的 `generated_at` 是快照生成时刻，`stale` 表示它已超过约定新鲜度。

- `Scoreboard` 定义"分组 + 指标 + 周期 + 过滤"，例如"Codeforces 个人 rating 榜"、
  "2024-2025 赛季队伍解题数榜"。条目由后台按 `scoreboards.refresh_interval` 物化。
- 读端点一律 `x-consistency: eventual` + `x-freshness-bound: PT15M`；响应带
  `generated_at`、`stale`。`stale=true` 或 `generated_at` 落后超上界时，前端应提示并
  可用 `POST /scoreboards/{id}/rebuild`（`scoreboard:manage`）触发重建。
- 重建是幂等的：同一榜单重复触发不会产生并发重算（已有任务在跑则 `409 conflict`）。
- `ScoreboardEntryHistory` 给出单个条目（个人/队伍）随时间的名次与分数，是**趋势**的逐条目版本，即一个人或一支队伍的名次与分数曲线；
  `/stats/trend` 则是把所有条目聚合起来的一条曲线。
- `/stats/heatmap` 按 `timezone` 归日并给出分位阈值（`level_thresholds`）计算 0..4 级，其中 0 表示当天没有活动、4 表示当天活跃度最高；
  `/stats/histogram` 用等宽分箱 `[lower, upper)`（最后一箱右闭），并返回
  `median/p90/p99` 等分布统计。展示形式属于前端，服务器只提供数据。

### 4.6 新闻板与广播

```
下表列出全部合法迁移，其余迁移一律返回 `409 conflict`：

| 当前状态 | 触发动作 | 新状态 |
| --- | --- | --- |
| `draft` | `publish`，且 `publish_at` 是过去或未给出 | `published` |
| `draft` | `publish`，且 `publish_at` 是未来时刻 | `scheduled` |
| `scheduled` | 到达 `publish_at`，由服务器自动执行 | `published` |
| `published` | 到达 `expires_at`，由服务器自动执行 | `expired` |
| `draft`、`scheduled` 或 `published` | `unpublish` | `draft` |
| 任意状态 | `DELETE`，默认归档而不是物理删除 | `archived` |
| 任意状态 | `DELETE` 且 `purge=true`，需要 `announcement:publish` | 记录被物理删除 |
```

- `POST /announcements` 支持机器人"主动推送"：`publish=false` 为草稿（`announcement:write`），
  `publish=true` 立即（或在 `publish_at` 到点时）发布，需要 `announcement:publish`；
  缺权限返回 `403`，**不静默降级为草稿**，避免机器人误以为已发布。
- `dedup_key`：7 天窗口内重复 → 返回 `200`（新建是 `201`）与**既有**公告，
  便于群聊抽取器反复推送同一条消息。
- `source` 记录来源（平台、群、作者、原文、时间、置信度），审计与展示用。
- **广播至少一次**：`POST /announcements/{id}/broadcast` 返回 `202` + `Job`；
  每个渠道一条 `Delivery`，失败按 `broadcast_retry.max_attempts` 与退避重试。
  渠道侧**可能收到重复消息**，因此模板带公告 id 供去重；`deliveries` 端点可查每个渠道
  的 `attempts`/`error`/`external_message_id`。
- 发布、更新、归档、投递失败都会产生 SSE 事件（§4.8）。

### 4.7 名额分配（区域赛）

```
draft ──open──► open ──close──► closed ──finalize──► finalized ──► archived
                 │                │                     │
        接受认领（pending）   不再接受新认领      认领不可再审核
                              仍可审核 pending
```

- **模型**：名额按赛季分配，一次区域赛名额分配就是一个池；`contest.season` 是赛季，
  同一赛季下 `contest.name` 唯一（重复建池 `409`）。池里的 `quota_total` 是总名额。
  认领**必须审核**（没有免审核开关），只有 `approved` 才占用名额；
  `counts.remaining = quota_total - claims_approved`。
- **每队上限 2**：`max_claims_per_team` 默认 2（可配 1..10）。同一队伍在池内的
  未撤销/未拒绝认领数超过上限 → `409 team_claim_limit_reached`。
- **认领状态机**：`pending → (approved | rejected | withdrawn | expired | released)`。
  已批准的名额要退回，由管理员调 `POST /quotas/{quota_id}/claims/{claim_id}/release`
  （状态变 `released`，名额立刻回到池里、候补顺位前移）；队伍自己只能撤销尚未审核的
  `pending`。定案时仍在候补的 `pending` 会被置为 `expired`，非候补的 `pending` 则让
  定案返回 `409` 并列出 id——不会静默作废。
- **队员确认**：认领名单里的成员各自调
  `POST /quotas/{quota_id}/claims/{claim_id}/confirm` 确认参赛，需要 `quota:claim`。
- **归档**：`finalized` 之后管理员调 `POST /quotas/{quota_id}/archive` 归档，池与认领转为只读。
- **候补**：超出剩余名额的认领**允许提交**，进入 `waitlist`（`waitlist_position` 非空），
  仍为 `pending`；管理员批准到名额用尽时再批准 → `409 quota_exceeded`，认领保持 `pending`。
- **并发**：批准/更新用 `If-Match` 携带上次读到的 `revision`，并发修改返回 `412`；
  认领创建用 `Idempotency-Key` 防重复提交（网络差时尤其重要）。
- **finalize**：必须没有 `pending` 认领，否则 `409 conflict` 并列出待处理 id；
  finalize 后所有认领/审核端点返回 `409 quota_finalized`。降低 `quota_total` 到低于
  已批准数返回 `409 quota_exceeded`。

### 4.8 SSE 实时事件流

帧格式（`text/event-stream`）：

```
retry: 3000

id: 1042
event: announcement.published
data: {"id":"1042","sequence":1042,"topic":"announcements","type":"announcement.published","occurred_at":"2024-05-06T07:08:09.123Z","resource":{"kind":"announcement","id":"ann_01J8..."},"revision":"3","data":{...}}

: hb
```

- `sequence` 全局单调递增且唯一；`id:` 即序号。客户端据此**检测跳号**。
- 心跳注释 `: hb` 每 15 秒；`retry: 3000` 建议重连间隔。
- **重放**：重连时带 `Last-Event-ID`（`EventSource` 自动带）或 `last_event_id` 查询参数，
  服务器会从内存里的重放缓冲补发：最多最近 1000 条、或最近 5 分钟内的事件（先到者为准）。
- **gap**：请求位置早于缓冲下界，或客户端读得太慢导致缓冲溢出时，先发
  `stream.gap`（`data.resync_required=true`），客户端应做一次全量刷新（配合 §4.9）
  再继续增量；服务器不静默丢事件。
- **认证**：`EventSource` 不能设置请求头，因此用 `POST /stream/tokens` 签发的短时令牌
  （≤10 分钟，单次连接）放在查询参数。令牌过期服务器返回 `401` 并关闭连接，
  客户端必须重新签发再连。
- **主题授权**：`topics` 里越权的主题不会推送（连接不断），返回的令牌也只在授权主题内有效。

### 4.9 增量同步与离线缓存契约

离线缓存（客户端可选特性）依赖服务器提供三样东西：

1. **资源版本**：每个资源有 `revision`（= `ETag`）与 `updated_at`。
2. **条件读取**：单资源 `If-None-Match`/`304`，列表 `updated_since`。
3. **变更流**：`GET /sync/changes`。

```
基线握手：GET /sync/changes                      → {cursor: C0, changes: []}
首次全量：GET /members?page=1..n（各自 ETag）    → 写入本地库
增量追赶：GET /sync/changes?since=C0             → upsert/delete 列表 + 新 cursor C1
按需回源：GET /members/{id}（If-None-Match）     → 304 则用本地副本，200 则更新
```

- `changes[].op=delete` 表示服务端已删除该 id，客户端删除本地副本。
- 同一 `cursor` 重放是幂等的：不跳过、不重复已确认的变更。
- 变更保留期见 `Config.retention.sync_changes`（默认 30 天）；游标超出保留期返回 `410 cursor_expired`，
  客户端必须重新基线化（省略 `since` 的握手 + 全量拉取）。
- 变更流覆盖成员等 PII，因此**不允许匿名**（需要 `sync:read`）。
- 客户端缓存策略（本仓库的 TypeScript 客户端实现）：**stale-while-revalidate**，即
  先返回本地副本、同时在后台按 `ETag`/`updated_since` 回源刷新；离线时只读本地并标记 `stale`。
- 离线写入用 **outbox**：本地排队 + 稳定 `Idempotency-Key`，恢复网络后按序重放；
  服务器幂等保证重放不产生重复副作用。`409 idempotency_key_reused` 表示键被用于
  不同请求体（客户端 bug），`412` 表示并发修改需要用户决策——两者都不自动重试。

### 4.10 重试与错误处理

| 场景 | 客户端行为 |
| --- | --- |
| `GET`/`HEAD` 5xx、网络错误 | 指数退避 + 抖动重试（尊重 `Retry-After`） |
| `POST`/`PUT`/`PATCH` 5xx | 仅当带 `Idempotency-Key`（或天然幂等，如 `PUT` 替换）才重试 |
| `429` | 按 `Retry-After` 退避；不立即重试 |
| `401 token_expired` | 刷新一次并重放；刷新失败则登出 |
| `401 invalid_token` | 不重试，清理凭证 |
| `403 insufficient_scope` | 不重试，提示权限不足 |
| `412 precondition_failed` | 重新拉取资源、由用户决定是否覆盖 |
| `409 idempotency_key_reused` | 不重试，换新键或修正请求体 |
| `410 cursor_expired` / `export_expired` | 重新基线化 / 重新发起导出 |

---

### 4.11 成员自助维护自己的档案

**档案本来就是成员自己填的**（学号、年级、专业、联系方式都是本人提供），因此默认允许
成员自己改，不需要管理员介入。控制粒度是**字段组**，四个 `profile:*` scope 各管一组：

| 字段组 | scope | 覆盖字段 | 端点 |
| --- | --- | --- | --- |
| 展示名 | `profile:display` | `display_name` | `PATCH /auth/me` |
| 联系方式 | `profile:contact` | `profile.email`、`phone`、`qq`、`remark` | `PATCH /auth/me` |
| 学籍 | `profile:academic` | `profile.student_id`、`enrollment_year`、`major` | `PATCH /auth/me` |
| 社团登记 | `profile:clubs` | `profile.club_memberships` | `PUT /auth/me/clubs` |

**默认给全**：新建人类账号套用的 `user` 模板包含上面四组，因此开箱即可自助维护。

**要收窄就改 scope**，不改代码：

- 某个成员不能自学籍 → `PUT /accounts/{account_id}/scopes` 去掉 `profile:academic`；
- 某类账号（如机器人、外部平台）只读 → 换用不含 `profile:*` 的模板；
- 批量套用不同权限 → 在 `Config.accounts.templates` 里定义新模板，创建账号时用
  `template` 指定。

**部分变更**是天然的：`PATCH /auth/me` 只改请求里出现的字段，未出现的保持不变。

**越权不静默**：请求里出现调用者没有对应 scope 的字段时，整个请求返回
`403 insufficient_scope`，`errors[]` 逐个指出越权字段的 `pointer`，不做部分生效——
避免"以为改了学号，其实只改了手机号"。

**管理路径仍在**：`PATCH /members/{member_id}`、`PUT /members/{member_id}/clubs` 需要
`member:manage`，可代改任何人，用于成员改错后求助于管理员。两条路径写的是**同一份数据**，
都推进 `revision`，都写审计；自助写入的审计里 `actor` 就是本人，因此事后看得出是谁改的。

## 5. 权限（scope）词汇表

格式是 `资源:动作`，例如 `member:manage` 读作"成员资源的 manage 动作"。
通配形式只有两种：`<资源>:*` 表示该资源的全部动作，`*` 表示全部权限。
资源前缀共 17 个：

`account`、`member`、`team`、`oj`、`ingest`、`crawler`、`scoreboard`、`stats`、
`announcement`、`channel`、`quota`、`config`、`audit`、`ops`、`metrics`、`sync`、
`profile`。

`stream` 是**模块名而不是 scope 资源**：SSE 不引入新 scope，订阅某个主题时校验的是该
资源自己的 `*:read`（例如 `announcements` 主题要 `announcement:read`）。

| scope | 含义 |
| --- | --- |
| `account:self` | 使用自助端点：读自己、签发或撤销自己的凭证 |
| `profile:display` / `profile:contact` / `profile:academic` / `profile:clubs` | 自助修改自己的展示名 / 联系方式 / 学籍 / 社团登记；**只作用于调用者本人**，`profile:*` 表示四组全给 |
| `account:read` / `account:manage` | 查看 / 创建、修改、停用任何账号（含机器人） |
| `member:read` / `member:manage` / `member:assign` | 读成员名单 / 增删改与导入 / 分配标签与 scope |
| `member:read_pii` | 读他人的个人身份信息（学号、邮箱、电话、QQ）；没有它时这些字段被脱敏并在 `masked_fields` 里列出 |
| `member:read_pii` | 读他人的个人身份信息（学号、邮箱、电话、QQ）；没有它时这些字段被脱敏并在 `masked_fields` 里列出 |
| `team:read` / `team:manage` | 查看 / 创建、修改、删除队伍 |
| `oj:read` / `oj:write` / `oj:manage` | 读 OJ 数据 / 绑定自己的 OJ ID / 管理他人的绑定 |
| `ingest:write` | 采集器写入通道与运行上报 |
| `crawler:read` / `crawler:manage` | 读取（含代理）配置与状态 / 修改配置、触发爬取 |
| `scoreboard:read` / `scoreboard:manage` | 读榜单 / 定义与重建榜单 |
| `stats:read` | 读统计聚合 |
| `announcement:read` / `announcement:write` / `announcement:publish` | 读公告 / 起草与编辑 / 发布、置顶、撤回 |
| `channel:manage` | 渠道配置、测试与广播 |
| `quota:read` / `quota:claim` / `quota:manage` | 读名额 / 认领 / 管理名额与审核 |
| `sync:read` | 读增量变更流（覆盖成员等 PII，故不允许匿名） |
| `config:read` / `config:manage` | 读配置与 schema / 修改配置 |
| `audit:read` | 读审计日志 |
| `ops:read` | 查看与取消异步任务 |
| `metrics:read` | 读取 Prometheus 指标 |

补充两点：`stream` 主题不是 scope，而是 SSE 订阅时的过滤条件，每个主题校验对应的
`*:read`（例如订阅 `announcements` 需要 `announcement:read`），签发流令牌本身不要求额外
scope；可用的主题列表见契约里的 `StreamTopic`。

---

## 6. 错误模型

错误体采用 RFC 7807 Problem Details 格式，媒体类型为 `application/problem+json`：
`type` 是稳定的问题类型 URI、`title` 供人阅读、`status` 是 HTTP 状态码、`code`
（机器可读，见 `ProblemCode` 枚举）、`detail`、`instance`、`request_id`，校验失败带
`errors[]`（JSON Pointer + message + code）。客户端**必须按 `code` 分支**，
并对未知 `code` 回退到按 HTTP 状态码处理（新增枚举值属非破坏性变更）。

---

## 7. 二次开发指引

1. 管理员为应用创建 `service` 账号并签发 `api_key`（最小 scope：只读用
   `oj:read`/`scoreboard:read`/`stats:read`/`announcement:read`）。
2. `GET /meta` 做能力探测与时钟校准；`GET /openapi.json` 拉取契约（可代码生成）。
3. 公开数据（OJ 采集结果、榜单、统计、已发布公告）在 `public_read=true` 时可匿名读，
   但**推荐带 Key**以享受更高配额与稳定的限流身份。
4. 增量同步用 `GET /sync/changes`；实时通知用 `POST /stream/tokens` + SSE。
5. 跨域 CORS：允许的来源由配置 `server.cors_origins` 控制；SSE 与普通请求遵循同一套同源策略。
6. 服务器**不**提供用户自定义 webhook 订阅，以免产生出站请求伪造 SSRF 风险与重试风暴；
   需要推送时用长连接 SSE，或自建消费者轮询 `/sync/changes`。

---

## 8. 兼容性与演进

- 同一大版本内只做**非破坏性**变更：新增可选字段、新增端点、新增枚举值（含
  `ProblemCode`）、新增 scope。客户端必须忽略未知字段与未知枚举值。
- 破坏性变更（删除或重命名字段、改语义、改状态机）走 `/api/v2`，旧版本至少并行
  6 个月，并在 `GET /meta` 中公告弃用时间。
- 弃用中的端点返回 `Deprecation` 与 `Sunset` 响应头，并在契约里标 `deprecated: true`。
- 契约即文档：任何行为变更先改 `doc/api`，再改实现与客户端；`npm run api:lint`
  与客户端契约测试会拦截不一致。
