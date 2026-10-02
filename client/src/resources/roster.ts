/**
 * 成员名单导出资源模块：`/roster/exports` 系列端点的 Typed REST 封装。
 */

import { readJson, writeJson, writeWithQueue } from './helpers.js';
import type { ReadOptions, ResourceContext, WriteOptions, WriteOutcome } from './helpers.js';
import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Job } from '../types/common.js';
import type { PagedRosterExport, RosterExport, RosterExportRequest } from '../types/roster.js';

/** `listExports` 的查询参数；与 `GET /roster/exports` 的 query 参数一一对应。 */
type ListRosterExportsParams = {
  status?: RosterExport['status'];
  page?: number;
  size?: number;
  order?: 'asc' | 'desc';
};

/** `ROSTER_OPERATIONS` 列出本模块覆盖的契约 operationId 与路径模板。 */
export const ROSTER_OPERATIONS = {
  listRosterExports: { method: 'GET', path: '/roster/exports' },
  createRosterExport: { method: 'POST', path: '/roster/exports' },
  getRosterExport: { method: 'GET', path: '/roster/exports/{export_id}' },
  downloadRosterExport: { method: 'GET', path: '/roster/exports/{export_id}/download' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class RosterResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 列出成员名单导出记录（偏移分页，按 `created_at` 倒序；默认只返回调用者自己创建的记录）。
   * 需要 `member:read`；只读幂等，状态强一致，可按 `status=queued`/`running` 轮询。
   * 未知 `status` 值 → 400；越界 `page` 返回空 `items` 而非 404。
   */
  listExports(params: ListRosterExportsParams = {}, options?: ReadOptions): Promise<PagedRosterExport> {
    return readJson<PagedRosterExport>(this.ctx, {
      path: '/roster/exports',
      query: params,
      resource: 'roster-exports',
      options,
    });
  }

  /**
   * 发起成员名单导出（202 → `Job`；按 `Location`/`Retry-After` 轮询任务）。
   * 需要 `member:manage`（含 PII）；必须携带幂等键，重放返回同一个 `job_id`。
   * 筛选/列名非法 → 422；命中行数超过导出上限 → 413；产物队列不可用 → 503。
   */
  createExport(
    body: RosterExportRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Job>>;
  createExport(body: RosterExportRequest, options?: WriteOptions): Promise<Job>;
  async createExport(body: RosterExportRequest, options?: WriteOptions): Promise<Job | WriteOutcome<Job>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Job>(this.ctx, { method: 'POST', path: '/roster/exports', body, options });
    }
    return writeJson<Job>(this.ctx, { method: 'POST', path: '/roster/exports', body, options });
  }

  /**
   * 获取导出详情（轮询状态、计数与获取新的 `download_url`）。
   * 需要 `member:read` 且为创建者或持有 `member:manage`；只读幂等，`ETag` 命中为 304。
   * 记录不存在或不可见 → 404；产物已清理时 `status=expired`、`download_url=null`。
   */
  getExport(exportId: string, options?: ReadOptions): Promise<RosterExport> {
    const path = substitutePath('/roster/exports/{export_id}', { export_id: exportId });
    return readJson<RosterExport>(this.ctx, { path, resource: 'roster-exports', id: exportId, options });
  }

  /**
   * 下载导出产物（CSV 文本或解析后的 JSON 对象）；二进制/文本下载，**不走缓存层**。
   * 需要 `member:read` 且为创建者或持有 `member:manage`；保留期内重复下载返回相同字节。
   * 记录不可见 → 404；产物未成功或失败 → 409；链接过期 → 403；产物已清理 → 410。
   */
  async download(
    exportId: string,
    options: ReadOptions & { parse?: 'text' | 'json'; downloadToken?: string } = {},
  ): Promise<string | Record<string, unknown>> {
    const path = substitutePath('/roster/exports/{export_id}/download', { export_id: exportId });
    const { parse, downloadToken, onResponse, ...transportOptions } = options;
    const result = await this.ctx.transport.get<string | Record<string, unknown>>(path, {
      accept: parse === 'json' ? 'application/json' : 'text/csv',
      ...(downloadToken ? { query: { download_token: downloadToken } } : {}),
      parse: parse ?? 'auto',
      ...(transportOptions.signal ? { signal: transportOptions.signal } : {}),
      ...(transportOptions.timeoutMs !== undefined ? { timeoutMs: transportOptions.timeoutMs } : {}),
      ...(transportOptions.retry !== undefined ? { retry: transportOptions.retry } : {}),
      ...(transportOptions.headers ? { headers: transportOptions.headers } : {}),
    });
    onResponse?.(result.meta);
    return result.data;
  }
}
