import { describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server, useMsw, BASE, streamFromChunks } from './support.js';
import { SseClient, SseParser, type SseGapInfo, type StreamEvent } from '../src/sse.js';
import { Transport } from '../src/http/transport.js';

useMsw();

function frame(sequence: number, type = 'announcement.published', extra: Record<string, unknown> = {}): string {
  const payload = {
    id: String(sequence),
    sequence,
    topic: 'announcements',
    type,
    occurred_at: '2024-05-06T07:08:09.123Z',
    resource: { kind: 'announcement', id: `ann_${sequence}` },
    revision: String(sequence),
    data: {},
    ...extra,
  };
  return `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function sseResponse(chunks: string[], options: { close?: boolean } = {}) {
  return new HttpResponse(streamFromChunks(chunks, options), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('SseParser 帧解析', () => {
  it('跨 chunk 的半帧会被缓冲，直到空行结束', () => {
    const parser = new SseParser();
    expect(parser.push('id: 1\nevent: announcement.pub')).toEqual([]);
    const frames = parser.push('lished\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ id: '1', event: 'announcement.published', data: '{"a":1}' }]);
  });

  it('多行 data 用换行拼接，注释与心跳被忽略', () => {
    const parser = new SseParser();
    const frames = parser.push(': hb\nid: 2\ndata: line1\ndata: line2\n\n: hb\n\n');
    expect(frames).toEqual([{ id: '2', data: 'line1\nline2' }]);
  });

  it('支持 CRLF 换行并解析 retry', () => {
    const parser = new SseParser();
    const frames = parser.push('retry: 3000\r\nid: 3\r\ndata: {}\r\n\r\n');
    expect(frames).toEqual([{ retry: 3000, id: '3', data: '{}' }]);
  });

  it('flush 容错处理未以空行结尾的残余帧', () => {
    const parser = new SseParser();
    expect(parser.push('id: 9\ndata: tail')).toEqual([]);
    expect(parser.flush()).toEqual([{ id: '9', data: 'tail' }]);
    expect(parser.flush()).toEqual([]);
  });
});

describe('SseClient 连接与补发时序', () => {
  it('分发事件、更新 lastEventId，并对序号跳号回调 onGap', async () => {
    server.use(http.get(`${BASE}/stream/events`, () => sseResponse([frame(1), frame(3)])));
    const transport = new Transport({ baseUrl: BASE });
    const events: StreamEvent[] = [];
    const gaps: SseGapInfo[] = [];
    let opened = 0;
    let closed = 0;

    const client = new SseClient({
      transport,
      topics: ['announcements'],
      autoReconnect: false,
      onEvent: (event) => events.push(event),
      onGap: (info) => gaps.push(info),
      onOpen: () => {
        opened += 1;
      },
      onClose: () => {
        closed += 1;
      },
    });

    await client.start();
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    expect(events.map((event) => event.sequence)).toEqual([1, 3]);
    expect(client.lastEventId).toBe('3');
    expect(gaps).toEqual([{ reason: 'sequence_jump', fromSequence: 2, toSequence: 2, resyncRequired: true }]);
    client.stop();
  });

  it('stream.gap 事件触发 resyncRequired 回调', async () => {
    server.use(
      http.get(`${BASE}/stream/events`, () =>
        sseResponse([frame(10, 'stream.gap', { data: { from_sequence: 4, to_sequence: 9, resync_required: true } })]),
      ),
    );
    const gaps: SseGapInfo[] = [];
    const client = new SseClient({
      transport: new Transport({ baseUrl: BASE }),
      autoReconnect: false,
      onGap: (info) => gaps.push(info),
    });
    await client.start();
    expect(gaps).toEqual([{ reason: 'event', fromSequence: 4, toSequence: 9, resyncRequired: true }]);
    client.stop();
  });

  it('用短时流令牌连接（access_token 查询参数）', async () => {
    const queries: URLSearchParams[] = [];
    let tokenCalls = 0;
    server.use(
      http.post(`${BASE}/stream/tokens`, () => {
        tokenCalls += 1;
        return HttpResponse.json({ token: 'st_1', expires_at: '2024-05-06T07:18:09.123Z', topics: ['announcements'], url: '/x' }, { status: 201 });
      }),
      http.get(`${BASE}/stream/events`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return sseResponse([frame(1)]);
      }),
    );
    const transport = new Transport({ baseUrl: BASE });
    const client = new SseClient({
      transport,
      topics: ['announcements'],
      autoReconnect: false,
      tokenProvider: async () => {
        const result = await transport.post<{ token: string }>('/stream/tokens', { body: { topics: ['announcements'] }, idempotencyKey: false });
        return result.data.token;
      },
    });
    await client.start();
    client.stop();

    expect(tokenCalls).toBe(1);
    expect(queries[0]?.get('access_token')).toBe('st_1');
    expect(queries[0]?.get('topics')).toBe('announcements');
  });

  it('断线重连时携带 last_event_id 实现补发', async () => {
    let connections = 0;
    const lastEventIds: (string | null)[] = [];
    const events: StreamEvent[] = [];
    let resolveSecond: (() => void) | undefined;
    const secondEvent = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    server.use(
      http.get(`${BASE}/stream/events`, ({ request }) => {
        connections += 1;
        lastEventIds.push(new URL(request.url).searchParams.get('last_event_id'));
        if (connections === 1) return sseResponse([frame(1)]);
        return sseResponse([frame(2)], { close: false });
      }),
    );

    const client = new SseClient({
      transport: new Transport({ baseUrl: BASE }),
      autoReconnect: true,
      baseReconnectDelayMs: 1,
      maxReconnectDelayMs: 5,
      onEvent: (event) => {
        events.push(event);
        if (event.sequence === 2) resolveSecond?.();
      },
    });

    await client.start();
    await secondEvent;
    client.stop();

    expect(connections).toBe(2);
    expect(lastEventIds).toEqual([null, '1']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('stop 之后不再重连', async () => {
    let connections = 0;
    server.use(
      http.get(`${BASE}/stream/events`, () => {
        connections += 1;
        return sseResponse([frame(1)]);
      }),
    );
    const client = new SseClient({
      transport: new Transport({ baseUrl: BASE }),
      autoReconnect: true,
      baseReconnectDelayMs: 1,
    });
    await client.start();
    client.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connections).toBe(1);
    expect(client.connected).toBe(false);
  });
});
