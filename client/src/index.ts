/**
 * `@dmu/xcpc-api-client` —— DMU/ICPC 面板主服务器 API 的 TypeScript 客户端。
 *
 * - 运行时零依赖，Node.js 18+ 与现代浏览器通用（基于 `fetch`）
 * - 契约优先：类型与端点对齐 `doc/api/openapi.yaml`（由 `test/contract.test.ts` 强制校验）
 * - 内置：会话与单飞刷新、RFC 7807 错误映射、退避重试与限流、ETag 条件读取、
 *   SSE 事件流（含 `Last-Event-ID` 补发与 gap 检测）、
 *   本地缓存（IndexedDB / 内存，stale-while-revalidate）与离线写入队列（outbox）
 */

export { XcpcClient, type XcpcClientOptions } from './client.js';

/* ------------------------------------------------------------------ 核心 */
export {
  Transport,
  type AuthProvider,
  type FetchLike,
  type HttpMethod,
  type RateLimitInfo,
  type ResponseMeta,
  type TransportOptions,
  type TransportRequest,
  type TransportResult,
} from './http/transport.js';
export {
  buildUrl,
  serializeQuery,
  substitutePath,
  type QueryParams,
  type QueryPrimitive,
  type QueryValue,
} from './http/query.js';
export {
  computeBackoffDelay,
  DEFAULT_RETRY_POLICY,
  isIdempotentMethod,
  resolveRetryPolicy,
  shouldRetryStatus,
  sleep,
  type RetryPolicy,
} from './http/retry.js';
export {
  AbortedError,
  ApiProblemError,
  NetworkError,
  OfflineError,
  ParseError,
  TimeoutError,
  isApiProblemError,
  isNetworkError,
  normalizeProblem,
  problemCodeForStatus,
} from './errors.js';

/* -------------------------------------------------------------- 会话/认证 */
export {
  MemoryTokenStore,
  SessionManager,
  type SessionOptions,
  type StoredTokens,
  type TokenStore,
} from './auth/session.js';

/* ------------------------------------------------------------ 缓存与同步 */
export { ApiCache, type ApiCacheOptions, type CachePolicy, type CachedResult } from './cache/cache.js';
export {
  MemoryCacheStore,
  type CacheEntry,
  type CacheStore,
} from './cache/store.js';
export { IndexedDbCacheStore, type IndexedDbCacheStoreOptions } from './cache/indexeddb.js';
export { Outbox, type FlushReport, type OutboxEnqueueRequest, type OutboxEvent, type OutboxItem, type OutboxOptions } from './cache/outbox.js';
export { SyncEngine, type ChangeFeed, type SyncEngineOptions } from './cache/sync.js';

/* ------------------------------------------------------------------- SSE */
export { SseClient, SseParser, type SseClientOptions, type SseFrame, type SseGapInfo, type StreamEvent, type StreamTopic, type StreamResourceKind } from './sse.js';

/* -------------------------------------------------------------- 资源辅助 */
export {
  cacheKeyFor,
  readCached,
  readJson,
  writeJson,
  writeResult,
  writeWithQueue,
  type ReadOptions,
  type ReadRequest,
  type RequestOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
  type WriteRequest,
} from './resources/helpers.js';

/* ---------------------------------------------------------------- 资源类 */
export { AccountsResource, ACCOUNTS_OPERATIONS } from './resources/accounts.js';
export { AnnouncementsResource, ANNOUNCEMENTS_OPERATIONS } from './resources/announcements.js';
export { AuditResource, AUDIT_OPERATIONS } from './resources/audit.js';
export { ChannelsResource, CHANNELS_OPERATIONS } from './resources/channels.js';
export { ConfigResource, CONFIG_OPERATIONS } from './resources/config.js';
export { CrawlerResource, CRAWLER_OPERATIONS } from './resources/crawler.js';
export { CredentialsResource, CREDENTIALS_OPERATIONS } from './resources/credentials.js';
export { IngestResource, INGEST_OPERATIONS } from './resources/ingest.js';
export { MembersResource, MEMBERS_OPERATIONS } from './resources/members.js';
export { OjDataResource, OJ_DATA_OPERATIONS } from './resources/ojData.js';
export { OjHandlesResource, OJ_HANDLES_OPERATIONS } from './resources/ojHandles.js';
export { OpsResource, OPS_OPERATIONS } from './resources/ops.js';
export { RosterResource, ROSTER_OPERATIONS } from './resources/roster.js';
export { ScoreboardsResource, SCOREBOARDS_OPERATIONS } from './resources/scoreboards.js';
export { SelfResource, SELF_OPERATIONS } from './resources/self.js';
export { QuotasResource, QUOTAS_OPERATIONS } from './resources/quotas.js';
export { StatsResource, STATS_OPERATIONS } from './resources/stats.js';
export { StreamResource, STREAM_OPERATIONS, type SubscribeOptions } from './resources/stream.js';
// 类名与 types/common.ts 的 `SyncResource` 字符串枚举同名，公开 API 里改用 SyncApiResource。
export { SyncResource as SyncApiResource, SYNC_OPERATIONS } from './resources/sync.js';
export { TeamsResource, TEAMS_OPERATIONS } from './resources/teams.js';

/* ------------------------------------------------------------------ 类型 */
export * from './types/common.js';
export * from './types/accounts.js';
export * from './types/oj.js';
export * from './types/roster.js';
export * from './types/boards.js';
export * from './types/news.js';
export * from './types/quotas.js';
export * from './types/config.js';
export * from './types/ops.js';
