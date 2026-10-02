import {
  AbortedError,
  ApiProblemError,
  NetworkError,
  OfflineError,
  ParseError,
  TimeoutError,
  normalizeProblem,
} from '../errors.js';
import type { Problem } from '../types/common.js';
import { buildUrl, type QueryParams } from './query.js';
import {
  computeBackoffDelay,
  computeRetryDelay,
  isIdempotentMethod,
  resolveRetryPolicy,
  shouldRetryStatus,
  sleep,
  type RetryPolicy,
} from './retry.js';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** 可注入的 fetch（浏览器 `fetch` 与 Node 18+ 的 `fetch` 同构）。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetSeconds?: number;
  retryAfterSeconds?: number;
  updatedAt: number;
}

/** 每次请求的响应元信息；离线缓存、SSE 与测试都依赖它。 */
export interface ResponseMeta {
  status: number;
  ok: boolean;
  method: HttpMethod;
  url: string;
  headers: Headers;
  /** 与错误体 `request_id` 一致的排障标识。 */
  requestId?: string;
  /** `Location` 响应头；`202` 异步任务指向 `/jobs/{job_id}`。 */
  location?: string;
  /** 强 ETag，如 `"17"`。 */
  etag?: string;
  /** `etag` 去引号后的版本号，与资源 `revision` 一致。 */
  revision?: string;
  rateLimit?: RateLimitInfo;
  /** 服务端告知本次响应是幂等键重放的结果。 */
  replayed: boolean;
  /** 条件读取命中（`304`）：此时 `data` 为 `undefined`。 */
  notModified: boolean;
  attempts: number;
  durationMs: number;
  idempotencyKey?: string;
  /** 命中了本地缓存（由缓存层填充）。 */
  fromCache?: boolean;
  /** 返回的是过期缓存（离线降级）。 */
  stale?: boolean;
}

export interface AuthProvider {
  /** 在每次尝试前注入认证头（可能触发令牌刷新）。 */
  authorize?(headers: Headers, ctx: { method: HttpMethod; path: string }): void | Promise<void>;
  /**
   * 收到 `401` 时的回调。返回 `true` 表示已经恢复（例如刷新了令牌），
   * 传输层会用同一请求重放一次。
   */
  onUnauthorized?(
    problem: Problem,
    ctx: { method: HttpMethod; path: string; retry: () => Promise<boolean> },
  ): boolean | Promise<boolean>;
}

export interface TransportOptions {
  /** API 根地址。浏览器默认 `/api/v1`；Node 下必须传绝对地址。 */
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy> | false;
  headers?: Record<string, string> | (() => Record<string, string>);
  auth?: AuthProvider;
  now?: () => number;
  randomUUID?: () => string;
  /** 判断是否在线；默认读取 `navigator.onLine`，无该 API 时视为在线。 */
  isOnline?: () => boolean;
  onResponse?: (meta: ResponseMeta) => void;
  onRetry?: (info: { attempt: number; delayMs: number; status?: number; error?: unknown }) => void;
  onProblem?: (problem: Problem, meta: ResponseMeta) => void;
  /** 已知剩余配额为 0 时是否主动等待到窗口重置。 */
  rateLimit?: { throttle?: boolean };
}

export interface TransportRequest {
  method: HttpMethod;
  /** 已替换过路径参数的路径（不含 baseUrl）。 */
  path: string;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy> | false;
  /** `'auto'`（默认，写操作自动生成）或显式键或 `false` 关闭。 */
  idempotencyKey?: string | 'auto' | false;
  ifMatch?: string;
  ifNoneMatch?: string;
  accept?: string;
  /** `null` 表示不发送 Content-Type。 */
  contentType?: string | null;
  parse?: 'auto' | 'json' | 'text' | 'none';
  /** 不读取响应体，直接返回 `Response`（SSE 使用）。 */
  raw?: boolean;
  /** 额外视为成功的状态码。 */
  allowStatuses?: readonly number[];
  /** 跳过认证注入（登录、刷新、公开端点）。 */
  noAuth?: boolean;
}

export interface TransportResult<T> {
  data: T;
  meta: ResponseMeta;
  response: Response;
}

const JSON_MEDIA_TYPE = 'application/json';
const PROBLEM_MEDIA_TYPE = 'application/problem+json';

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  return undefined;
}

function toNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripEtag(etag: string): string {
  return etag.replace(/^W\//, '').replace(/^"|"$/g, '');
}

/**
 * 传输层：URL 拼接、认证注入、幂等键、条件请求、限流感知、超时、
 * 退避重试，以及 RFC 7807 错误映射。
 *
 * 资源模块只依赖本类的 `request()`；缓存层与 SSE 也建立在它之上。
 */
export class Transport {
  readonly baseUrl: string;
  private readonly options: TransportOptions;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private currentRateLimit?: RateLimitInfo;

  constructor(options: TransportOptions = {}) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? '/api/v1';
    this.now = options.now ?? (() => Date.now());
    this.randomUUID = options.randomUUID ?? defaultRandomId;
  }

  /** 最近一次响应中的限流信息。 */
  get rateLimit(): RateLimitInfo | undefined {
    return this.currentRateLimit;
  }

  isOnline(): boolean {
    const probe = this.options.isOnline;
    if (probe) return probe();
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
    return true;
  }

  private get fetchImpl(): FetchLike {
    const impl = this.options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!impl) {
      throw new NetworkError('当前运行环境没有 fetch，请在 options.fetch 中注入实现');
    }
    return impl;
  }

  private resolveBase(): string {
    const base = this.baseUrl;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) return base;
    const location = (globalThis as { location?: { origin?: string } }).location;
    if (location?.origin) return `${location.origin}${base.startsWith('/') ? '' : '/'}${base}`;
    throw new NetworkError(
      `baseUrl 必须是非浏览器环境下的绝对地址（当前为 "${base}"），例如 http://127.0.0.1:8080/api/v1`,
    );
  }

  private baseHeaders(): Record<string, string> {
    const source = this.options.headers;
    return typeof source === 'function' ? source() : { ...(source ?? {}) };
  }

  /** 发起一次请求；4xx/5xx 抛出 `ApiProblemError`。 */
  async request<T>(request: TransportRequest): Promise<TransportResult<T>> {
    const method = request.method;
    const policy = resolveRetryPolicy(request.retry ?? this.options.retry);
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs ?? 15_000;
    const url = buildUrl(this.resolveBase(), request.path, request.query);
    const explicitKey = request.idempotencyKey;
    const idempotencyKey =
      explicitKey === false || explicitKey === null
        ? undefined
        : typeof explicitKey === 'string' && explicitKey !== 'auto'
          ? explicitKey
          : method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
            ? this.randomUUID()
            : undefined;
    const idempotent = isIdempotentMethod(method) || idempotencyKey !== undefined;

    await this.applyThrottle(request.signal);

    let attempt = 0;
    let authRetried = false;
    const startedAt = this.now();

    for (;;) {
      attempt += 1;
      const { signal, cleanup, timedOut } = this.createAttemptSignal(request.signal, timeoutMs);
      try {
        if (!this.isOnline()) throw new OfflineError('当前处于离线状态', { url });

        const headers = new Headers(this.baseHeaders());
        headers.set('Accept', request.accept ?? (request.raw ? 'text/event-stream' : JSON_MEDIA_TYPE));
        if (request.contentType !== null && request.body !== undefined) {
          const hasContentType = headers.has('Content-Type');
          if (!hasContentType) headers.set('Content-Type', request.contentType ?? JSON_MEDIA_TYPE);
        }
        if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
        if (request.ifMatch) headers.set('If-Match', request.ifMatch);
        if (request.ifNoneMatch) headers.set('If-None-Match', request.ifNoneMatch);
        for (const [key, value] of Object.entries(request.headers ?? {})) headers.set(key, value);
        if (!request.noAuth) await this.options.auth?.authorize?.(headers, { method, path: request.path });

        const init: RequestInit = { method, headers, signal };
        if (request.body !== undefined && method !== 'GET' && method !== 'HEAD') {
          init.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        }

        let response: Response;
        try {
          response = await this.fetchImpl(url, init);
        } catch (error) {
          const classified = this.classifyFetchError(error, { url, externalSignal: request.signal, timedOut });
          if (policy.retryNetworkErrors && attempt < policy.maxAttempts && (!policy.retryIdempotentOnly || idempotent)) {
            const delayMs = computeBackoffDelay(attempt, policy);
            this.options.onRetry?.({ attempt, delayMs, error: classified });
            await sleep(delayMs, request.signal);
            continue;
          }
          throw classified;
        }

        const meta = this.buildMeta(response, {
          method,
          url,
          attempts: attempt,
          startedAt,
          idempotencyKey,
        });
        this.currentRateLimit = meta.rateLimit;
        this.options.onResponse?.(meta);

        const success = response.ok || (request.allowStatuses?.includes(response.status) ?? false);
        if (success) {
          if (request.raw) return { data: response as unknown as T, meta, response };
          const data = (await this.readBody(response, request.parse ?? 'auto')) as T;
          return { data, meta, response };
        }

        // 条件读取命中：304 不是错误，data 为 undefined，由缓存层复用本地副本。
        if (meta.notModified) {
          return { data: undefined as unknown as T, meta, response };
        }

        const problem = await this.readProblem(response);
        const retryAfterSeconds = meta.rateLimit?.retryAfterSeconds ?? problem.retry_after_seconds;

        if (response.status === 401 && !request.noAuth && !authRetried && this.options.auth?.onUnauthorized) {
          authRetried = true;
          const recovered = await this.options.auth.onUnauthorized(problem, {
            method,
            path: request.path,
            retry: async () => true,
          });
          if (recovered) continue;
        }

        if (shouldRetryStatus(response.status, policy) && attempt < policy.maxAttempts && (!policy.retryIdempotentOnly || idempotent)) {
          const delayMs = computeRetryDelay(attempt, policy, retryAfterSeconds);
          this.options.onRetry?.({ attempt, delayMs, status: response.status });
          await sleep(delayMs, request.signal);
          continue;
        }

        this.options.onProblem?.(problem, meta);
        throw new ApiProblemError(problem, {
          requestId: meta.requestId,
          retryAfterSeconds,
        });
      } finally {
        cleanup();
      }
    }
  }

  get<T>(path: string, options: Omit<TransportRequest, 'method' | 'path'> = {}): Promise<TransportResult<T>> {
    return this.request<T>({ ...options, method: 'GET', path });
  }

  post<T>(path: string, request: Omit<TransportRequest, 'method' | 'path'> = {}): Promise<TransportResult<T>> {
    return this.request<T>({ ...request, method: 'POST', path });
  }

  put<T>(path: string, request: Omit<TransportRequest, 'method' | 'path'> = {}): Promise<TransportResult<T>> {
    return this.request<T>({ ...request, method: 'PUT', path });
  }

  patch<T>(path: string, request: Omit<TransportRequest, 'method' | 'path'> = {}): Promise<TransportResult<T>> {
    return this.request<T>({ ...request, method: 'PATCH', path });
  }

  delete<T>(path: string, request: Omit<TransportRequest, 'method' | 'path'> = {}): Promise<TransportResult<T>> {
    return this.request<T>({ ...request, method: 'DELETE', path });
  }

  private async applyThrottle(signal?: AbortSignal): Promise<void> {
    if (!this.options.rateLimit?.throttle) return;
    const info = this.currentRateLimit;
    if (!info || info.remaining === undefined || info.remaining > 0) return;
    const resetMs = (info.resetSeconds ?? 1) * 1000;
    if (resetMs > 0) await sleep(resetMs, signal);
  }

  private createAttemptSignal(
    external: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
    const controller = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new TimeoutError(timeoutMs));
    }, timeoutMs);
    const onAbort = (): void => controller.abort(external?.reason);
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener('abort', onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        external?.removeEventListener('abort', onAbort);
      },
      timedOut: () => didTimeout,
    };
  }

  private classifyFetchError(
    error: unknown,
    ctx: { url: string; externalSignal?: AbortSignal | undefined; timedOut: () => boolean },
  ): Error {
    if (error instanceof TimeoutError || error instanceof OfflineError || error instanceof NetworkError) return error;
    if (ctx.externalSignal?.aborted) return new AbortedError(ctx.externalSignal.reason);
    if (ctx.timedOut()) return new TimeoutError(this.options.timeoutMs ?? 15_000, { url: ctx.url });
    if (!this.isOnline()) return new OfflineError('当前处于离线状态', { url: ctx.url });
    const message = error instanceof Error ? error.message : String(error);
    return new NetworkError(`请求失败：${message}`, { url: ctx.url, cause: error });
  }

  private buildMeta(
    response: Response,
    ctx: { method: HttpMethod; url: string; attempts: number; startedAt: number; idempotencyKey?: string | undefined },
  ): ResponseMeta {
    const now = this.now();
    const headers = response.headers;
    const limit = toNumber(headers.get('x-ratelimit-limit'));
    const remaining = toNumber(headers.get('x-ratelimit-remaining'));
    const resetSeconds = toNumber(headers.get('x-ratelimit-reset'));
    const retryAfterSeconds = parseRetryAfter(headers.get('retry-after'), now);
    const etag = headers.get('etag') ?? undefined;
    const location = headers.get('location') ?? undefined;
    const rateLimit: RateLimitInfo | undefined =
      limit !== undefined || remaining !== undefined || resetSeconds !== undefined || retryAfterSeconds !== undefined
        ? {
            ...(limit !== undefined ? { limit } : {}),
            ...(remaining !== undefined ? { remaining } : {}),
            ...(resetSeconds !== undefined ? { resetSeconds } : {}),
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
            updatedAt: now,
          }
        : undefined;
    return {
      status: response.status,
      ok: response.ok,
      method: ctx.method,
      url: ctx.url,
      headers,
      ...(headers.get('x-request-id') ? { requestId: headers.get('x-request-id') as string } : {}),
      ...(location ? { location } : {}),
      ...(etag ? { etag, revision: stripEtag(etag) } : {}),
      ...(rateLimit ? { rateLimit } : {}),
      replayed: headers.get('idempotency-replayed') === 'true',
      notModified: response.status === 304,
      attempts: ctx.attempts,
      durationMs: now - ctx.startedAt,
      ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
    };
  }

  private async readBody(response: Response, parse: 'auto' | 'json' | 'text' | 'none'): Promise<unknown> {
    if (parse === 'none' || response.status === 204 || response.status === 205) return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    const wantsJson = parse === 'json' || (parse === 'auto' && /json/i.test(contentType));
    if (parse === 'text') return response.text();
    if (!wantsJson) {
      const text = await response.text();
      return text === '' ? undefined : text;
    }
    const text = await response.text();
    if (text.trim() === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ParseError('响应体不是合法 JSON', { status: response.status, cause: error });
    }
  }

  private async readProblem(response: Response): Promise<Problem> {
    const contentType = response.headers.get('content-type') ?? '';
    let payload: unknown;
    try {
      const text = await response.text();
      if (text.trim() !== '') {
        payload = /json/i.test(contentType) ? (JSON.parse(text) as unknown) : text;
      }
    } catch {
      payload = undefined;
    }
    return normalizeProblem(payload, response.status, response.statusText || 'Request failed');
  }
}

function defaultRandomId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
