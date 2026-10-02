/**
 * 统计资源模块：`/stats` 系列端点的 Typed REST 封装。
 *
 * 四个端点都是公开只读、可缓存的物化聚合读取；`stale` 表示已超过 `PT1H` 新鲜度上界。
 */

import { readJson } from './helpers.js';
import type { ReadOptions, ResourceContext } from './helpers.js';
import type { HttpMethod } from '../http/transport.js';
import type { ClubCode, Id, Judge, Label, Timestamp } from '../types/common.js';
import type {
  HeatmapUnit,
  HistogramMetric,
  ScoreboardScope,
  StatsGroupBy,
  StatsHeatmapResponse,
  StatsHistogramResponse,
  StatsSummaryResponse,
  StatsTrendResponse,
  TrendBucket,
  TrendMetric,
} from '../types/boards.js';

/** `trend` 的查询参数；`metric` 必填。 */
type StatsTrendParams = {
  metric: TrendMetric;
  scope?: ScoreboardScope;
  group_by?: StatsGroupBy;
  judges?: Judge[];
  team_ids?: Id[];
  enrollment_years?: number[];
  labels?: Label[];
  /** 只统计属于这些社团之一的成员，命中任一即纳入。 */
  clubs?: ClubCode[];
  /** 只统计该主体；与 `handle` 互斥。 */
  principal_id?: Id;
  /** 只统计该 OJ 账号；与 `principal_id` 互斥。 */
  handle?: string;
  /** 窗口起点（含），默认 `to - 90 天`；与 `bucket=hour` 组合时不得超 30 天。 */
  from?: Timestamp;
  /** 窗口终点（不含），默认当前时刻；必须晚于 `from`。 */
  to?: Timestamp;
  bucket?: TrendBucket;
  timezone?: string;
};

/** `heatmap` 的查询参数。 */
type StatsHeatmapParams = {
  unit?: HeatmapUnit;
  scope?: ScoreboardScope;
  principal_id?: Id;
  handle?: string;
  judges?: Judge[];
  team_ids?: Id[];
  enrollment_years?: number[];
  labels?: Label[];
  /** 只统计属于这些社团之一的成员，命中任一即纳入。 */
  clubs?: ClubCode[];
  /** 窗口起点（含），默认 `to - 365 天`，与 `to` 的距离不得超过 730 天。 */
  from?: Timestamp;
  to?: Timestamp;
  timezone?: string;
};

/** `histogram` 的查询参数；`metric` 必填。 */
type StatsHistogramParams = {
  metric: HistogramMetric;
  /** 等宽箱数量，默认 10、允许 1..50。 */
  bins?: number;
  scope?: ScoreboardScope;
  principal_id?: Id;
  handle?: string;
  judges?: Judge[];
  team_ids?: Id[];
  enrollment_years?: number[];
  labels?: Label[];
  /** 只统计属于这些社团之一的成员，命中任一即纳入。 */
  clubs?: ClubCode[];
  from?: Timestamp;
  to?: Timestamp;
  timezone?: string;
};

/** `summary` 的查询参数。 */
type StatsSummaryParams = {
  timezone?: string;
  /** 学年标识，如 `2024-2025`；省略或 `null` 表示全部历史。 */
  season?: string | null;
  team_id?: Id;
};

/** `STATS_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const STATS_OPERATIONS = {
  getStatsTrend: { method: 'GET', path: '/stats/trend' },
  getStatsHeatmap: { method: 'GET', path: '/stats/heatmap' },
  getStatsHistogram: { method: 'GET', path: '/stats/histogram' },
  getStatsSummary: { method: 'GET', path: '/stats/summary' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class StatsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 训练 trend 时间序列（按 `metric` 聚合，可用 `group_by` 分组）。
   * 公开读（`public_read` 或 `stats:read`）；只读幂等，可缓存，`query` 回显解析后的窗口与默认值。
   * 参数无法解析或 `bucket=hour` 超出 30 天 → 400/422；`principal_id` 与 `handle` 同时给出 → 422。
   */
  trend(params: StatsTrendParams, options?: ReadOptions): Promise<StatsTrendResponse> {
    return readJson<StatsTrendResponse>(this.ctx, {
      path: '/stats/trend',
      query: params,
      resource: 'stats-trend',
      options,
    });
  }

  /**
   * 训练热力图（按查询 `timezone` 归日；`level` 由响应的 `level_thresholds` 判定）。
   * 公开读（`public_read` 或 `stats:read`）；只读幂等，可缓存，`days` 覆盖窗口内每一天。
   * 窗口超过 730 天或参数非法 → 422；`principal_id` 与 `handle` 同时给出 → 422。
   */
  heatmap(params: StatsHeatmapParams = {}, options?: ReadOptions): Promise<StatsHeatmapResponse> {
    return readJson<StatsHeatmapResponse>(this.ctx, {
      path: '/stats/heatmap',
      query: params,
      resource: 'stats-heatmap',
      options,
    });
  }

  /**
   * 指标分布直方图（等宽箱 + `stats` 分布统计量；样本为 0 时 `bins: []`）。
   * 公开读（`public_read` 或 `stats:read`）；只读幂等，可缓存，`bins` 默认 10、允许 1..50。
   * `bins` 越界或参数非法 → 422；`principal_id` 与 `handle` 同时给出 → 422。
   */
  histogram(params: StatsHistogramParams, options?: ReadOptions): Promise<StatsHistogramResponse> {
    return readJson<StatsHistogramResponse>(this.ctx, {
      path: '/stats/histogram',
      query: params,
      resource: 'stats-histogram',
      options,
    });
  }

  /**
   * 面板总览统计（成员分档、OJ 覆盖、分平台 rating 与队伍规模）。
   * 公开读（`public_read` 或 `stats:read`）；只读幂等，可缓存，应展示 `stale` 而非当作实时值。
   * `season` 格式非法或参数非法 → 422。
   */
  summary(params: StatsSummaryParams = {}, options?: ReadOptions): Promise<StatsSummaryResponse> {
    return readJson<StatsSummaryResponse>(this.ctx, {
      path: '/stats/summary',
      query: params,
      resource: 'stats-summary',
      options,
    });
  }
}
