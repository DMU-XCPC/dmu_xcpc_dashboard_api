import { sleep } from '../http/retry.js';
import { TimeoutError } from '../errors.js';
/**
 * 运维资源（契约 `paths/ops.yaml`）：探针、元信息、OpenAPI 文档、Prometheus 指标
 * 与异步任务。
 *
 * `/health`、`/ready`、`/meta`、`/openapi.json` 匿名可读；`/metrics` 与 `/jobs*`
 * 需要认证（分别需 `metrics:read`、`ops:read` 或任务创建者本人）。
 */

import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Job, JobKind, JobState, Meta, SortOrder } from '../types/common.js';
import type { HealthStatus, PagedJob, ReadyStatus } from '../types/ops.js';
import { readJson, writeJson, writeWithQueue, type ReadOptions, type ResourceContext, type WriteOptions, type WriteOutcome } from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const OPS_OPERATIONS = {
  getHealth: { method: 'GET', path: '/health' },
  getReady: { method: 'GET', path: '/ready' },
  getMeta: { method: 'GET', path: '/meta' },
  getOpenApiDocument: { method: 'GET', path: '/openapi.json' },
  getMetrics: { method: 'GET', path: '/metrics' },
  listJobs: { method: 'GET', path: '/jobs' },
  getJob: { method: 'GET', path: '/jobs/{job_id}' },
  cancelJob: { method: 'POST', path: '/jobs/{job_id}/cancel' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

/** 轮询异步任务的选项。 */
export interface PollJobOptions {
  /** 服务端未给出 `Retry-After` 时的轮询间隔，默认 1000ms。 */
  intervalMs?: number;
  /** 总超时；到点抛 `TimeoutError`。 */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 每次拿到任务后回调（可用于进度条）。 */
  onProgress?: (job: Job) => void;
}

const TERMINAL_JOB_STATES: JobState[] = ['succeeded', 'failed', 'cancelled', 'expired'];

export class OpsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 存活探针（匿名、无副作用，客户端不应缓存）。`ok`/`degraded` 均返回 200；
   * 仅 `status=down` 返回 503 + Problem，此时抛出 `ApiProblemError`（`code: service_unavailable`）。
   * 429 触发全局限流时按 `Retry-After` 退避重试。
   */
  health(options?: ReadOptions): Promise<HealthStatus> {
    return readJson<HealthStatus>(this.ctx, { path: '/health', resource: 'health', options: { ...options, cache: false } });
  }

  /**
   * 就绪探针（匿名）：`ready=true` 返回 200；**未就绪返回 503 + Problem**，
   * 此时抛出 `ApiProblemError`（`code: service_unavailable`，`detail` 列出未就绪依赖）。
   * 依赖恢复后数秒内 `ready` 变为 `true`（无缓存保证）；429 限流。
   */
  ready(options?: ReadOptions): Promise<ReadyStatus> {
    return readJson<ReadyStatus>(this.ctx, { path: '/ready', resource: 'ready', options: { ...options, cache: false } });
  }

  /**
   * 服务器元信息与时钟校准（匿名）；用 `server_time` 校正本机偏移后再用同步游标。
   * 幂等只读，带 `ETag`（`If-None-Match` 命中 304），结果可离线缓存。
   * 429 限流；需要实时 `server_time` 时不要复用缓存。
   */
  meta(options?: ReadOptions): Promise<Meta> {
    return readJson<Meta>(this.ctx, { path: '/meta', resource: 'meta', options });
  }

  /**
   * 获取已 bundle 的 OpenAPI 3.1 文档（匿名）；`info.version` 是契约版本。
   * 幂等只读，带 `ETag`（可 304），随服务端版本固化、可缓存。429 限流。
   */
  openapi(options?: ReadOptions): Promise<Record<string, unknown>> {
    return readJson<Record<string, unknown>>(this.ctx, { path: '/openapi.json', resource: 'openapi', options });
  }

  /**
   * 获取 Prometheus 文本指标；需要 `metrics:read`。响应为 `text/plain`，不走缓存。
   * 只含聚合指标、无 PII；服务端为 eventual 视图（滞后不超过 `PT1M`）。
   * 401 未认证；403 缺 scope；429 限流；500 内部错误。
   */
  async metrics(options?: ReadOptions): Promise<string> {
    const result = await this.ctx.transport.get<string>('/metrics', {
      parse: 'text',
      accept: 'text/plain',
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.retry !== undefined ? { retry: options.retry } : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
    });
    options?.onResponse?.(result.meta);
    return result.data;
  }

  /**
   * 分页列出异步任务；需要 `ops:read`（否则只能看到自己创建的任务），按 `created_at` 降序。
   * 幂等只读，强一致视图，不可见等同于不存在。400 过滤非法；401 未认证；403 缺 scope。
   */
  listJobs(
    params: {
      kind?: JobKind;
      state?: JobState;
      created_by?: string;
      page?: number;
      size?: number;
      sort?: 'created_at';
      order?: SortOrder;
    } = {},
    options?: ReadOptions,
  ): Promise<PagedJob> {
    return readJson<PagedJob>(this.ctx, { path: '/jobs', query: params, resource: 'jobs', options });
  }

  /**
   * 获取异步任务；需要 `ops:read` 或为创建者本人。带强 `ETag`，运行中可按 `Retry-After` 轮询。
   * `expired` 表示产物已清理、`result` 不再可用；403 缺 scope；404 不存在或不可见。
   */
  getJob(jobId: string, options?: ReadOptions): Promise<Job> {
    const path = substitutePath('/jobs/{job_id}', { job_id: jobId });
    return readJson<Job>(this.ctx, { path, resource: 'jobs', id: jobId, options });
  }

  /**
   * 轮询异步任务直到终态（`succeeded` / `failed` / `cancelled` / `expired`）。
   *
   * 契约（README §2「异步任务」）要求按响应头的 `Retry-After` 决定下次轮询间隔；
   * 服务端没给该头时用 `intervalMs`（默认 1 秒）。`timeoutMs` 到点抛 `TimeoutError`，
   * `signal` 可取消。返回终态的 `Job`，调用方据此读 `result`（例如 `export_id`）。
   */
  async pollJob(jobId: string, options: PollJobOptions = {}): Promise<Job> {
    const path = substitutePath('/jobs/{job_id}', { job_id: jobId });
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;
    for (;;) {
      const result = await this.ctx.transport.get<Job>(path, {
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const job = result.data;
      options.onProgress?.(job);
      if (TERMINAL_JOB_STATES.includes(job.state)) return job;
      const header = Number(result.meta.headers.get('retry-after'));
      const waitMs = Number.isFinite(header) && header >= 0 ? header * 1000 : (options.intervalMs ?? 1000);
      if (deadline !== undefined && Date.now() + waitMs > deadline) {
        throw new TimeoutError(options.timeoutMs ?? 0);
      }
      await sleep(waitMs, options.signal);
    }
  }

  /** `pollJob` 的别名，语义相同。 */
  waitForJob(jobId: string, options: PollJobOptions = {}): Promise<Job> {
    return this.pollJob(jobId, options);
  }

  /**
   * 取消异步任务（协作式，已发生的外部副作用不回滚）；创建者本人或 `ops:read` 可调用。
   * 幂等写：同一 `Idempotency-Key` 重放返回首次结果，重复取消"正在取消"的任务是幂等的。
   * 403 非创建者且无 `ops:read`；404 不存在或不可见；409 任务已是终态（job_not_cancellable）。
   */
  cancelJob(jobId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Job>>;
  cancelJob(jobId: string, options?: WriteOptions): Promise<Job>;
  async cancelJob(jobId: string, options?: WriteOptions): Promise<Job | WriteOutcome<Job>> {
    const path = substitutePath('/jobs/{job_id}/cancel', { job_id: jobId });
    if (options?.queueIfOffline) return writeWithQueue<Job>(this.ctx, { method: 'POST', path, options });
    return writeJson<Job>(this.ctx, { method: 'POST', path, options });
  }
}
