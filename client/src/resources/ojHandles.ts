import { substitutePath, type QueryParams } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Id, Judge, SortOrder, Timestamp } from '../types/common.js';
import type { LinkOjHandleRequest, OjHandle, PagedOjHandle, VerifyOjHandleRequest } from '../types/oj.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** `GET /oj-handles` 的查询参数。 */
export interface OjHandlesListParams {
  principal_id?: Id;
  judge?: Judge;
  verified?: boolean;
  q?: string;
  updated_since?: Timestamp;
  page?: number;
  size?: number;
  sort?: 'judge' | 'handle' | 'linked_at' | 'last_submission_at' | 'updated_at';
  order?: SortOrder;
}

/**
 * OJ 绑定资源：列表、绑定、详情、解绑与归属校验。
 *
 * `verification_token` 是敏感字段，仅本人或 `oj:manage` 可见；列表走读穿缓存
 * （`resource: 'oj-handles'`），写方法支持 `queueIfOffline`。
 */
export class OjHandlesResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页查询 OJ 绑定（`verification_token` 按可见性裁剪为 `null`）。
   * 需要 `oj:read`；`updated_since` 按绑定变更时刻做增量过滤。
   * 权限不足 `403 insufficient_scope`，匿名 `401`。
   */
  async list(params?: OjHandlesListParams, options?: ReadOptions): Promise<PagedOjHandle> {
    const query: QueryParams = {
      principal_id: params?.principal_id,
      judge: params?.judge,
      verified: params?.verified,
      q: params?.q,
      updated_since: params?.updated_since,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
      order: params?.order,
    };
    return readJson<PagedOjHandle>(this.ctx, {
      path: '/oj-handles',
      query,
      resource: 'oj-handles',
      options,
    });
  }

  /**
   * 绑定 OJ 账号并进入归属校验流程（返回一次性可见的 `verification_token`）。
   * 给自己绑定需 `oj:write`，代他人绑定需 `oj:manage`；可 `queueIfOffline`。
   * `(judge, handle)` 已绑定 `409 handle_already_linked`，平台未启用 `422 judge_not_supported`，
   * `judge: other` 缺 `judge_label` 为 `422 validation_failed`。
   */
  link(body: LinkOjHandleRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<OjHandle>>;
  link(body: LinkOjHandleRequest, options?: WriteOptions): Promise<OjHandle>;
  async link(body: LinkOjHandleRequest, options?: WriteOptions): Promise<OjHandle | WriteOutcome<OjHandle>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<OjHandle>(this.ctx, { method: 'POST', path: '/oj-handles', body, options });
    }
    return writeJson<OjHandle>(this.ctx, { method: 'POST', path: '/oj-handles', body, options });
  }

  /**
   * 获取单个 OJ 绑定详情（含归属校验状态与最近采集信息）。
   * 需要 `oj:read`；不存在或不可见统一返回 `404 not_found`。
   * `verification_token` 仅本人或 `oj:manage` 返回原值，其余恒为 `null`。
   */
  async get(handleId: string, options?: ReadOptions): Promise<OjHandle> {
    const path = substitutePath('/oj-handles/{handle_id}', { handle_id: handleId });
    return readJson<OjHandle>(this.ctx, {
      path,
      resource: 'oj-handles',
      id: handleId,
      options,
    });
  }

  /**
   * 解绑 OJ 账号（历史采集数据保留，校验 token 作废）。
   * 本人需 `oj:write`，他人绑定需 `oj:manage`；总是返回 `204`，可 `queueIfOffline`。
   * 不存在或不可见返回 `404 not_found`。
   */
  unlink(handleId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<void>>;
  unlink(handleId: string, options?: WriteOptions): Promise<void>;
  async unlink(handleId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/oj-handles/{handle_id}', { handle_id: handleId });
    if (options?.queueIfOffline) {
      return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    }
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }

  /**
   * 采集器确认 OJ 账号归属（`token` 必须与下发的校验 token 完全一致）。
   * 需要 `ingest:write` 或 `crawler:manage`；对已校验绑定重复调用返回 `200` 且状态不变，可 `queueIfOffline`。
   * 绑定不存在 `404 not_found`，token 不匹配 `422 validation_failed`（`pointer=/token`）。
   */
  verify(
    handleId: string,
    body: VerifyOjHandleRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<OjHandle>>;
  verify(handleId: string, body: VerifyOjHandleRequest, options?: WriteOptions): Promise<OjHandle>;
  async verify(
    handleId: string,
    body: VerifyOjHandleRequest,
    options?: WriteOptions,
  ): Promise<OjHandle | WriteOutcome<OjHandle>> {
    const path = substitutePath('/oj-handles/{handle_id}/verify', { handle_id: handleId });
    if (options?.queueIfOffline) {
      return writeWithQueue<OjHandle>(this.ctx, { method: 'POST', path, body, options });
    }
    return writeJson<OjHandle>(this.ctx, { method: 'POST', path, body, options });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const OJ_HANDLES_OPERATIONS = {
  listOjHandles: { method: 'GET', path: '/oj-handles' },
  linkOjHandle: { method: 'POST', path: '/oj-handles' },
  getOjHandle: { method: 'GET', path: '/oj-handles/{handle_id}' },
  unlinkOjHandle: { method: 'DELETE', path: '/oj-handles/{handle_id}' },
  verifyOjHandle: { method: 'POST', path: '/oj-handles/{handle_id}/verify' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
