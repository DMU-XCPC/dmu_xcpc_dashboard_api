/**
 * 新闻板公告资源（契约 `paths/announcements.yaml`）。
 *
 * 读方法走 `readJson`（读穿缓存 + ETag 条件读取），写方法用重载提供
 * `queueIfOffline` 离线队列能力，并整体透传 `options`（幂等键由传输层生成）。
 */

import { substitutePath } from '../http/query.js';
import type { HttpMethod } from '../http/transport.js';
import type { Job, SortOrder, Timestamp } from '../types/common.js';
import type {
  Announcement,
  AnnouncementStatus,
  BroadcastAnnouncementRequest,
  CreateAnnouncementRequest,
  DeliveryState,
  PagedAnnouncement,
  PagedDelivery,
  PinAnnouncementRequest,
  PublishAnnouncementRequest,
  UpdateAnnouncementRequest,
} from '../types/news.js';
import {
  readJson,
  writeJson,
  writeWithQueue,
  type ReadOptions,
  type ResourceContext,
  type WriteOptions,
  type WriteOutcome,
} from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const ANNOUNCEMENTS_OPERATIONS = {
  listAnnouncements: { method: 'GET', path: '/announcements' },
  createAnnouncement: { method: 'POST', path: '/announcements' },
  getAnnouncement: { method: 'GET', path: '/announcements/{announcement_id}' },
  updateAnnouncement: { method: 'PATCH', path: '/announcements/{announcement_id}' },
  deleteAnnouncement: { method: 'DELETE', path: '/announcements/{announcement_id}' },
  publishAnnouncement: { method: 'POST', path: '/announcements/{announcement_id}/publish' },
  unpublishAnnouncement: { method: 'POST', path: '/announcements/{announcement_id}/unpublish' },
  setAnnouncementPin: { method: 'POST', path: '/announcements/{announcement_id}/pin' },
  broadcastAnnouncement: { method: 'POST', path: '/announcements/{announcement_id}/broadcast' },
  listAnnouncementDeliveries: { method: 'GET', path: '/announcements/{announcement_id}/deliveries' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class AnnouncementsResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 分页列出可见公告；匿名（`public_read=true`）只可见已发布的 public/members 公告。
   * 需要 `announcement:read` 才能看到草稿、私有与归档公告。幂等只读，结果可缓存。
   * 400 过滤参数非法；401 未认证；429 限流。
   */
  list(
    params: {
      status?: AnnouncementStatus;
      category?: string;
      tag?: string[];
      pinned?: boolean;
      q?: string;
      published_after?: Timestamp;
      updated_since?: Timestamp;
      page?: number;
      size?: number;
      sort?: 'published_at' | 'created_at' | 'updated_at' | 'priority';
      order?: SortOrder;
    } = {},
    options?: ReadOptions,
  ): Promise<PagedAnnouncement> {
    return readJson<PagedAnnouncement>(this.ctx, {
      path: '/announcements',
      query: params,
      resource: 'announcements',
      options,
    });
  }

  /**
   * 创建公告（Agent/机器人主动推送，无审核队列）；需要 `announcement:write`。
   * `publish=true` 需额外 `announcement:publish`，`broadcast=true` 还需 `channel:manage`。
   * 201 新建 / 200 命中 `dedup_key`；403 缺 scope；409 置顶超限；422 参数非法。
   */
  create(body: CreateAnnouncementRequest, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Announcement>>;
  create(body: CreateAnnouncementRequest, options?: WriteOptions): Promise<Announcement>;
  async create(body: CreateAnnouncementRequest, options?: WriteOptions): Promise<Announcement | WriteOutcome<Announcement>> {
    if (options?.queueIfOffline) return writeWithQueue<Announcement>(this.ctx, { method: 'POST', path: '/announcements', body, options });
    return writeJson<Announcement>(this.ctx, { method: 'POST', path: '/announcements', body, options });
  }

  /**
   * 读取单个公告详情；需要 `announcement:read`（或公开可见）。幂等只读，带强 `ETag`。
   * 无权访问草稿/私有公告返回 404（而非 403，避免枚举存在性）；401 未认证；429 限流。
   */
  get(announcementId: string, options?: ReadOptions): Promise<Announcement> {
    const path = substitutePath('/announcements/{announcement_id}', { announcement_id: announcementId });
    return readJson<Announcement>(this.ctx, { path, resource: 'announcements', id: announcementId, options });
  }

  /**
   * 局部更新公告；需要 `announcement:write`，改广播目标还需 `channel:manage`。
   * 幂等写：`options.ifMatch` 做乐观锁，不匹配返回 412 precondition_failed。
   * 404 公告不存在；409 `publish_at` 已发布不可改或置顶超限；422 参数非法。
   */
  update(
    announcementId: string,
    body: UpdateAnnouncementRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Announcement>>;
  update(announcementId: string, body: UpdateAnnouncementRequest, options?: WriteOptions): Promise<Announcement>;
  async update(
    announcementId: string,
    body: UpdateAnnouncementRequest,
    options?: WriteOptions,
  ): Promise<Announcement | WriteOutcome<Announcement>> {
    const path = substitutePath('/announcements/{announcement_id}', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<Announcement>(this.ctx, { method: 'PATCH', path, body, options });
    return writeJson<Announcement>(this.ctx, { method: 'PATCH', path, body, options });
  }

  /**
   * 删除公告：默认归档（`status=archived`，不可逆），`purge=true` 时物理删除。
   * 归档需 `announcement:write`，物理删除需 `announcement:publish`。重复调用总是 204。
   * 403 缺 scope；404 id 从未存在；401 未认证；429 限流。
   */
  remove(
    announcementId: string,
    params: { purge?: boolean } | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<void>>;
  remove(announcementId: string, params?: { purge?: boolean }, options?: WriteOptions): Promise<void>;
  async remove(
    announcementId: string,
    params?: { purge?: boolean },
    options?: WriteOptions,
  ): Promise<void | WriteOutcome<void>> {
    const path = substitutePath('/announcements/{announcement_id}', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<void>(this.ctx, { method: 'DELETE', path, query: params, options });
    return writeJson<void>(this.ctx, { method: 'DELETE', path, query: params, options });
  }

  /**
   * 发布公告（可定时）：未来 `publish_at` 进入 `scheduled`，否则立即 `published`。
   * 需要 `announcement:publish`，`broadcast=true` 时还需 `channel:manage`。
   * 对已发布公告重复调用幂等（200）；404 不存在；409 归档/过期或改 `publish_at`；422 参数非法。
   */
  publish(
    announcementId: string,
    body: PublishAnnouncementRequest | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Announcement>>;
  publish(announcementId: string, body?: PublishAnnouncementRequest, options?: WriteOptions): Promise<Announcement>;
  async publish(
    announcementId: string,
    body?: PublishAnnouncementRequest,
    options?: WriteOptions,
  ): Promise<Announcement | WriteOutcome<Announcement>> {
    const path = substitutePath('/announcements/{announcement_id}/publish', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<Announcement>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
    return writeJson<Announcement>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
  }

  /**
   * 撤销发布：`published`/`scheduled` 退回 `draft` 并清空发布时刻。需要 `announcement:publish`。
   * 幂等：对 `draft` 重复调用返回 200 且状态不变。404 不存在；409 归档/过期等终态不可回退。
   */
  unpublish(announcementId: string, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Announcement>>;
  unpublish(announcementId: string, options?: WriteOptions): Promise<Announcement>;
  async unpublish(announcementId: string, options?: WriteOptions): Promise<Announcement | WriteOutcome<Announcement>> {
    const path = substitutePath('/announcements/{announcement_id}/unpublish', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<Announcement>(this.ctx, { method: 'POST', path, options });
    return writeJson<Announcement>(this.ctx, { method: 'POST', path, options });
  }

  /**
   * 设置或取消公告置顶；需要 `announcement:publish`。重复设置同一值幂等。
   * 404 公告不存在；409 置顶总数超过 `announcements.max_pinned`；401 未认证；429 限流。
   */
  setPin(
    announcementId: string,
    body: PinAnnouncementRequest,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Announcement>>;
  setPin(announcementId: string, body: PinAnnouncementRequest, options?: WriteOptions): Promise<Announcement>;
  async setPin(
    announcementId: string,
    body: PinAnnouncementRequest,
    options?: WriteOptions,
  ): Promise<Announcement | WriteOutcome<Announcement>> {
    const path = substitutePath('/announcements/{announcement_id}/pin', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<Announcement>(this.ctx, { method: 'POST', path, body, options });
    return writeJson<Announcement>(this.ctx, { method: 'POST', path, body, options });
  }

  /**
   * 手动触发一次广播（返回 202 异步 `Job`）；需要 `channel:manage`，未发布公告也可广播。
   * 幂等：同一 `Idempotency-Key` 重放返回首次任务，不重复创建。
   * 404 公告不存在；409 已有运行中的广播任务；422 目标渠道非法；429 限流。
   */
  broadcast(
    announcementId: string,
    body: BroadcastAnnouncementRequest | undefined,
    options: WriteOptions & { queueIfOffline: true },
  ): Promise<WriteOutcome<Job>>;
  broadcast(announcementId: string, body?: BroadcastAnnouncementRequest, options?: WriteOptions): Promise<Job>;
  async broadcast(
    announcementId: string,
    body?: BroadcastAnnouncementRequest,
    options?: WriteOptions,
  ): Promise<Job | WriteOutcome<Job>> {
    const path = substitutePath('/announcements/{announcement_id}/broadcast', { announcement_id: announcementId });
    if (options?.queueIfOffline) return writeWithQueue<Job>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
    return writeJson<Job>(this.ctx, { method: 'POST', path, ...(body !== undefined ? { body } : {}), options });
  }

  /**
   * 列出该公告在各渠道的投递记录（at-least-once，渠道侧可能收到重复消息）。
   * 需要 `announcement:read`；结果为 eventual 视图（滞后不超过 `PT1M`），可缓存。
   * 400 过滤参数非法；401 未认证；403 缺 scope；404 公告不存在；429 限流。
   */
  deliveries(
    announcementId: string,
    params: { state?: DeliveryState; channel_id?: string; page?: number; size?: number; order?: SortOrder } = {},
    options?: ReadOptions,
  ): Promise<PagedDelivery> {
    const path = substitutePath('/announcements/{announcement_id}/deliveries', { announcement_id: announcementId });
    return readJson<PagedDelivery>(this.ctx, {
      path,
      query: params,
      resource: 'announcement-deliveries',
      options,
    });
  }
}
