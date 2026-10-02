/**
 * 队伍资源模块：`/teams` 系列端点的 Typed REST 封装。
 */

import { readJson, writeJson, writeWithQueue } from './helpers.js';
import type { ReadOptions, ResourceContext, WriteOptions, WriteOutcome } from './helpers.js';
import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Id, Label, SortOrder, Timestamp } from '../types/common.js';
import type { CreateTeamRequest, PagedTeam, SetTeamMembersRequest, Team, UpdateTeamRequest } from '../types/roster.js';

/** `list` 的查询参数；与 `GET /teams` 的 query 参数一一对应。 */
type ListTeamsParams = {
  /** 赛季精确匹配，形如 `2024-2025`；省略时跨全部赛季。 */
  season?: string;
  q?: string;
  member_id?: Id;
  /** 可重复；多个标签之间为 AND。 */
  label?: Label[];
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'name' | 'created_at' | 'updated_at';
  order?: SortOrder;
};

/** `TEAMS_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const TEAMS_OPERATIONS = {
  listTeams: { method: 'GET', path: '/teams' },
  createTeam: { method: 'POST', path: '/teams' },
  getTeam: { method: 'GET', path: '/teams/{team_id}' },
  updateTeam: { method: 'PATCH', path: '/teams/{team_id}' },
  deleteTeam: { method: 'DELETE', path: '/teams/{team_id}' },
  setTeamMembers: { method: 'PUT', path: '/teams/{team_id}/members' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class TeamsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 列出队伍（偏移分页；列表不含内联 `members`，仅有 `member_ids`/`member_count`）。
   * 需要 `team:read`；只读幂等，可缓存，可结合 `updated_since` 做增量同步。
   * 未知 `sort`/`season` 格式或非法 `updated_since` → 400；`member_id` 不存在返回空列表。
   */
  list(params: ListTeamsParams = {}, options?: ReadOptions): Promise<PagedTeam> {
    return readJson<PagedTeam>(this.ctx, {
      path: '/teams',
      query: params,
      resource: 'teams',
      options,
    });
  }

  /**
   * 新建队伍（201；成员名单需随后调用 `setMembers` 设置）。
   * 需要 `team:manage`；必须携带幂等键，重放返回首次创建的队伍。
   * `name`/`season` 非法 → 422；同赛季重名或 `external_id` 被占用 → 409。
   */
  create(body: CreateTeamRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Team>>;
  create(body: CreateTeamRequest, options?: WriteOptions): Promise<Team>;
  async create(body: CreateTeamRequest, options?: WriteOptions): Promise<Team | WriteOutcome<Team>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Team>(this.ctx, { method: 'POST', path: '/teams', body, options });
    }
    return writeJson<Team>(this.ctx, { method: 'POST', path: '/teams', body, options });
  }

  /**
   * 获取队伍详情（`member_ids` 与内联 `members` 顺序一致、长度相等）。
   * 需要 `team:read`；只读幂等，返回 `ETag`，`If-None-Match` 命中为 304。
   * 队伍不存在或不可见 → 404。
   */
  get(teamId: string, options?: ReadOptions): Promise<Team> {
    const path = substitutePath('/teams/{team_id}', { team_id: teamId });
    return readJson<Team>(this.ctx, { path, resource: 'teams', id: teamId, options });
  }

  /**
   * 合并式修改队伍元信息（不修改成员名单，成员替换走 `setMembers`）。
   * 需要 `team:manage`；必须携带幂等键，可用 `If-Match` 做乐观并发控制。
   * 空请求体 → 422；不存在 → 404；同赛季重名 → 409；`If-Match` 不匹配 → 412。
   */
  update(
    teamId: string,
    body: UpdateTeamRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Team>>;
  update(teamId: string, body: UpdateTeamRequest, options?: WriteOptions): Promise<Team>;
  async update(teamId: string, body: UpdateTeamRequest, options?: WriteOptions): Promise<Team | WriteOutcome<Team>> {
    const path = substitutePath('/teams/{team_id}', { team_id: teamId });
    if (options?.queueIfOffline) return writeWithQueue<Team>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Team>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 删除队伍（204，软删除；不删除成员主体；重复删除同样返回 204）。
   * 需要 `team:manage`；必须携带幂等键，删除幂等可安全重试。
   * 存在 `pending`/`approved` 名额认领 → 409。
   */
  remove(teamId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<void>>;
  remove(teamId: string, options?: WriteOptions): Promise<void>;
  async remove(teamId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/teams/{team_id}', { team_id: teamId });
    if (options?.queueIfOffline) return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }

  /**
   * 全量替换队伍成员名单（替换语义；未出现的成员被移出，`joined_at` 保留/重置规则见契约）。
   * 需要 `team:manage`；必须携带幂等键，可用 `If-Match` 并发控制，冲突时整个替换失败。
   * 成员不是成员或已在同赛季另一队 → 409；人数超上限或重复 `captain` → 422；`If-Match` 不匹配 → 412。
   */
  setMembers(
    teamId: string,
    body: SetTeamMembersRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Team>>;
  setMembers(teamId: string, body: SetTeamMembersRequest, options?: WriteOptions): Promise<Team>;
  async setMembers(
    teamId: string,
    body: SetTeamMembersRequest,
    options?: WriteOptions,
  ): Promise<Team | WriteOutcome<Team>> {
    const path = substitutePath('/teams/{team_id}/members', { team_id: teamId });
    if (options?.queueIfOffline) return writeWithQueue<Team>(this.ctx, { method: 'PUT', path, body, options });
    return writeJson<Team>(this.ctx, { method: 'PUT', path, body, options });
  }
}
