import { describe, expect, it } from 'vitest';
import { HttpResponse, delay, http } from 'msw';
import { server, useMsw, BASE, capture, problem, type Captured } from './support.js';
import { ApiProblemError, NetworkError, OfflineError, TimeoutError } from '../src/errors.js';
import { Transport } from '../src/http/transport.js';

useMsw();

const fastRetry = { baseDelayMs: 1, maxDelayMs: 5, jitter: 'none' as const };
const keyed = { randomUUID: () => 'k-fixed' };

describe('Transport 请求构造', () => {
  it('拼接 baseUrl 与重复键查询串，注入认证头、幂等键与 JSON 请求体', async () => {
    const seen: Captured[] = [];
    server.use(
      http.post(`${BASE}/announcements`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json({ id: 'ann_1' }, { status: 201, headers: { etag: '"1"', 'x-request-id': 'req_1' } });
      }),
    );
    const transport = new Transport({
      baseUrl: BASE,
      ...keyed,
      auth: { authorize: (headers) => headers.set('Authorization', 'Bearer tok') },
    });
    const result = await transport.post<{ id: string }>('/announcements', {
      body: { title: '训练通知' },
      query: { publish: true, tag: ['a', 'b'] },
    });

    expect(result.data.id).toBe('ann_1');
    const request = seen[0];
    expect(request).toBeDefined();
    expect(request?.headers.get('authorization')).toBe('Bearer tok');
    expect(request?.headers.get('idempotency-key')).toBe('k-fixed');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('accept')).toBe('application/json');
    expect(request?.body).toEqual({ title: '训练通知' });
    expect(`${request?.url.pathname ?? ''}${request?.url.search ?? ''}`).toBe('/api/v1/announcements?publish=true&tag=a&tag=b');
    expect(result.meta.etag).toBe('"1"');
    expect(result.meta.revision).toBe('1');
    expect(result.meta.requestId).toBe('req_1');
    expect(result.meta.attempts).toBe(1);
  });

  it('GET 不携带 Idempotency-Key；写操作自动生成且跨重试保持不变', async () => {
    const getHeaders: (string | null)[] = [];
    const postHeaders: (string | null)[] = [];
    let postAttempts = 0;
    server.use(
      http.get(`${BASE}/meta`, ({ request }) => {
        getHeaders.push(request.headers.get('idempotency-key'));
        return HttpResponse.json({ api_version: '1.0.0' });
      }),
      http.post(`${BASE}/announcements`, ({ request }) => {
        postHeaders.push(request.headers.get('idempotency-key'));
        postAttempts += 1;
        if (postAttempts === 1) return problem(503, 'service_unavailable');
        return HttpResponse.json({ id: 'ann_2' }, { status: 201 });
      }),
    );
    const transport = new Transport({ baseUrl: BASE, randomUUID: () => 'auto-key', retry: fastRetry });

    await transport.get('/meta');
    expect(getHeaders).toEqual([null]);

    await transport.post('/announcements', { body: { title: 'x' } });
    expect(postAttempts).toBe(2);
    expect(postHeaders).toEqual(['auto-key', 'auto-key']);
  });

  it('noAuth 跳过认证注入', async () => {
    const headers: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/auth/login`, ({ request }) => {
        headers.push(request.headers.get('authorization'));
        return HttpResponse.json({ access_token: 'a' });
      }),
    );
    const transport = new Transport({
      baseUrl: BASE,
      auth: { authorize: (h) => h.set('Authorization', 'Bearer should-not-appear') },
    });
    await transport.post('/auth/login', { body: { username: 'u', password: 'p' }, noAuth: true, idempotencyKey: false });
    expect(headers).toEqual([null]);
  });

  it('noAuth 请求收到 401 时不触发 onUnauthorized（避免刷新请求递归等待自身）', async () => {
    let unauthorizedCalls = 0;
    server.use(http.post(`${BASE}/auth/refresh`, () => problem(401, 'invalid_token')));
    const transport = new Transport({
      baseUrl: BASE,
      auth: {
        onUnauthorized: () => {
          unauthorizedCalls += 1;
          return true;
        },
      },
    });
    const error = await transport
      .post('/auth/refresh', { body: { refresh_token: 'r' }, noAuth: true, retry: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    expect(unauthorizedCalls).toBe(0);
  });
});

describe('Transport 错误映射', () => {
  it('把 problem+json 映射为 ApiProblemError，并保留 code/request_id/errors', async () => {
    server.use(
      http.post(`${BASE}/members/import`, () =>
        problem(422, 'validation_failed', {
          detail: '2 个字段未通过校验',
          request_id: 'req_422',
          errors: [{ pointer: '/rows/1/student_id', message: '学号已存在', code: 'conflict' }],
        }),
      ),
    );
    const transport = new Transport({ baseUrl: BASE, retry: false });
    const error = await transport.post('/members/import', { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    const apiError = error as ApiProblemError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('validation_failed');
    expect(apiError.requestId).toBe('req_422');
    expect(apiError.errors).toEqual([{ pointer: '/rows/1/student_id', message: '学号已存在', code: 'conflict' }]);
  });

  it('非 JSON 错误体也能兜底成 Problem', async () => {
    server.use(
      http.get(`${BASE}/metrics`, () => new HttpResponse('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })),
    );
    const transport = new Transport({ baseUrl: BASE, retry: false });
    const error = (await transport.get('/metrics').catch((e: unknown) => e)) as ApiProblemError;
    expect(error).toBeInstanceOf(ApiProblemError);
    expect(error.code).toBe('internal_error');
    expect(error.problem.detail).toContain('502 Bad Gateway');
  });

  it('4xx（非 429）不重试', async () => {
    let attempts = 0;
    server.use(
      http.get(`${BASE}/accounts/missing`, () => {
        attempts += 1;
        return problem(404, 'not_found');
      }),
    );
    const transport = new Transport({ baseUrl: BASE, retry: fastRetry });
    await expect(transport.get('/accounts/missing')).rejects.toBeInstanceOf(ApiProblemError);
    expect(attempts).toBe(1);
  });

  it('503 按 Retry-After 退避后重试并成功', async () => {
    let attempts = 0;
    const retries: number[] = [];
    server.use(
      http.get(`${BASE}/meta`, () => {
        attempts += 1;
        if (attempts === 1) return problem(503, 'service_unavailable', { retry_after_seconds: 0 });
        return HttpResponse.json({ api_version: '1.0.0' });
      }),
    );
    const transport = new Transport({
      baseUrl: BASE,
      retry: { ...fastRetry, maxAttempts: 3 },
      onRetry: (info) => retries.push(info.attempt),
    });
    const result = await transport.get<{ api_version: string }>('/meta');
    expect(result.data.api_version).toBe('1.0.0');
    expect(attempts).toBe(2);
    expect(retries).toEqual([1]);
    expect(result.meta.attempts).toBe(2);
  });

  it('429 抛出 ApiProblemError 并带 retryAfterSeconds', async () => {
    server.use(
      http.get(`${BASE}/members`, () =>
        problem(429, 'rate_limited', { retry_after_seconds: 12 }),
      ),
    );
    const transport = new Transport({ baseUrl: BASE, retry: false });
    const error = (await transport.get('/members').catch((e: unknown) => e)) as ApiProblemError;
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
  });
});

describe('Transport 条件请求、超时与离线', () => {
  it('304 返回 notModified 且不抛错', async () => {
    server.use(
      http.get(
        `${BASE}/members/mem_1`,
        () => new HttpResponse(null, { status: 304, headers: { etag: '"7"' } }),
      ),
    );
    const transport = new Transport({ baseUrl: BASE });
    const result = await transport.get<undefined>('/members/mem_1', { ifNoneMatch: '"7"' });
    expect(result.meta.notModified).toBe(true);
    expect(result.meta.revision).toBe('7');
    expect(result.data).toBeUndefined();
  });

  it('解析限流响应头到 meta.rateLimit', async () => {
    server.use(
      http.get(`${BASE}/scoreboards`, () =>
        HttpResponse.json({ items: [] }, {
          headers: { 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '30' },
        }),
      ),
    );
    const transport = new Transport({ baseUrl: BASE });
    const result = await transport.get('/scoreboards');
    expect(result.meta.rateLimit).toMatchObject({ limit: 600, remaining: 42, resetSeconds: 30 });
    expect(transport.rateLimit?.remaining).toBe(42);
  });

  it('请求超时抛 TimeoutError', async () => {
    server.use(http.get(`${BASE}/hangs`, async () => delay('infinite')));
    const transport = new Transport({ baseUrl: BASE, timeoutMs: 40, retry: false });
    const error = await transport.get('/hangs').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('网络错误重试后仍失败则抛 NetworkError', async () => {
    let attempts = 0;
    server.use(
      http.get(`${BASE}/flaky`, () => {
        attempts += 1;
        return HttpResponse.error();
      }),
    );
    const transport = new Transport({ baseUrl: BASE, retry: { ...fastRetry, maxAttempts: 2 } });
    const error = await transport.get('/flaky').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(attempts).toBe(2);
  });

  it('离线时立即抛 OfflineError（不发请求）', async () => {
    let attempts = 0;
    server.use(
      http.get(`${BASE}/members`, () => {
        attempts += 1;
        return HttpResponse.json({ items: [] });
      }),
    );
    const transport = new Transport({ baseUrl: BASE, isOnline: () => false });
    await expect(transport.get('/members')).rejects.toBeInstanceOf(OfflineError);
    expect(attempts).toBe(0);
  });

  it('可被调用方 AbortSignal 取消', async () => {
    server.use(http.get(`${BASE}/slow`, async () => delay(500)));
    const transport = new Transport({ baseUrl: BASE, timeoutMs: 5_000, retry: false });
    const controller = new AbortController();
    const promise = transport.get('/slow', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortedError' });
  });

  it('非浏览器环境要求绝对 baseUrl', async () => {
    const transport = new Transport({ baseUrl: '/api/v1' });
    await expect(transport.get('/meta')).rejects.toBeInstanceOf(NetworkError);
  });
});
