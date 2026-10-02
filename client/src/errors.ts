import type { Problem, ProblemCode, ValidationError } from './types/common.js';

/** HTTP 状态码到 `ProblemCode` 的兜底映射（响应体没有提供 code 时使用）。 */
export function problemCodeForStatus(status: number): ProblemCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 409:
      return 'conflict';
    case 410:
      // 410 在契约里有两种语义：`cursor_expired`（增量同步游标超出保留期）
      // 与 `export_expired`（导出产物已被清理）。仅凭状态码分不出来，这里取更常见的
      // `cursor_expired`；服务端总是给出 `code`，调用方应按 `code` 分支，
      // 下载场景也可用 `ExportExpiredError` 识别。
      return 'cursor_expired';
    case 412:
      return 'precondition_failed';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 422:
      return 'validation_failed';
    case 429:
      return 'rate_limited';
    case 503:
      return 'service_unavailable';
    default:
      return status >= 500 ? 'internal_error' : 'bad_request';
  }
}

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p['type'] === 'string' && typeof p['title'] === 'string' && typeof p['status'] === 'number';
}

/**
 * 把任意响应体规范化为 `Problem`。契约保证 4xx/5xx 都是 problem+json，
 * 但代理/网关可能返回别的形状，因此这里必须能兜底。
 */
export function normalizeProblem(payload: unknown, status: number, fallbackTitle: string): Problem {
  if (isProblem(payload)) {
    const problem = payload as Problem;
    return {
      ...problem,
      status: typeof problem.status === 'number' ? problem.status : status,
      code: (problem.code as ProblemCode | undefined) ?? problemCodeForStatus(status),
      errors: Array.isArray(problem.errors) ? (problem.errors as ValidationError[]) : undefined,
    };
  }
  let detail: string | undefined;
  if (typeof payload === 'string' && payload.trim() !== '') {
    detail = payload.length > 500 ? `${payload.slice(0, 500)}…` : payload;
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record['message'] === 'string') detail = record['message'];
    else if (typeof record['error'] === 'string') detail = record['error'];
  }
  return {
    type: 'about:blank',
    title: fallbackTitle,
    status,
    code: problemCodeForStatus(status),
    detail,
  };
}

/** 服务端返回的 4xx/5xx（RFC 7807）。 */
export class ApiProblemError extends Error {
  override name: string = 'ApiProblemError';
  readonly problem: Problem;
  readonly status: number;
  readonly code: ProblemCode;
  /** 与响应头 `X-Request-Id` 一致，便于对服务端日志。 */
  readonly requestId?: string;
  /** 429/503 的建议等待秒数。 */
  readonly retryAfterSeconds?: number;
  readonly validationErrors: ValidationError[];

  constructor(problem: Problem, options: { requestId?: string | undefined; retryAfterSeconds?: number | undefined } = {}) {
    super(`${problem.status} ${problem.code}: ${problem.detail ?? problem.title}`);
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
    // 契约保证响应头 `X-Request-Id` 与响应体 `request_id` 一致；优先用头，缺失时回退到响应体。
    const requestId = options.requestId ?? problem.request_id;
    if (requestId !== undefined) this.requestId = requestId;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    this.validationErrors = problem.errors ?? [];
  }

  /** 字段级校验错误（`validation_failed` 时非空）。 */
  get errors(): ValidationError[] {
    return this.validationErrors;
  }
}

export function isApiProblemError(error: unknown): error is ApiProblemError {
  return error instanceof ApiProblemError;
}

/**
 * `GET /roster/exports/{export_id}/download` 返回 `410 export_expired`：
 * 产物已被保留策略清理，`download_url` 不再可用，只能**重新发起导出**。
 *
 * 无论响应体里的 `code` 是 `export_expired` 还是被状态码兜底成 `cursor_expired`，
 * 这里都统一规范成 `export_expired`，便于调用方按 `isExportExpiredError` 分支。
 */
export class ExportExpiredError extends ApiProblemError {
  override readonly name = 'ExportExpiredError';
  /** 已过期的导出记录 id。 */
  readonly exportId?: string;

  constructor(
    problem: Problem,
    options: { requestId?: string | undefined; retryAfterSeconds?: number | undefined; exportId?: string | undefined } = {},
  ) {
    super({ ...problem, code: 'export_expired' }, options);
    if (options.exportId !== undefined) this.exportId = options.exportId;
  }
}

export function isExportExpiredError(error: unknown): error is ExportExpiredError {
  return error instanceof ExportExpiredError;
}

/** 传输层失败（DNS、连接重置、TLS…）。 */
export class NetworkError extends Error {
  override readonly name: string = 'NetworkError';
  readonly url?: string;
  override readonly cause?: unknown;

  constructor(message: string, options: { url?: string; cause?: unknown } = {}) {
    super(message);
    if (options.url !== undefined) this.url = options.url;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** 请求超过 `timeoutMs`。 */
export class TimeoutError extends NetworkError {
  override readonly name = 'TimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options: { url?: string } = {}) {
    super(`请求超时（${timeoutMs}ms）`, options);
    this.timeoutMs = timeoutMs;
  }
}

/** 客户端判定当前处于离线状态（`navigator.onLine === false` 或注入的判断函数）。 */
export class OfflineError extends NetworkError {
  override readonly name = 'OfflineError';
}

/** 响应体无法按期望的格式解析。 */
export class ParseError extends Error {
  override readonly name = 'ParseError';
  readonly status: number;
  override readonly cause?: unknown;

  constructor(message: string, options: { status: number; cause?: unknown }) {
    super(message);
    this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** 请求被调用方的 `AbortSignal` 取消。 */
export class AbortedError extends Error {
  override readonly name = 'AbortedError';
  readonly reason?: unknown;

  constructor(reason?: unknown) {
    super('请求已取消');
    if (reason !== undefined) this.reason = reason;
  }
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}
