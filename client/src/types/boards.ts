/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/boards.yaml` 对应的榜单与统计类型。
 *
 * 导出名与 schema 名严格一致（PascalCase），字段名与契约一致（snake_case）。
 */

import type {
  ClubCode,
  DateString,
  Duration,
  Id,
  Judge,
  Label,
  Paged,
  PrincipalRef,
  TeamRef,
  Timestamp,
  Visibility,
} from './common.js';

/* ------------------------------------------------------------------- 枚举 */

/** 榜单口径：`individual` 按主体排名，`team` 按队伍排名。 */
export type ScoreboardScope = 'individual' | 'team';

/** 排名依据的分值口径。 */
export type ScoreboardMetric = 'solved_count' | 'rating' | 'rating_sum' | 'activity_days' | 'weighted';

/** 统计区间种类。 */
export type ScoreboardPeriodKind = 'all_time' | 'season' | 'rolling' | 'custom';

/** trend 序列的切桶粒度（`hour` 仅允许查询最近 30 天）。 */
export type TrendBucket = 'hour' | 'day' | 'week' | 'month';

/** trend 端点可统计的指标。 */
export type TrendMetric =
  | 'solved_count'
  | 'submissions'
  | 'accepted'
  | 'rating'
  | 'active_members'
  | 'acceptance_rate'
  | 'rating_delta';

/** 统计结果的分组维度。 */
export type StatsGroupBy = 'none' | 'judge' | 'team' | 'club' | 'enrollment_year' | 'label';

/** 热力图的取值口径。 */
export type HeatmapUnit = 'submissions' | 'accepted' | 'active_days';

/** 直方图的分布指标。 */
export type HistogramMetric =
  | 'solved_count'
  | 'rating'
  | 'max_rating'
  | 'submissions_30d'
  | 'active_days_30d'
  | 'acceptance_rate'
  | 'rating_delta';

/* --------------------------------------------------------------- 榜单定义 */

/** 榜单的成员/队伍筛选条件；字段内 OR、字段间 AND。 */
export interface ScoreboardFilter {
  /** 仅统计属于这些社团之一的成员，命中任一即可；省略表示不限社团。 */
  clubs?: ClubCode[];
  judges?: Judge[];
  enrollment_years?: number[];
  labels?: Label[];
  team_ids?: Id[];
  include_inactive?: boolean;
}

/** 榜单的统计区间；`kind` 决定其它字段的有效性，区间按 `[from, to)` 解释。 */
export interface ScoreboardPeriod {
  kind: ScoreboardPeriodKind;
  /** 学年标识，如 `2024-2025`；仅 `kind=season` 时有值。 */
  season?: string | null;
  /** 滚动窗口，如 `P90D`；仅 `kind=rolling` 时有值。 */
  window?: Duration | null;
  /** 区间起点（含）；仅 `kind=custom` 时有值，`null` 表示不设下界。 */
  from?: Timestamp | null;
  /** 区间终点（不含）；仅 `kind=custom` 时有值，`null` 表示截至当前。 */
  to?: Timestamp | null;
}

/** 榜单定义与物化状态；`rank`/`score` 等条目数据由最近一次物化写入。 */
export interface Scoreboard {
  id: Id;
  name: string;
  description?: string | null;
  scope: ScoreboardScope;
  metric: ScoreboardMetric;
  /** 限定的平台；`null` 表示跨平台。 */
  judge?: Judge | null;
  /** `judge=other` 时的平台可读名称。 */
  judge_label?: string | null;
  period: ScoreboardPeriod;
  filter: ScoreboardFilter;
  visibility: Visibility;
  /** 最近一次物化产出的条目数；从未物化为 `0`。 */
  entry_count: number;
  /** 最近一次物化**完成**时刻；从未物化为 `null`。 */
  generated_at: Timestamp | null;
  /** 为 `true` 表示条目数据已落后于采集写入。 */
  stale: boolean;
  next_refresh_at?: Timestamp | null;
  source_updated_at?: Timestamp | null;
  revision: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by?: PrincipalRef | null;
}

/** 榜单定义的偏移分页结果。 */
export type PagedScoreboard = Paged<Scoreboard>;

/** 创建榜单定义；`judge=other` 时必须同时给 `judge_label`。 */
export interface CreateScoreboardRequest {
  name: string;
  description?: string;
  scope: ScoreboardScope;
  metric: ScoreboardMetric;
  judge?: Judge | null;
  judge_label?: string;
  period?: ScoreboardPeriod;
  filter?: ScoreboardFilter;
  visibility?: Visibility;
}

/** 合并式更新榜单定义；修改口径会触发重算并使 `stale=true`。 */
export interface UpdateScoreboardRequest {
  name?: string;
  /** `null` 表示清空说明。 */
  description?: string | null;
  scope?: ScoreboardScope;
  metric?: ScoreboardMetric;
  /** `null` 表示改为跨平台。 */
  judge?: Judge | null;
  /** `null` 表示清空（`judge` 非 `other` 时必须为 `null`）。 */
  judge_label?: string | null;
  period?: ScoreboardPeriod;
  filter?: ScoreboardFilter;
  visibility?: Visibility;
}

/* ------------------------------------------------------------------- 条目 */

/** 条目在单个平台上的明细。 */
export interface ScoreboardEntryJudge {
  judge: Judge;
  rating?: number | null;
  max_rating?: number | null;
  solved_count?: number;
  submissions?: number;
  rating_delta_30d?: number | null;
  last_accepted_at?: Timestamp | null;
}

/** 榜单中的单条排名记录（成员或队伍）。 */
export interface ScoreboardEntry {
  id: Id;
  scoreboard_id: Id;
  rank: number;
  display_name: string;
  principal?: PrincipalRef | null;
  team?: TeamRef | null;
  score: number;
  metric: ScoreboardMetric;
  solved_count: number;
  /** 罚时（分钟）；仅 ICPC 规则榜单有值。 */
  penalty?: number | null;
  activity_days?: number;
  rating?: number | null;
  rating_delta?: number | null;
  /** 相对上一次物化的名次变化，正数表示上升；首次物化为 `null`。 */
  rank_delta?: number | null;
  per_judge: ScoreboardEntryJudge[];
  updated_at: Timestamp;
}

/**
 * 榜单条目的偏移分页结果：分页元信息 + 本页物化时刻与新鲜度。
 * 契约里是 `allOf [PageMeta, {items, generated_at, stale}]`，故与普通 `Paged<T>` 不同。
 */
export interface PagedScoreboardEntry extends Paged<ScoreboardEntry> {
  /** 产生本页数据的物化完成时刻；从未物化为 `null`（此时 `items` 为空）。 */
  generated_at: Timestamp | null;
  /** 为 `true` 表示条目数据落后于采集写入或已超过 `PT15M` 上界。 */
  stale: boolean;
}

/** 同一响应的另一种叫法（历史命名），与 `PagedScoreboardEntry` 完全等价。 */
export type ScoreboardEntryList = PagedScoreboardEntry;

/* ------------------------------------------------------------------- 历史 */

/** 榜单条目历史中的一个快照点。 */
export interface ScoreboardHistoryPoint {
  at: Timestamp;
  rank?: number | null;
  score: number;
  solved_count: number;
  rating?: number | null;
}

/** 单个榜单条目的历史序列（含服务端解析后的窗口）。 */
export interface ScoreboardEntryHistory {
  entry_id: Id;
  scoreboard_id: Id;
  points: ScoreboardHistoryPoint[];
  window: { from: Timestamp; to: Timestamp };
}

/* ------------------------------------------------------------------- 统计 */

/** 服务端回显的**解析后**查询；字段与请求参数同名，不适用者省略。 */
export interface StatsQueryEcho {
  /** 生效的社团过滤；未指定时为空数组，表示不限社团。 */
  clubs?: ClubCode[];
  scope: ScoreboardScope;
  judges?: Judge[];
  team_ids?: Id[];
  enrollment_years?: number[];
  labels?: Label[];
  principal_id?: Id | null;
  handle?: string | null;
  from?: Timestamp | null;
  to?: Timestamp | null;
  timezone?: string;
  bucket?: TrendBucket;
  group_by?: StatsGroupBy;
  unit?: HeatmapUnit;
  /** 解析后的指标名：trend 端点为 `TrendMetric`，histogram 端点为 `HistogramMetric`。 */
  metric?: string;
}

/** trend 序列中的一个桶。 */
export interface TrendPoint {
  bucket_start: Timestamp;
  bucket_end: Timestamp;
  /** 该桶的指标值；`acceptance_rate` 为 0..1 的小数。 */
  value: number;
  sample_size?: number;
  /** 展示用短标签，如 `05-06`。 */
  label?: string;
}

/** trend 响应中单个分组的时间序列。 */
export interface TrendGroup {
  /** 分组键；不分组时为 `all`。 */
  key: string;
  label: string;
  points: TrendPoint[];
  series_summary: {
    total: number;
    average: number;
    max: number;
    min: number;
    last: number;
  };
}

/** trend 统计结果。 */
export interface StatsTrendResponse {
  query: StatsQueryEcho;
  groups: TrendGroup[];
  generated_at: Timestamp;
  stale?: boolean;
}

/** 热力图中的一天（按查询 `timezone` 归日）。 */
export interface HeatmapDay {
  date: DateString;
  value: number;
  /** 由 `summary.level_thresholds` 判定的 0..4 展示等级。 */
  level: 0 | 1 | 2 | 3 | 4;
  submissions?: number;
  accepted?: number;
}

/** 热力图整体汇总。 */
export interface HeatmapSummary {
  total: number;
  max_day_value: number;
  active_days: number;
  longest_streak?: number;
  current_streak?: number;
  first_date?: DateString | null;
  last_date?: DateString | null;
  /** 长度为 4 的升序分位阈值 `[t1, t2, t3, t4]`。 */
  level_thresholds: number[];
}

/** 热力图结果（日粒度）。 */
export interface StatsHeatmapResponse {
  query: StatsQueryEcho;
  timezone: string;
  unit: HeatmapUnit;
  days: HeatmapDay[];
  summary: HeatmapSummary;
  generated_at: Timestamp;
  stale?: boolean;
}

/** 等宽直方图的一个箱，区间 `[lower, upper)`，最后一箱右闭。 */
export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
  /** 该箱样本数占全部样本的比例（0..1）。 */
  ratio: number;
  label: string;
}

/** 分布描述统计量；样本不足时除 `count` 外均为 `0`。 */
export interface DistributionStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p90?: number;
  p99?: number;
  stddev?: number;
}

/** 直方图结果（分箱 + 分布统计量）。 */
export interface StatsHistogramResponse {
  query: StatsQueryEcho;
  metric: HistogramMetric;
  bins: HistogramBin[];
  stats: DistributionStats;
  generated_at: Timestamp;
  stale?: boolean;
}

/** 面板总览统计。 */
export interface StatsSummaryResponse {
  generated_at: Timestamp;
  stale: boolean;
  /** 成员规模与活跃度分档。 */
  members: {
    total: number;
    active_30d: number;
    dormant_90d: number;
    inactive_365d: number;
    /** 按社团拆分的人数；同时注册两个社团的人在两处都计入，因此之和可能大于 `total`。 */
    by_club: Array<{
      club: ClubCode;
      total: number;
      active_30d: number;
      dormant_90d: number;
      inactive_365d: number;
    }>;
  };
  /** OJ 绑定与采集覆盖情况。 */
  oj: {
    linked_handles: number;
    solved_total: number;
    submissions_30d: number;
    active_handles_30d: number;
  };
  /** 分平台 rating 分布。 */
  ratings: {
    judges: Array<{ judge: Judge; max: number | null; avg: number | null; count: number }>;
  };
  /** 队伍规模。 */
  teams: {
    total: number;
    active: number;
  };
}
