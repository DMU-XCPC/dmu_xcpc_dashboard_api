import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { ResponseMeta } from '../src/http/transport.js';

export const BASE = 'https://api.test/api/v1';

export const server = setupServer();

/** 每个测试文件调用一次：严格的 msw 生命周期与"未处理的请求即失败"。 */
export function useMsw(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => server.close());
}

/** 构造 RFC 7807 `application/problem+json` 响应。 */
export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    {
      type: `https://docs.dmu-xcpc.example/errors/${code}`,
      title: code,
      status,
      code,
      ...extra,
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export interface Captured {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/** 记录请求的辅助函数。 */
export async function capture(request: Request): Promise<Captured> {
  let body: unknown;
  const text = await request.text();
  if (text !== '') {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { method: request.method, url: new URL(request.url), headers: request.headers, body };
}

/** 构造缓存层使用的 `ResponseMeta`。 */
export function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    status: 200,
    ok: true,
    method: 'GET',
    url: `${BASE}/resource`,
    headers: new Headers(),
    replayed: false,
    notModified: false,
    attempts: 1,
    durationMs: 1,
    ...partial,
  };
}

/** 构造一个可控时钟。 */
export function fakeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void; set: (value: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (value: number) => {
      current = value;
    },
  };
}

/** 生成一个把字符串分块推送的可读流（SSE 测试用）。 */
export function streamFromChunks(chunks: string[], options: { close?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index] ?? ''));
        index += 1;
        return;
      }
      if (options.close !== false) controller.close();
    },
  });
}

/** 把字符串分块包成 `text/event-stream` 响应（SSE 测试用）。 */
export function sseResponse(
  chunks: string[],
  options: { close?: boolean; status?: number } = {},
): HttpResponse<ReadableStream<Uint8Array>> {
  return new HttpResponse<ReadableStream<Uint8Array>>(streamFromChunks(chunks, options), {
    status: options.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * 构造**不带 `code` 字段**的 problem+json。
 * 用于验证客户端在服务端省略机器可读 `code` 时按 HTTP 状态码兜底映射
 * （契约 §6：客户端必须按 `code` 分支，并对未知/缺失 code 回退到状态码处理）。
 */
export function problemBare(status: number, title = 'Request failed') {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** 轮询等待条件成立，返回是否在超时前成立。 */
export async function waitUntil(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 5;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}
