import type { HttpMethod } from '../http/transport.js';
import type {
  IngestHandleSnapshotsRequest,
  IngestProblemsRequest,
  IngestRatingRecordsRequest,
  IngestResult,
  IngestSubmissionsRequest,
} from '../types/oj.js';
import {
  writeJson,
  writeWithQueue,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/**
 * ingest 写入通道：采集器批量上报 OJ 数据的唯一写入口。
 *
 * 四个方法都是 POST、需要 `ingest:write`，返回 `IngestResult`（`200` 可能部分成功，
 * 必须检查 `rejected`）；批次超 `capabilities.ingest_batch_max` 返回 `413`（整批不入库），
 * 幂等由自然键保证，全部支持 `queueIfOffline`。
 */
export class IngestResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 批量上报 OJ 提交记录（自然键 `(judge, submission_id)`，重复记为 `duplicate`）。
   * 需要 `ingest:write`；可 `queueIfOffline`，同键重放返回首次结果。
   * 语义错误无法定位到单条 `422`，批次超限 `413 payload_too_large`，服务不可用 `503`。
   */
  submissions(
    body: IngestSubmissionsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<IngestResult>>;
  submissions(body: IngestSubmissionsRequest, options?: WriteOptions): Promise<IngestResult>;
  async submissions(
    body: IngestSubmissionsRequest,
    options?: WriteOptions,
  ): Promise<IngestResult | WriteOutcome<IngestResult>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/submissions', body, options });
    }
    return writeJson<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/submissions', body, options });
  }

  /**
   * 批量上报 rating 记录：只需要"某时刻的 rating"，`delta` 由服务端派生。
   * 自然键带 `contest_id` 时为 `(judge, handle, contest_id)`，省略时为 `(judge, handle, at)`；
   * 重复记为 `duplicate`（不是错误）。
   * 需要 `ingest:write`；可 `queueIfOffline`，同键重放返回首次结果。
   * `items` 为空等语义错误 `422`，批次超限 `413 payload_too_large`，服务不可用 `503`。
   */
  ratings(
    body: IngestRatingRecordsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<IngestResult>>;
  ratings(body: IngestRatingRecordsRequest, options?: WriteOptions): Promise<IngestResult>;
  async ratings(
    body: IngestRatingRecordsRequest,
    options?: WriteOptions,
  ): Promise<IngestResult | WriteOutcome<IngestResult>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<IngestResult>(this.ctx, {
        method: 'POST',
        path: '/ingest/oj/ratings',
        body,
        options,
      });
    }
    return writeJson<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/ratings', body, options });
  }

  /**
   * 批量上报账号指标快照（自然键 `(judge, handle, captured_at)`）。
   * 需要 `ingest:write`；可 `queueIfOffline`，同键重放返回首次结果。
   * 单条越界只记 `rejected`，批次超限 `413 payload_too_large`，服务不可用 `503`。
   */
  handleSnapshots(
    body: IngestHandleSnapshotsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<IngestResult>>;
  handleSnapshots(body: IngestHandleSnapshotsRequest, options?: WriteOptions): Promise<IngestResult>;
  async handleSnapshots(
    body: IngestHandleSnapshotsRequest,
    options?: WriteOptions,
  ): Promise<IngestResult | WriteOutcome<IngestResult>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<IngestResult>(this.ctx, {
        method: 'POST',
        path: '/ingest/oj/handle-snapshots',
        body,
        options,
      });
    }
    return writeJson<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/handle-snapshots', body, options });
  }

  /**
   * 批量上报题目元数据（自然键 `(judge, external_id)`，已有题目只补全非空字段）。
   * 需要 `ingest:write`；可 `queueIfOffline`，同键重放返回首次结果。
   * 单条校验失败只记 `rejected`，批次超限 `413 payload_too_large`，服务不可用 `503`。
   */
  problems(
    body: IngestProblemsRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<IngestResult>>;
  problems(body: IngestProblemsRequest, options?: WriteOptions): Promise<IngestResult>;
  async problems(
    body: IngestProblemsRequest,
    options?: WriteOptions,
  ): Promise<IngestResult | WriteOutcome<IngestResult>> {
    if (options?.queueIfOffline) {
      return writeWithQueue<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/problems', body, options });
    }
    return writeJson<IngestResult>(this.ctx, { method: 'POST', path: '/ingest/oj/problems', body, options });
  }
}

/** 本模块方法到契约 `operationId` / 路径模板的映射（供契约测试校验）。 */
export const INGEST_OPERATIONS = {
  ingestOjSubmissions: { method: 'POST', path: '/ingest/oj/submissions' },
  ingestOjRatings: { method: 'POST', path: '/ingest/oj/ratings' },
  ingestOjHandleSnapshots: { method: 'POST', path: '/ingest/oj/handle-snapshots' },
  ingestOjProblems: { method: 'POST', path: '/ingest/oj/problems' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;
