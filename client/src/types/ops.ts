/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/ops.yaml` 对应的运维类型：
 * 健康检查、审计日志与异步任务分页。
 *
 * `Job` 复用 `./common.js` 中的定义。
 */

import type { CursorPaged, Id, Job, Paged, PrincipalRef, Timestamp } from './common.js';

/* ---------------------------------------------------------------- 健康检查 */

/** 单个依赖或子系统的健康状态；`message` 已脱敏。 */
export interface HealthCheck {
  /** 检查项名称（如 `database`、`cache`、`crawler`、`sse`）。 */
  name: string;
  status: 'ok' | 'degraded' | 'down';
  /** 探测延迟（毫秒）；未探测时为 `null`。 */
  latency_ms?: number | null;
  /** 补充说明；`status=ok` 时通常为 `null`。 */
  message?: string | null;
}

/** 存活探针结果；`down` 时整体返回 `503` + Problem（而非本结构）。 */
export interface HealthStatus {
  /** 聚合状态：任一检查 `down` 则为 `down`，否则任一 `degraded` 则为 `degraded`。 */
  status: 'ok' | 'degraded' | 'down';
  /** 服务端实现版本（构建号）。 */
  version: string;
  /** 进程已运行秒数。 */
  uptime_seconds: number;
  time: Timestamp;
  checks: HealthCheck[];
}

/** 就绪探针结果；`ready=false` 时整体返回 `503` + Problem（而非本结构）。 */
export interface ReadyStatus {
  /** 是否已就绪（可接收流量）。 */
  ready: boolean;
  checks: HealthCheck[];
}

/* ------------------------------------------------------------------ 审计 */

/** 操作结果：`denied` 为权限不足被拒，`failure` 为校验或内部错误。 */
export type AuditOutcome = 'success' | 'denied' | 'failure';

/** 操作者类别；`system` 记录没有 `actor`。 */
export type ActorKind = 'human' | 'service' | 'system';

/** 被操作资源的轻量引用；无单一目标时 `id` 为 `null`。 */
export interface AuditTarget {
  /** 资源集合名（如 `announcements`、`quotas`、`config`）。 */
  resource?: string;
  id?: Id | null;
  /** 便于人工识别的标签（如公告标题）。 */
  label?: string | null;
}

/** 一条审计记录；审计写入是同步的，写入后立即可查。 */
export interface AuditLog {
  id: Id;
  at: Timestamp;
  /** 操作主体；`actor_kind=system` 时为 `null`。 */
  actor?: PrincipalRef | null;
  actor_kind: ActorKind;
  /** 动作名，形如 `<资源>.<动作>`。 */
  action: string;
  target?: AuditTarget | null;
  outcome: AuditOutcome;
  /** 该次操作最终返回的 HTTP 状态码。 */
  status_code?: number | null;
  /** 通过校验所用的 scope；认证失败时为 `null`。 */
  scope_used?: string | null;
  /** 客户端 IP（已按隐私策略截断）。 */
  ip?: string | null;
  user_agent?: string | null;
  /** 与响应头 `X-Request-Id` 相同的排障标识。 */
  request_id: string;
  /** 动作相关的结构化细节（已脱敏），未知字段应忽略。 */
  metadata?: Record<string, unknown>;
}

/** 审计日志的游标分页结果（按 `at` 降序）。 */
export type PagedAuditLog = CursorPaged<AuditLog>;

/* -------------------------------------------------------------- 异步任务 */

/** 异步任务的偏移分页结果。 */
export type PagedJob = Paged<Job>;
