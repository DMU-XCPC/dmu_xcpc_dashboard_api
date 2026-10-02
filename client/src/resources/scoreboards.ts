/**
 * 榜单资源模块：`/scoreboards` 系列端点的 Typed REST 封装。
 */

import { readJson, writeJson, writeWithQueue } from './helpers.js';
import type { ReadOptions, ResourceContext, WriteOptions, WriteOutcome } from './helpers.js';
import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Id, Job, Judge, SortOrder, Timestamp, Visibility } from '../types/common.js';
import type {
  CreateScoreboardRequest,
  PagedScoreboard,
  Scoreboard,
  ScoreboardEntryHistory,
  ScoreboardEntryList,
  ScoreboardScope,
  TrendBucket,
  UpdateScoreboardRequest,
} from '../types/boards.js';

/** `list` 的查询参数；与 `GET /scoreboards` 的 query 参数一一对应。 */
type ListScoreboardsParams = {
  scope?: ScoreboardScope;
  judge?: Judge;
  q?: string;
  visibility?: Visibility;
  /** `true`/`false` 分别只返回落后/新鲜的榜单；省略表示不限制。 */
  stale?: boolean;
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'name' | 'created_at' | 'generated_at' | 'updated_at';
  order?: SortOrder;
};

/** `listEntries` 的查询参数；与 `GET /scoreboards/{scoreboard_id}/entries` 一一对应。 */
type ListScoreboardEntriesParams = {
  q?: string;
  team_id?: Id;
  judge?: Judge;
  enrollment_year?: number;
  /** 名次下界（含），从 1 开始。 */
  min_rank?: number;
  /** 名次上界（含）；小于 `min_rank` 时返回 422。 */
  max_rank?: number;
  page?: number;
  size?: number;
  /** `rank` 时忽略 `order`，恒为升序。 */
  sort?: 'rank' | 'score' | 'solved_count' | 'rating' | 'activity_days';
  order?: SortOrder;
};

/** `entryHistory` 的查询参数；与 `GET /scoreboards/{scoreboard_id}/entries/{entry_id}/history` 一一对应。 */
type ScoreboardEntryHistoryParams = {
  from?: Timestamp;
  to?: Timestamp;
  bucket?: TrendBucket;
  /** 返回的最大点数，默认 90、最大 365（超出取上限而不报错）。 */
  limit?: number;
};

/** `rebuild` 的查询参数。 */
type RebuildScoreboardParams = {
  /** `true` 时忽略增量、直接全量重算（默认 `false`）。 */
  full?: boolean;
};

/** `SCOREBOARDS_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const SCOREBOARDS_OPERATIONS = {
  listScoreboards: { method: 'GET', path: '/scoreboards' },
  createScoreboard: { method: 'POST', path: '/scoreboards' },
  getScoreboard: { method: 'GET', path: '/scoreboards/{scoreboard_id}' },
  updateScoreboard: { method: 'PATCH', path: '/scoreboards/{scoreboard_id}' },
  deleteScoreboard: { method: 'DELETE', path: '/scoreboards/{scoreboard_id}' },
  listScoreboardEntries: { method: 'GET', path: '/scoreboards/{scoreboard_id}/entries' },
  getScoreboardEntryHistory: { method: 'GET', path: '/scoreboards/{scoreboard_id}/entries/{entry_id}/history' },
  rebuildScoreboard: { method: 'POST', path: '/scoreboards/{scoreboard_id}/rebuild' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class ScoreboardsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 列出榜单定义（偏移分页；`stale=true` 可用于巡检落后榜单）。
   * 公开读（`public_read` 或 `scoreboard:read`）；只读幂等，可缓存，可用 `updated_since` 增量拉取。
   * 匿名且 `public_read=false` → 401；已认证但缺少 `scoreboard:read` → 403；参数非法 → 422。
   */
  list(params: ListScoreboardsParams = {}, options?: ReadOptions): Promise<PagedScoreboard> {
    return readJson<PagedScoreboard>(this.ctx, {
      path: '/scoreboards',
      query: params,
      resource: 'scoreboards',
      options,
    });
  }

  /**
   * 创建榜单定义（201；`entry_count=0`、`stale=true`，条目待首次物化）。
   * 需要 `scoreboard:manage`；必须携带幂等键，重放返回首次创建的定义。
   * 重名或 `scope`+`metric`+`filter` 完全重复 → 409；字段非法 → 422。
   */
  create(
    body: CreateScoreboardRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Scoreboard>>;
  create(body: CreateScoreboardRequest, options?: WriteOptions): Promise<Scoreboard>;
  async create(
    body: CreateScoreboardRequest,
    options?: WriteOptions,
  ): Promise<Scoreboard | WriteOutcome<Scoreboard>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Scoreboard>(this.ctx, { method: 'POST', path: '/scoreboards', body, options });
    }
    return writeJson<Scoreboard>(this.ctx, { method: 'POST', path: '/scoreboards', body, options });
  }

  /**
   * 获取单个榜单定义与物化状态（`generated_at`/`stale` 表示新鲜度）。
   * 公开读（`public_read` 或 `scoreboard:read`）；只读幂等，返回 `ETag`，命中 `If-None-Match` 为 304。
   * 不存在或不可见 → 404；参数非法 → 422。
   */
  get(scoreboardId: string, options?: ReadOptions): Promise<Scoreboard> {
    const path = substitutePath('/scoreboards/{scoreboard_id}', { scoreboard_id: scoreboardId });
    return readJson<Scoreboard>(this.ctx, { path, resource: 'scoreboards', id: scoreboardId, options });
  }

  /**
   * 合并式更新榜单定义；改动口径（`scope`/`metric`/`period`/`filter`）会置 `stale=true` 并排队重算。
   * 需要 `scoreboard:manage`；必须携带幂等键，可用 `If-Match` 做乐观并发控制。
   * 不存在 → 404；重名或口径重复 → 409；`If-Match` 不匹配 → 412；空请求体 → 422。
   */
  update(
    scoreboardId: string,
    body: UpdateScoreboardRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Scoreboard>>;
  update(scoreboardId: string, body: UpdateScoreboardRequest, options?: WriteOptions): Promise<Scoreboard>;
  async update(
    scoreboardId: string,
    body: UpdateScoreboardRequest,
    options?: WriteOptions,
  ): Promise<Scoreboard | WriteOutcome<Scoreboard>> {
    const path = substitutePath('/scoreboards/{scoreboard_id}', { scoreboard_id: scoreboardId });
    if (options?.queueIfOffline) return writeWithQueue<Scoreboard>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Scoreboard>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 删除榜单定义（204，同时清理条目与历史快照，不可撤销）。
   * 需要 `scoreboard:manage`；必须携带幂等键，重复删除返回 204。
   * 不存在或不可见 → 404。
   */
  remove(
    scoreboardId: string,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<void>>;
  remove(scoreboardId: string, options?: WriteOptions): Promise<void>;
  async remove(scoreboardId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/scoreboards/{scoreboard_id}', { scoreboard_id: scoreboardId });
    if (options?.queueIfOffline) return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }

  /**
   * 列出榜单条目（偏移分页；`sort=rank` 时忽略 `order` 恒为升序）。
   * 公开读（`public_read` 或 `scoreboard:read`）；只读幂等，可缓存，响应带本页 `generated_at`/`stale`。
   * 榜单不存在或不可见 → 404；`max_rank < min_rank` 或参数非法 → 422。
   */
  listEntries(
    scoreboardId: string,
    params: ListScoreboardEntriesParams = {},
    options?: ReadOptions,
  ): Promise<ScoreboardEntryList> {
    const path = substitutePath('/scoreboards/{scoreboard_id}/entries', { scoreboard_id: scoreboardId });
    return readJson<ScoreboardEntryList>(this.ctx, {
      path,
      query: params,
      resource: 'scoreboard-entries',
      options,
    });
  }

  /**
   * 获取单个榜单条目的历史序列（`bucket` 降采样、`limit` 从窗口末端向前截断）。
   * 公开读（`public_read` 或 `scoreboard:read`）；只读幂等，可缓存，仅返回保留期内快照。
   * 榜单或条目不存在/不可见 → 404；`limit` 超上限取 365 而不报错，参数非法 → 422。
   */
  entryHistory(
    scoreboardId: string,
    entryId: string,
    params: ScoreboardEntryHistoryParams = {},
    options?: ReadOptions,
  ): Promise<ScoreboardEntryHistory> {
    const path = substitutePath('/scoreboards/{scoreboard_id}/entries/{entry_id}/history', {
      scoreboard_id: scoreboardId,
      entry_id: entryId,
    });
    return readJson<ScoreboardEntryHistory>(this.ctx, {
      path,
      query: params,
      resource: 'scoreboard-entry-history',
      id: `${scoreboardId}:${entryId}`,
      options,
    });
  }

  /**
   * 触发榜单重建（202 → `Job`；按 `Location` 轮询任务，`full=true` 为全量重算）。
   * 需要 `scoreboard:manage`；必须携带幂等键，重放返回同一个 `job_id`。
   * 榜单不存在 → 404；已有重建任务在跑 → 409；参数非法 → 422。
   */
  rebuild(
    scoreboardId: string,
    params: RebuildScoreboardParams | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Job>>;
  rebuild(scoreboardId: string, params?: RebuildScoreboardParams, options?: WriteOptions): Promise<Job>;
  async rebuild(
    scoreboardId: string,
    params?: RebuildScoreboardParams,
    options?: WriteOptions,
  ): Promise<Job | WriteOutcome<Job>> {
    const path = substitutePath('/scoreboards/{scoreboard_id}/rebuild', { scoreboard_id: scoreboardId });
    if (options?.queueIfOffline) {
      return writeWithQueue<Job>(this.ctx, { method: 'POST', path, query: params, options });
    }
    return writeJson<Job>(this.ctx, { method: 'POST', path, query: params, options });
  }
}
