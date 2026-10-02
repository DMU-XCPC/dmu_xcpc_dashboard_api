/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/config.yaml` 对应的运行时配置类型。
 *
 * 子段名与契约 schema 名一致（`ServerConfig`、`AuthConfig` …），字段 snake_case；
 * `ConfigPatch` 与 `Config` 同构但所有字段可选、叶子可为 `null`（恢复文件默认值）。
 */

import type { Duration, Judge, Scope, Timestamp } from './common.js';

/** 当前生效配置的来源；本服务只支持 TOML/YAML 配置文件与环境变量覆盖。 */
export type ConfigSource = 'file' | 'api' | 'override';

/** 服务器对外行为（监听地址、跨域）；不含敏感项。 */
export interface ServerConfig {
  /** 是否允许匿名读取 `public` 可见性资源。 */
  public_read: boolean;
  /** 对外基础 URL；`null` 表示按请求推导。 */
  base_url: string | null;
  /** 允许跨域的来源列表；`["*"]` 表示不限制。 */
  cors_origins: string[];
}

/** 认证与会话参数。 */
export interface AuthConfig {
  access_token_ttl: Duration;
  refresh_token_ttl: Duration;
  password_min_length: number;
  /** 单主体允许同时存在的 `session` 凭证数。 */
  session_max_per_principal: number;
}

/** 采集写入通道（`/ingest/*`）的限制与保留期。 */
export interface IngestConfig {
  /** 单批次最大条目数，超出返回 `413`。 */
  batch_max: number;
  /** 允许的历史时间偏差。 */
  clock_skew_past: Duration;
  /** 允许的未来时间偏差（容忍采集器时钟误差）。 */
  clock_skew_future: Duration;
  /** 提交记录保留期。 */
  submissions_retention: Duration;
}

/** 成员视图与导出的参数。 */
export interface RosterConfig {
  /** 多久未活跃即从「活跃成员」中排除。 */
  active_within: Duration;
  /** 导出产物保留期；过期下载返回 `410 export_expired`。 */
  export_ttl: Duration;
  /** 单次导出最大行数，超出返回 `409 quota_exceeded`。 */
  export_row_limit: number;
}

/** scoreList 的刷新与规模参数。 */
export interface ScoreboardsConfig {
  refresh_interval: Duration;
  /** 榜单可接受的最大滞后。 */
  freshness_bound: Duration;
  max_entries: number;
}

/** 训练统计的物化与查询范围参数。 */
export interface StatsConfig {
  materialize_interval: Duration;
  freshness_bound: Duration;
  /** 单次统计查询允许的最大天数跨度，超出返回 `422`。 */
  max_range_days: number;
}

/** 公告广播的重试策略。 */
export interface BroadcastRetryConfig {
  /** 单渠道投递的最大尝试次数。 */
  max_attempts: number;
  /** 首次重试的退避时长，后续按指数增长。 */
  backoff: Duration;
}

/** 公告板的容量、去重与广播策略。 */
export interface AnnouncementsConfig {
  /** 同时置顶的公告数上限，超出返回 `409 quota_exceeded`。 */
  max_pinned: number;
  /** 内容去重窗口；窗口内重复内容返回 `409 dedup_conflict`。 */
  dedup_window: Duration;
  broadcast_retry: BroadcastRetryConfig;
}

/** SSE 事件流的时序参数。 */
export interface StreamConfig {
  /** 心跳注释帧间隔，用于探测半开连接。 */
  heartbeat_interval: Duration;
  /** 服务端保留的可重放事件条数。 */
  replay_buffer_events: number;
  /** 可重放事件的时间窗口，与条数取先到者。 */
  replay_buffer_duration: Duration;
  /** 短时流令牌有效期（上限 `PT10M`）。 */
  stream_token_ttl: Duration;
}

/** 各通道的限流阈值；超限返回 `429` 与 `Retry-After`。 */
export interface RateLimitConfig {
  default_per_minute: number;
  ingest_per_minute: number;
  export_per_hour: number;
}

/** 采集平台开关与采集间隔。 */
export interface JudgesConfig {
  enabled: Judge[];
  crawl_interval: Duration;
}

/** 服务端日志级别与格式。 */
export interface LogConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  format: 'text' | 'json';
}

/** 当前生效的服务器配置（只读完整快照）。 */
/**
 * 账号与自助权限的默认值：`default_template` 是新建账号套用的模板，
 * `templates` 是模板名到预置 scope 集合的映射（见 `doc/api/README.md` §4.11）。
 */
export interface AccountsConfig {
  default_template: string;
  templates: Record<string, { description?: string; scopes: Scope[] }>;
}

/**
 * 各类数据的保留期，**唯一权威出处**；其它 schema 的保留期字段只是引用它。
 */
export interface RetentionConfig {
  submissions?: Duration;
  audit_logs?: Duration;
  jobs?: Duration;
  sync_changes?: Duration;
  announcements_archived?: Duration;
}

export interface Config {
  /** 与 `ETag` 等值的版本标记，用于 `If-Match`。 */
  revision: string;
  source: ConfigSource;
  updated_at: Timestamp;
  server: ServerConfig;
  auth: AuthConfig;
  accounts: AccountsConfig;
  ingest: IngestConfig;
  roster: RosterConfig;
  scoreboards: ScoreboardsConfig;
  stats: StatsConfig;
  announcements: AnnouncementsConfig;
  stream: StreamConfig;
  rate_limit: RateLimitConfig;
  judges: JudgesConfig;
  log: LogConfig;
  /** 保留期；未配置时用 schema 里的默认值。 */
  retention?: RetentionConfig;
  /** 需要重启才生效的字段（JSON Pointer 列表）；空数组表示全部已生效。 */
  restart_required_fields: string[];
}

/**
 * 配置变更请求：与 `Config` 同构、所有字段可选，不含
 * `revision`/`source`/`updated_at`/`restart_required_fields`。
 * 段落写 `null` 表示整段恢复文件默认值，叶子写 `null` 表示恢复该字段默认值；
 * 服务端整体校验、全量应用或全部拒绝（`422 validation_failed`）。
 */
export interface ConfigPatch {
  server?: {
    public_read?: boolean | null;
    base_url?: string | null;
    cors_origins?: string[] | null;
  } | null;
  auth?: {
    access_token_ttl?: Duration | null;
    refresh_token_ttl?: Duration | null;
    password_min_length?: number | null;
    session_max_per_principal?: number | null;
  } | null;
  ingest?: {
    batch_max?: number | null;
    clock_skew_past?: Duration | null;
    clock_skew_future?: Duration | null;
    submissions_retention?: Duration | null;
  } | null;
  roster?: {
    active_within?: Duration | null;
    export_ttl?: Duration | null;
    export_row_limit?: number | null;
  } | null;
  scoreboards?: {
    refresh_interval?: Duration | null;
    freshness_bound?: Duration | null;
    max_entries?: number | null;
  } | null;
  stats?: {
    materialize_interval?: Duration | null;
    freshness_bound?: Duration | null;
    max_range_days?: number | null;
  } | null;
  announcements?: {
    max_pinned?: number | null;
    dedup_window?: Duration | null;
    broadcast_retry?: {
      max_attempts?: number | null;
      backoff?: Duration | null;
    } | null;
  } | null;
  stream?: {
    heartbeat_interval?: Duration | null;
    replay_buffer_events?: number | null;
    replay_buffer_duration?: Duration | null;
    stream_token_ttl?: Duration | null;
  } | null;
  rate_limit?: {
    default_per_minute?: number | null;
    ingest_per_minute?: number | null;
    export_per_hour?: number | null;
  } | null;
  judges?: {
    enabled?: Judge[] | null;
    crawl_interval?: Duration | null;
  } | null;
  log?: {
    level?: LogConfig['level'] | null;
    format?: LogConfig['format'] | null;
  } | null;
}

/** 单个配置字段的元数据，供客户端自动渲染配置表单。 */
export interface ConfigFieldSpec {
  /** 字段的 JSON Pointer 路径（如 `/ingest/batch_max`）。 */
  path: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'duration' | 'enum' | 'string_list' | 'object';
  /** 文件默认值；无默认时为 `null`。 */
  default?: unknown;
  /** `type=enum` 时的允许取值。 */
  enum?: string[];
  min?: number;
  max?: number;
  /** 为 `true` 时值永不出现在 `GET /config`，只回显 `<字段名>_set`。 */
  secret?: boolean;
  /** 是否允许通过 `PATCH /config` 修改；`false` 时改动返回 `409`。 */
  mutable: boolean;
  /** 为 `true` 表示修改后需重启才作用于运行时。 */
  restart_required: boolean;
  /** 面向人类的中文字段说明。 */
  description: string;
}

/** 配置分组（对应 `Config` 的一个顶层段落）。 */
export interface ConfigSectionSpec {
  /** 段落的字段名（如 `ingest`）。 */
  key: string;
  title: string;
  description: string;
  fields: ConfigFieldSpec[];
}

/** 配置的机器可读元数据（与 `Config` 同版本）。 */
export interface ConfigSchema {
  /** 与同一时刻 `Config.revision` 相同的版本标记。 */
  revision: string;
  /** 配置分组列表，顺序即建议的表单展示顺序。 */
  sections: ConfigSectionSpec[];
}
