import { isApiProblemError } from '../errors.js';
import type { Transport } from '../http/transport.js';
import type { CacheStore } from './store.js';
import type { Duration, ResourceChange, SyncResource, Timestamp } from '../types/common.js';

const CURSOR_KEY = 'sync:cursor';

/** `GET /sync/changes` 的响应。 */
export interface ChangeFeed {
  changes: ResourceChange[];
  /** 不透明游标：回传作为下一次 `since`。 */
  cursor: string;
  has_more: boolean;
  server_time: Timestamp;
  /** 变更保留期；游标超出后服务端返回 `410 cursor_expired`。 */
  retention: Duration;
}

export interface SyncEngineOptions {
  transport: Transport;
  store: CacheStore;
  /** 只同步这些资源；省略表示全部。 */
  resources?: SyncResource[];
  /** 单页条数上限，默认 200。 */
  limit?: number;
  /** 每页变更的回调（用于更新本地库 / 失效缓存）。 */
  onChanges?: (changes: ResourceChange[], feed: ChangeFeed) => void | Promise<void>;
  onCursor?: (cursor: string) => void;
  /**
   * 游标过期后自动重新基线化完成时回调（可观测：本地游标刚被换成新的基线游标）。
   * 契约 §4.9：`410 cursor_expired` 时必须重新基线化。
   */
  onRebaseline?: (info: { previousCursor?: string; cursor: string }) => void;
}

/**
 * 增量同步引擎（契约 §4.9）。
 *
 * 用法：
 * ```ts
 * const cursor = await client.sync.baseline();   // 建立基线（返回当前游标）
 * await client.sync.pullAll(cursor);             // 增量追赶
 * ```
 * 游标持久化在本地缓存里，重启后可从上次位置继续。
 */
export class SyncEngine {
  private readonly transport: Transport;
  private readonly store: CacheStore;
  private readonly resources?: SyncResource[];
  private readonly limit: number;
  private readonly onChanges?: (changes: ResourceChange[], feed: ChangeFeed) => void | Promise<void>;
  private readonly onCursor?: (cursor: string) => void;
  private readonly onRebaseline?: (info: { previousCursor?: string; cursor: string }) => void;

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport;
    this.store = options.store;
    if (options.resources) this.resources = options.resources;
    this.limit = options.limit ?? 200;
    if (options.onChanges) this.onChanges = options.onChanges;
    if (options.onCursor) this.onCursor = options.onCursor;
    if (options.onRebaseline) this.onRebaseline = options.onRebaseline;
  }

  /** 读取本地保存的游标。 */
  async getCursor(): Promise<string | undefined> {
    const entry = await this.store.get<string>(CURSOR_KEY);
    return entry?.value;
  }

  async setCursor(cursor: string): Promise<void> {
    await this.store.set(CURSOR_KEY, { key: CURSOR_KEY, value: cursor, updatedAt: Date.now(), resource: 'sync' });
    this.onCursor?.(cursor);
  }

  async reset(): Promise<void> {
    await this.store.delete(CURSOR_KEY);
  }

  /**
   * 建立基线：不带 `since` 调用，服务端返回**当前游标与空变更集**。
   * 首次接入时用它，然后对需要的资源做一次全量拉取。
   */
  async baseline(): Promise<string> {
    const feed = await this.pull(undefined);
    await this.setCursor(feed.cursor);
    return feed.cursor;
  }

  /** 拉取一页变更。`since` 省略时即为基线握手。 */
  async pull(since?: string): Promise<ChangeFeed> {
    const query: Record<string, string | number | readonly string[]> = { limit: this.limit };
    if (since) query['since'] = since;
    if (this.resources && this.resources.length > 0) query['resources'] = this.resources;
    const result = await this.transport.get<ChangeFeed>('/sync/changes', { query, parse: 'json' });
    return result.data;
  }

  /**
   * 一直拉到 `has_more=false`，逐页回调并持久化游标。
   * 返回最终游标与累计变更数。
   *
   * 契约 §4.9/§4.10：遇到 `410 cursor_expired`（游标早于保留窗口）时，客户端必须
   * **清空游标 → 重新基线化（省略 `since` 的握手）→ 再拉取一次**。这里只自动重试
   * **一次**：重新基线化之后仍然 `cursor_expired` 就把错误抛给调用方，避免死循环。
   */
  async pullAll(since?: string): Promise<{ cursor: string; changes: ResourceChange[]; pages: number }> {
    try {
      return await this.pullAllOnce(since);
    } catch (error) {
      if (!isCursorExpired(error)) throw error;
      const previous = await this.getCursor();
      await this.reset();
      const cursor = await this.baseline();
      this.onRebaseline?.({ ...(previous !== undefined ? { previousCursor: previous } : {}), cursor });
      return await this.pullAllOnce(cursor);
    }
  }

  private async pullAllOnce(since?: string): Promise<{ cursor: string; changes: ResourceChange[]; pages: number }> {
    let cursor = since ?? (await this.getCursor());
    const all: ResourceChange[] = [];
    let pages = 0;
    for (;;) {
      const feed = await this.pull(cursor);
      pages += 1;
      if (feed.changes.length > 0) {
        all.push(...feed.changes);
        await this.onChanges?.(feed.changes, feed);
      }
      cursor = feed.cursor;
      await this.setCursor(cursor);
      if (!feed.has_more || feed.changes.length === 0) {
        return { cursor, changes: all, pages };
      }
    }
  }
}

/** `410 cursor_expired`：增量同步游标早于服务端的变更保留窗口。 */
function isCursorExpired(error: unknown): boolean {
  return isApiProblemError(error) && error.code === 'cursor_expired';
}
