/**
 * 负例与业务语义测试：覆盖 README §4.x 承诺的**状态机、错误分类与部分成功**语义。
 *
 * 这些行为此前完全没有测试——契约写了、实现做了，但没有任何东西阻止它们被改坏。
 */
import { describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { ApiProblemError } from '../src/errors.js';
import { Transport } from '../src/http/transport.js';
import { AnnouncementsResource } from '../src/resources/announcements.js';
import { QuotasResource } from '../src/resources/quotas.js';
import { SyncResource } from '../src/resources/sync.js';
import type { QuotaClaim } from '../src/types/quotas.js';
import { BASE, problem, server, useMsw } from './support.js';

useMsw();

const transport = () => new Transport({ baseUrl: BASE, retry: false });
/** 允许重试的传输层：用来验证"终态错误即使允许重试也只发一次"。 */
const retryingTransport = () =>
  new Transport({ baseUrl: BASE, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, jitter: 'none' } });
const ctx = (t: Transport) => ({ transport: t, cache: undefined, outbox: undefined }) as never;

const claim = (over: Partial<QuotaClaim> = {}): QuotaClaim =>
  ({
    id: 'claim_1',
    quota_id: 'quota_1',
    team: { id: 'team_1', name: 'DMU-1' },
    members: [],
    status: 'pending',
    priority: 100,
    waitlist_position: null,
    submitted_by: { id: 'acc_1', username: 'alice', display_name: '张三', kind: 'human' },
    submitted_at: '2024-05-01T02:00:00.000Z',
    created_at: '2024-05-01T02:00:00.000Z',
    updated_at: '2024-05-01T02:00:00.000Z',
    revision: '1',
    ...over,
  }) as QuotaClaim;

describe('错误分类：终态错误不得重试', () => {
  it('409 idempotency_key_reused 只请求一次', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => {
        calls += 1;
        return problem(409, 'idempotency_key_reused');
      }),
    );
    await expect(retryingTransport().post('/announcements', { body: {} })).rejects.toBeInstanceOf(ApiProblemError);
    expect(calls).toBe(1);
  });

  it('412 precondition_failed 只请求一次，并保留 code', async () => {
    let calls = 0;
    server.use(
      http.patch(`${BASE}/members/acc_1`, () => {
        calls += 1;
        return problem(412, 'precondition_failed');
      }),
    );
    const error = await retryingTransport()
      .patch('/members/acc_1', { body: {}, ifMatch: '17' })
      .catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((error as ApiProblemError).code).toBe('precondition_failed');
    expect((error as ApiProblemError).status).toBe(412);
  });

  it('403 insufficient_scope 的字段级 errors 可读（越权字段的契约表达）', async () => {
    server.use(
      http.patch(`${BASE}/auth/me`, () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmu-xcpc.example/errors/insufficient_scope',
            title: '权限不足',
            status: 403,
            code: 'insufficient_scope',
            detail: '缺少 profile:academic',
            errors: [{ pointer: '/profile/student_id', message: '缺少 profile:academic', code: 'insufficient_scope' }],
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const error = (await transport()
      .patch('/auth/me', { body: { profile: { student_id: '2220210000' } } })
      .catch((e: unknown) => e)) as ApiProblemError;
    expect(error.errors?.[0]?.pointer).toBe('/profile/student_id');
  });

  it('415 与 413 映射为对应 code', async () => {
    server.use(
      http.post(`${BASE}/announcements`, () => problem(415, 'unsupported_media_type')),
      http.post(`${BASE}/ingest/oj/submissions`, () => problem(413, 'payload_too_large')),
    );
    const unsupported = (await transport()
      .post('/announcements', { body: {} })
      .catch((e: unknown) => e)) as ApiProblemError;
    const tooLarge = (await transport()
      .post('/ingest/oj/submissions', { body: {} })
      .catch((e: unknown) => e)) as ApiProblemError;
    expect([unsupported.code, tooLarge.code]).toEqual(['unsupported_media_type', 'payload_too_large']);
  });
});

describe('公告：状态机与去重', () => {
  it('非法迁移（archived 上再 publish）返回 409 conflict', async () => {
    server.use(
      http.post(`${BASE}/announcements/ann_1/publish`, () => problem(409, 'conflict')),
    );
    const announcements = new AnnouncementsResource(ctx(transport()));
    await expect(announcements.publish('ann_1')).rejects.toMatchObject({ status: 409 });
  });

  it('dedup_key 命中去重（200 + 既有公告）按成功处理，不当成错误', async () => {
    server.use(
      http.post(`${BASE}/announcements`, () =>
        HttpResponse.json(
          { id: 'ann_9', title: '同一标题', status: 'published' },
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const announcements = new AnnouncementsResource(ctx(transport()));
    const created = await announcements.create({ title: '同一标题', body_markdown: '正文', category: '训练', dedup_key: 'qq-group-1' });
    expect(created.id).toBe('ann_9');
  });

  it('dedup_key 相同但内容不同 → 409 dedup_conflict（终态，不重试）', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => {
        calls += 1;
        return problem(409, 'dedup_conflict');
      }),
    );
    const announcements = new AnnouncementsResource(ctx(transport()));
    const error = (await announcements
      .create({ title: '改过的标题', body_markdown: '正文', category: '训练', dedup_key: 'qq-group-1' })
      .catch((e: unknown) => e)) as ApiProblemError;
    expect([error.code, calls]).toEqual(['dedup_conflict', 1]);
  });
});

describe('名额：流程与候补（README §4.7）', () => {
  it('每队上限命中 409 team_claim_limit_reached', async () => {
    server.use(
      http.post(`${BASE}/quotas/quota_1/claims`, () => problem(409, 'team_claim_limit_reached')),
    );
    const quotas = new QuotasResource(ctx(transport()));
    const error = (await quotas
      .createClaim('quota_1', { team_id: 'team_1', members: [] })
      .catch((e: unknown) => e)) as ApiProblemError;
    expect(error.code).toBe('team_claim_limit_reached');
  });

  it('超出剩余名额时进候补：waitlist_position 非空且仍算成功', async () => {
    const waitlisted = claim({ waitlist_position: 3 });
    server.use(
      http.post(`${BASE}/quotas/quota_1/claims`, () =>
        HttpResponse.json(waitlisted, { status: 201, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const quotas = new QuotasResource(ctx(transport()));
    const created = await quotas.createClaim('quota_1', { team_id: 'team_1', members: [] });
    expect(created.waitlist_position).toBe(3);
  });

  it('批准用尽名额 → 409 quota_exceeded', async () => {
    server.use(
      http.post(`${BASE}/quotas/quota_1/claims/claim_1/approve`, () => problem(409, 'quota_exceeded')),
    );
    const quotas = new QuotasResource(ctx(transport()));
    await expect(quotas.approve('quota_1', 'claim_1')).rejects.toMatchObject({ code: 'quota_exceeded' });
  });

  it('管理员释放已批准认领 → released；队员确认 → confirmed', async () => {
    server.use(
      http.post(`${BASE}/quotas/quota_1/claims/claim_1/release`, () =>
        HttpResponse.json(claim({ status: 'released' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
      http.post(`${BASE}/quotas/quota_1/claims/claim_2/confirm`, () =>
        HttpResponse.json(
          claim({ id: 'claim_2', members: [{ principal: { id: 'acc_1' }, role: 'member', display_name: '张三', confirmed: true } as never] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const quotas = new QuotasResource(ctx(transport()));
    const released = await quotas.releaseClaim('quota_1', 'claim_1', { reason: '退赛' });
    const confirmed = await quotas.confirmClaim('quota_1', 'claim_2');
    expect(released.status).toBe('released');
    expect(confirmed.members[0]?.confirmed).toBe(true);
  });

  it('归档只在 finalized 之后成功，否则 409', async () => {
    server.use(
      http.post(`${BASE}/quotas/quota_1/archive`, () => problem(409, 'conflict')),
    );
    const quotas = new QuotasResource(ctx(transport()));
    await expect(quotas.archive('quota_1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('ingest：部分成功语义（HTTP 200 + 逐条状态）', () => {
  it('重复项只标记 duplicate，不整批失败', async () => {
    server.use(
      http.post(`${BASE}/ingest/oj/submissions`, () =>
        HttpResponse.json(
          {
            accepted: 1,
            duplicates: 1,
            rejected: 1,
            materialized_at: '2024-05-06T07:15:00.000Z',
            items: [
              { index: 0, status: 'accepted', id: 'sub_1' },
              { index: 1, status: 'duplicate', id: 'sub_2' },
              { index: 2, status: 'rejected', code: 'out_of_range', message: 'submitted_at 超出容忍区间', pointer: '/items/2' },
            ],
          },
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const result = await transport().post<{ items: Array<{ status: string }>; rejected: number }>(
      '/ingest/oj/submissions',
      { body: { items: [] } },
    );
    expect(result.data.items.map((i) => i.status)).toEqual(['accepted', 'duplicate', 'rejected']);
    expect(result.data.rejected).toBe(1);
  });
});

describe('增量同步：分页形状是 changes/cursor/has_more', () => {
  it('基线与逐页拉取使用契约字段名', async () => {
    server.use(
      http.get(`${BASE}/sync/changes`, ({ request }) => {
        const since = new URL(request.url).searchParams.get('since');
        return HttpResponse.json({
          changes: since === null ? [] : [{ resource: 'members', op: 'update', id: 'acc_1', revision: '2', updated_at: '2024-05-06T07:00:00.000Z' }],
          cursor: since === null ? 'c0' : 'c1',
          has_more: false,
          server_time: '2024-05-06T07:08:09.123Z',
          retention: 'P30D',
        });
      }),
    );
    const t = transport();
    const store = new (await import('../src/cache/store.js')).MemoryCacheStore();
    const engine = new (await import('../src/cache/sync.js')).SyncEngine({ transport: t, store });
    const sync = new SyncResource(engine, ctx(t));
    const cursor = await sync.baseline();
    const feed = await sync.pull(cursor);
    expect([cursor, feed.cursor, feed.has_more]).toEqual(['c0', 'c1', false]);
    expect(feed.changes[0]?.resource).toBe('members');
  });
});
