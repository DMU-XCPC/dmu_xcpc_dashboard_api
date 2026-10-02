import { describe, expect, it } from 'vitest';
import { HttpResponse, delay, http } from 'msw';
import { server, useMsw, BASE, capture, problem, type Captured } from './support.js';
import { MemoryTokenStore, SessionManager } from '../src/auth/session.js';
import { Transport } from '../src/http/transport.js';
import { ApiProblemError } from '../src/errors.js';
import { SelfResource } from '../src/resources/self.js';
import type { ResourceContext } from '../src/resources/helpers.js';
import type { Principal, TokenPair } from '../src/types/common.js';

useMsw();

const principal: Principal = {
  id: 'acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0',
  username: 'alice',
  display_name: '张三',
  kind: 'human',
  labels: ['member'],
  scopes: ['account:self'],
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  revision: '1',
};

function tokenPair(access: string, refresh: string, expiresIn = 1800): TokenPair {
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refresh,
    refresh_expires_in: 2_592_000,
    principal,
  };
}

function buildSession(options: { store?: MemoryTokenStore; apiKey?: string; apiKeyHeader?: 'authorization' | 'x-api-key' } = {}) {
  const store = options.store ?? new MemoryTokenStore();
  // 与 XcpcClient 一样：传输层与会话互相依赖，用惰性箭头打破构造顺序。
  let session!: SessionManager;
  const transport = new Transport({
    baseUrl: BASE,
    auth: {
      authorize: (headers, ctx) => session.authorize(headers, ctx),
      onUnauthorized: (problem, ctx) => session.onUnauthorized(problem, ctx),
    },
  });
  session = new SessionManager({
    transport,
    store,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.apiKeyHeader ? { apiKeyHeader: options.apiKeyHeader } : {}),
  });
  return { store, transport, session };
}

describe('会话与令牌', () => {
  it('登录保存令牌对，后续请求自动注入 Bearer', async () => {
    const seen: Captured[] = [];
    server.use(
      http.post(`${BASE}/auth/login`, async ({ request }) => {
        const captured = await capture(request);
        seen.push(captured);
        return HttpResponse.json(tokenPair('access-1', 'refresh-1'));
      }),
      http.get(`${BASE}/auth/me`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json({ ...principal, effective_scopes: ['account:self'] });
      }),
    );
    const { session, store, transport } = buildSession();

    await session.login('alice', 'correct-horse-battery-staple', { deviceName: 'Chrome' });
    expect(seen[0]?.body).toEqual({
      username: 'alice',
      password: 'correct-horse-battery-staple',
      device_name: 'Chrome',
    });
    expect(seen[0]?.headers.get('idempotency-key')).toBeNull();

    const stored = await store.load();
    expect(stored?.accessToken).toBe('access-1');
    expect(stored?.refreshToken).toBe('refresh-1');
    expect(stored?.accessExpiresAt).toBeGreaterThan(Date.now());

    await transport.get('/auth/me');
    expect(seen[1]?.headers.get('authorization')).toBe('Bearer access-1');
    expect(session.principal?.username).toBe('alice');
    expect(session.isAuthenticated()).toBe(true);
  });

  it('401 时刷新一次并重放原请求', async () => {
    let refreshCalls = 0;
    const credentials: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/credentials`, ({ request }) => {
        const token = request.headers.get('authorization');
        credentials.push(token);
        if (token === 'Bearer old') return problem(401, 'token_expired');
        return HttpResponse.json({ items: [], page: 1, size: 20, total: 0, has_next: false });
      }),
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json(tokenPair('new', 'refresh-2'));
      }),
    );
    const { session, transport } = buildSession();
    await session.applyTokenPair(tokenPair('old', 'refresh-1'));

    const result = await transport.get<{ total: number }>('/credentials');
    expect(result.data.total).toBe(0);
    expect(refreshCalls).toBe(1);
    expect(credentials).toEqual(['Bearer old', 'Bearer new']);
    expect(session.accessToken).toBe('new');
  });

  it('并发 401 只触发一次刷新（刷新令牌单次使用）', async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${BASE}/credentials`, ({ request }) => {
        const token = request.headers.get('authorization');
        if (token === 'Bearer old') return problem(401, 'token_expired');
        return HttpResponse.json({ items: [], page: 1, size: 20, total: 0, has_next: false });
      }),
      http.post(`${BASE}/auth/refresh`, async () => {
        refreshCalls += 1;
        await delay(10);
        return HttpResponse.json(tokenPair('new', 'refresh-2'));
      }),
    );
    const { session, transport } = buildSession();
    await session.applyTokenPair(tokenPair('old', 'refresh-1'));

    const [first, second] = await Promise.all([transport.get('/credentials'), transport.get('/credentials')]);
    expect(first.meta.status).toBe(200);
    expect(second.meta.status).toBe(200);
    expect(refreshCalls).toBe(1);
  });

  it('访问令牌临近过期时提前刷新，不产生 401', async () => {
    let refreshCalls = 0;
    const authHeaders: (string | null)[] = [];
    server.use(
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json(tokenPair('fresh', 'refresh-2'));
      }),
      http.get(`${BASE}/meta`, ({ request }) => {
        authHeaders.push(request.headers.get('authorization'));
        return HttpResponse.json({ api_version: '1.0.0' });
      }),
    );
    const { session, transport } = buildSession();
    await session.applyTokenPair(tokenPair('nearly-expired', 'refresh-1', 5));

    await transport.get('/meta');
    expect(refreshCalls).toBe(1);
    expect(authHeaders).toEqual(['Bearer fresh']);
  });

  it('刷新令牌失效时清空本地令牌，并抛出 401', async () => {
    server.use(
      http.post(`${BASE}/auth/refresh`, () => problem(401, 'invalid_token', { detail: '刷新令牌已失效' })),
      http.get(`${BASE}/credentials`, () => problem(401, 'token_expired')),
    );
    const { session, transport } = buildSession();
    await session.applyTokenPair(tokenPair('old', 'refresh-1'));

    await expect(transport.get('/credentials')).rejects.toMatchObject({ status: 401 });
    expect(session.accessToken).toBeUndefined();
    expect(session.isAuthenticated()).toBe(false);
  });

  it('登出在网络失败时仍清理本地令牌', async () => {
    server.use(
      http.post(`${BASE}/auth/logout`, () => HttpResponse.error()),
    );
    const { session, store } = buildSession();
    await session.applyTokenPair(tokenPair('old', 'refresh-1'));

    await expect(session.logout()).resolves.toBeUndefined();
    expect(session.accessToken).toBeUndefined();
    expect(await store.load()).toBeNull();
  });

  it('API Key 模式注入指定请求头且 401 不触发刷新', async () => {
    let refreshCalls = 0;
    const headers: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/crawler/config`, ({ request }) => {
        headers.push(request.headers.get('x-api-key'));
        return problem(401, 'invalid_token');
      }),
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return problem(401, 'invalid_token');
      }),
    );
    const { session, transport } = buildSession({ apiKey: 'xcp_secret', apiKeyHeader: 'x-api-key' });

    await expect(transport.get('/crawler/config')).rejects.toMatchObject({ status: 401 });
    expect(headers).toEqual(['xcp_secret']);
    expect(refreshCalls).toBe(0);
    expect(session.isApiKeyAuth).toBe(true);
  });
});

describe('自助改口令：契约点名不得自动重试', () => {
  it('5xx 不重试，且不发送 Idempotency-Key', async () => {
    let calls = 0;
    const keys: Array<string | null> = [];
    server.use(
      http.put(`${BASE}/auth/me/password`, ({ request }) => {
        calls += 1;
        keys.push(request.headers.get('idempotency-key'));
        return problem(503, 'service_unavailable');
      }),
    );
    const { transport } = buildSession();
    const self = new SelfResource({ transport } as unknown as ResourceContext);
    await expect(
      self.changePassword({ current_password: 'old-passphrase', new_password: 'new-passphrase-123' }),
    ).rejects.toBeInstanceOf(ApiProblemError);
    expect(calls).toBe(1);          // 503 也不重试
    expect(keys).toEqual([null]);   // 契约未声明该头，一个都不能发
  });
});
