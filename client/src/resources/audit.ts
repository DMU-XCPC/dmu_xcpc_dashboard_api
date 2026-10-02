/**
 * 审计日志资源（契约 `paths/audit.yaml`）。
 *
 * 审计写入是同步的（业务响应返回时已落库），因此紧接着查询一定能读到；
 * 结果为游标分页，保证持续写入期间不跳过、不重复。
 */

import type { HttpMethod } from '../http/transport.js';
import type { Timestamp } from '../types/common.js';
import type { ActorKind, AuditOutcome, PagedAuditLog } from '../types/ops.js';
import { readJson, type ReadOptions, type ResourceContext } from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const AUDIT_OPERATIONS = {
  listAuditLogs: { method: 'GET', path: '/audit-logs' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class AuditResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 游标分页查询审计日志（按 `at` 降序）；需要 `audit:read`，普通成员返回 403。
   * 幂等只读，强一致（写入后立即可见），查询本身也会被审计（`action: audit.read`）。
   * 400 参数非法；401 未认证；403 insufficient_scope；422 `to` 早于 `from`；429 限流。
   */
  list(
    params: {
      actor_id?: string;
      actor_kind?: ActorKind;
      action?: string;
      resource?: string;
      resource_id?: string;
      outcome?: AuditOutcome;
      request_id?: string;
      from?: Timestamp;
      to?: Timestamp;
      cursor?: string;
      limit?: number;
    } = {},
    options?: ReadOptions,
  ): Promise<PagedAuditLog> {
    return readJson<PagedAuditLog>(this.ctx, { path: '/audit-logs', query: params, resource: 'audit-logs', options });
  }
}
