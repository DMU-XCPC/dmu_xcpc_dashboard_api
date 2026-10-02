import { substitutePath, type QueryParams } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Id } from '../types/common.js';
import type { Credential, CredentialKind, PagedCredential } from '../types/accounts.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** `GET /credentials` 的查询参数。 */
export interface CredentialsListParams {
  principal_id?: Id;
  kind?: CredentialKind;
  revoked?: boolean;
  include_expired?: boolean;
  page?: number;
  size?: number;
}

/**
 * 凭证资源：查询元信息、读取单个凭证与撤销。
 *
 * 响应**永不包含明文密钥**；列表走读穿缓存（`resource: 'credentials'`）。
 */
export class CredentialsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页查询凭证元信息（默认只查调用者自己）。
   * 省略 `principal_id` 需 `account:self`，指定他人需 `account:read`。
   * 权限不足 `403 insufficient_scope`；结果按 `created_at` 倒序。
   */
  async list(params?: CredentialsListParams, options?: ReadOptions): Promise<PagedCredential> {
    const query: QueryParams = {
      principal_id: params?.principal_id,
      kind: params?.kind,
      revoked: params?.revoked,
      include_expired: params?.include_expired,
      page: params?.page,
      size: params?.size,
    };
    return readJson<PagedCredential>(this.ctx, {
      path: '/credentials',
      query,
      resource: 'credentials',
      options,
    });
  }

  /**
   * 获取单个凭证的元信息（不含明文密钥）。
   * 本人需 `account:self`，他人需 `account:manage`；不可见与不存在统一 `404 not_found`。
   * `last_used_at` 有 ≤ 5 分钟延迟，`revoked_at`/`expires_at` 准确。
   */
  async get(credentialId: string, options?: ReadOptions): Promise<Credential> {
    const path = substitutePath('/credentials/{credential_id}', { credential_id: credentialId });
    return readJson<Credential>(this.ctx, {
      path,
      resource: 'credentials',
      id: credentialId,
      options,
    });
  }

  /**
   * 撤销凭证（不可回滚；鉴权传播延迟 ≤ 60 秒）。
   * 本人需 `account:self`，他人需 `account:manage`；总是返回 `204`，可 `queueIfOffline`。
   * 不可见与不存在统一 `404 not_found`。
   */
  revoke(credentialId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<void>>;
  revoke(credentialId: string, options?: WriteOptions): Promise<void>;
  async revoke(credentialId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/credentials/{credential_id}', { credential_id: credentialId });
    if (options?.queueIfOffline) {
      return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    }
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const CREDENTIALS_OPERATIONS = {
  listCredentials: { method: 'GET', path: '/credentials' },
  getCredential: { method: 'GET', path: '/credentials/{credential_id}' },
  revokeCredential: { method: 'DELETE', path: '/credentials/{credential_id}' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
