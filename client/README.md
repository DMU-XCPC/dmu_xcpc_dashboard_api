# @dmu/xcpc-api-client

DMU/ICPC 面板主服务器 API 的 TypeScript 客户端。契约见仓库的
[`doc/api`](../doc/api)（`openapi.yaml` 是契约本体）。
名词不熟先看 [`doc/api/README.md` 的 §0.1 术语速查](../doc/api/README.md#01-术语速查)；
本文件里的"契约 §4.9"等指的都是那份设计说明。

- **零运行时依赖**，基于 `fetch`，Node.js 18+ 与现代浏览器通用（ESM + CJS 双产物）
- **自助**：`client.self` 覆盖 `/auth/me*`——读自己、改档案字段、改口令、登记社团；
  能改哪些字段由 `profile:*` 字段组 scope 决定（默认模板给全，见契约 §4.11）
- **类型与端点对齐契约**：每个资源模块导出 `XXX_OPERATIONS` 清单，
  `test/client-contract.test.ts` 逐条比对契约里的 `operationId` 与路径模板
- **会话**：访问令牌自动注入；`401` 触发**单飞**刷新并重放一次
  （刷新令牌单次使用 + 轮换，并发刷新会被服务端判定为泄露）
- **可靠性**：指数退避 + `Retry-After`、只重试幂等请求、`Idempotency-Key` 自动生成、
  RFC 7807 错误映射为 `ApiProblemError`
- **离线**：本地缓存（IndexedDB / 内存）+ `stale-while-revalidate` + ETag 条件读取，
  以及离线写入队列（outbox）按序重放
- **实时**：SSE 事件流，含短时令牌、`Last-Event-ID` 补发与序号 gap 检测

## 安装与构建

```sh
npm install                 # 仓库根目录
npm run build -w @dmu/xcpc-api-client
```

## 快速开始

```ts
import { XcpcClient } from '@dmu/xcpc-api-client';

const client = new XcpcClient({ baseUrl: 'https://dashboard.example.edu/api/v1' });

await client.session.login('alice', 'passphrase', { deviceName: 'Web' });

const page = await client.members.list({ page: 1, size: 50, club: ['acm_icpc'], sort: 'last_active_at' });

// 集训队挂靠两个社团，成员可只注册其一或两者，因此名单与活跃度都要按社团分看
const acm = await client.members.list({ club: ['acm_icpc'] });
const software = await client.members.list({ club: ['safewind_software'] });
// 自助：成员维护自己的档案字段（默认模板给全 profile:* 四组）
await client.self.updateMe({ profile: { phone: '13900000000' } });

// 自助：登记或退出自己的社团；只想动一个社团也要提交完整集合
await client.self.setClubs({
  memberships: [
    { club: 'acm_icpc', status: 'active', registered_at: '2024-03-01', role: '成员' },
    { club: 'safewind_software', status: 'active', registered_at: '2023-09-20', role: '干事' },
  ],
});

// 管理路径：管理员代改任何人，需要 member:manage
const memberId = 'acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0';   // 来自 GET /members 的条目 id
await client.members.setClubs(memberId, {
  memberships: [
    { club: 'safewind_software', status: 'active', registered_at: '2023-09-20', role: '干事' },
    { club: 'acm_icpc', status: 'active', registered_at: '2024-03-01', role: '成员' },
  ],
});
```

机器人/采集器用长期 API Key，不需要登录：

```ts
const crawler = new XcpcClient({
  baseUrl: 'https://dashboard.example.edu/api/v1',
  apiKey: process.env.XCPC_API_KEY,
  apiKeyHeader: 'x-api-key',
});

await crawler.ingest.submissions({ items: [/* … */] });   // 幂等：自然键 + Idempotency-Key
const config = await crawler.crawler.getConfig();          // 读取代理等采集配置（password 永不下发）
```

## 浏览器离线缓存与离线写入

浏览器里把默认的内存缓存换成 IndexedDB（"本地数据库"）；Node 里用内存实现或注入
自己的 `CacheStore`：

```ts
import { XcpcClient, IndexedDbCacheStore } from '@dmu/xcpc-api-client';

const client = new XcpcClient({
  baseUrl: '/api/v1',
  cache: new IndexedDbCacheStore({ name: 'xcpc-cache' }),
  cacheTtlMs: 30_000,        // 新鲜期：期内直接返回本地副本，后台用 If-None-Match 校验
  cacheMaxStaleMs: 604_800_000, // 最多允许返回 7 天内的过期副本（离线降级）
  outbox: true,              // 默认就是开启；只有显式写 outbox: false 才关闭
  onResponse: (meta) => {    // 可选：观察每个响应的元信息，例如是否用了过期副本
    if (meta.stale) console.warn('返回的是过期副本，后台正在刷新');
  },
});
```

读路径（契约 §4.9）：

1. 有**新鲜**副本 → 立刻返回，后台条件回源（`304` 则只更新时间戳）；
2. 副本过期 → 先回源；网络失败/5xx → 在 `cacheMaxStaleMs` 内返回过期副本
   （结果的 `meta.stale === true`：既可在构造参数里统一用 `onResponse` 观察，也可在某次
   调用上临时传 `{ onResponse }`）；
3. 离线且本地无副本 → 抛 `OfflineError`。

写路径：给写方法加 `{ queueIfOffline: true }`，离线（或网络失败）时请求进入 outbox：

```ts
// 这些 id 来自上一步的响应，这里写成常量只是为了让示例可运行
const quotaId = 'quota_01J8Z5V6Q0K3M7N9P2R4T6W8X0';
const teamId = 'team_01J8Z5V6Q0K3M7N9P2R4T6W8X0';
const roster = await client.members.list({ club: ['acm_icpc'] });

const outcome = await client.quotas.createClaim(
  quotaId,
  { team_id: teamId, members: roster.items.map((m) => ({ principal_id: m.id })) },
  { queueIfOffline: true },
);

if (outcome.queued) {
  // 已入队。离线队列不会自己重放：网络恢复后由你调用 flush()
  await client.outbox?.flush();
} else {
  console.log(outcome.data.status); // 'pending'：仍需管理员审核
}
```

outbox 的语义（`test/outbox.test.ts` 约束）：

- 条目按 `createdAt` 顺序重放；幂等键**持久化**，重放不会产生重复副作用；
- `429/5xx/网络错误/401` → 保留并退避，**中断本轮**以保持因果顺序；
- 其他 `4xx`（`403/409/412/422`…）→ 标记 `failed`，等用户决策；不会自动重试；
- `client.outbox.list()/remove()/clear()` 可查看与干预队列。

## 增量同步

```ts
const cursor = await client.sync.baseline();   // 基线握手：只取当前游标，不取数据
await client.sync.pullAll(cursor);             // 逐页追赶，游标自动持久化
// 省略参数则从本地持久化的游标继续：await client.sync.pullAll();

// 也可以自己消费变更流（资源方法名是 listChanges，见 SyncResource）
const feed = await client.syncResource.listChanges({ since: cursor, resources: ['members', 'teams'] });
for (const change of feed.changes) {
  // 变更项只给元信息：按资源名与 id 让本地副本失效，下次读时再回源取正文
  await client.cache?.invalidateResource(change.resource, change.id);
}
```

游标超出保留期时服务端返回 `410 cursor_expired`（`ApiProblemError.code`）：
清空本地副本、重新 `baseline()` 并全量拉取。

## SSE 事件流

```ts
// topics 可用值：announcements、scoreboards、ingest、quotas、members、jobs
const stream = client.subscribe({
  topics: ['announcements', 'scoreboards'],
  onEvent: (event) => console.log(event.sequence, event.type, event.resource),
  onGap: (info) => {
    // 缓冲不足或丢事件：做一次增量追赶或全量刷新
    if (info.resyncRequired) void client.sync.pullAll();
  },
});
await stream.start();
// …
stream.stop();
```

默认自动 `POST /stream/tokens` 签发短时令牌（`EventSource` 无法设置请求头），
并在收到事件时失效对应资源的本地缓存（`invalidateOnStreamEvents`，默认开启）。
断线自动重连并携带 `last_event_id` 补发。

## 错误处理

所有 4xx/5xx 都是 `ApiProblemError`：

```ts
import { ApiProblemError, isApiProblemError, isNetworkError } from '@dmu/xcpc-api-client';

try {
  await client.announcements.publish('ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0');
} catch (error) {
  if (isApiProblemError(error)) {
    switch (error.code) {
      case 'insufficient_scope': /* 权限不足，不要重试 */ break;
      case 'version_conflict':   /* 412：重新拉取后由用户决定 */ break;
      case 'quota_exceeded':     /* 409：名额已满，进入候补 */ break;
      default: console.error(error.status, error.problem.detail, error.requestId);
    }
  } else if (isNetworkError(error)) {
    /* 网络问题：可结合 outbox 重试 */
  }
}
```

重试由传输层负责（`retry` 选项：`maxAttempts`、`baseDelayMs`、`retryOnStatus`、
`retryIdempotentOnly`、`respectRetryAfter`）；`429`/`503` 的 `Retry-After` 优先于指数退避。
`x-ratelimit-*` 会解析到 `meta.rateLimit`，可用 `rateLimit: { throttle: true }`
在配额耗尽时主动等待窗口重置。

## 在 Node 与浏览器中的差异

| 能力 | Node.js 18+ | 浏览器 |
| --- | --- | --- |
| `baseUrl` | 必须是绝对地址（否则抛 `NetworkError`） | 可用相对路径（同源部署） |
| 默认 `fetch` | 全局 `fetch` | 全局 `fetch` |
| 默认缓存 | `MemoryCacheStore` | 建议显式传 `IndexedDbCacheStore` |
| 令牌存储 | `MemoryTokenStore`（可自行实现 `TokenStore` 落盘） | 可基于 `localStorage`/IndexedDB 实现 |
| SSE | 支持（流式 `fetch`） | 支持；`EventSource` 场景用 `subscribe()` 的流令牌 |

## 测试

```sh
npm test -w @dmu/xcpc-api-client      # 需要先 npm run api:build（根目录）
```

| 测试 | 约束的行为 |
| --- | --- |
| `contract.test.ts` | 契约不变量：无 XML、operation 形状、幂等键、路径参数、分页形状、示例合法性 |
| `transport.test.ts` | 请求构造、幂等键、RFC 7807 映射、重试与 `Retry-After`、超时/离线/取消、304 |
| `session.test.ts` | 登录、401 单飞刷新并重放、刷新令牌失效清理、离线登出、API Key 模式 |
| `cache.test.ts` | SWR、304 复用副本、网络/5xx 降级为 stale、maxStaleMs 边界、按资源失效 |
| `outbox.test.ts` | 顺序重放、幂等键稳定、可重试 vs 终态失败、离线不入网 |
| `sse.test.ts` | 帧解析（半帧/多行/CRLF）、序号跳号与 `stream.gap`、`last_event_id` 补发、令牌 |

测试用 **vitest** 运行；HTTP 用 **msw** 拦截（不会真发请求），浏览器存储用
**fake-indexeddb** 替身。只跑一个文件：`npx vitest run test/sse.test.ts`；
`npm run test:watch -w @dmu/xcpc-api-client` 可进入监听模式。
