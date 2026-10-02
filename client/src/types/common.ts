/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/common.yaml` 对应的公共类型。
 *
 * 这些类型是**手写**的：`test/contract.test.ts` 会用契约 bundle 校验它们，
 * 一旦契约变更导致形状漂移，测试会失败。
 */

/** 不透明资源标识符，形如 `acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0`。 */
export type Id = string;

/** UTC RFC 3339 时刻，例如 `2024-05-06T07:08:09.123Z`。 */
export type Timestamp = string;

/** UTC 日历日 `YYYY-MM-DD`。 */
export type DateString = string;

/** ISO-8601 时长，例如 `PT15M` / `P365D`。 */
export type Duration = string;

export type SortOrder = 'asc' | 'desc';

export type Judge = 'codeforces' | 'atcoder' | 'luogu' | 'nowcoder' | 'vjudge' | 'qoj' | 'other';

export type Visibility = 'public' | 'members' | 'private';

export type PrincipalKind = 'human' | 'service';

/** `资源:动作` 能力字符串，例如 `member:manage`；`*` 为平台管理员。 */
export type Scope = string;

export type Label = string;

/** 偏移分页元信息。 */
export interface PageMeta {
  page: number;
  size: number;
  total: number;
  has_next: boolean;
}

/** 游标分页元信息。 */
export interface CursorPageMeta {
  has_more: boolean;
  next_cursor: string | null;
}

export interface Paged<T> extends PageMeta {
  items: T[];
}

export interface CursorPaged<T> extends CursorPageMeta {
  items: T[];
}

/** 已知的错误码；服务端可能新增取值，因此实际类型允许任意字符串。 */
export type KnownProblemCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'invalid_token'
  | 'token_expired'
  | 'insufficient_scope'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'idempotency_key_reused'
  | 'version_conflict'
  | 'precondition_failed'
  | 'quota_exceeded'
  | 'team_claim_limit_reached'
  | 'claim_window_closed'
  | 'quota_not_open'
  | 'quota_finalized'
  | 'handle_already_linked'
  | 'judge_not_supported'
  | 'dedup_conflict'
  | 'cursor_expired'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unprocessable_entity'
  | 'crawler_not_embedded'
  | 'crawler_run_in_progress'
  | 'job_not_cancellable'
  | 'export_expired'
  | 'internal_error'
  | 'service_unavailable';

/** `KnownProblemCode` 的运行期镜像，用于与契约 `ProblemCode` 枚举对账。 */
export const KNOWN_PROBLEM_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'invalid_token',
  'token_expired',
  'insufficient_scope',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'conflict',
  'idempotency_key_reused',
  'version_conflict',
  'precondition_failed',
  'quota_exceeded',
  'team_claim_limit_reached',
  'claim_window_closed',
  'quota_not_open',
  'quota_finalized',
  'handle_already_linked',
  'judge_not_supported',
  'dedup_conflict',
  'cursor_expired',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'unprocessable_entity',
  'crawler_not_embedded',
  'crawler_run_in_progress',
  'job_not_cancellable',
  'export_expired',
  'internal_error',
  'service_unavailable',
] as const satisfies readonly KnownProblemCode[];

export type ProblemCode = KnownProblemCode | (string & {});

export interface ValidationError {
  /** 指向请求体的 JSON Pointer，例如 `/items/3/handle`。 */
  pointer: string;
  message: string;
  code?: string;
}

/** RFC 7807 问题详情（`application/problem+json`）。 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: ValidationError[];
  retry_after_seconds?: number;
  docs_url?: string;
}

/** 只包含真正由 202 端点产生的任务类型；渠道测试是同步请求，不产生任务。 */
export type JobKind =
  | 'roster_export'
  | 'scoreboard_rebuild'
  | 'crawler_run'
  | 'announcement_broadcast';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface JobProgress {
  percent: number;
  message?: string;
}

export interface Job {
  id: Id;
  kind: JobKind;
  state: JobState;
  progress: JobProgress;
  result?: Record<string, unknown> | null;
  error?: Problem | null;
  created_at: Timestamp;
  started_at?: Timestamp | null;
  finished_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  created_by?: PrincipalRef | null;
}

export interface PrincipalRef {
  id: Id;
  username: string;
  display_name: string;
  kind: PrincipalKind;
}

export interface TeamRef {
  id: Id;
  name: string;
}

export type ChangeOp = 'upsert' | 'delete';

export type SyncResource =
  | 'members'
  | 'teams'
  | 'oj-handles'
  | 'scoreboards'
  | 'announcements'
  | 'quotas'
  | 'channels'
  | 'config';

export interface ResourceChange {
  resource: SyncResource | (string & {});
  id: Id;
  op: ChangeOp;
  revision: string;
  updated_at: Timestamp;
}

export interface Capabilities {
  crawler_embedded: boolean;
  public_read: boolean;
  sse: boolean;
  judges: Judge[];
  ingest_batch_max: number;
  /** `Idempotency-Key` 的去重窗口；超出后重放会被当成新请求。 */
  idempotency_window: Duration;
  /** 同一主体允许的 SSE 并发连接数上限。 */
  max_stream_connections: number;
}

export interface Meta {
  api_version: string;
  server_version: string;
  server_time: Timestamp;
  capabilities: Capabilities;
  /** 当前赛季（`2024-2025`）；省略 `season` 时服务端采用它。 */
  current_season: string;
}

/* ------------------------------------------------------------------ 身份 */

export type AccountStatus = 'active' | 'disabled';

/**
 * 社团身份：集训队挂靠的两个社团，成员可只注册其一或两个都注册。
 * `safewind_software` 是海风社团软件部 Safewind，`acm_icpc` 是 ACM/ICPC 学社。
 */
export type ClubCode = 'safewind_software' | 'acm_icpc';

/** `ClubCode` 的运行期镜像，用于与契约枚举对账。 */
export const CLUB_CODES = [
  'safewind_software',
  'acm_icpc',
] as const satisfies readonly ClubCode[];

/** 某个社团身份的状态；只有 `active` 计入该社团的在册名单。 */
export type ClubMembershipStatus = 'active' | 'inactive' | 'alumni';

/** 一条社团注册记录，`(主体, 社团)` 唯一；写入口是 `PUT /members/{id}/clubs`。 */
export interface ClubMembership {
  club: ClubCode;
  status: ClubMembershipStatus;
  /** 在该社团的注册日期。 */
  registered_at: DateString;
  /** 退出或暂停日期；`active` 时为 `null`。 */
  ended_at?: DateString | null;
  /** 社团内角色，自由文本，例如 `部长`、`干事`、`成员`。 */
  role?: string | null;
  /** 社团系统里的登记号。 */
  membership_no?: string | null;
}

/**
 * 可写的档案字段，用于创建与更新主体。只读字段 `grade` 与 `club_memberships`
 * 不在这个类型里：它们只出现在响应中；改社团身份请用 `members.setClubs()`。
 */
export interface PrincipalProfileInput {
  student_id?: string;
  enrollment_year?: number;
  major?: string;
  email?: string;
  phone?: string;
  qq?: string;
  remark?: string;
}

/** 档案的响应形态：包含服务端派生或只读的字段。 */
export interface PrincipalProfile extends PrincipalProfileInput {
  /** 由 `enrollment_year` 派生，只读。 */
  grade?: string;
  /**
   * 本次响应里被脱敏的字段名。缺 `member:read_pii` 且不在读自己时，学号/邮箱/电话/QQ
   * 返回 `null` 并在此列出，避免"没填"与"不让看"的歧义。
   */
  masked_fields?: string[];
  /** 各社团的注册记录，每个社团至多一条；只读，写入走 `PUT /members/{id}/clubs`。 */
  club_memberships?: ClubMembership[];
}

export interface Principal {
  id: Id;
  username: string;
  display_name: string;
  kind: PrincipalKind;
  labels: Label[];
  scopes: Scope[];
  profile?: PrincipalProfile;
  status: AccountStatus;
  disabled_at?: Timestamp | null;
  last_active_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
}

export type CredentialKind = 'session' | 'api_key';

export interface Credential {
  id: Id;
  principal_id: Id;
  kind: CredentialKind;
  name: string;
  prefix?: string;
  scopes: Scope[];
  created_at: Timestamp;
  created_by?: PrincipalRef | null;
  expires_at?: Timestamp | null;
  last_used_at?: Timestamp | null;
  revoked_at?: Timestamp | null;
}

/** 签发结果：`secret` 只在此处出现一次。 */
export interface IssuedCredential extends Credential {
  secret: string;
}

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  principal: Principal;
}

/** 登录请求（契约 `LoginRequest`）：账号口令换令牌对。 */
export interface LoginRequest {
  username: string;
  password: string;
  /** 设备标识，写入会话凭证的 `name`，便于在列表中撤销。 */
  device_name?: string;
}

/** 刷新请求（契约 `RefreshRequest`）：携带**单次使用**的刷新令牌换取新的令牌对。 */
export interface RefreshRequest {
  refresh_token: string;
}

/**
 * 登出请求（契约 `LogoutRequest`）。
 * 缺省登出当前访问令牌对应的会话；给 `refresh_token` 可精确撤销该会话。
 */
export interface LogoutRequest {
  /** 要撤销的会话的刷新令牌；省略时撤销当前访问令牌所属会话。 */
  refresh_token?: string;
  /** 为 `true` 时撤销该主体的全部 `session` 凭证，不含 `api_key`。 */
  all_sessions?: boolean;
}

/**
 * 自助修改自己的展示名与档案（`PATCH /auth/me`）。字段级授权：每个字段组需要对应的
 * `profile:*` scope，越权字段会让整个请求返回 `403` 并在 `errors[]` 里指出。
 * 只发想改的字段即可，未出现的保持不变。
 */
export interface UpdateMeRequest {
  display_name?: string;
  profile?: PrincipalProfileInput;
}

/** 管理员设置或重置某个主体的口令（`POST /accounts/{account_id}/password-reset`）。 */
export interface ResetPasswordRequest {
  password: string;
}

/** 修改自己的口令（`PUT /auth/me/password`）；成功后除当前会话外的会话全部失效。 */
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/** 当前主体视角（`GET /auth/me`）：主体信息 + 当前凭证摘要 + 生效 scope。 */
export interface Me extends Principal {
  credential?: Credential | null;
  effective_scopes: Scope[];
}
