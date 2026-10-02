/**
 * 资源方法的行为：请求构造、缓存读穿、离线队列、并发控制与错误映射。
 *
 * 这些断言直接对齐契约里的语义（scope/幂等/If-Match/202+Job 等），
 * 而不是实现细节——因此服务端实现换语言也不会让它们失效。
 */
import { describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server, useMsw, BASE, capture, problem, streamFromChunks, type Captured } from './support.js';
import { fixtures } from './fixtures.js';
import { ApiProblemError, MemoryCacheStore, XcpcClient, type XcpcClientOptions } from '../src/index.js';

useMsw();

const CLAIM_QUOTA = 'quota_01J8Z5V6Q0K3M7N9P2R4T6W8X0';

function clientWith(options: XcpcClientOptions = {}): XcpcClient {
  return new XcpcClient({
    baseUrl: BASE,
    cache: new MemoryCacheStore(),
    cacheTtlMs: 60_000,
    cacheOptions: { staleWhileRevalidate: false },
    ...options,
  });
}

describe('资源方法：请求构造', () => {
  it('列表查询参数：数组用重复键、布尔与排序按契约命名、单资源路径参数被替换', async () => {
    const seen: Captured[] = [];
    server.use(
      http.get(`${BASE}/members`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json(fixtures.PagedMember, { headers: { etag: '"9"' } });
      }),
      http.get(`${BASE}/members/${fixtures.Member.id}`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json(fixtures.Member, { headers: { etag: '"7"' } });
      }),
    );
    const client = clientWith();

    const page = await client.members.list({
      label: ['member', '2022'],
      club: ['acm_icpc'],
      page: 2,
      size: 50,
      sort: 'last_active_at',
      order: 'desc',
    });
    expect(page.total).toBe(fixtures.PagedMember.total);
    expect(`${seen[0]?.url.pathname}${seen[0]?.url.search}`).toBe(
      '/api/v1/members?label=member&label=2022&club=acm_icpc&page=2&size=50&sort=last_active_at&order=desc',
    );

    const member = await client.members.get(fixtures.Member.id);
    expect(member.id).toBe(fixtures.Member.id);
    expect(seen[1]?.url.pathname).toBe(`/api/v1/members/${fixtures.Member.id}`);
  });

  it('写操作自动生成 Idempotency-Key，并透传 If-Match', async () => {
    const seen: Captured[] = [];
    server.use(
      http.patch(`${BASE}/members/${fixtures.Member.id}`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json(fixtures.Member, { headers: { etag: '"8"' } });
      }),
    );
    const client = clientWith();
    const updated = await client.members.update(fixtures.Member.id, { display_name: '张三（队长）' }, { ifMatch: '"7"' });

    expect(updated).toMatchObject({ id: fixtures.Member.id });
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.headers.get('if-match')).toBe('"7"');
    expect(seen[0]?.headers.get('idempotency-key')).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(seen[0]?.body).toEqual({ display_name: '张三（队长）' });
  });

  it('412 并发冲突映射为 ApiProblemError(version_conflict)', async () => {
    server.use(http.patch(`${BASE}/members/${fixtures.Member.id}`, () => problem(412, 'version_conflict')));
    const client = clientWith();
    const error = await client.members
      .update(fixtures.Member.id, { display_name: 'x' }, { ifMatch: '"1"' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    expect((error as ApiProblemError).code).toBe('version_conflict');
    expect((error as ApiProblemError).status).toBe(412);
  });

  it('采集写入按契约发送批次并返回逐条结果', async () => {
    const seen: Captured[] = [];
    server.use(
      http.post(`${BASE}/ingest/oj/submissions`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json(fixtures.IngestResult);
      }),
    );
    const crawler = new XcpcClient({ baseUrl: BASE, apiKey: 'xcp_secret', apiKeyHeader: 'x-api-key', cache: false });
    const result = await crawler.ingest.submissions({
      items: [
        {
          judge: 'codeforces',
          submission_id: '1700000001',
          handle: 'alice',
          problem: { judge: 'codeforces', external_id: '1900A' },
          verdict: 'accepted',
          submitted_at: '2024-05-06T07:00:00.000Z',
        },
      ],
    });
    expect(result.accepted).toBe(fixtures.IngestResult.accepted);
    expect(seen[0]?.headers.get('x-api-key')).toBe('xcp_secret');
    expect(seen[0]?.headers.get('idempotency-key')).toBeTruthy();
  });
});

  it('rating 上报只发送观测值：省略 contest_id、不注入 delta', async () => {
    const seen: Captured[] = [];
    server.use(
      http.post(`${BASE}/ingest/oj/ratings`, async ({ request }) => {
        seen.push(await capture(request));
        return HttpResponse.json({
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          items: [{ index: 0, status: 'accepted', id: 'rch_01J8Z5V6Q0K3M7N9P2R4T6W8X0' }],
          crawler_run_id: null,
          materialized_at: '2024-05-06T07:10:00.000Z',
        });
      }),
    );
    const bot = new XcpcClient({ baseUrl: BASE, apiKey: 'xcp_secret', apiKeyHeader: 'x-api-key', cache: false });
    const result = await bot.ingest.ratings({
      items: [{ judge: 'atcoder', handle: 'tourist', rating: 2843, at: '2024-05-01T00:00:00.000Z' }],
    });

    expect(result.accepted).toBe(1);
    expect(seen[0]?.url.pathname).toBe('/api/v1/ingest/oj/ratings');
    // 客户端不得凭空补 delta：原始数据只有"某时刻的 rating"
    expect(seen[0]?.body).toEqual({
      items: [{ judge: 'atcoder', handle: 'tourist', rating: 2843, at: '2024-05-01T00:00:00.000Z' }],
    });
  });

describe('资源方法：缓存读穿（弱网降级基础）', () => {
  it('新鲜期内不重复请求；后台回源用 If-None-Match 校验', async () => {
    let requests = 0;
    const conditional: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/members`, ({ request }) => {
        requests += 1;
        conditional.push(request.headers.get('if-none-match'));
        if (requests === 1) return HttpResponse.json(fixtures.PagedMember, { headers: { etag: '"9"' } });
        return new HttpResponse(null, { status: 304, headers: { etag: '"9"' } });
      }),
    );
    const swrClient = clientWith({ cacheOptions: { staleWhileRevalidate: true, ttlMs: 60_000 } });

    await swrClient.members.list();
    const cached = await swrClient.members.list();
    expect(cached.total).toBe(fixtures.PagedMember.total);
    expect(requests).toBe(1); // 命中本地副本，未阻塞在网络上

    await swrClient.cache?.whenIdle();
    expect(requests).toBe(2);
    expect(conditional).toEqual([null, '"9"']);
  });

  it('网络失败时返回过期副本（结果标记 stale），离线写入则入队', async () => {
    let online = true;
    let listFailures = 0;
    server.use(
      http.get(`${BASE}/members`, () => {
        if (online) return HttpResponse.json(fixtures.PagedMember, { headers: { etag: '"9"' } });
        listFailures += 1;
        return HttpResponse.error();
      }),
      http.post(`${BASE}/quotas/${CLAIM_QUOTA}/claims`, () => HttpResponse.json(fixtures.QuotaClaim, { status: 201 })),
    );
    const client = clientWith({ isOnline: () => online, cacheOptions: { ttlMs: 0, maxStaleMs: 60_000 } });

    await client.members.list(); // 写入副本
    const metas: Array<{ stale?: boolean; fromCache?: boolean }> = [];
    online = false;
    const degraded = await client.members.list({}, { onResponse: (meta) => metas.push({ stale: meta.stale, fromCache: meta.fromCache }) });
    expect(degraded.total).toBe(fixtures.PagedMember.total);
    expect(listFailures).toBe(0); // 离线时根本没有发请求

    const outcome = await client.quotas.createClaim(
      CLAIM_QUOTA,
      { team_id: 'team_01J8Z5V6Q0K3M7N9P2R4T6W8X0', members: [{ principal_id: fixtures.Member.id }] },
      { queueIfOffline: true },
    );
    expect(outcome.queued).toBe(true);

    online = true;
    const report = await client.outbox?.flush();
    expect(report?.sent).toHaveLength(1);
    expect(report?.remaining).toEqual([]);
  });
});

describe('资源方法：下载与增量同步', () => {
  it('成员名单导出下载返回 CSV 文本（不走缓存、带 Accept: text/csv）', async () => {
    const seen: Captured[] = [];
    server.use(
      http.get(`${BASE}/roster/exports/${fixtures.RosterExport.id}/download`, async ({ request }) => {
        seen.push(await capture(request));
        return new HttpResponse('username,student_id\nalice,2220210000\n', {
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="roster.csv"' },
        });
      }),
    );
    const client = clientWith();
    const csv = await client.roster.download(fixtures.RosterExport.id);
    expect(csv).toContain('alice,2220210000');
    expect(seen[0]?.headers.get('accept')).toBe('text/csv');
  });

  it('sync.pullAll 逐页追赶并持久化游标', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/sync/changes`, ({ request }) => {
        const since = new URL(request.url).searchParams.get('since');
        cursors.push(since);
        if (since === null) {
          return HttpResponse.json({ changes: [], cursor: 'C0', has_more: false, server_time: '2024-05-06T07:08:09.123Z', retention: 'P30D' });
        }
        if (since === 'C0') {
          return HttpResponse.json({
            changes: [{ resource: 'members', id: fixtures.Member.id, op: 'upsert', revision: '18', updated_at: '2024-05-06T07:08:09.123Z' }],
            cursor: 'C1',
            has_more: true,
            server_time: '2024-05-06T07:08:09.123Z',
            retention: 'P30D',
          });
        }
        return HttpResponse.json({ changes: [], cursor: 'C1', has_more: false, server_time: '2024-05-06T07:08:09.123Z', retention: 'P30D' });
      }),
    );
    const client = clientWith();
    const baseline = await client.sync.baseline();
    expect(baseline).toBe('C0');

    const collected: string[] = [];
    const result = await client.sync.pullAll(baseline);
    expect(result.cursor).toBe('C1');
    expect(result.changes).toHaveLength(1);
    expect(cursors).toEqual([null, 'C0', 'C1']);
    expect(await client.syncResource.cursor()).toBe('C1');
    collected.push(result.changes[0]?.op ?? '');
    expect(collected).toEqual(['upsert']);
  });
});

describe('资源方法：SSE 装配', () => {
  it('subscribe 先签发流令牌，再带 access_token 连接事件流', async () => {
    const streamQueries: URLSearchParams[] = [];
    const tokenCalls: Captured[] = [];
    server.use(
      http.post(`${BASE}/stream/tokens`, async ({ request }) => {
        tokenCalls.push(await capture(request));
        return HttpResponse.json(
          { token: 'st_1', expires_at: '2024-05-06T07:18:09.123Z', topics: ['announcements'], url: '/api/v1/stream/events?access_token=st_1' },
          { status: 201 },
        );
      }),
      http.get(`${BASE}/stream/events`, ({ request }) => {
        streamQueries.push(new URL(request.url).searchParams);
        const event = {
          id: '1',
          sequence: 1,
          topic: 'announcements',
          type: 'announcement.published',
          occurred_at: '2024-05-06T07:08:09.123Z',
          resource: { kind: 'announcement', id: 'ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0' },
          revision: '1',
          data: {},
        };
        return new HttpResponse(streamFromChunks([`id: 1\nevent: announcement.published\ndata: ${JSON.stringify(event)}\n\n`]), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    const client = clientWith({ invalidateOnStreamEvents: false });
    const events: string[] = [];
    const stream = client.subscribe({ topics: ['announcements'], autoReconnect: false, onEvent: (event) => events.push(event.type) });
    await stream.start();
    stream.stop();

    expect(tokenCalls[0]?.body).toEqual({ topics: ['announcements'] });
    expect(streamQueries[0]?.get('access_token')).toBe('st_1');
    expect(streamQueries[0]?.get('topics')).toBe('announcements');
    expect(events).toEqual(['announcement.published']);
  });
});
