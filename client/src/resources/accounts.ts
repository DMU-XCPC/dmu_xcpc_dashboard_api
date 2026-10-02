/**
 * **账号与权限模块**（`/accounts`，以"身份"为中心）：创建主体（人类或机器人）、停用/启用、
 * 设置标签与 `资源:动作` scope、签发与撤销凭证（会话令牌 / 长期 API Key）。
 *
 * 典型用法：给 QQ 机器人发 API Key、停用一个账号、查某主体拥有哪些权限。
 * **查人、筛人、填表档案、活跃度请用 `MembersResource`**——那是同一主体的另一视角
 * （同一个 id 与 ETag，见 `doc/api/README.md` §3.1）。
 */

import { substitutePath, type QueryParams } from '../http/query.js';
import type { ClubCode, ResetPasswordRequest } from '../types/common.js';
import type { HttpMethod } from '../http/transport.js';
import type { SortOrder, Timestamp } from '../types/common.js';
import type {
  AccountStatus,
  CreateAccountRequest,
  IssueCredentialRequest,
  IssuedCredential,
  PagedPrincipal,
  Principal,
  PrincipalKind,
  SetLabelsRequest,
  SetScopesRequest,
  UpdateAccountRequest,
} from '../types/accounts.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** `GET /accounts` 的查询参数。 */
export interface AccountsListParams {
  q?: string;
  label?: string[];
  kind?: PrincipalKind;
  status?: AccountStatus;
  /** 按社团过滤；`club_match` 决定是命中任一、全部命中还是全部排除。 */
  club?: ClubCode[];
  club_match?: 'any' | 'all' | 'none';
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'username' | 'display_name' | 'created_at' | 'last_active_at' | 'updated_at';
  order?: SortOrder;
}

/**
 * 主体（账号）资源：列表、创建、详情、修改、停用、标签/scope 替换与凭证签发。
 *
 * 读方法走读穿缓存（`resource: 'accounts'`），写方法支持 `queueIfOffline` 离线排队。
 */
export class AccountsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页查询主体，支持模糊搜索与标签/类型/状态/成员名单过滤。
   * 需要 `account:read`；可安全缓存（键含全部查询参数）。
   * 无权返回 `403 insufficient_scope`，匿名返回 `401`。
   */
  async list(params?: AccountsListParams, options?: ReadOptions): Promise<PagedPrincipal> {
    const query: QueryParams = {
      q: params?.q,
      label: params?.label,
      kind: params?.kind,
      status: params?.status,
      club: params?.club,
      club_match: params?.club_match,
      updated_since: params?.updated_since,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
      order: params?.order,
    };
    return readJson<PagedPrincipal>(this.ctx, {
      path: '/accounts',
      query,
      resource: 'accounts',
      options,
    });
  }

  /**
   * 新建 `human` 或 `service` 主体。
   * 需要 `account:manage`；必须携带 `Idempotency-Key`（传输层自动生成），可 `queueIfOffline`。
   * 用户名/学号冲突返回 `409 conflict`，语义校验失败返回 `422 validation_failed`。
   */
  create(body: CreateAccountRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Principal>>;
  create(body: CreateAccountRequest, options?: WriteOptions): Promise<Principal>;
  async create(body: CreateAccountRequest, options?: WriteOptions): Promise<Principal | WriteOutcome<Principal>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Principal>(this.ctx, { method: 'POST', path: '/accounts', body, options });
    }
    return writeJson<Principal>(this.ctx, { method: 'POST', path: '/accounts', body, options });
  }

  /**
   * 获取单个主体详情（含 `labels`/`scopes`/`profile` 与 `revision`）。
   * 需要 `account:read`；不存在或不可见统一返回 `404 not_found`。
   * 响应带 `ETag`，可用 `If-None-Match` 走 `304` 条件读取。
   */
  async get(accountId: string, options?: ReadOptions): Promise<Principal> {
    const path = substitutePath('/accounts/{account_id}', { account_id: accountId });
    return readJson<Principal>(this.ctx, {
      path,
      resource: 'accounts',
      id: accountId,
      options,
    });
  }

  /**
   * 部分更新主体的展示名、档案或状态。
   * 需要 `account:manage`；可 `queueIfOffline`，并可用 `ifMatch` 做乐观并发控制。
   * 不存在 `404`、停用自己 `409`、`If-Match` 不匹配 `412`、`422` 语义校验失败。
   */
  update(
    accountId: string,
    body: UpdateAccountRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Principal>>;
  update(accountId: string, body: UpdateAccountRequest, options?: WriteOptions): Promise<Principal>;
  async update(
    accountId: string,
    body: UpdateAccountRequest,
    options?: WriteOptions,
  ): Promise<Principal | WriteOutcome<Principal>> {
    const path = substitutePath('/accounts/{account_id}', { account_id: accountId });
    if (options?.queueIfOffline) {
      return writeWithQueue<Principal>(this.ctx, { method: 'PATCH', path, body, options });
    }
    return writeJson<Principal>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 停用主体（软删除，`purge=true` 需通配 `*` scope）。
   * 需要 `account:manage`；总是返回 `204`，可 `queueIfOffline`。
   * 不存在 `404 not_found`，`If-Match` 不匹配 `412 precondition_failed`。
   */
  disable(
    accountId: string,
    params: { purge?: boolean } | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<void>>;
  disable(accountId: string, params?: { purge?: boolean }, options?: WriteOptions): Promise<void>;
  async disable(
    accountId: string,
    params?: { purge?: boolean },
    options?: WriteOptions,
  ): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/accounts/{account_id}', { account_id: accountId });
    const query: QueryParams = { purge: params?.purge };
    if (options?.queueIfOffline) {
      return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, query, options });
    }
    return writeJson<void>(this.ctx, { method: 'DELETE', path, query, options });
  }

  /**
   * 以替换语义设置主体标签（空数组清空；`member` 影响成员视图）。
   * 需要 `member:assign`；天然幂等，可 `queueIfOffline`。
   * 不存在 `404`，`If-Match` 不匹配 `412`，语义校验失败 `422`。
   */
  setLabels(
    accountId: string,
    body: SetLabelsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Principal>>;
  setLabels(accountId: string, body: SetLabelsRequest, options?: WriteOptions): Promise<Principal>;
  async setLabels(
    accountId: string,
    body: SetLabelsRequest,
    options?: WriteOptions,
  ): Promise<Principal | WriteOutcome<Principal>> {
    const path = substitutePath('/accounts/{account_id}/labels', { account_id: accountId });
    if (options?.queueIfOffline) {
      return writeWithQueue<Principal>(this.ctx, { method: 'PUT', path, body, options });
    }
    return writeJson<Principal>(this.ctx, { method: 'PUT', path, body, options });
  }

  /**
   * 以替换语义设置主体 scope（空数组撤销全部）。
   * 需要 `member:assign` 且不得授予自己没有的 scope，否则 `403`；可 `queueIfOffline`。
   * 不存在 `404`，`If-Match` 不匹配 `412`，语义校验失败 `422`。
   */
  setScopes(
    accountId: string,
    body: SetScopesRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Principal>>;
  setScopes(accountId: string, body: SetScopesRequest, options?: WriteOptions): Promise<Principal>;
  async setScopes(
    accountId: string,
    body: SetScopesRequest,
    options?: WriteOptions,
  ): Promise<Principal | WriteOutcome<Principal>> {
    const path = substitutePath('/accounts/{account_id}/scopes', { account_id: accountId });
    if (options?.queueIfOffline) {
      return writeWithQueue<Principal>(this.ctx, { method: 'PUT', path, body, options });
    }
    return writeJson<Principal>(this.ctx, { method: 'PUT', path, body, options });
  }

  /**
   * 设置或重置某个主体的口令（`POST /accounts/{account_id}/password-reset`）。
   * 批量导入或新建出来的主体初始没有口令，成员本人无法登录，管理员用本方法补第一条；
   * 之后成员可用 `self.changePassword()` 自助修改。需要 `account:manage`。
   * 副作用：撤销该主体全部 `session` 凭证（`api_key` 不受影响），写审计但不记录口令。
   * 主体已停用 `409 conflict`；口令过短 `422`；不支持离线入队（一次性动作，不应重放）。
   */
  async resetPassword(
    accountId: string,
    body: ResetPasswordRequest,
    options?: WriteOptions,
  ): Promise<void> {
    const path = substitutePath('/accounts/{account_id}/password-reset', { account_id: accountId });
    await writeJson<void>(this.ctx, { method: 'POST', path, body, options });
  }

  /**
   * 为主体签发凭证；明文 `secret` **只在本次响应中出现一次**，之后任何接口都不再返回。
   * 给自己签发需 `account:self`、给他人需 `account:manage`。
   * 主体已停用 `409 conflict`，`expires_at`/`expires_in` 互斥冲突 `422`，不存在 `404`。
   *
   * **不支持 `queueIfOffline`**：离线队列只重放请求、不回传响应体，排队会让明文 `secret`
   * 永久丢失（凭证已签发却拿不到）。离线时请等网络恢复后再调用。
   */
  async issueCredential(
    accountId: string,
    body: IssueCredentialRequest,
    options?: WriteOptions,
  ): Promise<IssuedCredential> {
    const path = substitutePath('/accounts/{account_id}/credentials', { account_id: accountId });
    return writeJson<IssuedCredential>(this.ctx, { method: 'POST', path, body, options });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const ACCOUNTS_OPERATIONS = {
  listAccounts: { method: 'GET', path: '/accounts' },
  createAccount: { method: 'POST', path: '/accounts' },
  getAccount: { method: 'GET', path: '/accounts/{account_id}' },
  updateAccount: { method: 'PATCH', path: '/accounts/{account_id}' },
  disableAccount: { method: 'DELETE', path: '/accounts/{account_id}' },
  setAccountLabels: { method: 'PUT', path: '/accounts/{account_id}/labels' },
  setAccountScopes: { method: 'PUT', path: '/accounts/{account_id}/scopes' },
  issueCredential: { method: 'POST', path: '/accounts/{account_id}/credentials' },
  resetAccountPassword: { method: 'POST', path: '/accounts/{account_id}/password-reset' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
