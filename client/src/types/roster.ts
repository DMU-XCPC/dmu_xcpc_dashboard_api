/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/roster.yaml` 对应的成员名单/队伍类型。
 *
 * 这些类型是**手写**的：字段名与契约保持一致（snake_case），导出名与 schema 名一致。
 */

import type {
  AccountStatus,
  ClubCode,
  DateString,
  ClubMembership,
  ClubMembershipStatus,
  Duration,
  Id,
  Judge,
  Label,
  Paged,
  Principal,
  PrincipalProfile,
  PrincipalProfileInput,
  PrincipalRef,
  Problem,
  Scope,
  TeamRef,
  Timestamp,
  ValidationError,
} from './common.js';
import type { OjHandleRef } from './oj.js';

/* --------------------------------------------------------------- 成员活动度 */

/** 成员活动度的派生视图（只读；由后台汇总任务计算，最终一致）。 */
/** 某个社团身份下的活跃度切片：只统计该社团在册期间的活跃。 */
export interface ClubActivity {
  club: ClubCode;
  status: ClubMembershipStatus;
  /** 该社团的注册日期，也是本切片的统计起点。 */
  registered_at: DateString;
  /** 在册期间的最后一次活跃；期间没有活跃则为 `null`。 */
  last_active_at?: Timestamp | null;
  /** 在册期间有活跃记录的天数。 */
  active_days: number;
  /** 在册期间的 OJ 提交数。 */
  submissions: number;
}

export interface MemberActivity {
  /** 按社团身份切分的活跃度；未注册任何社团时为空数组。 */
  by_club: ClubActivity[];
  /** `max(last_login_at, last_api_use_at, last_oj_activity_at)`；从未活跃为 `null`。 */
  last_active_at: Timestamp | null;
  /** 最近一次成功登录时刻；从未登录为 `null`。 */
  last_login_at?: Timestamp | null;
  /** 最近一次携带凭证调用 API 的时刻；从未调用为 `null`。 */
  last_api_use_at?: Timestamp | null;
  /** 最近一次在任一 OJ 绑定上采集到新提交的时刻；从未采集到为 `null`。 */
  last_oj_activity_at: Timestamp | null;
  /** 活动度分档：≤90 天 `active`、≤365 天 `dormant`、其余 `inactive`。 */
  activity_state: 'active' | 'dormant' | 'inactive';
  /** 最近 30 天内有活跃记录的天数（按 UTC 日历日去重）。 */
  active_days_30d?: number;
  /** 最近 30 天内通过（AC）的去重题目数，跨 OJ 合并。 */
  solved_count_30d?: number;
  /** 最近 30 天内采集到的提交总数（含未通过）。 */
  submissions_30d?: number;
  /** 本对象所有派生值的计算时刻（客户端据此展示"数据截至时间"）。 */
  computed_at: Timestamp;
}

/* ----------------------------------------------------------------- 成员 */

/**
 * 成员信息视图：`Principal` 在"社团成员"视角下的**只读投影**，不是独立实体。
 * `member_id` 就是主体 `id`（没有 `mem_` 前缀），与账号视图共享同一 `revision`/`ETag`；
 * 成员名单专属字段仅 `clubs`/`activity`/`teams`/`oj_handles`，其余继承自主体。
 * 社团身份是一对多记录：成员可只注册海风社团软件部或 ACM/ICPC 学社其一，也可两个都注册。
 */
export interface Member extends Principal {
  /** 当前有效的社团身份；它决定该主体是否在成员名单里。 */
  /** 当前有效的社团身份；空数组表示当前不属于任何社团。 */
  clubs: ClubCode[];
  /** 派生活动度视图。 */
  activity: MemberActivity;
  /** 当前赛季所属队伍引用（同一赛季至多一支）。 */
  teams: TeamRef[];
  /** 绑定的 OJ 账号轻量引用。 */
  oj_handles: OjHandleRef[];
}

/** 成员的分页结果。 */
export type PagedMember = Paged<Member>;

/* --------------------------------------------------------------- 成员写入 */

/** 管理员修改成员档案的请求体；全部字段可选，只覆盖出现的字段。 */
export interface UpdateMemberRequest {
  display_name?: string;
  /** 社团档案的合并式更新（`grade` 为只读派生字段，提交值被忽略）。 */
  profile?: PrincipalProfileInput;
}

/** 全量替换成员标签集合（空数组表示清空全部标签，含 `member`）。 */
export interface SetMemberLabelsRequest {
  labels: Label[];
}

/** 全量替换成员 scope 集合（空数组表示回收全部权限）。 */
export interface SetMemberScopesRequest {
  scopes: Scope[];
}

/* --------------------------------------------------------------------- 队伍 */

/** 队伍成员条目，用于直接渲染队伍表。 */
export interface TeamMember {
  principal: PrincipalRef;
  /** 队内角色；`captain` 至多一名。 */
  role: 'member' | 'captain' | 'coach';
  joined_at: Timestamp;
  /** 冗余学号，取自该成员档案。 */
  /** 被脱敏的字段名；见 `PrincipalProfile.masked_fields`。 */
  masked_fields?: string[];
  student_id?: string;
  /** 冗余入学年份，取自该成员档案。 */
  enrollment_year?: number;
}

/** 队伍/分组；同一 `season` 内 `name` 唯一。 */
export interface Team {
  id: Id;
  name: string;
  short_name?: string;
  /** 赛季标识，形如 `2024-2025`。 */
  season?: string;
  description?: string;
  /** 队长主体 id；未指定时为 `null`。 */
  captain_id?: Id | null;
  /** 外部系统的队伍号；未绑定为 `null`。 */
  external_id?: string | null;
  labels?: Label[];
  /** 成员主体 id 列表（有序，与 `members` 顺序一致）。 */
  member_ids: Id[];
  /** 成员人数，恒等于 `member_ids` 的长度（只读派生）。 */
  member_count: number;
  /** 内联成员条目，仅单资源视图返回。 */
  members?: TeamMember[];
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
}

/** 队伍的分页结果。 */
export type PagedTeam = Paged<Team>;

/** 新建队伍；成员名单需随后用 `PUT /teams/{team_id}/members` 设置。 */
export interface CreateTeamRequest {
  name: string;
  short_name?: string;
  season?: string;
  description?: string;
  labels?: Label[];
  external_id?: string | null;
}

/** 修改队伍元信息；全部字段可选，不含成员名单。 */
export interface UpdateTeamRequest {
  name?: string;
  short_name?: string;
  season?: string;
  description?: string;
  labels?: Label[];
  /** 显式传 `null` 表示解绑外部队伍号。 */
  external_id?: string | null;
}

/** 全量替换队伍成员名单（替换语义，不是增量）。 */
export interface SetTeamMembersRequest {
  /** 替换后的完整成员列表；空数组表示清空名单。 */
  members: Array<{
    /** 成员主体 id，必须在成员名单中。 */
    principal_id: Id;
    /** 队内角色，默认 `member`；`captain` 至多一名。 */
    role?: 'member' | 'captain' | 'coach';
  }>;
}

/* ----------------------------------------------------------------- 批量导入 */

/** 一行导入数据；`username` 是行的身份键。 */
export interface ImportMemberRow {
  username: string;
  display_name?: string;
  student_id?: string;
  enrollment_year?: number;
  major?: string;
  email?: string;
  phone?: string;
  qq?: string;
  clubs?: ClubCode[];
  labels?: Label[];
  scopes?: Scope[];
  oj_handles?: Array<{ judge: Judge; handle: string }>;
}

/** 批量导入成员；整批单事务，行级失败不阻断其它行（上限 1000 行）。 */
export interface ImportRequest {
  /** `csv` 必须提供 `csv`，`json` 必须提供 `members`；不匹配返回 422。 */
  format: 'csv' | 'json';
  /** CSV 文本（UTF-8，首行列头）。仅 `format=csv` 时允许。 */
  csv?: string;
  /** 结构化成员行。仅 `format=json` 时允许。 */
  members?: ImportMemberRow[];
  /** 冲突（`username`/`student_id` 已存在）处理策略，默认 `skip`。 */
  on_conflict?: 'skip' | 'update' | 'fail';
  /** 为 `true` 时只校验与计数，不落库（默认 `false`）。 */
  dry_run?: boolean;
}

/** 单行的处理结果。 */
export interface ImportRowResult {
  /** CSV 为物理行号（首个数据行为 2）；JSON 为下标 + 1。 */
  row_number: number;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  /** 该行对应的主体 id；`skipped` 为已存在主体 id，失败为 `null`。 */
  principal_id?: Id | null;
  errors: ValidationError[];
}

/** 导入结果；`created + updated + skipped + failed` 恒等于提交行数。 */
export interface ImportResult {
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** 逐行结果，顺序与输入行一致。 */
  rows: ImportRowResult[];
}

/* ----------------------------------------------------------------- 成员名单导出 */

/** 导出的筛选条件；`labels` 为 AND，`enrollment_years` 为 OR。 */
export interface RosterExportFilters {
  q?: string;
  labels?: Label[];
  enrollment_year?: number;
  enrollment_years?: number[];
  major?: string;
  team_id?: Id;
  status?: AccountStatus;
}

/** 发起成员名单导出的参数；默认排除超过 `P365D` 未活跃的成员。 */
/** 整体替换成员的社团注册记录；未出现的社团会被置为 `alumni` 而不是删除。 */
export interface SetMemberClubsRequest {
  memberships: ClubMembership[];
}

/** 某个社团在一次导出中的计数。 */
export interface RosterExportClubCount {
  club: ClubCode;
  /** 进入产物的该社团成员数。 */
  included: number;
  /** 因在该社团在册期内没有活跃而被排除的成员数。 */
  excluded_inactive: number;
}

export interface RosterExportRequest {
  format?: 'csv' | 'json';
  /**
   * 只导出在这些社团注册的成员；省略时导出两个社团的合并名单，
   * 同一人只出现一次并在 `clubs` 列列出其社团。
   */
  clubs?: ClubCode[];
  include_inactive?: boolean;
  /** 活跃度窗口；指定 `clubs` 时按社团在册期计算。 */
  active_within?: Duration;
  /** 产出的列（CSV 列头 / JSON 字段名）；未知列名返回 422。 */
  columns?: string[];
  filters?: RosterExportFilters;
  include_oj_handles?: boolean;
  include_activity?: boolean;
}

/** 成员名单导出产物；状态机 `queued → running → (succeeded | failed)`，清理后 `expired`。 */
export interface RosterExport {
  id: Id;
  /** 与共享的 JobState 一致：任务被取消时为 `cancelled`。 */
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  format: 'csv' | 'json';
  include_inactive: boolean;
  active_within: Duration;
  /** 本次导出限定的社团；未限定时为空数组。 */
  clubs?: ClubCode[];
  /** 按社团拆分的计数，便于分别核对两个社团的名单。 */
  club_counts?: RosterExportClubCount[];
  row_count?: number | null;
  /** 因在 `active_within` 窗口内没有活跃而被自动排除的人数。 */
  excluded_inactive_count?: number | null;
  size_bytes?: number | null;
  /** 短时有效的相对 URI；过期或产物被清理后为 `null`。 */
  download_url?: string | null;
  download_expires_at?: Timestamp | null;
  created_by?: PrincipalRef | null;
  created_at: Timestamp;
  completed_at?: Timestamp | null;
  error?: Problem | null;
  filters?: RosterExportFilters;
  columns?: string[];
}

/** 成员名单导出记录的分页结果（按 `created_at` 倒序）。 */
export type PagedRosterExport = Paged<RosterExport>;
