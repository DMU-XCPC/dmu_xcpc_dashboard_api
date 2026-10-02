/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/quotas.yaml` 对应的名额池与认领类型。
 *
 * 字段名与契约一致（snake_case）；`over_quota` 在契约中是派生字段，
 * 这里放宽为 `boolean` 以便客户端构造视图对象，语义见各自 JSDoc。
 *
 * 契约里**没有**表示"是否免审核"的字段：本系统的认领一律需要管理员审核。
 */

import type { ClubCode, DateString, Id, Paged, PrincipalRef, TeamRef, Timestamp, Label } from './common.js';

/* ------------------------------------------------------------------ 比赛 */

/** 竞赛类型；只用于展示与筛选，不影响名额与审核规则。 */
export type ContestKind =
  | 'regional'
  | 'provincial'
  | 'invitational'
  | 'ecfinal'
  | 'world_final'
  | 'online'
  | 'other';

/** 比赛标识（名额池自带的可读描述，不要求存在独立资源）。 */
export interface ContestRef {
  name: string;
  kind: ContestKind;
  /** 赛季，形如 `2024-2025`。 */
  season: string;
  external_id?: string | null;
  /** 比赛举办日期；未定时为 `null`。 */
  held_on?: DateString | null;
  location?: string | null;
  url?: string | null;
}

/* ---------------------------------------------------------------- 名额池 */

/** 名额池状态机：`draft → open → closed → finalized → archived`（不允许跳级或回退）。 */
export type QuotaStatus = 'draft' | 'open' | 'closed' | 'finalized' | 'archived';

/** 认领资格过滤（可选）；字段之间是与关系，不满足返回 `403 forbidden`。 */
export interface QuotaEligibility {
  /** 白名单队伍；非空时只允许这些队伍认领。 */
  team_ids?: Id[];
  /** 参赛成员必须具备的标签。 */
  labels?: Label[];
  /** 参赛成员必须属于这些社团之一；省略表示不限社团。 */
  clubs?: ClubCode[];
  /** 允许的入学年份集合。 */
  enrollment_years?: number[];
  min_team_size?: number;
  /** 必须 ≥ `min_team_size`，否则创建/更新返回 `422`。 */
  max_team_size?: number;
}

/** 认领窗口（闭区间）；`closes_at` 必须晚于 `opens_at`。 */
export interface QuotaClaimWindow {
  opens_at: Timestamp;
  closes_at: Timestamp;
}

/** 认领计数快照；与同一响应中的状态来自同一事务视图。 */
export interface QuotaCounts {
  /** 等待管理员审核的认领数。 */
  claims_pending: number;
  /** 已批准并占用名额的认领数。 */
  claims_approved: number;
  claims_rejected: number;
  claims_withdrawn: number;
  /** `max(quota_total - claims_approved, 0)`。 */
  remaining: number;
}

/** 名额池资源；认领必须经管理员批准才占用名额。 */
export interface Quota {
  id: Id;
  title: string;
  contest: ContestRef;
  /** 名额总数；降低时不得低于已批准数，否则 `409 quota_exceeded`。 */
  quota_total: number;
  /** 同一队伍在本池的认领上限（默认 2）。 */
  max_claims_per_team: number;
  status: QuotaStatus;
  counts: QuotaCounts;
  /** 认领窗口；`null` 表示未显式设置，`open` 时按默认 14 天补齐。 */
  claim_window?: QuotaClaimWindow | null;
  /** 资格过滤；`null` 表示不限。 */
  eligibility?: QuotaEligibility | null;
  /** 面向成员的说明；`finalized` 后仍可修改。 */
  notes?: string | null;
  created_by?: PrincipalRef | null;
  opened_at?: Timestamp | null;
  closed_at?: Timestamp | null;
  finalized_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
}

/** 新建名额池；服务端强制 `status=draft`、`counts` 全零，认领一律需审核。 */
export interface CreateQuotaRequest {
  title: string;
  contest: ContestRef;
  quota_total: number;
  max_claims_per_team?: number;
  claim_window?: QuotaClaimWindow | null;
  eligibility?: QuotaEligibility | null;
  notes?: string | null;
}

/** 部分更新名额池；`minProperties: 1`。 */
export interface UpdateQuotaRequest {
  title?: string;
  contest?: ContestRef;
  quota_total?: number;
  max_claims_per_team?: number;
  claim_window?: QuotaClaimWindow | null;
  eligibility?: QuotaEligibility | null;
  notes?: string | null;
}

/* ------------------------------------------------------------------ 认领 */

/** 认领状态机；`pending` 不占用名额，只有 `approved` 才占用。 */
export type QuotaClaimStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'released';

/** 认领成员角色；不改变名额占用数。 */
export type QuotaClaimMemberRole = 'member' | 'reserve' | 'coach';

/** 认领成员快照；`display_name`/`student_id` 是提交时刻的成员快照。 */
export interface QuotaClaimMember {
  principal: PrincipalRef;
  role: QuotaClaimMemberRole;
  display_name?: string;
  student_id?: string | null;
  /** 该成员是否已确认参加（不阻止认领，仅作提示）。 */
  confirmed: boolean;
}

/** 队伍对某名额池的一次认领。 */
/** 管理员释放已批准认领时的可选说明（写进审计）。 */
export interface ReleaseQuotaClaimRequest {
  reason?: string;
}

export interface QuotaClaim {
  id: Id;
  quota_id: Id;
  team: TeamRef;
  members: QuotaClaimMember[];
  status: QuotaClaimStatus;
  /** 数值越小越优先（默认 100）。 */
  priority?: number;
  /** 候补顺位；`null` 表示不在候补队列。 */
  waitlist_position?: number | null;
  submitted_by: PrincipalRef;
  submitted_at: Timestamp;
  decided_by?: PrincipalRef | null;
  decided_at?: Timestamp | null;
  /** 审核意见（拒绝时必填）。 */
  decision_note?: string | null;
  expires_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
}

/** 认领的轻量引用（用于名额池汇总，避免内联完整成员列表）。 */
export interface QuotaClaimRef {
  id: Id;
  team: TeamRef;
  status: QuotaClaimStatus;
  submitted_at: Timestamp;
  /** 数值越小越优先。 */
  priority: number;
}

/** 提交认领；成功后状态恒为 `pending`。 */
export interface CreateQuotaClaimRequest {
  team_id: Id;
  /** 参赛成员（1..8，含替补与教练）；展示字段由服务端从成员快照补全。 */
  members: { principal_id: Id; role?: QuotaClaimMemberRole }[];
  priority?: number;
  note?: string | null;
}

/** 批准认领；批准后立即占用一个名额且不可撤销。 */
export interface ApproveQuotaClaimRequest {
  note?: string | null;
}

/** 拒绝认领；理由必填并进入审计日志。 */
export interface RejectQuotaClaimRequest {
  reason: string;
}

/** 名额池汇总视图；所有计数与列表来自同一事务快照。 */
export interface QuotaSummary {
  quota_id: Id;
  quota_total: number;
  counts: QuotaCounts;
  /** 已批准认领，按 `(priority, submitted_at)` 升序。 */
  approved_claims: QuotaClaimRef[];
  /** 候补队列，按 `waitlist_position` 升序。 */
  waitlist: QuotaClaimRef[];
  /** 契约里是必填的 `const false`，仅用于前端一致性自检。 */
  over_quota: false;
  generated_at: Timestamp;
}

/** 名额池的偏移分页结果。 */
export type PagedQuota = Paged<Quota>;

/** 认领的偏移分页结果。 */
export type PagedQuotaClaim = Paged<QuotaClaim>;
