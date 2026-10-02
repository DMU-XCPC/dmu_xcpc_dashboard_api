import { describe, expect, it } from 'vitest';
import { ApiCache, type CachePolicy } from '../src/cache/cache.js';
import { MemoryCacheStore } from '../src/cache/store.js';
import { NetworkError, OfflineError, ApiProblemError } from '../src/errors.js';
import type { TransportResult } from '../src/http/transport.js';
import { fakeClock, makeMeta } from './support.js';

interface Page {
  items: number[];
  total: number;
}

function ok(data: Page, etag = '"1"'): TransportResult<Page> {
  return { data, meta: makeMeta({ etag, revision: etag.replace(/"/g, '') }), response: new Response() };
}

function notModified(etag = '"1"'): TransportResult<Page> {
  return {
    data: undefined as unknown as Page,
    meta: makeMeta({ status: 304, notModified: true, etag, revision: etag.replace(/"/g, '') }),
    response: new Response(),
  };
}

const policy: CachePolicy = { key: 'members:list:page=1', resource: 'members', ttlMs: 1000, maxStaleMs: 60_000 };

describe('ApiCache 读穿与 SWR', () => {
  it('首次读取回源并写入本地副本', async () => {
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 1000 });
    const result = await cache.read<Page>(policy, async () => ok({ items: [1], total: 1 }));
    expect(result.data.total).toBe(1);
    expect(result.fromCache).toBe(false);
    expect(result.revalidated).toBe(true);
    expect(await store.get(policy.key)).toMatchObject({ etag: '"1"', resource: 'members' });
  });

  it('新鲜期内直接命中本地副本，并在后台用 If-None-Match 校验', async () => {
    const clock = fakeClock();
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 60_000, now: clock.now });
    const calls: (string | undefined)[] = [];

    await cache.read<Page>(policy, async () => ok({ items: [1], total: 1 }));
    clock.advance(1_000);
    const cached = await cache.read<Page>(policy, async (ctx) => {
      calls.push(ctx.ifNoneMatch);
      return notModified();
    });

    // 命中本地副本：立即返回，不等后台回源
    expect(cached.fromCache).toBe(true);
    expect(cached.stale).toBe(false);
    expect(cached.revalidated).toBe(false);

    await cache.whenIdle();
    expect(calls).toEqual(['"1"']);
    const entry = await store.get<Page>(policy.key);
    expect(entry?.updatedAt).toBe(clock.now());
  });

  it('超过 TTL 时条件回源：304 复用副本并刷新时间戳', async () => {
    const clock = fakeClock();
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 1000, now: clock.now });

    await cache.read<Page>(policy, async () => ok({ items: [1], total: 1 }));
    clock.advance(5_000);
    const result = await cache.read<Page>(policy, async () => notModified());

    expect(result.notModified).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.data.total).toBe(1);
    const entry = await store.get<Page>(policy.key);
    expect(entry?.updatedAt).toBe(clock.now());
  });

  it('超过 TTL 且网络失败时降级为过期副本并标记 stale', async () => {
    const clock = fakeClock();
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 1000, maxStaleMs: 60_000, now: clock.now });

    await cache.read<Page>(policy, async () => ok({ items: [7], total: 7 }));
    clock.advance(10_000);
    const result = await cache.read<Page>(policy, async () => {
      throw new NetworkError('断网');
    });

    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.data.items).toEqual([7]);
  });

  it('5xx 也可降级为过期副本', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(new MemoryCacheStore(), { ttlMs: 1000, maxStaleMs: 60_000, now: clock.now });
    await cache.read<Page>(policy, async () => ok({ items: [1], total: 1 }));
    clock.advance(10_000);
    const result = await cache.read<Page>(policy, async () => {
      throw new ApiProblemError({ type: 'about:blank', title: 'Service unavailable', status: 503, code: 'service_unavailable' });
    });
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.data.items).toEqual([1]);
  });

  it('离线且没有副本时抛 OfflineError；有副本则降级', async () => {
    const store = new MemoryCacheStore();
    let online = true;
    const cache = new ApiCache(store, { ttlMs: 1000, maxStaleMs: 60_000, isOnline: () => online });

    await expect(cache.read<Page>(policy, async () => ok({ items: [], total: 0 }))).resolves.toMatchObject({ fromCache: false });

    online = false;
    const cached = await cache.read<Page>({ ...policy, ttlMs: 0 }, async () => ok({ items: [], total: 0 }));
    expect(cached.stale).toBe(true);
    expect(cached.fromCache).toBe(true);

    await expect(cache.read<Page>({ ...policy, key: 'other' }, async () => ok({ items: [], total: 0 }))).rejects.toBeInstanceOf(
      OfflineError,
    );
  });

  it('超过 maxStaleMs 的副本不再降级', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(new MemoryCacheStore(), { ttlMs: 1000, maxStaleMs: 5_000, now: clock.now });
    await cache.read<Page>(policy, async () => ok({ items: [1], total: 1 }));
    clock.advance(60_000);
    await expect(
      cache.read<Page>({ key: policy.key, ttlMs: 1000 }, async () => {
        throw new NetworkError('断网');
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('invalidateResource 按资源清理本地副本', async () => {
    const store = new MemoryCacheStore();
    const cache = new ApiCache(store, { ttlMs: 60_000 });
    await cache.read<Page>({ ...policy, key: 'members:list', resource: 'members' }, async () => ok({ items: [1], total: 1 }));
    await cache.read<Page>({ ...policy, key: 'teams:list', resource: 'teams' }, async () => ok({ items: [2], total: 2 }));

    await cache.invalidateResource('members');
    expect(await store.get('members:list')).toBeNull();
    expect(await store.get('teams:list')).not.toBeNull();
  });
});

describe('缓存隔离：不同调用者不共用副本', () => {
  it('身份变化时清空本地缓存，绝不把上一身份的副本返回给新主体', async () => {
    let identity = 'user:alice';
    let fetches = 0;
    const cache = new ApiCache(new MemoryCacheStore(), {
      ttlMs: 60_000,
      staleWhileRevalidate: false,   // 关掉后台回源，让命中/回源次数可判定
      identity: () => identity,
    });
    const policy: CachePolicy = { key: 'accounts:list', resource: 'accounts', ttlMs: 60_000 };
    const fetcher = async (): Promise<TransportResult<{ total: number }>> => {
      fetches += 1;
      return {
        data: identity === 'user:alice' ? { total: 138 } : { total: 12 },
        meta: {
          status: 200,
          headers: new Headers(),
          fromCache: false,
          notModified: false,
          replayed: false,
          attempts: 1,
        },
        response: new Response(null, { status: 200 }),
      } as unknown as TransportResult<{ total: number }>;
    };

    const first = await cache.read<{ total: number }>(policy, fetcher);
    expect([first.data.total, fetches]).toEqual([138, 1]);
    // 同一身份内命中缓存
    await cache.read<{ total: number }>(policy, fetcher);
    expect(fetches).toBe(1);

    // 换账号：必须回源，且不得复用上一身份的副本
    identity = 'user:bob';
    const second = await cache.read<{ total: number }>(policy, fetcher);
    expect([second.data.total, fetches]).toEqual([12, 2]);
    expect(second.stale).toBe(false);
  });
});

