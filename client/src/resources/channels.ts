/**
 * 广播渠道资源（契约 `paths/channels.yaml`）。
 *
 * 渠道目标与密钥属敏感信息：读取一律只返回 `target_masked`/`secret_set`，
 * 且列表也需要 `channel:manage`。创建/更新支持 `queueIfOffline`。
 */

import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type {
  Channel,
  ChannelKind,
  ChannelTestResult,
  CreateChannelRequest,
  PagedChannel,
  TestChannelRequest,
  UpdateChannelRequest,
} from '../types/news.js';
import { readJson, writeJson, writeWithQueue, type ReadOptions, type ResourceContext, type WriteOptions, type WriteOutcome } from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const CHANNELS_OPERATIONS = {
  listChannels: { method: 'GET', path: '/channels' },
  createChannel: { method: 'POST', path: '/channels' },
  getChannel: { method: 'GET', path: '/channels/{channel_id}' },
  updateChannel: { method: 'PATCH', path: '/channels/{channel_id}' },
  deleteChannel: { method: 'DELETE', path: '/channels/{channel_id}' },
  testChannel: { method: 'POST', path: '/channels/{channel_id}/test' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class ChannelsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页列出广播渠道（按 `kind`/`enabled`/`q` 过滤）；需要 `channel:manage`。
   * 响应已脱敏：只有 `target_masked` 与 `secret_set`。幂等只读，可缓存。
   * 401 未认证；403 缺 scope；429 限流。
   */
  list(
    params: { kind?: ChannelKind; enabled?: boolean; q?: string; page?: number; size?: number; order?: 'asc' | 'desc' } = {},
    options?: ReadOptions,
  ): Promise<PagedChannel> {
    return readJson<PagedChannel>(this.ctx, { path: '/channels', query: params, resource: 'channels', options });
  }

  /**
   * 创建广播渠道；需要 `channel:manage`，`target`/`secret` 只在此处提交。
   * 幂等写：同一 `Idempotency-Key` 重放返回首次响应；重名不触发重复创建。
   * 403 缺 scope；409 渠道名已存在；422 参数非法；429 限流。
   */
  create(body: CreateChannelRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Channel>>;
  create(body: CreateChannelRequest, options?: WriteOptions): Promise<Channel>;
  async create(body: CreateChannelRequest, options?: WriteOptions): Promise<Channel | WriteOutcome<Channel>> {
    if (options?.queueIfOffline) return writeWithQueue<Channel>(this.ctx, { method: 'POST', path: '/channels', body, options });
    return writeJson<Channel>(this.ctx, { method: 'POST', path: '/channels', body, options });
  }

  /**
   * 读取单个渠道配置（已脱敏）；需要 `channel:manage`。幂等只读，带强 `ETag`。
   * 403 缺 scope；404 渠道不存在；401 未认证；429 限流。
   */
  get(channelId: string, options?: ReadOptions): Promise<Channel> {
    const path = substitutePath('/channels/{channel_id}', { channel_id: channelId });
    return readJson<Channel>(this.ctx, { path, resource: 'channels', id: channelId, options });
  }

  /**
   * 局部更新渠道；需要 `channel:manage`，`target`/`secret` 提供时整体替换。
   * 幂等写：`options.ifMatch` 不匹配返回 412 precondition_failed。
   * 404 不存在；409 与其它渠道重名；422 参数非法；429 限流。
   */
  update(channelId: string, body: UpdateChannelRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Channel>>;
  update(channelId: string, body: UpdateChannelRequest, options?: WriteOptions): Promise<Channel>;
  async update(channelId: string, body: UpdateChannelRequest, options?: WriteOptions): Promise<Channel | WriteOutcome<Channel>> {
    const path = substitutePath('/channels/{channel_id}', { channel_id: channelId });
    if (options?.queueIfOffline) return writeWithQueue<Channel>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Channel>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 删除广播渠道（不可撤销）；需要 `channel:manage`，历史投递记录保留。
   * 幂等：重复删除总是 204。403 缺 scope；404 id 从未存在；401 未认证；429 限流。
   */
  remove(channelId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<void>>;
  remove(channelId: string, options?: WriteOptions): Promise<void>;
  async remove(channelId: string, options?: WriteOptions): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/channels/{channel_id}', { channel_id: channelId });
    if (options?.queueIfOffline) return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, options });
    return writeJson<void>(this.ctx, { method: 'DELETE', path, options });
  }

  /**
   * 测试渠道连通性：失败以 `ok=false`/`error` 表达而不是 4xx，因此**不提供离线队列**。
   * 需要 `channel:manage`；非幂等（每次都会真实投递），客户端不应自动重试。
   * 403 缺 scope；404 渠道不存在；422 参数非法；429 测试被限流。
   */
  test(channelId: string, body?: TestChannelRequest, options?: WriteOptions): Promise<ChannelTestResult> {
    const path = substitutePath('/channels/{channel_id}/test', { channel_id: channelId });
    return writeJson<ChannelTestResult>(this.ctx, {
      method: 'POST',
      path,
      ...(body !== undefined ? { body } : {}),
      options,
    });
  }
}
