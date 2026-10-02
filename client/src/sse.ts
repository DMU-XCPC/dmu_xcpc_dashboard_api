import { ParseError } from './errors.js';
import type { QueryParams } from './http/query.js';
import type { Transport } from './http/transport.js';
import type { Timestamp } from './types/common.js';

/** 事件指向的资源种类（单数），与契约 `StreamResourceKind` 枚举一致。 */
export type StreamResourceKind = 'announcement' | 'channel' | 'delivery' | 'scoreboard' | 'member' | 'team' | 'quota' | 'job' | 'crawler_run' | 'oj_handle' | 'credential' | 'audit_log';

export type StreamTopic = 'announcements' | 'scoreboards' | 'ingest' | 'quotas' | 'members' | 'jobs';

/** `StreamTopic` 的运行期镜像，用于与契约 `StreamTopic` 枚举对账。 */
export const STREAM_TOPICS = [
  'announcements',
  'scoreboards',
  'ingest',
  'quotas',
  'members',
  'jobs',
] as const satisfies readonly StreamTopic[];

/** SSE 事件负载（契约 `StreamEvent`）。 */
export interface StreamEvent {
  /** 单调递增的十进制序号字符串，也是 SSE 的 `id:`。 */
  id: string;
  sequence: number;
  topic: StreamTopic;
  type: string;
  occurred_at: Timestamp;
  revision?: string | null;
  resource?: { kind: StreamResourceKind; id: string } | null;
  data: Record<string, unknown>;
}

export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface SseGapInfo {
  reason: 'event' | 'sequence_jump';
  fromSequence?: number;
  toSequence?: number;
  /**
   * 为 `true` 时客户端应做一次全量刷新（或走 `sync/changes` 增量追赶），
   * 因为补发缓冲区不足或事件被丢弃。
   */
  resyncRequired: boolean;
}

export interface SseClientOptions {
  transport: Transport;
  topics?: StreamTopic[];
  /** 已消费到的位置；重连时作为 `last_event_id` 与 `Last-Event-ID` 补发。 */
  lastEventId?: string;
  /**
   * 取得短时流令牌（`POST /stream/tokens`）。返回 `undefined` 表示只用
   * `Authorization` 头连接。
   */
  tokenProvider?: () => Promise<string | undefined> | string | undefined;
  autoReconnect?: boolean;
  /**
   * 未收到服务端 `retry:` 时的重连间隔；省略时用契约文档的默认 3 秒
   * （README §4.8：`retry: 3000` 建议重连间隔 3 秒）。
   */
  baseReconnectDelayMs?: number;
  /** 只约束上面的客户端默认值；服务端显式给出的 `retry:` 不受它限制。 */
  maxReconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  isOnline?: () => boolean;
  path?: string;
  onEvent?: (event: StreamEvent) => void;
  onGap?: (info: SseGapInfo) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
  onClose?: (error?: unknown) => void;
}

/**
 * 契约文档给出的默认重连间隔：首帧 `retry: 3000` 表示"建议重连间隔 3 秒"
 * （`doc/api/paths/stream.yaml`）。收到 `retry:` 前用这个值。
 */
export const DEFAULT_SSE_RECONNECT_DELAY_MS = 3_000;

/**
 * 增量式 SSE 帧解析器。
 *
 * 处理跨 chunk 的半帧、CRLF/CR 换行、多行 `data:`、注释心跳（`: hb`）与
 * `id:`/`event:`/`retry:` 字段。不完整的尾部会留在缓冲区等下一个 chunk。
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const frames: SseFrame[] = [];
    for (;;) {
      const index = this.buffer.indexOf('\n\n');
      if (index === -1) break;
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const frame = parseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** 流结束：按规范丢弃未以空行结束的半帧。 */
  flush(): SseFrame[] {
    const block = this.buffer;
    this.buffer = '';
    const frame = block.trim() === '' ? null : parseBlock(block);
    return frame ? [frame] : [];
  }

  reset(): void {
    this.buffer = '';
  }
}

function parseBlock(block: string): SseFrame | null {
  const frame: SseFrame = { data: '' };
  let sawField = false;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'id':
        if (!value.includes('\0')) frame.id = value;
        sawField = true;
        break;
      case 'event':
        frame.event = value;
        sawField = true;
        break;
      case 'retry': {
        const retry = Number(value);
        if (Number.isFinite(retry) && retry >= 0) frame.retry = retry;
        sawField = true;
        break;
      }
      case 'data':
        frame.data = frame.data === '' ? value : `${frame.data}\n${value}`;
        sawField = true;
        break;
      default:
        break;
    }
  }
  return sawField ? frame : null;
}

/**
 * SSE 订阅客户端。
 *
 * 时序行为（契约 §4.8）：
 * - 用 `POST /stream/tokens` 的短时令牌连接（浏览器 `EventSource` 无法设置请求头）；
 * - 记录 `last_event_id`，重连时用 `last_event_id` 查询参数与 `Last-Event-ID` 请求头补发，避免丢事件；
 * - 检测序号跳号与 `stream.gap` 事件，按事件 `data.resync_required` 回调 `onGap`；
 * - 断线按服务端 `retry:` 的固定间隔重连（未给出时默认 3 秒）；`stop()` 后不再重连。
 */
export class SseClient {
  private readonly options: SseClientOptions;
  private readonly transport: Transport;
  private readonly parser = new SseParser();
  private readonly path: string;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private open = false;
  private attempts = 0;
  private lastId?: string;
  private lastSequence?: number;
  private serverRetryMs?: number;

  constructor(options: SseClientOptions) {
    this.options = options;
    this.transport = options.transport;
    this.path = options.path ?? '/stream/events';
    if (options.lastEventId) this.lastId = options.lastEventId;
  }

  get connected(): boolean {
    return this.open;
  }

  get lastEventId(): string | undefined {
    return this.lastId;
  }

  get lastSequenceNumber(): number | undefined {
    return this.lastSequence;
  }

  /** 发起首次连接；返回时首次连接已有结论（成功或失败）。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.attempts = 0;
    await this.openOnce();
  }

  stop(): void {
    this.running = false;
    this.open = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
  }

  private isOnline(): boolean {
    if (this.options.isOnline) return this.options.isOnline();
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
    return true;
  }

  private async openOnce(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const token = await this.options.tokenProvider?.();
      const query: QueryParams = {};
      if (this.options.topics && this.options.topics.length > 0) query['topics'] = this.options.topics.join(',');
      if (this.lastId) query['last_event_id'] = this.lastId;
      if (token) query['access_token'] = token;

      const { data: response } = await this.transport.request<Response>({
        method: 'GET',
        path: this.path,
        query,
        raw: true,
        retry: false,
        signal: controller.signal,
        accept: 'text/event-stream',
        // 契约：`Last-Event-ID` 请求头与 `last_event_id` 查询参数等价，两者同时出现时以请求头为准。
        // 浏览器 `EventSource` 无法设置请求头，但本客户端走 fetch，能设置就一起带上。
        ...(this.lastId ? { headers: { 'Last-Event-ID': this.lastId } } : {}),
      });
      this.open = true;
      this.attempts = 0;
      this.parser.reset();
      this.options.onOpen?.();
      await this.consume(response, controller.signal);
      this.open = false;
      this.options.onClose?.();
      this.scheduleReconnect();
    } catch (error) {
      this.open = false;
      if (!this.running) return;
      this.options.onError?.(error);
      this.scheduleReconnect(error);
    }
  }

  private async consume(response: Response, signal: AbortSignal): Promise<void> {
    const body = response.body;
    if (!body) throw new Error('SSE 响应没有可读的 body（需要支持流式 fetch）');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const frame of this.parser.push(text)) this.handleFrame(frame);
      }
      const tail = decoder.decode();
      if (tail !== '') {
        for (const frame of this.parser.push(tail)) this.handleFrame(frame);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // 忽略：底层流可能已关闭。
      }
    }
  }

  private handleFrame(frame: SseFrame): void {
    if (frame.retry !== undefined) this.serverRetryMs = frame.retry;
    if (frame.id !== undefined && frame.id !== '') this.lastId = frame.id;
    if (frame.data === '') return;
    let event: StreamEvent;
    try {
      event = JSON.parse(frame.data) as StreamEvent;
    } catch (error) {
      this.options.onError?.(new ParseError('SSE data 不是合法 JSON', { status: 200, cause: error }));
      return;
    }
    this.trackSequence(event);
    this.options.onEvent?.(event);
  }

  private trackSequence(event: StreamEvent): void {
    if (event.type === 'stream.gap') {
      const data = event.data as { from_sequence?: number; to_sequence?: number; resync_required?: unknown };
      this.options.onGap?.({
        reason: 'event',
        ...(typeof data.from_sequence === 'number' ? { fromSequence: data.from_sequence } : {}),
        ...(typeof data.to_sequence === 'number' ? { toSequence: data.to_sequence } : {}),
        // 契约：`stream.gap` 的 `data.resync_required` 决定是否必须全量刷新；
        // 字段缺省时按 `true` 处理（服务端不静默丢事件）。
        resyncRequired: typeof data.resync_required === 'boolean' ? data.resync_required : true,
      });
    }
    if (typeof event.sequence !== 'number') return;
    if (this.lastSequence !== undefined && event.sequence > this.lastSequence + 1) {
      this.options.onGap?.({
        reason: 'sequence_jump',
        fromSequence: this.lastSequence + 1,
        toSequence: event.sequence - 1,
        resyncRequired: true,
      });
    }
    this.lastSequence = Math.max(this.lastSequence ?? 0, event.sequence);
  }

  private scheduleReconnect(cause?: unknown): void {
    if (!this.running || this.options.autoReconnect === false) return;
    this.attempts += 1;
    const maxAttempts = this.options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    if (this.attempts > maxAttempts) {
      this.running = false;
      this.options.onError?.(cause ?? new Error('SSE 重连次数超过上限'));
      return;
    }
    // 契约 §4.8：`retry: 3000` 表示"建议重连间隔 3 秒"，是**固定间隔**而不是指数退避基数。
    // 收到 `retry:` 后按该值固定重连；未收到时用客户端默认值（省略则为契约默认 3 秒）。
    const fallback = Math.min(
      this.options.baseReconnectDelayMs ?? DEFAULT_SSE_RECONNECT_DELAY_MS,
      this.options.maxReconnectDelayMs ?? Number.POSITIVE_INFINITY,
    );
    const delay = this.serverRetryMs ?? fallback;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.running) void this.openOnce();
    }, delay);
    const handle = this.timer as unknown as { unref?: () => void };
    handle.unref?.();
  }
}
