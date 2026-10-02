import { ApiProblemError, OfflineError, isApiProblemError, isNetworkError } from '../errors.js';
import type { HttpMethod, Transport } from '../http/transport.js';
import type { QueryParams } from '../http/query.js';
import type { CacheStore } from './store.js';

const QUEUE_KEY = 'outbox:queue';

/** 可以稍后重试的失败（网络、限流、服务端错误、临时未认证）。 */
const RETRYABLE_STATUS = new Set([401, 408, 425, 429, 500, 502, 503, 504]);

export interface OutboxEnqueueRequest {
  method: HttpMethod;
  /** 写入时的乐观并发前置版本；会被持久化并在重放时作为 `If-Match` 发出。 */
  ifMatch?: string;
  path: string;
  query?: QueryParams;
  body?: unknown;
  /** 人类可读标签，例如 `announcement:create`。 */
  label?: string;
  /** 可选的固定幂等键（默认自动生成并**持久化**，保证重放安全）。 */
  idempotencyKey?: string;
}

export interface OutboxItem {
  id: string;
  method: HttpMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
  label?: string;
  /**
   * 乐观并发的前置版本（`If-Match`）。离线写入必须把它一起排队：否则恢复后重放会退化成
   * "最后写入者获胜"，破坏契约的 `412 precondition_failed` 语义。
   */
  ifMatch?: string;
  /** 稳定幂等键：重放时保持不变，服务端据此去重。 */
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** `pending` 会继续重试；`failed` 需要用户或上层介入。 */
  status: 'pending' | 'failed';
  lastError?: { status?: number; code?: string; message: string };
}

export interface FlushReport {
  attempted: number;
  sent: OutboxItem[];
  failed: OutboxItem[];
  /**
   * 本轮**跳过**的终态失败条目：它们不会被自动重试，需要调用方决定
   * （`retry(id)` 重新排队，或 `remove(id)` 丢弃）。
   */
  skipped: OutboxItem[];
  remaining: OutboxItem[];
  offline: boolean;
}

export type OutboxEvent =
  | { type: 'enqueued'; item: OutboxItem }
  | { type: 'sent'; item: OutboxItem; replayed: boolean }
  | { type: 'retry'; item: OutboxItem; delayMs: number }
  | { type: 'failed'; item: OutboxItem; status?: number; code?: string }
  | { type: 'offline' };

export interface OutboxOptions {
  now?: () => number;
  randomId?: () => string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isOnline?: () => boolean;
  onEvent?: (event: OutboxEvent) => void;
}

/**
 * 离线写入队列（outbox）。
 *
 * 弱网下的写入先入本地队列，恢复网络后按 `createdAt` 顺序重放。
 * 每一项携带**持久化的** `Idempotency-Key`，因此重放不会产生重复副作用：
 * 服务端会返回首次结果并标注 `Idempotency-Replayed: true`。
 */
export class Outbox {
  private readonly store: CacheStore;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly isOnline: () => boolean;
  private readonly onEvent?: (event: OutboxEvent) => void;

  constructor(store: CacheStore, transport: Transport, options: OutboxOptions = {}) {
    this.store = store;
    this.transport = transport;
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? defaultRandomId;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
    if (options.isOnline) this.isOnline = options.isOnline;
    else if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') this.isOnline = () => navigator.onLine;
    else this.isOnline = () => true;
    if (options.onEvent) this.onEvent = options.onEvent;
  }

  private async load(): Promise<OutboxItem[]> {
    const entry = await this.store.get<OutboxItem[]>(QUEUE_KEY);
    return entry?.value ?? [];
  }

  private async save(items: OutboxItem[]): Promise<void> {
    await this.store.set(QUEUE_KEY, { key: QUEUE_KEY, value: items, updatedAt: this.now(), resource: 'outbox' });
  }

  async enqueue(request: OutboxEnqueueRequest): Promise<OutboxItem> {
    const items = await this.load();
    const item: OutboxItem = {
      id: this.randomId(),
      method: request.method,
      path: request.path,
      ...(request.query ? { query: request.query } : {}),
      ...(request.body !== undefined ? { body: request.body } : {}),
      ...(request.label ? { label: request.label } : {}),
      ...(request.ifMatch ? { ifMatch: request.ifMatch } : {}),
      idempotencyKey: request.idempotencyKey ?? this.randomId(),
      createdAt: this.now(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
    };
    items.push(item);
    await this.save(items);
    this.onEvent?.({ type: 'enqueued', item });
    return item;
  }

  async list(): Promise<OutboxItem[]> {
    return this.load();
  }

  async size(): Promise<number> {
    return (await this.load()).length;
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.load();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    await this.save(next);
    return true;
  }

  async clear(): Promise<void> {
    await this.save([]);
  }

  /**
   * 把终态失败的条目重新排回队首可发送状态（`attempts` 归零、立即可发）。
   * 用于"用户改好参数/补齐权限后再试一次"；不改变条目内容与幂等键。
   */
  async retry(id: string): Promise<boolean> {
    const items = await this.load();
    const target = items.find((item) => item.id === id);
    if (!target || target.status !== 'failed') return false;
    const { lastError: _drop, ...rest } = target;
    const revived: OutboxItem = { ...rest, status: 'pending', attempts: 0, nextAttemptAt: 0 };
    await this.save(items.map((item) => (item.id === id ? revived : item)));
    this.onEvent?.({ type: 'enqueued', item: revived });
    return true;
  }

  /**
   * 按顺序重放队列。
   *
   * - 网络错误/5xx/429/401 → 记为待重试并**中断本轮**（保持因果顺序）；
   * - 4xx（除可重试者）→ 标记 `failed`，继续处理后续项，并计入 `skipped`；
   * - 已标记 `failed` 的条目 → **永不自动重试**，本轮直接跳过（要重试先 `retry(id)`）；
   * - 成功 → 出队，`Idempotency-Replayed: true` 时事件里标注 `replayed`。
   */
  async flush(): Promise<FlushReport> {
    const items = await this.load();
    const report: FlushReport = { attempted: 0, sent: [], failed: [], skipped: [], remaining: [], offline: false };
    if (!this.isOnline()) {
      report.offline = true;
      report.remaining = items;
      this.onEvent?.({ type: 'offline' });
      return report;
    }

    const now = this.now();
    const done: OutboxItem[] = [];
    let index = 0;
    for (; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      // 终态失败：只由调用方决定，绝不自动重放；跳过且不阻塞后续条目
      if (item.status === 'failed') {
        report.skipped.push(item);
        continue;
      }
      if (item.nextAttemptAt > now) {
        break;
      }
      report.attempted += 1;
      try {
        const result = await this.transport.request<unknown>({
          method: item.method,
          path: item.path,
          ...(item.query ? { query: item.query } : {}),
          ...(item.body !== undefined ? { body: item.body } : {}),
          ...(item.ifMatch ? { ifMatch: item.ifMatch } : {}),
          idempotencyKey: item.idempotencyKey,
          retry: false,
        });
        done.push(item);
        report.sent.push(item);
        this.onEvent?.({ type: 'sent', item, replayed: result.meta.replayed });
      } catch (error) {
        // 传输层已经尝试过一次刷新；仍拿到 401 说明需要用户重新登录。
        // 若继续按"可重试"处理，队首会永远失败并挡住后面所有条目，因此记为终态失败。
        const authTerminal = isApiProblemError(error) && error.status === 401;
        if (authTerminal || (isApiProblemError(error) && !RETRYABLE_STATUS.has(error.status))) {
          const failed: OutboxItem = {
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            lastError: { status: error.status, code: String(error.code), message: error.message },
          };
          items[index] = failed;
          report.failed.push(failed);
          this.onEvent?.({ type: 'failed', item: failed, status: error.status, code: String(error.code) });
          continue;
        }
        const attempts = item.attempts + 1;
        const delayMs = Math.min(this.baseDelayMs * 2 ** (attempts - 1), this.maxDelayMs);
        const retryable: OutboxItem = {
          ...item,
          attempts,
          nextAttemptAt: this.now() + delayMs,
          lastError: describeError(error),
        };
        items[index] = retryable;
        report.remaining.push(retryable);
        this.onEvent?.({ type: 'retry', item: retryable, delayMs });
        break;
      }
    }

    const sentIds = new Set(done.map((item) => item.id));
    const queue = items.filter((item) => !sentIds.has(item.id));
    await this.save(queue);
    report.remaining = queue;
    return report;
  }
}

function describeError(error: unknown): { status?: number; code?: string; message: string } {
  if (error instanceof ApiProblemError) {
    return { status: error.status, code: String(error.code), message: error.message };
  }
  if (error instanceof OfflineError || isNetworkError(error)) return { message: error.message };
  return { message: error instanceof Error ? error.message : String(error) };
}

function defaultRandomId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
