/**
 * 名额池与认领资源（契约 `paths/quotas.yaml`）。
 *
 * 认领需要管理员批准才占用名额；`createClaim` 是弱网场景的关键写操作，
 * 支持 `queueIfOffline`（离线先入 outbox，联网后用同一幂等键重放）。
 */

import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { SortOrder, Timestamp } from '../types/common.js';
import type {
  ApproveQuotaClaimRequest,
  ContestKind,
  CreateQuotaClaimRequest,
  CreateQuotaRequest,
  PagedQuotaClaim,
  PagedQuota,
  RejectQuotaClaimRequest,
  QuotaClaim,
  ReleaseQuotaClaimRequest,
  QuotaClaimStatus,
  Quota,
  QuotaStatus,
  QuotaSummary,
  UpdateQuotaRequest,
} from '../types/quotas.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const QUOTAS_OPERATIONS = {
  listQuotas: { method: 'GET', path: '/quotas' },
  createQuota: { method: 'POST', path: '/quotas' },
  getQuota: { method: 'GET', path: '/quotas/{quota_id}' },
  updateQuota: { method: 'PATCH', path: '/quotas/{quota_id}' },
  deleteQuota: { method: 'DELETE', path: '/quotas/{quota_id}' },
  openQuota: { method: 'POST', path: '/quotas/{quota_id}/open' },
  closeQuota: { method: 'POST', path: '/quotas/{quota_id}/close' },
  finalizeQuota: { method: 'POST', path: '/quotas/{quota_id}/finalize' },
  getQuotaSummary: { method: 'GET', path: '/quotas/{quota_id}/summary' },
  listQuotaClaims: { method: 'GET', path: '/quotas/{quota_id}/claims' },
  createQuotaClaim: { method: 'POST', path: '/quotas/{quota_id}/claims' },
  getQuotaClaim: { method: 'GET', path: '/quotas/{quota_id}/claims/{claim_id}' },
  approveQuotaClaim: { method: 'POST', path: '/quotas/{quota_id}/claims/{claim_id}/approve' },
  rejectQuotaClaim: { method: 'POST', path: '/quotas/{quota_id}/claims/{claim_id}/reject' },
  withdrawQuotaClaim: { method: 'POST', path: '/quotas/{quota_id}/claims/{claim_id}/withdraw' },
  releaseQuotaClaim: { method: 'POST', path: '/quotas/{quota_id}/claims/{claim_id}/release' },
  confirmQuotaClaimMember: { method: 'POST', path: '/quotas/{quota_id}/claims/{claim_id}/confirm' },
  archiveQuota: { method: 'POST', path: '/quotas/{quota_id}/archive' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class QuotasResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页检索名额池；需要 `quota:read`（含机器人）。幂等只读，强一致且可缓存。
   * `updated_since` + `sort=created_at&order=asc` 用于增量追赶（此时不可复用 `ETag`）。
   * 400 过滤值非法；401 未认证；403 缺 scope；429 限流。
   */
  list(
    params: {
      status?: QuotaStatus;
      season?: string;
      kind?: ContestKind;
      updated_since?: Timestamp;
      page?: number;
      size?: number;
      sort?: 'created_at' | 'held_on' | 'quota_total' | 'updated_at';
      order?: SortOrder;
    } = {},
    options?: ReadOptions,
  ): Promise<PagedQuota> {
    return readJson<PagedQuota>(this.ctx, { path: '/quotas', query: params, resource: 'quotas', options });
  }

  /**
   * 新建名额池（初始状态恒为 `draft`）；需要 `quota:manage`。
   * 幂等写：同一 `Idempotency-Key` 重放返回首次创建的资源与相同 `Location`。
   * 403 缺 scope；409 `season + name + kind` 重复；422 参数非法；429 限流。
   */
  create(body: CreateQuotaRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Quota>>;
  create(body: CreateQuotaRequest, options?: WriteOptions): Promise<Quota>;
  async create(body: CreateQuotaRequest, options?: WriteOptions): Promise<Quota | WriteOutcome<Quota>> {
    if (options?.queueIfOffline) return writeWithQueue<Quota>(this.ctx, { method: 'POST', path: '/quotas', body, options });
    return writeJson<Quota>(this.ctx, { method: 'POST', path: '/quotas', body, options });
  }

  /**
   * 获取名额池及其计数快照；需要 `quota:read`。幂等只读，带强 `ETag`（可 304）。
   * 404 不存在或不可见；401 未认证；403 缺 scope；429 限流。
   */
  get(quotaId: string, options?: ReadOptions): Promise<Quota> {
    const path = substitutePath('/quotas/{quota_id}', { quota_id: quotaId });
    return readJson<Quota>(this.ctx, { path, resource: 'quotas', id: quotaId, options });
  }

  /**
   * 修改名额池（合并式部分更新）；需要 `quota:manage`。
   * 幂等写：`If-Match` 不匹配返回 412 version_conflict，建议始终携带。
   * 404 不存在；409 已定案仅可改 notes、或配额低于已批准数；422 跨字段非法。
   */
  update(quotaId: string, body: UpdateQuotaRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Quota>>;
  update(quotaId: string, body: UpdateQuotaRequest, options?: WriteOptions): Promise<Quota>;
  async update(quotaId: string, body: UpdateQuotaRequest, options?: WriteOptions): Promise<Quota | WriteOutcome<Quota>> {
    const path = substitutePath('/quotas/{quota_id}', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<Quota>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Quota>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 删除名额池（级联删除未终结认领，不可撤销）；需要 `quota:manage`。
   * 幂等：对已删除的池重复调用同样返回 204。403 缺 scope；404 不存在；409 仍有已批准认领。
   */
  remove(quotaId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<void>>;
  remove(quotaId: string, options?: WriteOptions): Promise<void>;
  async remove(quotaId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/quotas/{quota_id}', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }

  /**
   * 开启名额池（`draft → open`，未设置窗口时按 `now` 起 14 天补齐）；需要 `quota:manage`。
   * 幂等：重复对 `open` 的池调用返回当前资源且不改变 `opened_at`。
   * 404 不存在；409 已 `closed`/`finalized`/`archived`（不支持重新开启）；403 缺 scope。
   */
  open(quotaId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Quota>>;
  open(quotaId: string, options?: WriteOptions): Promise<Quota>;
  async open(quotaId: string, options?: WriteOptions): Promise<Quota | WriteOutcome<Quota>> {
    const path = substitutePath('/quotas/{quota_id}/open', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<Quota>(this.ctx, { method: 'POST', path, options });
    return writeJson<Quota>(this.ctx, { method: 'POST', path, options });
  }

  /**
   * 关闭认领窗口（`open → closed`）：不再接受新认领，但 `pending` 仍可审核。
   * 需要 `quota:manage`；重复对 `closed` 的池调用幂等返回当前资源。
   * 404 不存在；409 `draft` 池为 quota_not_open、`finalized`/`archived` 为 quota_finalized。
   */
  close(quotaId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Quota>>;
  close(quotaId: string, options?: WriteOptions): Promise<Quota>;
  async close(quotaId: string, options?: WriteOptions): Promise<Quota | WriteOutcome<Quota>> {
    const path = substitutePath('/quotas/{quota_id}/close', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<Quota>(this.ctx, { method: 'POST', path, options });
    return writeJson<Quota>(this.ctx, { method: 'POST', path, options });
  }

  /**
   * 定案名额池（`closed → finalized`，不可撤销）；需要 `quota:manage`。
   * 幂等：重复对 `finalized` 的池调用返回当前资源。
   * 404 不存在；409 仍有 `pending` 认领（detail 列出 claim id）或池为 `draft`；403 缺 scope。
   */
  finalize(quotaId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Quota>>;
  finalize(quotaId: string, options?: WriteOptions): Promise<Quota>;
  async finalize(quotaId: string, options?: WriteOptions): Promise<Quota | WriteOutcome<Quota>> {
    const path = substitutePath('/quotas/{quota_id}/finalize', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<Quota>(this.ctx, { method: 'POST', path, options });
    return writeJson<Quota>(this.ctx, { method: 'POST', path, options });
  }

  /**
   * 获取名额池汇总（已批准、候补队列与计数，同一事务快照）；需要 `quota:read`。
   * 本接口无 `ETag`、不做缓存，每次读取都反映最新已提交状态。幂等只读。
   * 401 未认证；403 缺 scope；404 不存在；429 限流。
   */
  summary(quotaId: string, options?: ReadOptions): Promise<QuotaSummary> {
    const path = substitutePath('/quotas/{quota_id}/summary', { quota_id: quotaId });
    // 契约：本接口不做缓存，每次读取都反映最新已提交状态。
    return readJson<QuotaSummary>(this.ctx, { path, resource: 'quota-summary', id: quotaId, options: { ...options, cache: false } });
  }

  /**
   * 释放**已批准**的认领（`POST /quotas/{q}/claims/{c}/release`），名额立刻回到池里。
   * 需要 `quota:manage`；只有 `approved` 可释放，结果状态为 `released`。
   * 队伍自己不能释放已批准名额（只能 `withdrawClaim` 撤销未审核的）。可传 `ifMatch`。
   */
  async releaseClaim(
    quotaId: string,
    claimId: string,
    body: ReleaseQuotaClaimRequest = {},
    options?: WriteOptions,
  ): Promise<QuotaClaim> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}/release', {
      quota_id: quotaId,
      claim_id: claimId,
    });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, body, options });
  }

  /**
   * 确认自己在认领名单里的参赛身份（`POST /quotas/{q}/claims/{c}/confirm`）。
   * 需要 `quota:claim`，且调用者必须在名单里；只对 `pending`/`approved` 有效。
   */
  async confirmClaim(quotaId: string, claimId: string, options?: WriteOptions): Promise<QuotaClaim> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}/confirm', {
      quota_id: quotaId,
      claim_id: claimId,
    });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, options });
  }

  /** 归档名额池（`POST /quotas/{quota_id}/archive`），仅 `finalized` 可归档。需要 `quota:manage`。 */
  async archive(quotaId: string, options?: WriteOptions): Promise<Quota> {
    const path = substitutePath('/quotas/{quota_id}/archive', { quota_id: quotaId });
    return writeJson<Quota>(this.ctx, { method: 'POST', path, options });
  }

  /**
   * 列出池内认领（可按状态/队伍/成员过滤）；需要 `quota:read`，仅有 `quota:claim` 只看本队。
   * 幂等只读、强一致，默认按 `submitted_at` 降序。400 过滤非法；403 越权；404 池不存在。
   */
  listClaims(
    quotaId: string,
    params: {
      status?: QuotaClaimStatus;
      team_id?: string;
      principal_id?: string;
      page?: number;
      size?: number;
      sort?: 'submitted_at' | 'priority' | 'status';
      order?: SortOrder;
    } = {},
    options?: ReadOptions,
  ): Promise<PagedQuotaClaim> {
    const path = substitutePath('/quotas/{quota_id}/claims', { quota_id: quotaId });
    return readJson<PagedQuotaClaim>(this.ctx, { path, query: params, resource: 'quota-claims', options });
  }

  /**
   * 提交名额认领（支持离线队列，弱网下先入 outbox）；需要 `quota:claim` 或 `quota:manage`。
   * 成功后状态恒为 `pending`，同一 `Idempotency-Key` 重放返回同一个认领。
   * 409 超出每队上限/窗口外/池未开启或已定案；422 成员不合规；403 不满足 eligibility。
   */
  createClaim(
    quotaId: string,
    body: CreateQuotaClaimRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<QuotaClaim>>;
  createClaim(quotaId: string, body: CreateQuotaClaimRequest, options?: WriteOptions): Promise<QuotaClaim>;
  async createClaim(
    quotaId: string,
    body: CreateQuotaClaimRequest,
    options?: WriteOptions,
  ): Promise<QuotaClaim | WriteOutcome<QuotaClaim>> {
    const path = substitutePath('/quotas/{quota_id}/claims', { quota_id: quotaId });
    if (options?.queueIfOffline) return writeWithQueue<QuotaClaim>(this.ctx, { method: 'POST', path, body, options });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, body, options });
  }

  /**
   * 获取单个认领详情与成员快照；需要 `quota:read`（他队认领对仅 `quota:claim` 者返回 404）。
   * 幂等只读，带强 `ETag`（可 304）。401 未认证；403 缺 scope；404 不存在或不可见。
   */
  getClaim(quotaId: string, claimId: string, options?: ReadOptions): Promise<QuotaClaim> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}', { quota_id: quotaId, claim_id: claimId });
    return readJson<QuotaClaim>(this.ctx, { path, resource: 'quota-claims', id: `${quotaId}:${claimId}`, options });
  }

  /**
   * 批准认领（认领生效的唯一途径，批准后立即占用名额且不可撤销）；需要 `quota:manage`。
   * 幂等写：同一 `Idempotency-Key` 重放返回首次批准结果。
   * 404 不存在；409 非 `pending`、已定案、或已批准数达 `quota_total`（quota_exceeded）；422 参数非法。
   */
  approve(
    quotaId: string,
    claimId: string,
    body: ApproveQuotaClaimRequest | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<QuotaClaim>>;
  approve(quotaId: string, claimId: string, body?: ApproveQuotaClaimRequest, options?: WriteOptions): Promise<QuotaClaim>;
  async approve(
    quotaId: string,
    claimId: string,
    body?: ApproveQuotaClaimRequest,
    options?: WriteOptions,
  ): Promise<QuotaClaim | WriteOutcome<QuotaClaim>> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}/approve', { quota_id: quotaId, claim_id: claimId });
    if (options?.queueIfOffline) return writeWithQueue<QuotaClaim>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
  }

  /**
   * 拒绝认领（`reason` 必填并进入审计日志）；需要 `quota:manage`。
   * 幂等写：同一 `Idempotency-Key` 重放返回首次拒绝结果。
   * 404 不存在；409 非 `pending`（含已批准）或池已定案 quota_finalized；422 缺少理由。
   */
  reject(
    quotaId: string,
    claimId: string,
    body: RejectQuotaClaimRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<QuotaClaim>>;
  reject(quotaId: string, claimId: string, body: RejectQuotaClaimRequest, options?: WriteOptions): Promise<QuotaClaim>;
  async reject(
    quotaId: string,
    claimId: string,
    body: RejectQuotaClaimRequest,
    options?: WriteOptions,
  ): Promise<QuotaClaim | WriteOutcome<QuotaClaim>> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}/reject', { quota_id: quotaId, claim_id: claimId });
    if (options?.queueIfOffline) return writeWithQueue<QuotaClaim>(this.ctx, { method: 'POST', path, body, options });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, body, options });
  }

  /**
   * 撤销认领（提交方本人/队长或 `quota:manage`）；只有 `pending` 可撤销。
   * 幂等写：无请求体，同一 `Idempotency-Key` 重放返回首次撤销结果。
   * 403 非本人/本队且无管理权限；404 不存在或不可见；409 非 `pending` 或池已定案。
   */
  withdraw(quotaId: string, claimId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<QuotaClaim>>;
  withdraw(quotaId: string, claimId: string, options?: WriteOptions): Promise<QuotaClaim>;
  async withdraw(quotaId: string, claimId: string, options?: WriteOptions): Promise<QuotaClaim | WriteOutcome<QuotaClaim>> {
    const path = substitutePath('/quotas/{quota_id}/claims/{claim_id}/withdraw', { quota_id: quotaId, claim_id: claimId });
    if (options?.queueIfOffline) return writeWithQueue<QuotaClaim>(this.ctx, { method: 'POST', path, options });
    return writeJson<QuotaClaim>(this.ctx, { method: 'POST', path, options });
  }
}
