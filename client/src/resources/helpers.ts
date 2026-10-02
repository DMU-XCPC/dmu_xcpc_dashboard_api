import { isNetworkError } from '../errors.js';
import type { ApiCache, CachePolicy, CachedResult } from '../cache/cache.js';
import type { Outbox, OutboxItem } from '../cache/outbox.js';
import { serializeQuery, type QueryParams } from '../http/query.js';
import type { HttpMethod, ResponseMeta, Transport } from '../http/transport.js';
import type { RetryPolicy } from '../http/retry.js';

/** 资源模块共享的上下文；由 `XcpcClient` 注入。 */
export interface ResourceContext {
  transport: Transport;
  /** 未启用缓存时为 `undefined`。 */
  cache?: ApiCache;
  /** 未启用离线队列时为 `undefined`。 */
  outbox?: Outbox;
  defaultTtlMs?: number;
  defaultMaxStaleMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy> | false;
  headers?: Record<string, string>;
  /** 每次响应的元信息回调（ETag、限流、是否命中缓存等）。 */
  onResponse?: (meta: ResponseMeta) => void;
}

export interface ReadOptions extends RequestOptions {
  /**
   * 缓存策略：省略时走客户端默认 TTL 的读穿缓存；
   * `false` 跳过缓存直连；对象可覆盖键、TTL 与降级行为。
   */
  cache?: CachePolicy | false;
}

export interface WriteOptions extends RequestOptions {
  /** 显式幂等键；省略时由传输层自动生成。 */
  idempotencyKey?: string;
  /** 乐观并发控制。 */
  ifMatch?: string;
  /** 离线（或网络失败）时写入本地队列而不是抛错。 */
  queueIfOffline?: boolean;
  /** 队列条目的可读标签。 */
  label?: string;
}

export type WriteOutcome<T> = { queued: false; data: T; meta: ResponseMeta } | { queued: true; item: OutboxItem };

export interface ReadRequest {
  path: string;
  query?: QueryParams;
  /** 资源集合名，用于按资源批量失效。 */
  resource?: string;
  id?: string;
  options?: ReadOptions;
}

export interface WriteRequest {
  method: HttpMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
  options?: WriteOptions;
}

/** 由资源集合 + 路径 + 查询串生成的稳定缓存键。 */
export function cacheKeyFor(resource: string, path: string, query?: QueryParams, extra?: string): string {
  const suffix = serializeQuery(query);
  return `${resource}:${path}${suffix}${extra ? `#${extra}` : ''}`;
}

function fetchOptions(request: ReadRequest | WriteRequest): {
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy> | false;
  headers?: Record<string, string>;
} {
  const options = request.options ?? {};
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  };
}

/** 读单个/列表资源；默认走读穿缓存与 `stale-while-revalidate`。 */
export async function readJson<T>(ctx: ResourceContext, request: ReadRequest): Promise<T> {
  const result = await readCached<T>(ctx, request);
  return result.data;
}

/** 与 `readJson` 相同，但返回新鲜度信息（`stale`/`fromCache`/`notModified`）。 */
export async function readCached<T>(ctx: ResourceContext, request: ReadRequest): Promise<CachedResult<T>> {
  const options = request.options ?? {};
  const base = fetchOptions(request);
  const key = cacheKeyFor(request.resource ?? 'resource', request.path, request.query);
  const cache = ctx.cache;
  if (!cache || options.cache === false) {
    const result = await ctx.transport.get<T>(request.path, { ...base, ...(request.query ? { query: request.query } : {}) });
    options.onResponse?.(result.meta);
    return {
      data: result.data,
      updatedAt: Date.now(),
      fromCache: false,
      stale: false,
      revalidated: true,
      notModified: false,
      meta: result.meta,
    };
  }
  const override = typeof options.cache === 'object' ? options.cache : undefined;
  const policy: CachePolicy = {
    key: key,
    ...(ctx.defaultTtlMs !== undefined ? { ttlMs: ctx.defaultTtlMs } : {}),
    ...(ctx.defaultMaxStaleMs !== undefined ? { maxStaleMs: ctx.defaultMaxStaleMs } : {}),
    ...(request.resource ? { resource: request.resource } : {}),
    ...(request.id ? { id: request.id } : {}),
    ...(override ?? {}),
  };
  const result = await cache.read<T>(policy, ({ ifNoneMatch }) =>
    ctx.transport.get<T>(request.path, {
      ...base,
      ...(request.query ? { query: request.query } : {}),
      ...(ifNoneMatch ? { ifNoneMatch } : {}),
    }),
  );
  if (result.meta) options.onResponse?.(result.meta);
  return result;
}

/** 直接写入（不排队）；4xx/5xx 抛 `ApiProblemError`。 */
export async function writeJson<T>(ctx: ResourceContext, request: WriteRequest): Promise<T> {
  const result = await writeResult<T>(ctx, request);
  return result.data;
}

/** 与 `writeJson` 相同，但返回 `meta`（ETag / 幂等重放标记）。 */

/**
 * 从写入路径推断它影响的**资源集合名**（与读方法传给 `readJson` 的 `resource` 一致）。
 *
 * 写成功后按集合失效本地副本：契约要求"缓存键必须包含请求者的权限身份"，
 * 而写入改变的是服务端状态——不失效就会出现"刚改完，读到的还是旧副本"（TTL 内）。
 */
const PATH_RESOURCE_TAGS: Array<[RegExp, string]> = [
  [/^\/accounts/, 'accounts'],
  [/^\/members/, 'members'],
  [/^\/teams/, 'teams'],
  [/^\/quotas/, 'quotas'],
  [/^\/announcements/, 'announcements'],
  [/^\/channels/, 'channels'],
  [/^\/scoreboards/, 'scoreboards'],
  [/^\/oj-handles/, 'oj-handles'],
  [/^\/credentials/, 'credentials'],
  [/^\/roster/, 'roster-exports'],
  [/^\/config/, 'config'],
  [/^\/crawler/, 'crawler-config'],
];

export function resourceTagForPath(path: string): string | undefined {
  for (const [pattern, tag] of PATH_RESOURCE_TAGS) {
    if (pattern.test(path)) return tag;
  }
  return undefined;
}

export async function writeResult<T>(ctx: ResourceContext, request: WriteRequest): Promise<{ data: T; meta: ResponseMeta }> {
  const options = request.options ?? {};
  const result = await ctx.transport.request<T>({
    method: request.method,
    path: request.path,
    ...(request.query ? { query: request.query } : {}),
    ...(request.body !== undefined ? { body: request.body } : {}),
    ...fetchOptions(request),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  });
  options.onResponse?.(result.meta);
  // 写成功即失效该资源的本地副本，避免 TTL 内读到旧值（契约 §4.9 的缓存约定）。
  const tag = resourceTagForPath(request.path);
  if (tag) await ctx.cache?.invalidateResource(tag).catch(() => undefined);
  return { data: result.data, meta: result.meta };
}

/**
 * 弱网友好的写入：`queueIfOffline` 为真且当前离线（或网络失败）时，
 * 把请求放进本地 outbox 并返回 `{ queued: true }`；恢复网络后由
 * `outbox.flush()` 用**同一个幂等键**重放，服务端保证不重复副作用。
 */
export async function writeWithQueue<T>(ctx: ResourceContext, request: WriteRequest): Promise<WriteOutcome<T>> {
  const options = request.options ?? {};
  const outbox = ctx.outbox;
  if (!outbox || !options.queueIfOffline) {
    const result = await writeResult<T>(ctx, request);
    return { queued: false, data: result.data, meta: result.meta };
  }
  if (!ctx.transport.isOnline()) {
    const item = await enqueue(ctx, request);
    return { queued: true, item };
  }
  try {
    const result = await writeResult<T>(ctx, request);
    return { queued: false, data: result.data, meta: result.meta };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const item = await enqueue(ctx, request);
    return { queued: true, item };
  }
}

async function enqueue(ctx: ResourceContext, request: WriteRequest): Promise<OutboxItem> {
  const options = request.options ?? {};
  const outbox = ctx.outbox;
  if (!outbox) throw new Error('未启用 outbox');
  return outbox.enqueue({
    method: request.method,
    path: request.path,
    ...(request.query ? { query: request.query } : {}),
    ...(request.body !== undefined ? { body: request.body } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
    ...(options.label ? { label: options.label } : {}),
  });
}
