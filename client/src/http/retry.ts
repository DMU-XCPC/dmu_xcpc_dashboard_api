import { AbortedError } from '../errors.js';

/**
 * 重试策略。默认只重试**幂等**请求与网络错误，并尊重 `Retry-After`。
 */
export interface RetryPolicy {
  /** 总尝试次数（含首次）。1 表示不重试。 */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: 'none' | 'full' | 'equal';
  /** 触发重试的响应状态码。 */
  retryOnStatus: readonly number[];
  retryNetworkErrors: boolean;
  /** 只重试幂等方法，或携带了 `Idempotency-Key` 的请求（契约要求）。 */
  retryIdempotentOnly: boolean;
  respectRetryAfter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  jitter: 'full',
  retryOnStatus: [408, 425, 429, 500, 502, 503, 504],
  retryNetworkErrors: true,
  retryIdempotentOnly: true,
  respectRetryAfter: true,
};

export function resolveRetryPolicy(partial?: Partial<RetryPolicy> | false): RetryPolicy {
  if (partial === false) return { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };
  return { ...DEFAULT_RETRY_POLICY, ...(partial ?? {}) };
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

export function shouldRetryStatus(status: number, policy: RetryPolicy): boolean {
  return policy.retryOnStatus.includes(status);
}

/**
 * 计算自算退避时长（仅用于客户端自己的指数退避与抖动）。
 *
 * 注意：传入 `retryAfterSeconds` 时结果仍会被 `maxDelayMs` 截断，这是历史兼容行为
 * （见 `test/primitives.test.ts`）。传输层实际使用的是 {@link computeRetryDelay}，
 * 它**不会截断**服务端显式给出的 `Retry-After`。
 */
export function computeBackoffDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfterSeconds?: number,
  random: () => number = Math.random,
): number {
  if (policy.respectRetryAfter && retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);
  switch (policy.jitter) {
    case 'none':
      return exponential;
    case 'equal':
      return exponential / 2 + random() * (exponential / 2);
    case 'full':
    default:
      return random() * exponential;
  }
}

/**
 * 计算一次重试前的等待时长（传输层使用）。
 *
 * 契约要求**尊重 `Retry-After`**（README §4.10：`429`/`503` 按 `Retry-After` 退避）：
 * 服务端显式给出的等待时间**不得被 `maxDelayMs` 截断**，否则客户端会早于服务端允许的
 * 时刻重试，可能继续被限流。只有客户端自算的指数退避才受 `maxDelayMs` 限制。
 */
export function computeRetryDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfterSeconds?: number,
  random: () => number = Math.random,
): number {
  if (policy.respectRetryAfter && retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }
  return computeBackoffDelay(attempt, policy, undefined, random);
}

/** 可被 `AbortSignal` 打断的 sleep。 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError(signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortedError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
