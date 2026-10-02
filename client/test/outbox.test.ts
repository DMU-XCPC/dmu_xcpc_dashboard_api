import { describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server, useMsw, BASE, capture, problem, fakeClock, type Captured } from './support.js';
import { MemoryCacheStore } from '../src/cache/store.js';
import { Outbox, type OutboxEvent } from '../src/cache/outbox.js';
import { Transport } from '../src/http/transport.js';

useMsw();

interface Harness {
  store: MemoryCacheStore;
  transport: Transport;
  outbox: Outbox;
  clock: ReturnType<typeof fakeClock>;
  events: OutboxEvent[];
}

function harness(options: { online?: () => boolean } = {}): Harness {
  const store = new MemoryCacheStore();
  const clock = fakeClock();
  let counter = 0;
  const transport = new Transport({
    baseUrl: BASE,
    ...(options.online ? { isOnline: options.online } : {}),
  });
  const events: OutboxEvent[] = [];
  const outbox = new Outbox(store, transport, {
    now: clock.now,
    randomId: () => `id-${(counter += 1)}`,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
    ...(options.online ? { isOnline: options.online } : {}),
    onEvent: (event) => events.push(event),
  });
  return { store, transport, outbox, clock, events };
}

describe('Outbox 离线写入队列', () => {
  it('按入队顺序重放，幂等键跨重放保持不变，成功后出队', async () => {
    const captured: Captured[] = [];
    server.use(
      http.post(`${BASE}/announcements`, async ({ request }) => {
        captured.push(await capture(request));
        return HttpResponse.json({ id: 'ann_1' }, { status: 201, headers: { 'idempotency-replayed': 'true' } });
      }),
      http.post(`${BASE}/quotas/quota_1/claims`, async ({ request }) => {
        captured.push(await capture(request));
        return HttpResponse.json({ id: 'claim_1' }, { status: 201 });
      }),
    );
    const { outbox, events } = harness();

    const first = await outbox.enqueue({ method: 'POST', path: '/announcements', body: { title: 'a' }, label: 'announcement:create' });
    const second = await outbox.enqueue({ method: 'POST', path: '/quotas/quota_1/claims', body: { team_id: 'team_1' } });
    expect(await outbox.size()).toBe(2);
    expect(first.idempotencyKey).toBe('id-2');

    const report = await outbox.flush();
    expect(report.offline).toBe(false);
    expect(report.attempted).toBe(2);
    expect(report.sent.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(report.remaining).toEqual([]);
    expect(await outbox.size()).toBe(0);

    expect(captured[0]?.headers.get('idempotency-key')).toBe(first.idempotencyKey);
    expect(captured[0]?.headers.get('idempotency-replayed')).toBeNull();
    const replayed = events.find((event) => event.type === 'sent');
    expect(replayed).toMatchObject({ type: 'sent', replayed: true });
  });

  it('可重试失败（503）时保留条目并退避，本轮中断后续条目', async () => {
    let announcements = 0;
    let claims = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => {
        announcements += 1;
        return problem(503, 'service_unavailable');
      }),
      http.post(`${BASE}/quotas/quota_1/claims`, () => {
        claims += 1;
        return HttpResponse.json({ id: 'claim_1' }, { status: 201 });
      }),
    );
    const { outbox, clock, events } = harness();
    await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });
    await outbox.enqueue({ method: 'POST', path: '/quotas/quota_1/claims', body: {} });

    const report = await outbox.flush();
    expect(report.sent).toEqual([]);
    expect(report.attempted).toBe(1);
    expect(claims).toBe(0);
    expect(report.remaining).toHaveLength(2);
    const retried = report.remaining[0];
    expect(retried?.attempts).toBe(1);
    expect(retried?.nextAttemptAt).toBe(clock.now() + 1000);
    expect(retried?.status).toBe('pending');
    expect(events.some((event) => event.type === 'retry')).toBe(true);

    // 退避未到期：本轮不尝试任何请求
    const second = await outbox.flush();
    expect(second.attempted).toBe(0);
    expect(announcements).toBe(1);

    // 时间推进后可重试
    clock.advance(1000);
    await outbox.flush();
    expect(announcements).toBe(2);
  });

  it('终态失败（403）标记 failed 并继续处理后续条目', async () => {
    const sent: string[] = [];
    let announcements = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => {
        announcements += 1;
        return problem(403, 'insufficient_scope');
      }),
      http.post(`${BASE}/quotas/quota_1/claims`, () => {
        sent.push('claim');
        return HttpResponse.json({ id: 'claim_1' }, { status: 201 });
      }),
    );
    const { outbox, events } = harness();
    const blocked = await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });
    await outbox.enqueue({ method: 'POST', path: '/quotas/quota_1/claims', body: {} });

    const report = await outbox.flush();
    expect(report.failed.map((item) => item.id)).toEqual([blocked.id]);
    expect(report.failed[0]?.lastError?.code).toBe('insufficient_scope');
    expect(sent).toEqual(['claim']);
    // failed 条目仍留在队列里，等待上层决策
    const queued = await outbox.list();
    expect(queued.map((item) => item.status)).toEqual(['failed']);

    // 终态失败条目永不自动重放：本轮被跳过，且不占用 attempted
    const again = await outbox.flush();
    expect(again.attempted).toBe(0);
    expect(again.sent).toEqual([]);
    expect(again.skipped.map((item) => item.id)).toEqual([blocked.id]);
    expect(announcements).toBe(1);

    // 用户决定重试后才会再次发送
    expect(await outbox.retry(blocked.id)).toBe(true);
    const afterRetry = await outbox.flush();
    expect(afterRetry.attempted).toBe(1);
    expect(announcements).toBe(2);
  });

  it('离线时不上报发送，队列保持不变', async () => {
    let requests = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => {
        requests += 1;
        return HttpResponse.json({ id: 'ann_1' }, { status: 201 });
      }),
    );
    let online = true;
    const { outbox } = harness({ online: () => online });
    await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });

    online = false;
    const report = await outbox.flush();
    expect(report.offline).toBe(true);
    expect(report.remaining).toHaveLength(1);
    expect(requests).toBe(0);

    online = true;
    const after = await outbox.flush();
    expect(after.sent).toHaveLength(1);
    expect(requests).toBe(1);
  });

  it('clear 与 remove 可管理队列', async () => {
    const { outbox } = harness();
    const item = await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });
    expect(await outbox.remove(item.id)).toBe(true);
    expect(await outbox.remove(item.id)).toBe(false);
    await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });
    await outbox.clear();
    expect(await outbox.size()).toBe(0);
  });
});

describe('outbox：并发前置条件与鉴权终态', () => {
  it('离线排队时保留 If-Match，重放会真的带上该请求头', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.patch(`${BASE}/members/acc_1`, ({ request }) => {
        seen.push(request.headers.get('if-match'));
        return HttpResponse.json({ id: 'acc_1' }, { status: 200 });
      }),
    );
    const { outbox } = harness();
    const item = await outbox.enqueue({
      method: 'PATCH',
      path: '/members/acc_1',
      body: { profile: { phone: '13900000000' } },
      ifMatch: '17',
    });
    expect(item.ifMatch).toBe('17');
    // 持久化后重新加载仍在
    const [queued] = await outbox.list();
    expect(queued?.ifMatch).toBe('17');

    await outbox.flush();
    expect(seen).toEqual(['17']);
  });

  it('401 视为终态失败，不再卡住后续条目（队列可继续推进）', async () => {
    let okSent = 0;
    server.use(
      http.post(`${BASE}/announcements`, () => problem(401, 'invalid_token')),
      http.post(`${BASE}/quotas/quota_1/claims`, () => {
        okSent += 1;
        return HttpResponse.json({ id: 'claim_1' }, { status: 201 });
      }),
    );
    const { outbox } = harness();
    const blocked = await outbox.enqueue({ method: 'POST', path: '/announcements', body: {} });
    await outbox.enqueue({ method: 'POST', path: '/quotas/quota_1/claims', body: {} });

    const report = await outbox.flush();
    expect(report.failed.map((item) => item.id)).toEqual([blocked.id]);
    expect(report.failed[0]?.lastError?.status).toBe(401);
    expect(okSent).toBe(1);                       // 后续条目没有被队首挡住
    expect((await outbox.list()).map((i) => i.status)).toEqual(['failed']);

    // 重新登录后由用户决定是否重试
    const later = await outbox.flush();
    expect(later.attempted).toBe(0);
    expect(later.skipped.map((item) => item.id)).toEqual([blocked.id]);
  });
});

