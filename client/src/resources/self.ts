import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';
import type { HttpMethod } from '../http/transport.js';
import type { ChangePasswordRequest, Me, UpdateMeRequest } from '../types/common.js';
import type { SetMemberClubsRequest } from '../types/roster.js';

/** `SELF_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const SELF_OPERATIONS = {
  getCurrentPrincipal: { method: 'GET', path: '/auth/me' },
  updateCurrentPrincipal: { method: 'PATCH', path: '/auth/me' },
  changePassword: { method: 'PUT', path: '/auth/me/password' },
  setOwnClubs: { method: 'PUT', path: '/auth/me/clubs' },
} satisfies Record<string, { method: HttpMethod; path: string }>;

/**
 * 自助资源：成员维护**自己**的那部分数据。
 *
 * 档案字段的读写在 `SessionManager`（`GET`/`PATCH /auth/me`）里；本类只负责
 * 自助社团登记。它与管理端点 `PUT /members/{member_id}/clubs` 写的是**同一份数据**，
 * 差别只在授权：这里只能改自己，需要 `profile:clubs`；管理端点需要 `member:manage`
 * 且可改任何人。默认模板 `user` 含 `profile:clubs`，因此成员开箱即可自助登记。
 */
export class SelfResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 读自己的主体信息（`GET /auth/me`），含 `effective_scopes` 与当前凭证摘要。
   * 用于判断"我有哪些 `profile:*` 字段组"，从而知道能自助改哪些字段。
   */
  getMe(options?: ReadOptions): Promise<Me> {
    return readJson<Me>(this.ctx, { path: '/auth/me', resource: 'me', options });
  }

  /**
   * 自助修改自己的展示名与档案（`PATCH /auth/me`，合并式更新，只改出现的字段）。
   * 字段级授权：`profile:display` 管展示名，`profile:contact` 管联系方式，
   * `profile:academic` 管学籍；请求里出现没有对应 scope 的字段时整个请求返回
   * `403 insufficient_scope`，`errors[]` 指出越权字段，不做部分生效。
   * 并发冲突返回 `412 precondition_failed`；支持 `queueIfOffline`。
   */
  updateMe(
    body: UpdateMeRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Me>>;
  updateMe(body: UpdateMeRequest, options?: WriteOptions): Promise<Me>;
  async updateMe(body: UpdateMeRequest, options?: WriteOptions): Promise<Me | WriteOutcome<Me>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Me>(this.ctx, { method: 'PATCH', path: '/auth/me', body, options });
    }
    return writeJson<Me>(this.ctx, { method: 'PATCH', path: '/auth/me', body, options });
  }

  /**
   * 修改自己的口令（`PUT /auth/me/password`）；成功后除当前会话外的会话全部失效。
   *
   * 契约点名"**客户端不得自动重试本接口**"，且该端点不接受 `Idempotency-Key`，
   * 因此这里直接走传输层并显式关掉重试与幂等键：首次若已改密而响应丢失，
   * 自动重试会把"已成功"变成报错。
   */
  changePassword(body: ChangePasswordRequest, options?: WriteOptions): Promise<void> {
    return this.ctx.transport
      .request<void>({
        method: 'PUT',
        path: '/auth/me/password',
        body,
        retry: false,
        idempotencyKey: false,
        parse: 'none',
        ...(options?.headers ? { headers: options.headers } : {}),
      })
      .then(() => undefined);
  }

  /**
   * 登记或退出自己的社团（`PUT /auth/me/clubs`，整体替换，不是增量）。
   * 需要 `profile:clubs`；未出现的社团会被置为 `alumni` 并保留注册日期。
   * 即使只想动一个社团也要提交完整集合：先 `getMe()` 读出 `profile.club_memberships` 再改。
   * 越权 `403 insufficient_scope`，并发冲突 `412 precondition_failed`；写审计，`actor` 是自己。
   */
  setClubs(
    body: SetMemberClubsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Me>>;
  setClubs(body: SetMemberClubsRequest, options?: WriteOptions): Promise<Me>;
  async setClubs(body: SetMemberClubsRequest, options?: WriteOptions): Promise<Me | WriteOutcome<Me>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Me>(this.ctx, { method: 'PUT', path: '/auth/me/clubs', body, options });
    }
    return writeJson<Me>(this.ctx, { method: 'PUT', path: '/auth/me/clubs', body, options });
  }
}
