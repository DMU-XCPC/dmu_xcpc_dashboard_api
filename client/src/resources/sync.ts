/**
 * 增量同步资源（契约 `paths/sync.yaml`）。
 *
 * `listChanges()` 直连 `GET /sync/changes`（**不走缓存**：游标流必须每次取最新）；
 * `baseline`/`pull`/`pullAll`/`cursor`/`setCursor`/`reset` 委托给 `SyncEngine`
 * （游标持久化在本地缓存里）。
 */

import type { ChangeFeed, SyncEngine } from '../cache/sync.js';
import type { HttpMethod } from '../http/transport.js';
import type { ResourceChange, SyncResource as SyncResourceName, Timestamp } from '../types/common.js';
import { readJson, type ReadOptions, type ResourceContext } from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const SYNC_OPERATIONS = {
  listResourceChanges: { method: 'GET', path: '/sync/changes' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class SyncResource {
  constructor(
    private readonly engine: SyncEngine,
    private readonly ctx: ResourceContext,
  ) {}

  /**
   * 拉取一段增量变更流；需要 `sync:read`（不提供匿名访问）。幂等只读，**强制不走缓存**。
   * `since` 省略即建立基线握手（空 `changes` + 当前游标）；同一游标重放不会跳过或重复。
   * 403 缺 scope；410 游标过期（cursor_expired，必须重新基线化）；422 游标格式非法。
   */
  listChanges(
    params: { since?: string; resources?: SyncResourceName[]; limit?: number; until?: Timestamp } = {},
    options?: ReadOptions,
  ): Promise<ChangeFeed> {
    return readJson<ChangeFeed>(this.ctx, {
      path: '/sync/changes',
      query: params,
      resource: 'sync',
      options: { ...options, cache: false },
    });
  }

  /**
   * 建立基线：省略 `since` 握手取当前游标并持久化，返回该游标。
   * 需要 `sync:read`；幂等只读，首次接入后应再对关心的资源做一次全量拉取。
   * 401 未认证；403 缺 scope；429 限流。
   */
  baseline(): Promise<string> {
    return this.engine.baseline();
  }

  /**
   * 拉取一页变更（`since` 省略时即为基线握手）。需要 `sync:read`，幂等只读。
   * 游标由调用方原样回传续拉；同一游标重放不会跳过也不会重复已确认的变更。
   * 403 缺 scope；410 游标过期（必须重新基线化）；422 游标格式非法；429 限流。
   */
  pull(since?: string): Promise<ChangeFeed> {
    return this.engine.pull(since);
  }

  /**
   * 一直拉到 `has_more=false`，逐页回调并持久化游标，返回最终游标与累计变更数。
   * 需要 `sync:read`；幂等只读（重放同一 `since` 安全）。
   * 403 缺 scope；410 游标过期；422 游标格式非法；429 限流。
   */
  pullAll(since?: string): Promise<{ cursor: string; changes: ResourceChange[]; pages: number }> {
    return this.engine.pullAll(since);
  }

  /**
   * 读取本地持久化的游标（不发请求）；从未同步时为 `undefined`。
   * 纯本地操作，不需要 scope，幂等；失败仅可能来自本地存储。
   */
  cursor(): Promise<string | undefined> {
    return this.engine.getCursor();
  }

  /**
   * 写入本地游标（通常已由 `pullAll` 自动持久化，手工覆盖用于测试或纠偏）。
   * 纯本地操作，不需要 scope，幂等；失败仅可能来自本地存储。
   */
  setCursor(cursor: string): Promise<void> {
    return this.engine.setCursor(cursor);
  }

  /**
   * 清空本地游标；下次同步必须重新 `baseline()` 并做一次全量拉取。
   * 纯本地操作，不需要 scope，幂等；清空后仍回传旧游标会得到 410 cursor_expired。
   */
  reset(): Promise<void> {
    return this.engine.reset();
  }
}
