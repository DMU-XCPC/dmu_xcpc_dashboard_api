/**
 * 事件流资源（契约 `paths/stream.yaml`）。
 *
 * `subscribe` 组装并返回 `SseClient`：默认先用 `POST /stream/tokens` 签发短时令牌
 * （浏览器 `EventSource` 无法设置请求头），收到事件时按需失效本地缓存副本。
 * 长连接的补发、gap 检测与指数退避重连都由 `SseClient` 负责。
 */

import { SseClient, type SseGapInfo } from '../sse.js';
import type { HttpMethod } from '../http/transport.js';
/**
 * 契约的 `StreamEvent.resource.kind` 是**单数**（`announcement`、`scoreboard`…），
 * 而缓存条目的 `resource` 标签是**集合名**（`announcements`、`scoreboards`…）。
 * 这张表把两者对上，否则"收到事件后刷新本地副本"会永远匹配不到、静默失效。
 */
export const STREAM_KIND_TO_RESOURCES: Record<string, string[]> = {
  announcement: ['announcements', 'announcement-deliveries'],
  channel: ['channels'],
  delivery: ['announcement-deliveries'],
  scoreboard: ['scoreboards', 'scoreboard-entries', 'scoreboard-entry-history'],
  member: ['members', 'member-activity'],
  team: ['teams'],
  quota: ['quotas', 'quota-claims', 'quota-summary'],
  job: ['jobs'],
  crawler_run: ['crawler-runs', 'crawler-status'],
  oj_handle: ['oj-handles', 'oj-handle-stats'],
  credential: ['credentials'],
  audit_log: ['audit-logs'],
};

import type { StreamEvent, StreamToken, StreamTokenRequest, StreamTopic } from '../types/news.js';
import type { ResourceContext, WriteOptions } from './helpers.js';

/** 本资源模块覆盖的契约操作（`streamEvents` 由 `SseClient` 实现，不在此列出）。 */
export const STREAM_OPERATIONS = {
  createStreamToken: { method: 'POST', path: '/stream/tokens' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

/** SSE 订阅选项：透传给 `SseClient`，并额外支持自动签发流令牌与缓存失效。 */
export interface SubscribeOptions {
  /** 要订阅的主题；省略表示全部（越权主题被服务端忽略而不是报错）。 */
  topics?: StreamTopic[];
  /** 已消费到的位置；重连时作为 `last_event_id` 补发。 */
  lastEventId?: string;
  /** 默认 true：用 POST /stream/tokens 签发短时令牌（EventSource 无法设置请求头）。 */
  mintToken?: boolean;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  onEvent?: (event: StreamEvent) => void;
  onGap?: (info: SseGapInfo) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
  onClose?: (error?: unknown) => void;
}

export class StreamResource {
  constructor(
    private readonly ctx: ResourceContext,
    private readonly options: { invalidateOnEvent: boolean },
  ) {}

  /**
   * 签发短时流令牌（201）；任何已认证主体都可调用，无需额外 scope。
   * 契约**豁免 `Idempotency-Key`**（每次都应签发新令牌），因此显式关闭自动幂等键。
   * 403 `topics` 超出自身 scope；422 参数非法；401 未认证；429 限流。
   */
  async createToken(body?: StreamTokenRequest, options?: WriteOptions): Promise<StreamToken> {
    const result = await this.ctx.transport.request<StreamToken>({
      method: 'POST',
      path: '/stream/tokens',
      ...(body !== undefined ? { body } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.retry !== undefined ? { retry: options.retry } : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
      // 契约明确豁免：不生成也不接受 Idempotency-Key。
      idempotencyKey: false,
    });
    options?.onResponse?.(result.meta);
    return result.data;
  }

  /**
   * 订阅 SSE 事件流；默认自动签发短时令牌并重建连接（令牌单次连接有效）。
   * `onEvent` 被包装为：先按事件资源失效本地缓存（不 await、失败吞掉），再回调调用方。
   * 401 令牌过期时 `SseClient` 报错；413/400 等由 `onError` 透出。
   */
  subscribe(options: SubscribeOptions = {}): SseClient {
    const { topics, lastEventId, mintToken, autoReconnect, maxReconnectAttempts, onEvent, onGap, onError, onOpen, onClose } = options;
    const invalidate = this.options.invalidateOnEvent;
    const cache = this.ctx.cache;
    const wrappedOnEvent = (event: StreamEvent): void => {
      const resource = event.resource;
      if (invalidate && cache && resource) {
        // 先按 kind→集合名映射失效整个集合（列表条目没有 id，只能按集合失效），
        // 再按具体 id 失效单资源副本。
        const collections = STREAM_KIND_TO_RESOURCES[resource.kind] ?? [];
        void Promise.all([
          ...collections.map((name) => cache.invalidateResource(name)),
          cache.invalidateResource(resource.kind, resource.id),
        ]).catch(() => undefined);
      }
      onEvent?.(event);
    };
    return new SseClient({
      transport: this.ctx.transport,
      ...(topics && topics.length > 0 ? { topics } : {}),
      ...(lastEventId !== undefined ? { lastEventId } : {}),
      ...(mintToken !== false
        ? { tokenProvider: () => this.createToken(topics && topics.length > 0 ? { topics } : {}).then((token) => token.token) }
        : {}),
      ...(autoReconnect !== undefined ? { autoReconnect } : {}),
      ...(maxReconnectAttempts !== undefined ? { maxReconnectAttempts } : {}),
      onEvent: wrappedOnEvent,
      ...(onGap ? { onGap } : {}),
      ...(onError ? { onError } : {}),
      ...(onOpen ? { onOpen } : {}),
      ...(onClose ? { onClose } : {}),
    });
  }
}
