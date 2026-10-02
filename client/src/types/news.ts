/**
 * 与 OpenAPI 契约 `doc/api/components/schemas/news.yaml` 对应的新闻板（公告）、
 * 广播渠道与事件流类型。
 *
 * `StreamTopic` / `StreamEvent` 的形状由 `src/sse.ts` 定义，此处直接转发，
 * 避免同一契约概念出现两份可能漂移的声明；其余类型与契约字段逐一对应（snake_case）。
 */

import type { Id, Paged, PrincipalRef, Timestamp, Visibility } from './common.js';
import type { StreamTopic } from '../sse.js';

export type { StreamEvent, StreamTopic } from '../sse.js';

/* ------------------------------------------------------------------ 公告 */

/** 公告状态机；`archived`/`expired` 为终态，非法迁移由服务端返回 `409`。 */
export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'expired' | 'archived';

/** 公告优先级；排序权重 `low < normal < high < urgent`，不影响投递顺序。 */
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

/** 公告来源信息；公告上只读，创建时可提交。 */
export interface AnnouncementSource {
  /** 来源类型（契约中的内联枚举）。 */
  kind: 'manual' | 'agent' | 'group_chat' | 'api' | 'import';
  /** 来源平台标识，如 `qq`、`telegram`。 */
  platform?: string;
  /** 原始消息/网页地址，供人工回看。 */
  url?: string;
  /** 原始作者展示名，不要求是系统主体。 */
  author?: string;
  /** 群名称；`kind=group_chat` 时使用。 */
  group_name?: string;
  /** 平台侧消息 id，用于回溯与人工去重。 */
  message_id?: string;
  /** 抽取前的原始文本；未保留时为 `null`。 */
  raw_text?: string | null;
  /** 采集到该信息的时刻；未知时为 `null`。 */
  collected_at?: Timestamp | null;
  /** 自动抽取置信度（0..1）；人工录入或未知时为 `null`。 */
  confidence?: number | null;
}

/** 新闻板公告资源；已发布公告的正文仍可修改并提升 `revision`。 */
export interface Announcement {
  id: Id;
  title: string;
  body_markdown: string;
  category: string;
  tags: string[];
  priority: AnnouncementPriority;
  pinned: boolean;
  status: AnnouncementStatus;
  visibility: Visibility;
  /** 计划发布时刻；`status=scheduled` 时必有值。 */
  publish_at?: Timestamp | null;
  /** 实际变为 `published` 的时刻；未发布为 `null`。 */
  published_at?: Timestamp | null;
  /** 过期时刻；到点后服务端自动把 `published` 置为 `expired`。 */
  expires_at?: Timestamp | null;
  /** 归档时刻；未归档为 `null`。 */
  archived_at?: Timestamp | null;
  /** 来源信息；人工创建且未填写为 `null`。 */
  source?: AnnouncementSource | null;
  /** 推送方自带的去重键；未提供为 `null`。 */
  dedup_key?: string | null;
  /** 发布时是否自动广播到 `broadcast_channel_ids`。 */
  broadcast_on_publish?: boolean;
  /** 广播目标渠道快照。 */
  broadcast_channel_ids?: Id[];
  /** 署名作者（可不同于创建者）；未署名为 `null`。 */
  author?: PrincipalRef | null;
  /** 创建者；外部机器人推送时为对应的 `service` 主体。 */
  created_by?: PrincipalRef | null;
  /** 投递汇总；从未广播为 `null`。返回「公告 × 渠道」逐条状态见 deliveries。 */
  delivery_summary?: { pending: number; sent: number; failed: number } | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** 与 `ETag` 等值的版本标记，用于 `If-Match`。 */
  revision: string;
}

/** 创建公告（Agent / 机器人主动推送；无审核队列）。 */
export interface CreateAnnouncementRequest {
  title: string;
  body_markdown: string;
  category: string;
  tags?: string[];
  priority?: AnnouncementPriority;
  pinned?: boolean;
  visibility?: Visibility;
  /** 是否立即（或按 `publish_at` 定时）发布；需 `announcement:publish`。 */
  publish?: boolean;
  /** 计划发布时刻；未来时刻则为 `scheduled`。 */
  publish_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  /** 发布后是否广播到 `channel_ids`；需 `channel:manage`。 */
  broadcast?: boolean;
  channel_ids?: Id[];
  /** 推送方自带的去重键（8..128 字符，7 天窗口）。 */
  dedup_key?: string | null;
  source?: AnnouncementSource | null;
}

/** 局部更新公告；不含 `publish`/`source`/`dedup_key`。 */
export interface UpdateAnnouncementRequest {
  title?: string;
  body_markdown?: string;
  category?: string;
  tags?: string[];
  priority?: AnnouncementPriority;
  pinned?: boolean;
  visibility?: Visibility;
  /** 仅 `draft`/`scheduled` 可改；`published` 改此字段返回 `409`，`null` 取消定时。 */
  publish_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  /** 是否在下次发布时广播（写入 `broadcast_on_publish`）。 */
  broadcast?: boolean;
  channel_ids?: Id[];
}

/** 发布公告的选项。 */
export interface PublishAnnouncementRequest {
  /** 未来时刻则为 `scheduled`；省略或 `null` 表示立即发布。 */
  publish_at?: Timestamp | null;
  broadcast?: boolean;
  channel_ids?: Id[];
}

/** 设置或取消置顶。 */
export interface PinAnnouncementRequest {
  /** `true` 置顶，`false` 取消置顶；超上限返回 `409`。 */
  pinned: boolean;
}

/** 手动触发一次广播（异步任务）。 */
export interface BroadcastAnnouncementRequest {
  channel_ids?: Id[];
  /** 为 `true` 时只投递到测试渠道且不计入正式统计。 */
  test?: boolean;
}

/** 公告的偏移分页结果。 */
export type PagedAnnouncement = Paged<Announcement>;

/* ------------------------------------------------------------------ 渠道 */

/** 广播渠道类型；创建后不可更改。 */
export type ChannelKind = 'qq_group' | 'qq_private' | 'webhook' | 'discord_webhook' | 'telegram';

/** 广播渠道资源；`target`/`secret` 明文永不回显。 */
export interface Channel {
  id: Id;
  name: string;
  kind: ChannelKind;
  /** 脱敏后的投递目标。 */
  target_masked: string;
  /** 是否已配置签名密钥。 */
  secret_set?: boolean;
  enabled: boolean;
  /** 消息模板；`null` 时使用服务器默认模板。 */
  template?: string | null;
  mention_all?: boolean;
  /** 每分钟投递上限；超出排队而非失败。 */
  rate_limit_per_minute?: number;
  /** 可见性过滤：`public` < `members` < `all`。 */
  visibility_filter?: 'public' | 'members' | 'all';
  created_by?: PrincipalRef | null;
  last_delivery_at?: Timestamp | null;
  last_error?: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
}

/** 创建广播渠道；`target`/`secret` 只在写入时提交。 */
export interface CreateChannelRequest {
  name: string;
  kind: ChannelKind;
  target: string;
  secret?: string;
  enabled?: boolean;
  template?: string | null;
  mention_all?: boolean;
  rate_limit_per_minute?: number;
  visibility_filter?: 'public' | 'members' | 'all';
}

/** 局部更新渠道；`target`/`secret` 提供时整体替换，`null` 清除密钥。 */
export interface UpdateChannelRequest {
  name?: string;
  target?: string;
  secret?: string | null;
  enabled?: boolean;
  template?: string | null;
  mention_all?: boolean;
  rate_limit_per_minute?: number;
  visibility_filter?: 'public' | 'members' | 'all';
}

/** 渠道轻量引用（投递记录中的快照）。 */
export interface ChannelRef {
  id: Id;
  name: string;
  kind: ChannelKind;
}

/** 渠道连通性测试的可选参数。 */
export interface TestChannelRequest {
  /** 自定义测试文案；省略时使用默认文案。 */
  message?: string;
}

/** 测试结果；投递失败以 `ok=false` 表达而不是 4xx。 */
export interface ChannelTestResult {
  /** 上游是否接受了该条消息。 */
  ok: boolean;
  /** 端到端耗时（毫秒）；未发出请求时为 `null`。 */
  latency_ms: number | null;
  /** 上游返回的 HTTP 状态码；不适用为 `null`。 */
  status_code?: number | null;
  /** 失败原因摘要；`ok=true` 时为 `null`。 */
  error?: string | null;
  sent_at?: Timestamp;
}

/** 渠道的偏移分页结果（已脱敏）。 */
export type PagedChannel = Paged<Channel>;

/* ------------------------------------------------------------------ 投递 */

/** 单条投递的状态机；`skipped` 为未尝试投递的终态。 */
export type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

/** 一条「公告 × 渠道」的投递记录（at-least-once 语义）。 */
export interface Delivery {
  id: Id;
  announcement_id: Id;
  /** 发起投递时的渠道快照，渠道删除后仍完整。 */
  channel: ChannelRef;
  state: DeliveryState;
  /** 已尝试投递的次数（含正在进行的一次）。 */
  attempts: number;
  last_attempt_at?: Timestamp | null;
  sent_at?: Timestamp | null;
  error?: string | null;
  external_message_id?: string | null;
  /** 下一次重试时刻；终态或成功时为 `null`。 */
  next_attempt_at?: Timestamp | null;
  created_at: Timestamp;
}

/** 投递记录的偏移分页结果。 */
export type PagedDelivery = Paged<Delivery>;

/* --------------------------------------------------------------- 事件流 */

/** 短时流令牌的签发参数。 */
export interface StreamTokenRequest {
  /** 希望订阅的主题；省略时授予该主体有权读取的全部主题。 */
  topics?: StreamTopic[];
  /** 令牌有效秒数（60..600，默认 600）。 */
  expires_in?: number;
  /** 从该事件序号之后开始补发。 */
  last_event_id?: string | null;
}

/** 短时流令牌；**单次连接有效**，断开后必须重新签发。 */
export interface StreamToken {
  /** 令牌明文，放入 `access_token` 查询参数。 */
  token: string;
  expires_at: Timestamp;
  /** 实际授予的主题（已按主体 scope 校验）。 */
  topics: StreamTopic[];
  /** 已带好查询参数的 SSE 地址，可直接交给 `EventSource`。 */
  url: string;
}
