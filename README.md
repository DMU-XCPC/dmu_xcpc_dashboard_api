# DMU/ICPC Dashboard — 主服务器 API 契约与 TypeScript 客户端

本仓库包含两件东西：

1. **`doc/api/`** —— 校队信息面板**主服务器**的 RESTful API 契约（OpenAPI 3.1，模块化文件），
   以及说明实体格式、端点语义与**时序行为**的设计文档。
2. **`client/`** —— 该 API 的 TypeScript 客户端（`@dmu/xcpc-api-client`），
   零运行时依赖，Node.js 18+ 与现代浏览器通用，内置会话刷新、退避重试、
   SSE 事件流、基于本地数据库的离线缓存与离线写入队列。

契约优先：`doc/api` 是唯一事实源，服务端实现、前端与第三方都以它对齐；
客户端有测试强制校验"代码里的端点 ↔ 契约里的 operationId"一致。

> 名词不熟（主体、scope、幂等键、ETag、SSE、outbox…）先看
> [`doc/api/README.md` §0.1 术语速查](doc/api/README.md#01-术语速查)；
> 想直接找接口看 [§2.1 按任务找端点](doc/api/README.md#21-按任务找端点第一次读先看这里)。

## 目录结构

```
doc/api/
  openapi.yaml                  根文档（info / servers / tags / security / paths 索引）
  README.md                     设计说明：术语速查、实体、语义、时序行为（**先读 §0.1**）
  STYLE.md                      契约编写规范
  paths/*.yaml                  20 个模块（90 条路径、118 个 operation）
  components/schemas/*.yaml     224 个 schema（bundle 去重后口径；按领域分文件）
  components/{parameters,responses,headers}/common.yaml   共享组件
client/
  src/                          TypeScript 客户端
  test/                         行为测试 + 契约一致性测试
build/                          api:build 产物（openapi.bundled.{yaml,json}）；
                                npm run api:docs 另外生成 docs.html；都是运行后才存在
```

## 快速开始

**前置条件**：Node.js 18 或更高；npm 即可（仓库用 npm workspaces，`client/` 是其中一个
workspace，因此带 `-w` 的命令必须在**仓库根目录**执行）。TypeScript 固定 5.x，因为客户端的
`.d.ts` 打包工具尚不支持 TS 7 原生预览版。若你的环境里 `~/.npm` 不可写（沙箱、容器），
先 `export npm_config_cache="$PWD/.npm-cache"`。

```sh
npm install                 # 安装根（redocly/typescript）与 client 的依赖

npm run api:lint            # 契约 lint（redocly，必须零 error）
npm run api:build           # lint + 打包成 build/openapi.bundled.{yaml,json}
npm run typecheck           # 客户端类型检查
npm test                    # 契约校验 + 客户端全部测试
npm run verify              # 以上全部（CI 入口）

npm run fixtures            # 契约的 schema/示例变更后，先跑这个（类型↔契约桥）
npm run build               # 打包客户端（ESM + CJS + d.ts）
```

**改动顺序**：改了 `doc/api` 的 schema 或示例后，先 `npm run fixtures` 再 `npm run verify`，
否则类型↔契约的桥还是旧的，校验会失败。

**阅读契约**：`npm run api:docs` 生成单文件 HTML 文档 `build/docs.html`，用浏览器直接打开
（redocly 的 `preview` 子命令面向 Redocly Realm 项目，不是本契约的预览服务）。

## 覆盖的功能

契约覆盖**主服务器需要提供的接口**；采集器程序、QQ/Agent 机器人与前端都是
契约的**调用方**，各自独立部署，不在本仓库内。下表左列是项目最初的功能需求，
已复述成自解释的句子。

| 功能 | 契约模块 |
| --- | --- |
| 社团成员：查人/筛人、填表字段（学号、年级、专业）、批量导入、活跃度 | `members`（见 §2.1 与 §3.1） |
| 两个社团身份（海风社团软件部 / ACM-ICPC 学社），可只注册其一或两者 | `members` 模块：`PUT /members/{member_id}/clubs`；数据落在 `PrincipalProfile.club_memberships`；筛选维度是各接口的 `club` / `clubs` 参数 |
| 人员名单导出，超过 1 年未活跃自动排除 | `roster`（异步导出任务） |
| 权限：`资源:动作` scope 字符串列表，角色退化为标签 | 全部模块的 scope 词汇，见 `doc/api/README.md` §5 |
| 成员自助维护自己的信息（档案本来就是本人填的） | `profile:*` 字段组 scope + `PATCH /auth/me`、`PUT /auth/me/clubs`；默认模板给全，可按主体收窄，见 §4.11 |
| 成员 PII 分级：默认看不到他人的学号/邮箱/电话/QQ | `member:read_pii` scope + `masked_fields` 脱敏标记；默认 `user` 模板不含它，`manager` 模板含 |
| 名额生命周期：审核、候补、释放、归档、队员确认 | `POST /quotas/{id}/claims/{claim_id}/release\|confirm`、`POST /quotas/{id}/archive`；状态机含 `released` |
| 赛季：省略 `season` 时用当前赛季 | `Config.roster.current_season` + `GET /meta` 的 `current_season` |
| 数据保留期只有一个出处 | `Config.retention`（提交、审计、任务、变更流、已归档公告） |
| 成员绑定 OJ ID、归属校验 | `oj-handles` |
| 采集器提交记录/rating 历史/题目数据，公开查询 | `ingest`（写入）、`oj-data`（查询） |
| 采集器代理回退配置、运行状态、可代管触发 | `crawler` |
| 不同分组的 scoreList（平台 × 个人/队伍） | `scoreboards` |
| 训练 trend、热力图、直方图数据 | `stats` |
| 对外二次开发接口（标准 REST + API Key + 限流） | 全部公开读端点 + `ops`（`/meta`、`/openapi.json`） |
| 新闻板/公告：主动推送、定时发布、广播、投递记录 | `announcements`、`channels` |
| 实时事件流 | `stream`（SSE） |
| 区域赛名额分配（管理员设名额、队伍认领、**需审核**、每队上限 2） | `quotas` |
| 参数配置（TOML/YAML 配置文件，**不支持 XML**） | `config` |
| 增量同步（供二次开发与离线缓存） | `sync` |
| 审计与运维 | `audit`、`ops` |

不在本契约范围内（有意排除）：前端渲染、采集器内部实现、群聊消息的自动识别与摘要、
用户自定义出站 webhook 订阅。理由见 `doc/api/README.md` §1 与 §7。

## 客户端用法

**先把它装进你的项目**：本仓库**不发布到公共 registry**，根包也是 `private`，因此有三种用法：

```sh
# 1) 在本仓库里开发（workspace 引用，零配置）
npm install && npm run build

# 2) 给仓库外的项目用：打成 tarball 再装
npm pack -w @dmu/xcpc-api-client          # 产出 dmu-xcpc-api-client-0.1.0.tgz
npm install /path/to/dmu-xcpc-api-client-0.1.0.tgz

# 3) 发布到私有 registry 后正常安装（需自行配置 registry 与 publishConfig）
```

`client/dist/` 是构建产物且被 `.gitignore` 忽略，因此**新克隆的仓库里没有它**——先 `npm run build`。

多数读接口可以在匿名下调用（`GET /meta`、`public_read=true` 时的榜单与公告）；
其余接口需要凭证：人类用 `session.login()`，机器人用 API Key（构造时传 `apiKey`）。

```ts
import {
  XcpcClient, IndexedDbCacheStore, ApiProblemError, NetworkError, OfflineError,
} from '@dmu/xcpc-api-client';

const client = new XcpcClient({
  baseUrl: 'https://dashboard.example.edu/api/v1',
  cache: new IndexedDbCacheStore({ name: 'xcpc-cache' }), // 浏览器本地数据库；Node 用默认内存实现
  cacheTtlMs: 30_000,
});

// 登录（令牌对会自动注入后续请求；刷新令牌单次使用，并发 401 只刷新一次）
await client.session.login('alice', 'passphrase', { deviceName: 'Web' });

// 读：默认走本地缓存 + ETag 条件读取，弱网/离线时降级为过期副本
const members = await client.members.list({ page: 1, size: 50, club: ['acm_icpc'] });

// 写：幂等键自动生成；弱网时可先入本地队列，恢复网络后由你自己触发重放
const outcome = await client.quotas.createClaim(
  'quota_01J8Z5V6Q0K3M7N9P2R4T6W8X0',
  {
    team_id: 'team_01J8Z5V6Q0K3M7N9P2R4T6W8X0',
    members: [{ principal_id: 'acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0' }],
  },
  { queueIfOffline: true },
);
if (outcome.queued) {
  console.log('已离线入队；恢复网络后调用 client.outbox?.flush() 重放');
}

// SSE：自动签发短时流令牌，序号跳号或缓冲不足时回调 onGap
const stream = client.subscribe({
  topics: ['announcements'],
  onEvent: (event) => console.log(event.type, event.resource),
  onGap: (info) => {
    // 断线期间可能漏事件：做一次增量追赶（省略参数则使用本地已持久化的游标）
    if (info.resyncRequired) void client.sync.pullAll();
  },
});
await stream.start();   // 异步建立连接；签发令牌或连接失败会在这里抛出
```

**注意**：离线队列**不会自动重放**。接入方需要在网络恢复时自行调用 `client.outbox?.flush()`
（例如监听浏览器的 `online` 事件），或在应用启动时调用一次。

错误分两类：**服务端返回了错误**时抛 `ApiProblemError`，携带 RFC 7807 的 `code`；
**请求没能到达服务端**时抛 `NetworkError` 的子类 `OfflineError`（离线）或 `TimeoutError`
（超时）。因此先判断类型，再按 `code` 分支：

```ts
try {
  await client.announcements.publish('ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0');
} catch (error) {
  if (error instanceof ApiProblemError && error.code === 'insufficient_scope') {
    // 权限不足：不要重试
  } else if (error instanceof OfflineError) {
    // 离线：写请求可以入 outbox，读请求走本地缓存
  } else if (error instanceof NetworkError) {
    // 网络问题：可退避重试
  }
}
```

离线场景（缓存 + 队列 + 增量同步）见 `client/README.md`。

## 测试在约束什么

`client/test/` 不只是单测，它同时约束契约本身（9 个测试文件，断言数见 `npm test` 输出）：

- `contract.test.ts`：契约不变量——无 XML 表示、每个 operation 有 operationId/tag/summary/description、
  写操作要求 `Idempotency-Key`（含豁免清单）、路径参数已声明、`x-consistency` 与新鲜度上界、
  分页形状统一、所有 schema 级示例通过自身 schema 校验。
- `client-contract.test.ts` + `fixtures.ts`：**逐条比对客户端声明的端点与契约 operationId**，
  要求 118 个 operation 全部被客户端覆盖（`SelfResource` 管 `/auth/me*`、
  `SessionManager` 管登录与刷新、`SseClient` 管事件流）；
  关键实体的示例数据同时被 TypeScript 类型（编译期 `satisfies`）与契约 schema（运行期 Ajv）约束。
- `transport/session/cache/outbox/sse/resources*.test.ts`：把语义与时序写死——重试与 `Retry-After`、
  401 单飞刷新、ETag/304、SWR 降级、幂等重放、SSE 补发与 gap 检测、资源方法的请求构造。

## 状态

契约与客户端均已实现并通过测试；仓库不含服务端实现（服务端可用任何语言，
按契约实现即可）。变更流程：先改 `doc/api`，跑 `npm run verify`，再同步实现。
