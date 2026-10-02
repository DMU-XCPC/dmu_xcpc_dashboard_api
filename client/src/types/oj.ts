/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/oj_data.yaml` 对应的类型。
 *
 * 覆盖 OJ 绑定/题目/提交/rating/快照、ingest 写入通道与采集器配置/运行/状态。
 * `Id`、`Timestamp`、`Duration`、`Judge`、`Paged`、`CursorPaged` 复用
 * `types/common.ts` 中的定义。
 */

import type { CursorPaged, Duration, Id, Judge, Paged, Timestamp } from './common.js';

/* ------------------------------------------------------------------ OJ 绑定 */

/** 成员与某个 OJ 平台的账号绑定。 */
export interface OjHandle {
  id: Id;
  principal_id: Id;
  judge: Judge;
  /** `judge: other` 时的人类可读平台名；其余为 `null`。 */
  judge_label?: string | null;
  /** 外部平台的原始账号名，逐字保存、大小写敏感。 */
  handle: string;
  profile_url?: string | null;
  verified: boolean;
  /** 归属校验状态机：`pending` → `verified` / `failed`。 */
  verification_state: 'pending' | 'verified' | 'failed';
  /** 敏感字段：仅本人或持有 `oj:manage` 的调用者能看到原值，其余为 `null`。 */
  verification_token?: string | null;
  verified_at?: Timestamp | null;
  linked_at: Timestamp;
  last_crawled_at?: Timestamp | null;
  last_submission_at?: Timestamp | null;
  summary?: OjHandleSummary | null;
  revision: string;
  updated_at: Timestamp;
}

/** OJ 绑定的轻量引用，用于在提交、rating 记录里内联身份。 */
export interface OjHandleRef {
  id: Id;
  judge: Judge;
  judge_label?: string | null;
  handle: string;
  verified: boolean;
  latest_rating?: number | null;
}

/** 单个 OJ 绑定的聚合统计摘要（最终一致视图）。 */
export interface OjHandleSummary {
  rating?: number | null;
  max_rating?: number | null;
  rating_delta_30d?: number | null;
  solved_count: number;
  attempted_count: number;
  submissions_30d?: number;
  active_days_30d?: number;
  computed_at: Timestamp;
}

/* -------------------------------------------------------------------- 题目 */

/** 题目的轻量引用；自然键为 `(judge, external_id)`。 */
export interface OjProblemRef {
  /** 服务器侧题目资源的内部 id；题目尚未入库时为 `null`。 */
  problem_id?: Id | null;
  judge: Judge;
  external_id: string;
  title?: string | null;
  url?: string | null;
  tags?: string[];
  difficulty?: number | null;
  rating?: number | null;
}

/** 服务器侧保存的题目资源。 */
export interface OjProblem {
  id: Id;
  judge: Judge;
  external_id: string;
  title: string;
  url?: string | null;
  tags: string[];
  difficulty?: number | null;
  rating?: number | null;
  solved_count?: number | null;
  attempt_count?: number | null;
  first_seen_at: Timestamp;
  updated_at: Timestamp;
}

/* -------------------------------------------------------------------- 比赛 */

/** 比赛的轻量引用；自然键为 `(judge, contest_id)`。 */
export interface OjContestRef {
  judge: Judge;
  contest_id: string;
  name?: string | null;
  url?: string | null;
  started_at?: Timestamp | null;
}

/* -------------------------------------------------------------------- 提交 */

/** 归一化后的评测结果。 */
export type OjVerdict =
  | 'accepted'
  | 'wrong_answer'
  | 'time_limit_exceeded'
  | 'memory_limit_exceeded'
  | 'runtime_error'
  | 'compile_error'
  | 'presentation_error'
  | 'partial'
  | 'skipped'
  | 'other';

/** 一条 OJ 提交记录；自然键为 `(judge, submission_id)`。 */
export interface OjSubmission {
  id: Id;
  judge: Judge;
  submission_id: string;
  handle: string;
  principal_id?: Id | null;
  problem: OjProblemRef;
  verdict?: OjVerdict | null;
  verdict_raw?: string | null;
  language?: string | null;
  submitted_at: Timestamp;
  ingested_at: Timestamp;
  contest?: OjContestRef | null;
  is_first_ac?: boolean;
}

/* ------------------------------------------------------------ rating 记录 */

/**
 * 一次 rating 观测（历史点）。原始数据只需 `judge`/`handle`/`rating`/`at`：
 * `delta` 由服务端与同一账号的上一条记录派生（首条为 `null`）。
 * 自然键：带 `contest_id` 时为 `(judge, handle, contest_id)`，否则 `(judge, handle, at)`。
 */
export interface OjRatingRecord {
  id: Id;
  judge: Judge;
  handle: string;
  principal_id?: Id | null;
  contest?: OjContestRef | null;
  /** 该时刻的 rating（观测值本身）。 */
  rating: number;
  /** 与同一账号上一条记录之差；服务端派生，首条为 `null`。 */
  delta?: number | null;
  max_rating?: number | null;
  rank?: number | null;
  performance?: number | null;
  at: Timestamp;
  ingested_at?: Timestamp;
}

/* -------------------------------------------------------------- 账号快照 */

/** 某个 OJ 账号在某一时刻的指标快照；自然键为 `(judge, handle, captured_at)`。 */
export interface OjHandleSnapshot {
  id: Id;
  judge: Judge;
  handle: string;
  principal_id?: Id | null;
  captured_at: Timestamp;
  rating?: number | null;
  max_rating?: number | null;
  solved_count?: number | null;
  attempted_count?: number | null;
  submissions_30d?: number | null;
  active_days_30d?: number | null;
}

/** rating 曲线上的一个采样点。 */
interface OjRatingPoint {
  at: Timestamp;
  rating: number;
}

/** 单个 OJ 绑定的统计详情：聚合摘要 + 时间窗 + 提交样本 + rating 曲线点。 */
export interface OjHandleStats extends OjHandleSummary {
  handle_id: Id;
  judge: Judge;
  handle: string;
  /** 本次统计采用的时间窗（回看时长），与请求参数 `window` 一致。 */
  window: Duration;
  /** 时间窗内最近的提交样本，按 `submitted_at` 倒序，最多 20 条。 */
  recent_submissions: OjSubmission[];
  /** 时间窗内的 rating 曲线点，按 `at` 升序。 */
  rating_points: OjRatingPoint[];
}

/* -------------------------------------------------------------- 分页响应 */

/** 题目列表的偏移分页响应。 */
export type PagedOjProblem = Paged<OjProblem>;

/** 提交记录的游标分页响应，固定按 `submitted_at` 倒序。 */
export type OjSubmissionPage = CursorPaged<OjSubmission>;

/** rating 历史（观测记录序列）的游标分页响应，固定按 `at` 倒序。 */
export type OjRatingHistoryPage = CursorPaged<OjRatingRecord>;

/** OJ 绑定列表的偏移分页响应。 */
export type PagedOjHandle = Paged<OjHandle>;

/* ---------------------------------------------------------- ingest 写入 */

/** 单条提交上报；自然键为 `(judge, submission_id)`。 */
export interface IngestSubmissionItem {
  judge: Judge;
  submission_id: string;
  handle: string;
  problem: OjProblemRef;
  verdict?: OjVerdict | null;
  verdict_raw?: string | null;
  language?: string | null;
  /** 平台上的提交时刻，允许乱序，须落在 `now-3y .. now+1d` 内。 */
  submitted_at: Timestamp;
  contest_id?: string | null;
  contest_name?: string | null;
  is_first_ac?: boolean;
}

/** 提交记录的批量上报请求（1..500 条/批）。 */
export interface IngestSubmissionsRequest {
  items: IngestSubmissionItem[];
  crawler_run_id?: Id | null;
}

/**
 * 单条 rating 上报：**只需要"某时刻的 rating"**，`delta` 由服务端派生。
 * 自然键：带 `contest_id` 时为 `(judge, handle, contest_id)`，否则 `(judge, handle, at)`。
 */
export interface IngestRatingRecordItem {
  judge: Judge;
  handle: string;
  /** 外部平台比赛编号；可省略（如周期性 rating 快照）。 */
  contest_id?: string;
  contest_name?: string | null;
  /** 该时刻的 rating（观测值本身）。 */
  rating: number;
  max_rating?: number | null;
  rank?: number | null;
  performance?: number | null;
  at: Timestamp;
}

/** rating 记录的批量上报请求（1..500 条/批）。 */
export interface IngestRatingRecordsRequest {
  items: IngestRatingRecordItem[];
  crawler_run_id?: Id | null;
}

/** 单个账号指标快照上报；自然键为 `(judge, handle, captured_at)`。 */
export interface IngestHandleSnapshotItem {
  judge: Judge;
  handle: string;
  captured_at: Timestamp;
  rating?: number | null;
  max_rating?: number | null;
  solved_count?: number | null;
  attempted_count?: number | null;
  submissions_30d?: number | null;
  active_days_30d?: number | null;
}

/** 账号指标快照的批量上报请求（1..500 条/批）。 */
export interface IngestHandleSnapshotsRequest {
  items: IngestHandleSnapshotItem[];
  crawler_run_id?: Id | null;
}

/** 单条题目元数据上报；自然键为 `(judge, external_id)`。 */
export interface IngestProblemItem {
  judge: Judge;
  external_id: string;
  title: string;
  tags?: string[];
  difficulty?: number | null;
  rating?: number | null;
  url?: string | null;
}

/** 题目元数据的批量上报请求（1..500 条/批）。 */
export interface IngestProblemsRequest {
  items: IngestProblemItem[];
  crawler_run_id?: Id | null;
}

/** 批次中单条上报的处理结果；`index` 与请求 `items` 下标一一对应。 */
export interface IngestItemResult {
  index: number;
  status: 'accepted' | 'duplicate' | 'rejected';
  id?: Id | null;
  code?: string | null;
  message?: string | null;
  /** RFC 6901 JSON Pointer，如 `/items/3/submitted_at`。 */
  pointer?: string | null;
}

/** ingest 批次的处理结果：`200` + 逐条结果表示可能部分成功。 */
export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  items: IngestItemResult[];
  crawler_run_id?: Id | null;
  /** 本批数据在聚合视图中可见的时刻；`null` 表示尚未排入物化。 */
  materialized_at?: Timestamp | null;
}

/* -------------------------------------------------------------- 采集器配置 */

/** 代理服务器的最近一次健康探测结果。 */
export interface ProxyHealth {
  state: 'unknown' | 'healthy' | 'unhealthy';
  checked_at?: Timestamp | null;
  latency_ms?: number | null;
  last_error?: string | null;
}

/** 一个可选的代理服务器；`password` 是只写字段，响应永不含明文。 */
export interface ProxyServer {
  id: Id;
  label: string;
  url: string;
  username?: string | null;
  /** 只写：仅在 `PATCH /crawler/config` 请求体中出现；`null` 表示清除口令。 */
  password?: string | null;
  /** 只读：服务端是否已保存该代理的口令。 */
  has_password?: boolean;
  enabled: boolean;
  priority?: number;
  health?: ProxyHealth | null;
}

/** 代理回退配置：仅当直连失败（或 `always`）时才使用代理。 */
export interface ProxyConfig {
  enabled: boolean;
  strategy: 'failover' | 'round_robin' | 'always';
  direct_timeout: Duration;
  proxies: ProxyServer[];
  /** 永不使用代理的主机名后缀列表。 */
  no_proxy?: string[];
}

/** 单个平台的采集配置。 */
export interface CrawlerJudgeConfig {
  judge: Judge;
  enabled: boolean;
  /** 该平台的采集间隔；`null` 表示沿用全局 `schedule.interval`。 */
  interval?: Duration | null;
  /** 单次运行最多抓取的列表页数；`null` 表示不限制。 */
  max_pages?: number | null;
  /** 平台特有参数，服务端原样透传。 */
  extra?: Record<string, unknown> | null;
}

/** 允许采集的时间窗（`from` 含、`to` 不含）。 */
interface CrawlerActiveHours {
  from: string;
  to: string;
}

/** 默认调度参数，可被单个 `judges[].interval` 覆盖。 */
interface CrawlerScheduleConfig {
  interval: Duration;
  jitter: Duration;
  timezone: string;
  active_hours?: CrawlerActiveHours;
}

/** 采集器对单个平台的默认请求节流。 */
interface CrawlerRateLimit {
  requests_per_minute: number;
  concurrency: number;
}

/** 采集结果的保留期。 */
interface CrawlerRetention {
  submissions: Duration;
  runs: Duration;
}

/** 采集器的完整配置（由服务器持有并下发）。 */
export interface CrawlerConfig {
  /** 配置版本标记，与 `GET /crawler/config` 的 `ETag` 一致。 */
  revision: string;
  /** 运行形态，客户端只读。 */
  mode: 'embedded' | 'external';
  enabled: boolean;
  judges: CrawlerJudgeConfig[];
  schedule: CrawlerScheduleConfig;
  rate_limit: CrawlerRateLimit;
  proxy: ProxyConfig;
  retention?: CrawlerRetention;
  updated_at: Timestamp;
}

/** 采集器配置的局部更新请求：出现的字段整体替换。 */
export interface CrawlerConfigPatch {
  enabled?: boolean;
  judges?: CrawlerJudgeConfig[];
  schedule?: CrawlerScheduleConfig;
  rate_limit?: CrawlerRateLimit;
  proxy?: ProxyConfig;
  retention?: CrawlerRetention;
}

/* -------------------------------------------------------------- 采集器运行 */

/** 采集器运行的状态机；`succeeded` / `failed` / `partial` 为终态。 */
export type CrawlerRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';

/** 运行由谁触发。 */
export type CrawlerRunTrigger = 'schedule' | 'manual' | 'api';

/** 一次采集运行的条目计数。 */
export interface CrawlerRunCounts {
  fetched: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  failed: number;
}

/** 一次采集运行的记录（服务器代管与外部上报共用）。 */
export interface CrawlerRun {
  id: Id;
  judge: Judge;
  state: CrawlerRunState;
  trigger?: CrawlerRunTrigger;
  started_at: Timestamp;
  /** 运行结束时刻；仍在 `running` 时为 `null`。 */
  finished_at?: Timestamp | null;
  counts: CrawlerRunCounts;
  proxy_used?: boolean;
  proxy_failures?: number;
  error?: string | null;
  report_note?: string | null;
}

/** 外部采集器上报自己一次运行的请求体。 */
export interface CrawlerRunReportRequest {
  judge: Judge;
  state: CrawlerRunState;
  trigger?: CrawlerRunTrigger;
  started_at: Timestamp;
  /** `state` 为终态时必填且不得早于 `started_at`。 */
  finished_at?: Timestamp | null;
  counts: CrawlerRunCounts;
  proxy_used?: boolean;
  proxy_failures?: number;
  error?: string | null;
}

/** 采集器运行记录的游标分页响应，固定按 `started_at` 倒序。 */
export type PagedCrawlerRun = CursorPaged<CrawlerRun>;

/** 请求服务器代管触发一次采集（仅 `mode=embedded` 可用）。 */
export interface TriggerCrawlerRunRequest {
  judge: Judge;
  /** `true` 时忽略增量游标做全量回填；默认 `false`。 */
  full?: boolean;
  since?: Timestamp | null;
}

/* -------------------------------------------------------------- 采集器状态 */

/** 单个平台的采集健康度。 */
export interface JudgeCollectionStatus {
  judge: Judge;
  enabled: boolean;
  last_attempt_at?: Timestamp | null;
  last_success_at?: Timestamp | null;
  /** 数据滞后（已采集数据的最新时刻与当前时刻之差）；无数据为 `null`。 */
  lag?: Duration | null;
  consecutive_failures: number;
  last_error?: string | null;
  using_proxy?: boolean;
  collected_24h?: number;
}

/** 代理池按健康状态汇总的数量。 */
interface CrawlerProxySummary {
  healthy: number;
  unhealthy: number;
  unknown: number;
}

/** 采集器采集的实时状态快照（最终一致视图）。 */
export interface CrawlerStatus {
  mode: 'embedded' | 'external';
  enabled: boolean;
  last_run_at?: Timestamp | null;
  next_run_at?: Timestamp | null;
  judges: JudgeCollectionStatus[];
  /** 已接收但尚未物化的条目数。 */
  pending_items: number;
  /** 未配置任何代理时为 `null`。 */
  proxy_summary?: CrawlerProxySummary | null;
  generated_at: Timestamp;
}

/* -------------------------------------------------------------- 绑定写入 */

/** 把某个 OJ 账号与主体绑定；`judge` 与 `handle` 必填。 */
export interface LinkOjHandleRequest {
  /** 省略时绑定到调用者自身（需 `oj:write`）；给出时需 `oj:manage`。 */
  principal_id?: Id;
  judge: Judge;
  /** `judge: other` 时必填。 */
  judge_label?: string;
  handle: string;
}

/** 采集器确认 OJ 账号归属的请求体；`token` 必填。 */
export interface VerifyOjHandleRequest {
  token: string;
  /** 可选的人工证据地址，仅写入审计日志。 */
  evidence_url?: string;
}
