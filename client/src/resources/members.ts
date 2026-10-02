/**
 * **成员名单模块**（`/members`，以"人"为中心）：查社团名单、按年级/专业/队伍/是否成员筛人、
 * 看单个成员的档案与活跃度、批量导入、改档案与标签/scope。
 *
 * 典型用法：开学导名单、出填表清单、赛季组队、看谁最近没在训练。
 * **创建账号、停用、签发凭证、配权限请用 `AccountsResource`**——那是同一主体的另一视角
 * （同一个 id 与 ETag，见 `doc/api/README.md` §3.1）。
 */

import { readJson, writeJson, writeWithQueue } from './helpers.js';
import type { ReadOptions, ResourceContext, WriteOptions, WriteOutcome } from './helpers.js';
import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { ClubCode } from '../types/common.js';
import type { AccountStatus, Duration, SortOrder, Timestamp } from '../types/common.js';
import type {
  ImportRequest,
  ImportResult,
  Member,
  MemberActivity,
  PagedMember,
  SetMemberClubsRequest,
  SetMemberLabelsRequest,
  SetMemberScopesRequest,
  UpdateMemberRequest,
} from '../types/roster.js';

/** `list` 的查询参数；与 `GET /members` 的 query 参数一一对应。 */
type ListMembersParams = {
  q?: string;
  /** 可重复；多个标签之间为 AND。 */
  label?: string[];
  team_id?: string;
  enrollment_year?: number;
  major?: string;
  /** 按社团过滤；`club_match` 决定是命中任一、全部命中还是全部排除。 */
  club?: ClubCode[];
  club_match?: 'any' | 'all' | 'none';
  /** 默认 false；true 时连不在任何社团的主体也返回。 */
  include_non_members?: boolean;
  status?: AccountStatus;
  activity_state?: 'active' | 'dormant' | 'inactive';
  /** 只返回 `updated_at` 严格晚于该时刻的成员（增量同步）。 */
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'display_name' | 'enrollment_year' | 'last_active_at' | 'created_at' | 'updated_at';
  order?: SortOrder;
};

/** `activity` 的查询参数。 */
type MemberActivityParams = {
  /** 统计回看窗口（默认 `P90D`，最大 `P730D`）。 */
  window?: Duration;
};

/** `MEMBERS_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const MEMBERS_OPERATIONS = {
  listMembers: { method: 'GET', path: '/members' },
  importMembers: { method: 'POST', path: '/members/import' },
  getMember: { method: 'GET', path: '/members/{member_id}' },
  updateMemberProfile: { method: 'PATCH', path: '/members/{member_id}' },
  setMemberLabels: { method: 'PUT', path: '/members/{member_id}/labels' },
  setMemberScopes: { method: 'PUT', path: '/members/{member_id}/scopes' },
  setMemberClubs: { method: 'PUT', path: '/members/{member_id}/clubs' },
  getMemberActivity: { method: 'GET', path: '/members/{member_id}/activity' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class MembersResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 列出成员（偏移分页；`label` 之间为 AND，`activity_state` 按派生活动度过滤）。
   * 需要 `member:read`；只读幂等，可缓存，可结合 `updated_since` 做增量刷新。
   * 未知 `sort`/`status`/`activity_state` 或非法 `updated_since` → 400；`team_id` 不存在返回空列表。
   */
  list(params: ListMembersParams = {}, options?: ReadOptions): Promise<PagedMember> {
    return readJson<PagedMember>(this.ctx, {
      path: '/members',
      query: params,
      resource: 'members',
      options,
    });
  }

  /**
   * 批量导入成员（整批单事务；行级失败不阻断其它行；单批上限 1000 行）。
   * 需要 `member:manage`（含 PII）；必须携带幂等键，重放返回首次结果。
   * `format` 与载荷不匹配/列头缺失 → 422；`on_conflict=fail` 且冲突 → 409；超过行数或字节上限 → 413。
   */
  import(body: ImportRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<ImportResult>>;
  import(body: ImportRequest, options?: WriteOptions): Promise<ImportResult>;
  async import(body: ImportRequest, options?: WriteOptions): Promise<ImportResult | WriteOutcome<ImportResult>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<ImportResult>(this.ctx, { method: 'POST', path: '/members/import', body, options });
    }
    return writeJson<ImportResult>(this.ctx, { method: 'POST', path: '/members/import', body, options });
  }

  /**
   * 获取成员详情（主体 + 档案 + 标签 + scope + 队伍引用 + OJ 绑定 + 活动度）。
   * 需要 `member:read`；只读幂等，返回 `ETag`，`If-None-Match` 命中为 304。
   * 成员不存在或不可见 → 404；`activity` 为最终一致数据（滞后上界 15 分钟）。
   */
  get(memberId: string, options?: ReadOptions): Promise<Member> {
    const path = substitutePath('/members/{member_id}', { member_id: memberId });
    return readJson<Member>(this.ctx, { path, resource: 'members', id: memberId, options });
  }

  /**
   * 合并式修改成员档案（只覆盖出现的字段；标签与 scope 不在此接口）。
   * 需要 `member:manage`；必须携带幂等键，可用 `If-Match` 做乐观并发控制。
   * 空请求体或字段非法 → 422；学号已被占用 → 409；`If-Match` 不匹配 → 412。
   */
  update(
    memberId: string,
    body: UpdateMemberRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Member>>;
  update(memberId: string, body: UpdateMemberRequest, options?: WriteOptions): Promise<Member>;
  async update(
    memberId: string,
    body: UpdateMemberRequest,
    options?: WriteOptions,
  ): Promise<Member | WriteOutcome<Member>> {
    const path = substitutePath('/members/{member_id}', { member_id: memberId });
    if (options?.queueIfOffline) return writeWithQueue<Member>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Member>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 全量替换成员标签。标签与成员资格无关，不会改变 `clubs`。
   * 需要 `member:assign`；必须携带幂等键，可用 `If-Match` 并发控制。
   * 标签格式非法 → 422；成员不存在 → 404；`If-Match` 不匹配 → 412。
   */
  setLabels(
    memberId: string,
    body: SetMemberLabelsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Member>>;
  setLabels(memberId: string, body: SetMemberLabelsRequest, options?: WriteOptions): Promise<Member>;
  async setLabels(
    memberId: string,
    body: SetMemberLabelsRequest,
    options?: WriteOptions,
  ): Promise<Member | WriteOutcome<Member>> {
    const path = substitutePath('/members/{member_id}/labels', { member_id: memberId });
    if (options?.queueIfOffline) return writeWithQueue<Member>(this.ctx, { method: 'PUT', path, body, options });
    return writeJson<Member>(this.ctx, { method: 'PUT', path, body, options });
  }

  /**
   * 全量替换成员 scope；不得授予调用者自身不持有的 scope（不做部分授予）。
   * 需要 `member:assign`；必须携带幂等键，可用 `If-Match` 并发控制。
   * 未知 scope → 422；成员不存在 → 404；越权授予 → 403；`If-Match` 不匹配 → 412。
   */
  setScopes(
    memberId: string,
    body: SetMemberScopesRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Member>>;
  setScopes(memberId: string, body: SetMemberScopesRequest, options?: WriteOptions): Promise<Member>;
  async setScopes(
    memberId: string,
    body: SetMemberScopesRequest,
    options?: WriteOptions,
  ): Promise<Member | WriteOutcome<Member>> {
    const path = substitutePath('/members/{member_id}/scopes', { member_id: memberId });
    if (options?.queueIfOffline) return writeWithQueue<Member>(this.ctx, { method: 'PUT', path, body, options });
    return writeJson<Member>(this.ctx, { method: 'PUT', path, body, options });
  }

  /**
   * 替换成员的社团身份（整体替换，不是增量）：请求里的 `memberships` 即替换后的完整集合，
   * 未出现的社团会被置为 `alumni` 并保留注册日期。集训队挂靠海风社团软件部与 ACM/ICPC 学社
   * 两个社团，成员可只注册其一或两个都注册。
   * 需要 `member:manage`；可 `queueIfOffline`。传空数组表示两个社团都退出。
   * 422 表示社团取值非法、日期非法或同一社团重复；412 表示并发冲突；404 表示成员不存在。
   */
  setClubs(
    memberId: string,
    body: SetMemberClubsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Member>>;
  setClubs(memberId: string, body: SetMemberClubsRequest, options?: WriteOptions): Promise<Member>;
  async setClubs(
    memberId: string,
    body: SetMemberClubsRequest,
    options?: WriteOptions,
  ): Promise<Member | WriteOutcome<Member>> {
    const path = substitutePath('/members/{member_id}/clubs', { member_id: memberId });
    if (options?.queueIfOffline) return writeWithQueue<Member>(this.ctx, { method: 'PUT', path, body, options });
    return writeJson<Member>(this.ctx, { method: 'PUT', path, body, options });
  }


  /**
   * 获取成员活动度派生视图（`window` 只影响三个 `*_30d` 统计，默认 `P90D`、上限 `P730D`）。
   * 需要 `member:read`；只读幂等，可缓存（以 `computed_at` 为准，滞后上界 15 分钟）。
   * `window` 非法或超过 `P730D` → 400；成员不存在或不可见 → 404。
   */
  activity(memberId: string, params: MemberActivityParams = {}, options?: ReadOptions): Promise<MemberActivity> {
    const path = substitutePath('/members/{member_id}/activity', { member_id: memberId });
    return readJson<MemberActivity>(this.ctx, {
      path,
      query: params,
      resource: 'member-activity',
      id: memberId,
      options,
    });
  }
}
