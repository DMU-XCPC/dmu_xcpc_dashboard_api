import { MemoryTokenStore, SessionManager, type TokenStore } from './auth/session.js';
import { ApiCache, type ApiCacheOptions } from './cache/cache.js';
import { MemoryCacheStore, type CacheStore } from './cache/store.js';
import { Outbox, type OutboxOptions } from './cache/outbox.js';
import { SyncEngine } from './cache/sync.js';
import type { Problem } from './types/common.js';
import type { RetryPolicy } from './http/retry.js';
import { Transport, type AuthProvider, type FetchLike, type ResponseMeta } from './http/transport.js';
import type { SseClient } from './sse.js';
import type { ResourceContext } from './resources/helpers.js';
import type { SubscribeOptions } from './resources/stream.js';

import { AccountsResource } from './resources/accounts.js';
import { AnnouncementsResource } from './resources/announcements.js';
import { AuditResource } from './resources/audit.js';
import { ChannelsResource } from './resources/channels.js';
import { ConfigResource } from './resources/config.js';
import { CrawlerResource } from './resources/crawler.js';
import { CredentialsResource } from './resources/credentials.js';
import { IngestResource } from './resources/ingest.js';
import { MembersResource } from './resources/members.js';
import { OjDataResource } from './resources/ojData.js';
import { OjHandlesResource } from './resources/ojHandles.js';
import { OpsResource } from './resources/ops.js';
import { RosterResource } from './resources/roster.js';
import { ScoreboardsResource } from './resources/scoreboards.js';
import { QuotasResource } from './resources/quotas.js';
import { SelfResource } from './resources/self.js';
import { StatsResource } from './resources/stats.js';
import { StreamResource } from './resources/stream.js';
import { SyncResource } from './resources/sync.js';
import { TeamsResource } from './resources/teams.js';

export interface XcpcClientOptions {
  /** 默认 `/api/v1`；非浏览器环境必须是绝对地址。 */
  baseUrl?: string;
  fetch?: FetchLike;
  /** 机器人/采集器的长期 API Key（与用户名口令登录互斥）。 */
  apiKey?: string;
  apiKeyHeader?: 'authorization' | 'x-api-key';
  /** 会话令牌存储；浏览器可传 localStorage/IndexedDB 实现。 */
  tokens?: TokenStore;
  headers?: Record<string, string> | (() => Record<string, string>);
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** 本地缓存存储；`false` 关闭缓存。默认内存实现。 */
  cache?: CacheStore | false;
  cacheOptions?: ApiCacheOptions;
  /** 离线写入队列；`false` 关闭。 */
  outbox?: boolean | OutboxOptions;
  /** 默认 TTL（新鲜期）。 */
  cacheTtlMs?: number;
  /** 默认允许返回的过期副本上限。 */
  cacheMaxStaleMs?: number;
  isOnline?: () => boolean;
  now?: () => number;
  onResponse?: (meta: ResponseMeta) => void;
  onProblem?: (problem: Problem, meta: ResponseMeta) => void;
  onRetry?: (info: { attempt: number; delayMs: number; status?: number; error?: unknown }) => void;
  rateLimit?: { throttle?: boolean };
  /** 收到 SSE 事件时自动失效对应资源的本地副本（默认开启）。 */
  invalidateOnStreamEvents?: boolean;
}

/**
 * API 客户端：把传输层、会话、本地缓存、离线队列、增量同步与各资源模块
 * 组合成单一入口。Node.js 18+ 与现代浏览器通用，运行时**零依赖**。
 *
 * ```ts
 * const client = new XcpcClient({ baseUrl: 'https://dashboard.example.edu/api/v1' });
 * await client.session.login('alice', 'secret');
 * const members = await client.members.list({ page: 1, size: 50 });
 * ```
 */
export class XcpcClient {
  readonly transport: Transport;
  readonly session: SessionManager;
  readonly cache?: ApiCache;
  readonly outbox?: Outbox;
  readonly sync: SyncEngine;
  readonly store: CacheStore;

  readonly accounts: AccountsResource;
  readonly credentials: CredentialsResource;
  readonly ojHandles: OjHandlesResource;
  readonly oj: OjDataResource;
  readonly members: MembersResource;
  readonly teams: TeamsResource;
  readonly roster: RosterResource;
  readonly ingest: IngestResource;
  readonly crawler: CrawlerResource;
  readonly scoreboards: ScoreboardsResource;
  readonly stats: StatsResource;
  readonly announcements: AnnouncementsResource;
  readonly channels: ChannelsResource;
  readonly stream: StreamResource;
  readonly quotas: QuotasResource;
  readonly self: SelfResource;
  readonly config: ConfigResource;
  readonly audit: AuditResource;
  readonly ops: OpsResource;
  readonly syncResource: SyncResource;

  constructor(options: XcpcClientOptions = {}) {
    const store: CacheStore = options.cache === undefined || options.cache === false ? new MemoryCacheStore() : options.cache;
    this.store = store;

    // 传输层与会话互相依赖：用惰性箭头函数打破构造顺序（调用发生在请求期）。
    const deferredAuth: AuthProvider = {
      authorize: (headers, ctx) => this.session.authorize(headers, ctx),
      onUnauthorized: (problem, ctx) => this.session.onUnauthorized(problem, ctx),
    };

    this.transport = new Transport({
      auth: deferredAuth,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.isOnline ? { isOnline: options.isOnline } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.onResponse ? { onResponse: options.onResponse } : {}),
      ...(options.onProblem ? { onProblem: options.onProblem } : {}),
      ...(options.onRetry ? { onRetry: options.onRetry } : {}),
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    });

    this.session = new SessionManager({
      transport: this.transport,
      store: options.tokens ?? new MemoryTokenStore(),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.apiKeyHeader ? { apiKeyHeader: options.apiKeyHeader } : {}),
      ...(options.now ? { now: options.now } : {}),
    });

    this.cache =
      options.cache === false
        ? undefined
        : new ApiCache(store, {
            ...(options.cacheTtlMs !== undefined ? { ttlMs: options.cacheTtlMs } : {}),
            ...(options.cacheMaxStaleMs !== undefined ? { maxStaleMs: options.cacheMaxStaleMs } : {}),
            ...(options.isOnline ? { isOnline: options.isOnline } : {}),
            ...(options.now ? { now: options.now } : {}),
            identity: () => this.session.identity(),
            ...(options.cacheOptions ?? {}),
          });

    this.outbox =
      options.outbox === false
        ? undefined
        : new Outbox(store, this.transport, {
            ...(options.now ? { now: options.now } : {}),
            ...(options.isOnline ? { isOnline: options.isOnline } : {}),
            ...(typeof options.outbox === 'object' ? options.outbox : {}),
          });

    this.sync = new SyncEngine({ transport: this.transport, store });

    const context: ResourceContext = {
      transport: this.transport,
      ...(this.cache ? { cache: this.cache } : {}),
      ...(this.outbox ? { outbox: this.outbox } : {}),
      ...(options.cacheTtlMs !== undefined ? { defaultTtlMs: options.cacheTtlMs } : {}),
      ...(options.cacheMaxStaleMs !== undefined ? { defaultMaxStaleMs: options.cacheMaxStaleMs } : {}),
    };

    this.accounts = new AccountsResource(context);
    this.credentials = new CredentialsResource(context);
    this.ojHandles = new OjHandlesResource(context);
    this.oj = new OjDataResource(context);
    this.members = new MembersResource(context);
    this.teams = new TeamsResource(context);
    this.roster = new RosterResource(context);
    this.ingest = new IngestResource(context);
    this.crawler = new CrawlerResource(context);
    this.scoreboards = new ScoreboardsResource(context);
    this.stats = new StatsResource(context);
    this.announcements = new AnnouncementsResource(context);
    this.channels = new ChannelsResource(context);
    this.stream = new StreamResource(context, {
      invalidateOnEvent: options.invalidateOnStreamEvents ?? true,
    });
    this.quotas = new QuotasResource(context);
    this.self = new SelfResource(context);
    this.config = new ConfigResource(context);
    this.audit = new AuditResource(context);
    this.ops = new OpsResource(context);
    this.syncResource = new SyncResource(this.sync, context);
  }

  /**
   * 订阅 SSE 事件流；默认自动签发短时流令牌，并在收到事件时失效本地副本。
   */
  subscribe(options: SubscribeOptions = {}): SseClient {
    return this.stream.subscribe(options);
  }
}
