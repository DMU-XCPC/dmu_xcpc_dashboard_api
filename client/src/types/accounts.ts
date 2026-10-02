/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/accounts.yaml` 对应的请求/响应类型。
 *
 * 公共类型（`Principal`、`Credential`、`IssuedCredential` 等）定义在
 * `types/common.ts`，此处**只重新导出**，不重复定义。
 */

import type {
  AccountStatus,
  Credential,
  CredentialKind,
  Label,
  Paged,
  Principal,
  PrincipalKind,
  PrincipalProfile,
  PrincipalProfileInput,
  Scope,
  Timestamp,
} from './common.js';

export type {
  AccountStatus,
  Credential,
  CredentialKind,
  IssuedCredential,
  Label,
  Principal,
  PrincipalKind,
  PrincipalProfile,
  Scope,
} from './common.js';

/** 创建主体的请求体；`username`、`display_name`、`kind` 必填。 */
export interface CreateAccountRequest {
  /**
   * 套用 `Config.accounts.templates` 里的 scope 模板，与 `scopes` 互斥；
   * 两者同时出现返回 `422`，都不给则用 `Config.accounts.default_template`。
   */
  template?: string;
  username: string;
  display_name: string;
  kind: PrincipalKind;
  labels?: Label[];
  scopes?: Scope[];
  profile?: PrincipalProfileInput;
  /** 仅 `kind: human` 合法；`service` 主体提交该字段会被 `422` 拒绝。 */
  password?: string;
  status?: AccountStatus;
}

/** 修改主体的请求体；字段全部可选但至少出现一个（否则 `422`）。 */
export interface UpdateAccountRequest {
  display_name?: string;
  /** 合并式更新：只覆盖出现的字段。 */
  profile?: PrincipalProfileInput;
  status?: AccountStatus;
}

/** 替换语义的标签集合。 */
export interface SetLabelsRequest {
  labels: Label[];
}

/** 替换语义的 scope 集合。 */
export interface SetScopesRequest {
  scopes: Scope[];
}

/** 签发新凭证的请求体；明文 `secret` 只在 201 响应中出现一次。 */
export interface IssueCredentialRequest {
  kind: CredentialKind;
  name: string;
  scopes?: Scope[];
  /** 与 `expires_in` 互斥；`null` 表示不过期（仅 `api_key` 允许）。 */
  expires_at?: Timestamp | null;
  /** 相对有效期（秒），与 `expires_at` 互斥。 */
  expires_in?: number;
  description?: string;
}

/** 主体列表的偏移分页响应。 */
export type PagedPrincipal = Paged<Principal>;

/** 凭证列表的偏移分页响应（条目永不含明文密钥）。 */
export type PagedCredential = Paged<Credential>;
