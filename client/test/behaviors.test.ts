/**
 * 契约行为测试：把 README §2/§4.x 与 operation description 里承诺的**时序行为**钉住。
 *
 * 覆盖：`Retry-After` 不被截断、异步任务轮询、`download_token`、SSE 的
 * `resync_required` 与固定重连间隔、`410 cursor_expired` 自动重新基线化、
 * 条件读 `If-None-Match` 透传。
 */
import { describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { ApiCache } from '../src/cache/cache.js';
import { MemoryCacheStore } from '../src/cache/store.js';
import { SyncEngine } from '../src/cache/sync.js';
import { ApiProblemError } from '../src/errors.js';
import { DEFAULT_RETRY_POLICY, computeRetryDelay } from '../src/http/retry.js';
import { Transport } from '../src/http/transport.js';
import { readJson, writeJson } from '../src/resources/helpers.js';
import { OpsResource } from '../src/resources/ops.js';
import { RosterResource } from '../src/resources/roster.js';
import { SseClient, SseParser } from '../src/sse.js';
import { BASE, capture, problem, server, sseResponse, useMsw, type Captured } from './support.js';

useMsw();

const CTX = (transport: Transport) => ({ transport, cache: undefined, outbox: undefined }) as never;

function makeTransport(): Transport {
  return new Transport({ baseUrl: BASE });
}

describe('退避：服务端给的 Retry-After 不得被截断', () => {
  it('显式 Retry-After 原样使用，自算指数退避仍受 maxDelayMs 限制', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxDelayMs: 5_000 };
    // 服务端要求 60 秒 → 必须等满 60 秒（不能被 5 秒截断）
    expect(computeRetryDelay(1, policy, 60)).toBe(60_000);
    // 没有 Retry-After 时用指数退避，受上限约束
    expect(computeRetryDelay(10, policy)).toBeLessThanOrEqual(5_000);
  });
});

describe('异步任务：202 + Location + Retry-After → 轮询到终态', () => {
  it('按 Retry-After 轮询，直到 succeeded 并返回 result', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/jobs/job_1`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json(
            { id: 'job_1', kind: 'roster_export', state: 'running', progress: { percent: 50 } },
            { status: 200, headers: { 'retry-after': '0' } },
          );
        }
        return HttpResponse.json({
          id: 'job_1',
          kind: 'roster_export',
          state: 'succeeded',
          progress: { percent: 100 },
          result: { export_id: 'exp_1' },
        });
      }),
    );
    const ops = new OpsResource(CTX(makeTransport()));
    const job = await ops.pollJob('job_1', { intervalMs: 1, timeoutMs: 5_000 });
    expect([job.state, calls]).toEqual(['succeeded', 3]);
    expect((job.result as { export_id: string }).export_id).toBe('exp_1');
  });

  it('超时抛 TimeoutError，不无限轮询', async () => {
    server.use(
      http.get(`${BASE}/jobs/job_2`, () =>
        HttpResponse.json(
          { id: 'job_2', kind: 'roster_export', state: 'running', progress: { percent: 1 } },
          { status: 200, headers: { 'retry-after': '3600' } },
        ),
      ),
    );
    const ops = new OpsResource(CTX(makeTransport()));
    await expect(ops.pollJob('job_2', { timeoutMs: 50 })).rejects.toThrowError(/超时/);
  });
});

describe('导出下载：支持契约声明的 download_token', () => {
  it('把 download_token 放进查询参数', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE}/roster/exports/exp_1/download`, ({ request }) => {
        urls.push(request.url);
        return new HttpResponse('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } });
      }),
    );
    const roster = new RosterResource(CTX(makeTransport()));
    const body = await roster.download('exp_1', { downloadToken: 'xcd_token' });
    expect(String(body)).toContain('a,b');
    expect(urls[0]).toContain('download_token=xcd_token');
  });

  it('产物过期（410 export_expired）抛可识别的错误，便于重新发起导出', async () => {
    server.use(
      http.get(`${BASE}/roster/exports/exp_2/download`, () => problem(410, 'export_expired')),
    );
    const roster = new RosterResource(CTX(makeTransport()));
    await expect(roster.download('exp_2')).rejects.toBeInstanceOf(ApiProblemError);
  });
});

describe('SSE：缺口标记与固定重连间隔', () => {
  it('读事件里的 resync_required，而不是恒为 true', async () => {
    server.use(
      http.get(`${BASE}/stream/events`, () =>
        sseResponse([
          'id: 1\nevent: stream.gap\ndata: {"id":"1","sequence":1,"topic":"announcements","type":"stream.gap","occurred_at":"2024-05-06T07:08:09.123Z","revision":null,"resource":null,"data":{"resync_required":false,"from_sequence":0,"to_sequence":1}}\n\n',
        ]),
      ),
    );
    const gaps: Array<{ resyncRequired: boolean }> = [];
    const client = new SseClient({
      transport: makeTransport(),
      topics: ['announcements'],
      onGap: (info) => gaps.push({ resyncRequired: info.resyncRequired }),
      autoReconnect: false,
    });
    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.stop();
    expect(gaps[0]?.resyncRequired).toBe(false);
  });

  it('服务端首帧 retry: 3000 决定重连间隔（3 秒），而非自造 1 秒', async () => {
    // 解析器把服务端的 retry: 作为可读的重连间隔暴露给客户端
    const frames = new SseParser().push('retry: 3000\n\n');
    expect(frames[0]?.retry).toBe(3000);
  });
});

describe('增量同步：游标过期自动重新基线化', () => {
  it('遇到 410 cursor_expired 会 reset + baseline 并继续拉取一次', async () => {
    const calls: string[] = [];
    server.use(
      http.get(`${BASE}/sync/changes`, ({ request }) => {
        const since = new URL(request.url).searchParams.get('since');
        calls.push(since ?? '(none)');
        if (since === 'stale') return problem(410, 'cursor_expired');
        if (since === null) {
          return HttpResponse.json({ changes: [], cursor: 'c0', has_more: false, server_time: '2024-05-06T07:08:09.123Z', retention: 'P30D' });
        }
        return HttpResponse.json({ changes: [], cursor: 'c1', has_more: false, server_time: '2024-05-06T07:08:09.123Z', retention: 'P30D' });
      }),
    );
    const store = new MemoryCacheStore();
    const rebaselined: string[] = [];
    const sync = new SyncEngine({
      transport: makeTransport(),
      store,
      onRebaseline: (info) => rebaselined.push(info.cursor),
    });
    await sync.setCursor('stale');
    const feed = await sync.pullAll();
    expect(calls).toEqual(['stale', '(none)', 'c0']);
    expect(rebaselined).toEqual(['c0']);
    // 重新基线化后还会用新游标再拉一页，因此最终游标是那一页返回的 c1
    expect(feed.cursor).toBe('c1');
  });
});

describe('条件读：If-None-Match 透传', () => {
  it('把 ifNoneMatch 原样作为请求头发送', async () => {
    const seen: Captured[] = [];
    server.use(
      http.get(`${BASE}/accounts/acc_1`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json({ id: 'acc_1' });
      }),
    );
    const transport = makeTransport();
    await transport.get('/accounts/acc_1', { ifNoneMatch: '"17"' });
    expect(seen[0]?.headers.get('if-none-match')).toBe('"17"');
  });
});

describe('写后失效：改完再读不能命中旧副本', () => {
  it('写操作成功后按资源集合失效本地缓存', async () => {
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 60_000, staleWhileRevalidate: false });
    const t = makeTransport();
    const ctx = { transport: t, cache } as never;
    let reads = 0;
    const page = { items: [], page: 1, size: 20, total: 0, has_next: false };
    const principal = {
      id: 'acc_1', username: 'alice', display_name: '张三', kind: 'human',
      labels: [], scopes: [], status: 'active',
      created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-02T00:00:00.000Z', revision: '2',
    };
    server.use(
      http.get(`${BASE}/accounts`, () => {
        reads += 1;
        return HttpResponse.json(page);
      }),
      http.patch(`${BASE}/accounts/acc_1`, () => HttpResponse.json(principal)),
    );

    await readJson(ctx, { path: '/accounts', resource: 'accounts', query: { page: 1 } });
    await readJson(ctx, { path: '/accounts', resource: 'accounts', query: { page: 1 } });
    expect(reads).toBe(1);                    // TTL 内命中本地副本

    await writeJson(ctx, { method: 'PATCH', path: '/accounts/acc_1', body: { display_name: '李四' } });

    await readJson(ctx, { path: '/accounts', resource: 'accounts', query: { page: 1 } });
    expect(reads).toBe(2);                    // 写后必须回源，不能拿到旧副本
  });
});

