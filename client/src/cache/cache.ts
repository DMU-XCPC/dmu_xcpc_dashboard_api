import { OfflineError, isApiProblemError, isNetworkError } from '../errors.js';
import type { ResponseMeta, TransportResult } from '../http/transport.js';
import type { CacheEntry, CacheStore } from './store.js';

export interface CachePolicy {
  /** 逻辑键；同一键共享副本与 ETag。 */
  key: string;
  /** 新鲜期；期内直接命中本地副本。 */
  ttlMs?: number;
  /** 命中新鲜副本时后台回源校验（默认开启）。 */
  staleWhileRevalidate?: boolean;
  /** 允许返回的超期副本上限（离线降级用）。 */
  maxStaleMs?: number;
  /** 网络失败时是否降级为过期副本（默认开启）。 */
  offlineFallback?: boolean;
  resource?: string;
  id?: string;
}

export interface CachedResult<T> {
  data: T;
  updatedAt: number;
  /** 数据来自本地副本（未从网络读取）。 */
  fromCache: boolean;
  /** 本地副本已超过 TTL。 */
  stale: boolean;
  /** 本次调用与网络交互过（200 或 304）。 */
  revalidated: boolean;
  /** 条件读取命中 304：本地副本仍有效。 */
  notModified: boolean;
  meta?: ResponseMeta;
}

export interface ApiCacheOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  staleWhileRevalidate?: boolean;
  offlineFallback?: boolean;
  isOnline?: () => boolean;
  now?: () => number;
  /**
   * 当前调用者的身份指纹（用户名、API Key 前缀或 `anonymous`）。
   * 契约要求"缓存键必须包含全部查询参数与请求者的权限身份"：本类在每次读取时比较该值，
   * **一旦变化就清空整个本地缓存**，避免切换账号后把上一身份的副本（例如仅本人可见的
   * `verification_token`、私有公告）返回给新主体。
   */
  identity?: () => string;
  /** 后台回源更新副本后回调（可用于驱动 UI 刷新）。 */
  onUpdate?: (key: string, entry: CacheEntry) => void;
}

type Fetcher<T> = (ctx: { etag?: string; ifNoneMatch?: string }) => Promise<TransportResult<T>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 读穿缓存（stale-while-revalidate）。
 *
 * 行为严格对齐契约 §4.9：
 * - 新鲜命中 → 直接返回本地副本，并在后台用 `If-None-Match` 校验；
 * - 超过 TTL → 先条件回源：`304` 则刷新时间戳并复用副本，`200` 则替换副本；
 * - 离线或网络/5xx 失败 → 在 `maxStaleMs` 内返回过期副本并标记 `stale`；
 * - 本地无副本且离线 → 抛 `OfflineError`。
 */
export class ApiCache {
  private identity?: string;
  private readonly store: CacheStore;
  private readonly options: Required<Pick<ApiCacheOptions, 'ttlMs' | 'maxStaleMs' | 'staleWhileRevalidate' | 'offlineFallback'>> &
    ApiCacheOptions;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(store: CacheStore, options: ApiCacheOptions = {}) {
    this.store = store;
    this.options = {
      ttlMs: options.ttlMs ?? 30_000,
      maxStaleMs: options.maxStaleMs ?? 7 * DAY_MS,
      staleWhileRevalidate: options.staleWhileRevalidate ?? true,
      offlineFallback: options.offlineFallback ?? true,
      ...options,
    };
    this.now = options.now ?? (() => Date.now());
  }

  get cacheStore(): CacheStore {
    return this.store;
  }

  private isOnline(): boolean {
    if (this.options.isOnline) return this.options.isOnline();
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
    return true;
  }

  async peek<T>(key: string): Promise<CacheEntry<T> | null> {
    return this.store.get<T>(key);
  }

  /** 身份变化时清空缓存；同一身份内是幂等的。 */
  private async enforceIdentity(): Promise<void> {
    const identity = this.options.identity?.();
    if (identity === undefined) return;
    if (this.identity === undefined) {
      this.identity = identity;
      return;
    }
    if (this.identity !== identity) {
      this.identity = identity;
      await this.store.clear();
    }
  }

  async invalidate(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** 按资源集合失效（例如收到 SSE 事件或 `sync/changes` 变更后）。 */
  async invalidateResource(resource: string, id?: string): Promise<void> {
    const keys = await this.store.keys();
    const targets: string[] = [];
    for (const key of keys) {
      const entry = await this.store.get(key);
      if (!entry || entry.resource !== resource) continue;
      if (id === undefined || entry.id === id) targets.push(key);
    }
    await Promise.all(targets.map((key) => this.store.delete(key)));
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  /** 等待所有后台回源结束（测试与"刷新前先落盘"场景使用）。 */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.inflight.values()]);
  }

  async read<T>(policy: CachePolicy, fetcher: Fetcher<T>): Promise<CachedResult<T>> {
    await this.enforceIdentity();

    const ttlMs = policy.ttlMs ?? this.options.ttlMs;
    const maxStaleMs = policy.maxStaleMs ?? this.options.maxStaleMs;
    const swr = policy.staleWhileRevalidate ?? this.options.staleWhileRevalidate;
    const offlineFallback = policy.offlineFallback ?? this.options.offlineFallback;
    const now = this.now();
    const cached = await this.store.get<T>(policy.key);
    const age = cached ? now - cached.updatedAt : Number.POSITIVE_INFINITY;

    if (cached && age <= ttlMs && this.isOnline()) {
      if (swr) void this.revalidate(policy, fetcher);
      return {
        data: cached.value,
        updatedAt: cached.updatedAt,
        fromCache: true,
        stale: false,
        revalidated: false,
        notModified: false,
      };
    }

    if (!this.isOnline()) {
      if (cached && offlineFallback && age <= maxStaleMs) {
        return {
          data: cached.value,
          updatedAt: cached.updatedAt,
          fromCache: true,
          stale: true,
          revalidated: false,
          notModified: false,
        };
      }
      throw new OfflineError('离线且本地没有可用副本', { url: policy.key });
    }

    try {
      const result = await fetcher(this.conditional(cached));
      return await this.commit(policy, result, cached);
    } catch (error) {
      if (cached && offlineFallback && age <= maxStaleMs && isDegradable(error)) {
        return {
          data: cached.value,
          updatedAt: cached.updatedAt,
          fromCache: true,
          stale: true,
          revalidated: false,
          notModified: false,
        };
      }
      throw error;
    }
  }

  private conditional(cached: CacheEntry<unknown> | null): { etag?: string; ifNoneMatch?: string } {
    if (!cached?.etag) return {};
    return { etag: cached.etag, ifNoneMatch: cached.etag };
  }

  private async commit<T>(
    policy: CachePolicy,
    result: TransportResult<T>,
    cached: CacheEntry<T> | null,
  ): Promise<CachedResult<T>> {
    const now = this.now();
    if (result.meta.notModified) {
      const base = cached;
      if (!base) {
        throw new OfflineError('服务端返回 304 但本地没有副本', { url: policy.key });
      }
      const entry: CacheEntry<T> = { ...base, updatedAt: now };
      if (result.meta.etag) entry.etag = result.meta.etag;
      if (result.meta.revision) entry.revision = result.meta.revision;
      await this.store.set(policy.key, entry);
      this.options.onUpdate?.(policy.key, entry);
      return {
        data: entry.value,
        updatedAt: entry.updatedAt,
        fromCache: true,
        stale: false,
        revalidated: true,
        notModified: true,
        meta: result.meta,
      };
    }
    const entry: CacheEntry<T> = {
      key: policy.key,
      value: result.data,
      updatedAt: now,
      ...(result.meta.etag ? { etag: result.meta.etag } : {}),
      ...(result.meta.revision ? { revision: result.meta.revision } : {}),
      ...(policy.resource ? { resource: policy.resource } : {}),
      ...(policy.id ? { id: policy.id } : {}),
    };
    await this.store.set(policy.key, entry);
    this.options.onUpdate?.(policy.key, entry);
    return {
      data: result.data,
      updatedAt: now,
      fromCache: false,
      stale: false,
      revalidated: true,
      notModified: false,
      meta: result.meta,
    };
  }

  /** 后台回源；同一键并发只发一次。失败被吞掉（下次读再试）。 */
  private revalidate<T>(policy: CachePolicy, fetcher: Fetcher<T>): Promise<void> {
    const existing = this.inflight.get(policy.key);
    if (existing) return existing;
    const task = (async () => {
      try {
        const cached = await this.store.get(policy.key);
        if (!cached) return;
        const result = await fetcher(this.conditional(cached));
        await this.commit(policy, result, cached);
      } catch {
        // 后台回源失败不影响本次返回；保留旧副本等下次重试。
      } finally {
        this.inflight.delete(policy.key);
      }
    })();
    this.inflight.set(policy.key, task);
    return task;
  }
}

function isDegradable(error: unknown): boolean {
  return isNetworkError(error) || (isApiProblemError(error) && error.status >= 500);
}
