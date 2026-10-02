import { substitutePath, type QueryParams } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Duration, Id, Judge, SortOrder, Timestamp } from '../types/common.js';
import type {
  OjHandleStats,
  OjRatingHistoryPage,
  OjSubmissionPage,
  OjVerdict,
  PagedOjProblem,
} from '../types/oj.js';
import { readJson, type ReadOptions, type ResourceContext } from './helpers.js';

/** `GET /oj/submissions` 的查询参数。 */
export interface OjSubmissionsListParams {
  judge?: Judge;
  handle?: string;
  principal_id?: Id;
  problem_external_id?: string;
  contest_id?: string;
  /** 多个取值之间是并集。 */
  verdict?: OjVerdict[];
  from?: Timestamp;
  to?: Timestamp;
  cursor?: string;
  limit?: number;
}

/** `GET /oj/rating-history` 的查询参数。 */
export interface OjRatingHistoryListParams {
  judge?: Judge;
  handle?: string;
  principal_id?: Id;
  from?: Timestamp;
  to?: Timestamp;
  cursor?: string;
  limit?: number;
}

/** `GET /oj/problems` 的查询参数。 */
export interface OjProblemsListParams {
  judge?: Judge;
  q?: string;
  tag?: string[];
  min_difficulty?: number;
  max_difficulty?: number;
  min_rating?: number;
  max_rating?: number;
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'external_id' | 'title' | 'difficulty' | 'rating' | 'first_seen_at' | 'updated_at';
  order?: SortOrder;
}

/**
 * OJ 公开数据资源：提交记录、rating 历史、题目库与单个绑定的统计详情。
 *
 * 这些端点均为**最终一致**视图（`x-freshness-bound: PT15M`），匿名可用取决于
 * `capabilities.public_read`；全部走读穿缓存，只读、不可排队。
 */
export class OjDataResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 游标分页查询提交记录（固定按 `submitted_at` 倒序）。
   * 匿名可用需 `capabilities.public_read`，否则需 `oj:read`；参数非法 `400`。
   * 游标过期或与过滤条件不匹配返回 `409 cursor_expired`（重第一页即可）。
   */
  async listSubmissions(params?: OjSubmissionsListParams, options?: ReadOptions): Promise<OjSubmissionPage> {
    const query: QueryParams = {
      judge: params?.judge,
      handle: params?.handle,
      principal_id: params?.principal_id,
      problem_external_id: params?.problem_external_id,
      contest_id: params?.contest_id,
      verdict: params?.verdict,
      from: params?.from,
      to: params?.to,
      cursor: params?.cursor,
      limit: params?.limit,
    };
    return readJson<OjSubmissionPage>(this.ctx, {
      path: '/oj/submissions',
      query,
      resource: 'oj-submissions',
      options,
    });
  }

  /**
   * 游标分页查询 rating 历史（观测记录序列，固定按 `at` 倒序）。
   * 匿名可用需 `capabilities.public_read`，否则需 `oj:read`；时间参数非法 `400`。
   * 游标失效返回 `409 cursor_expired`。
   */
  async listRatingHistory(params?: OjRatingHistoryListParams, options?: ReadOptions): Promise<OjRatingHistoryPage> {
    const query: QueryParams = {
      judge: params?.judge,
      handle: params?.handle,
      principal_id: params?.principal_id,
      from: params?.from,
      to: params?.to,
      cursor: params?.cursor,
      limit: params?.limit,
    };
    return readJson<OjRatingHistoryPage>(this.ctx, {
      path: '/oj/rating-history',
      query,
      resource: 'oj-rating-history',
      options,
    });
  }

  /**
   * 偏移分页查询题目库（`tag` 取并集，难度/rating 为闭区间）。
   * 匿名可用需 `capabilities.public_read`，否则需 `oj:read`；`page` 越界返回空 `items`。
   * 参数无法解析或枚举未知返回 `400 bad_request`。
   */
  async listProblems(params?: OjProblemsListParams, options?: ReadOptions): Promise<PagedOjProblem> {
    const query: QueryParams = {
      judge: params?.judge,
      q: params?.q,
      tag: params?.tag,
      min_difficulty: params?.min_difficulty,
      max_difficulty: params?.max_difficulty,
      min_rating: params?.min_rating,
      max_rating: params?.max_rating,
      updated_since: params?.updated_since,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
      order: params?.order,
    };
    return readJson<PagedOjProblem>(this.ctx, {
      path: '/oj/problems',
      query,
      resource: 'oj-problems',
      options,
    });
  }

  /**
   * 获取单个 OJ 绑定的统计详情（摘要 + 最近提交样本 + rating 曲线点）。
   * 匿名可用需 `capabilities.public_read`，否则需 `oj:read`；`window` 默认 `P90D`、上限 `P1095D`。
   * `handle_id` 非法或绑定不存在返回 `404 not_found`，`window` 无法解析返回 `400`。
   */
  async handleStats(handleId: string, params?: { window?: Duration }, options?: ReadOptions): Promise<OjHandleStats> {
    const path = substitutePath('/oj/handles/{handle_id}/stats', { handle_id: handleId });
    const query: QueryParams = { window: params?.window };
    return readJson<OjHandleStats>(this.ctx, {
      path,
      query,
      resource: 'oj-handle-stats',
      id: handleId,
      options,
    });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const OJ_DATA_OPERATIONS = {
  listOjSubmissions: { method: 'GET', path: '/oj/submissions' },
  listOjRatingHistory: { method: 'GET', path: '/oj/rating-history' },
  listOjProblems: { method: 'GET', path: '/oj/problems' },
  getOjHandleStats: { method: 'GET', path: '/oj/handles/{handle_id}/stats' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
