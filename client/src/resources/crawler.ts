import { substitutePath, type QueryParams } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Job, Judge, Timestamp } from '../types/common.js';
import type {
  CrawlerConfig,
  CrawlerConfigPatch,
  CrawlerRun,
  CrawlerRunReportRequest,
  CrawlerRunState,
  CrawlerStatus,
  PagedCrawlerRun,
  TriggerCrawlerRunRequest,
} from '../types/oj.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** `GET /crawler/runs` 的查询参数。 */
export interface CrawlerRunsListParams {
  judge?: Judge;
  state?: CrawlerRunState;
  proxy_used?: boolean;
  from?: Timestamp;
  to?: Timestamp;
  cursor?: string;
  limit?: number;
}

/**
 * 爬虫资源：配置读取/修改、采集状态、运行记录与代管触发。
 *
 * 读方法走读穿缓存（`resource: 'crawler-config' | 'crawler-status' | 'crawler-runs'`），
 * 写方法支持 `queueIfOffline`；配置可用 `ifMatch` 做乐观并发控制。
 */
export class CrawlerResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 拉取当前生效的爬虫配置（采集器周期调用的推荐姿势）。
   * 需要 `crawler:read`；响应带强 `ETag`，可用 `If-None-Match` 走 `304`。
   * 代理口令永不回传，只能用 `proxy.proxies[].has_password` 判断。
   */
  async getConfig(options?: ReadOptions): Promise<CrawlerConfig> {
    return readJson<CrawlerConfig>(this.ctx, {
      path: '/crawler/config',
      resource: 'crawler-config',
      options,
    });
  }

  /**
   * 修改爬虫配置（出现的字段整体替换，`mode` 不可改）。
   * 需要 `crawler:manage`；可 `queueIfOffline`，建议带 `ifMatch`。
   * `If-Match` 不匹配 `412 precondition_failed`，提交 `mode` 等语义错误 `422`，
   * 同键不同体重放 `409 idempotency_key_reused`。
   */
  updateConfig(
    body: CrawlerConfigPatch,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<CrawlerConfig>>;
  updateConfig(body: CrawlerConfigPatch, options?: WriteOptions): Promise<CrawlerConfig>;
  async updateConfig(
    body: CrawlerConfigPatch,
    options?: WriteOptions,
  ): Promise<CrawlerConfig | WriteOutcome<CrawlerConfig>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<CrawlerConfig>(this.ctx, { method: 'PATCH', path: '/crawler/config', body, options });
    }
    return writeJson<CrawlerConfig>(this.ctx, { method: 'PATCH', path: '/crawler/config', body, options });
  }

  /**
   * 获取采集健康度总览（开关、调度时刻、各平台滞后、代理池概况）。
   * 需要 `crawler:read`；最终一致视图（滞后 ≤ `PT5M`），应展示 `generated_at`。
   * 权限不足 `403 insufficient_scope`，匿名 `401 unauthenticated`。
   */
  async status(options?: ReadOptions): Promise<CrawlerStatus> {
    return readJson<CrawlerStatus>(this.ctx, {
      path: '/crawler/status',
      resource: 'crawler-status',
      options,
    });
  }

  /**
   * 游标分页查询采集器运行记录（固定按 `started_at` 倒序）。
   * 需要 `crawler:read`；支持 `judge`/`state`/`proxy_used`/时间区间过滤。
   * 时间参数格式错误返回 `400 bad_request`。
   */
  async listRuns(params?: CrawlerRunsListParams, options?: ReadOptions): Promise<PagedCrawlerRun> {
    const query: QueryParams = {
      judge: params?.judge,
      state: params?.state,
      proxy_used: params?.proxy_used,
      from: params?.from,
      to: params?.to,
      cursor: params?.cursor,
      limit: params?.limit,
    };
    return readJson<PagedCrawlerRun>(this.ctx, {
      path: '/crawler/runs',
      query,
      resource: 'crawler-runs',
      options,
    });
  }

  /**
   * 外部采集器上报自己一次运行（只登记，不触发抓取）。
   * 需要 `ingest:write`；可 `queueIfOffline`，同键重放返回同一条记录。
   * 终态缺 `finished_at` 或早于 `started_at` 返回 `422 validation_failed`。
   */
  reportRun(
    body: CrawlerRunReportRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<CrawlerRun>>;
  reportRun(body: CrawlerRunReportRequest, options?: WriteOptions): Promise<CrawlerRun>;
  async reportRun(
    body: CrawlerRunReportRequest,
    options?: WriteOptions,
  ): Promise<CrawlerRun | WriteOutcome<CrawlerRun>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<CrawlerRun>(this.ctx, { method: 'POST', path: '/crawler/runs', body, options });
    }
    return writeJson<CrawlerRun>(this.ctx, { method: 'POST', path: '/crawler/runs', body, options });
  }

  /**
   * 按 id 读取一条采集器运行记录。
   * 需要 `crawler:read`；记录不存在或已过保留期统一返回 `404 not_found`。
   * 仍在 `running` 的记录 `finished_at` 为 `null`。
   */
  async getRun(runId: string, options?: ReadOptions): Promise<CrawlerRun> {
    const path = substitutePath('/crawler/runs/{run_id}', { run_id: runId });
    return readJson<CrawlerRun>(this.ctx, {
      path,
      resource: 'crawler-runs',
      id: runId,
      options,
    });
  }

  /**
   * 请求服务器代管触发一次采集，返回异步任务（`202`）。
   * 需要 `crawler:manage`；可 `queueIfOffline`，同键重放返回同一个 `job_id`。
   * 服务器不代管 `409 crawler_not_embedded`，该平台已有任务 `409 crawler_run_in_progress`，
   * 平台未启用返回 `404 not_found`。
   */
  triggerRun(body: TriggerCrawlerRunRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Job>>;
  triggerRun(body: TriggerCrawlerRunRequest, options?: WriteOptions): Promise<Job>;
  async triggerRun(body: TriggerCrawlerRunRequest, options?: WriteOptions): Promise<Job | WriteOutcome<Job>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<Job>(this.ctx, { method: 'POST', path: '/crawler/trigger', body, options });
    }
    return writeJson<Job>(this.ctx, { method: 'POST', path: '/crawler/trigger', body, options });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const CRAWLER_OPERATIONS = {
  getCrawlerConfig: { method: 'GET', path: '/crawler/config' },
  updateCrawlerConfig: { method: 'PATCH', path: '/crawler/config' },
  getCrawlerStatus: { method: 'GET', path: '/crawler/status' },
  listCrawlerRuns: { method: 'GET', path: '/crawler/runs' },
  reportCrawlerRun: { method: 'POST', path: '/crawler/runs' },
  getCrawlerRun: { method: 'GET', path: '/crawler/runs/{run_id}' },
  triggerCrawlerRun: { method: 'POST', path: '/crawler/trigger' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
