/**
 * 自动生成，请勿手工编辑：由 `scripts/generate-types.mjs` 从
 * `build/openapi.bundled.json` 的 `components.schemas` 生成（224 个 schema）。
 *
 * 它是"契约 ↔ 客户端手写类型"的编译期对账基准：`client/test/type-contract.test.ts`
 * 对客户端导出的同名类型做双向可赋值校验。契约一旦新增可选字段、删字段或改类型，
 * 这里会同形变化，从而让 `tsc` / `vitest` 失败，而不是静默漂移。
 *
 * 重新生成：`npm run api:build && node scripts/generate-types.mjs`
 */

export type AccountStatus = 'active' | 'disabled';

export type AccountsConfig = {
  default_template: string;
  templates: Record<string, {
    description?: string;
    scopes: Scope[];
  }>;
};

export type ActorKind = 'human' | 'service' | 'system';

export type Announcement = {
  id: Id;
  title: string;
  body_markdown: string;
  category: string;
  tags: string[];
  priority: AnnouncementPriority;
  pinned: boolean;
  status: AnnouncementStatus;
  visibility: Visibility;
  publish_at?: Timestamp | null;
  published_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  archived_at?: Timestamp | null;
  source?: AnnouncementSource | null;
  dedup_key?: string | null;
  broadcast_on_publish?: boolean;
  broadcast_channel_ids?: Id[];
  author?: PrincipalRef | null;
  created_by?: PrincipalRef | null;
  delivery_summary?: {
    pending: number;
    sent: number;
    failed: number;
  } | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AnnouncementSource = {
  kind: 'manual' | 'agent' | 'group_chat' | 'api' | 'import';
  platform?: string;
  url?: string;
  author?: string;
  group_name?: string;
  message_id?: string;
  raw_text?: string | null;
  collected_at?: Timestamp | null;
  confidence?: number | null;
};

export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'expired' | 'archived';

export type AnnouncementsConfig = {
  max_pinned: number;
  dedup_window: Duration;
  broadcast_retry: BroadcastRetryConfig;
};

export type ApproveQuotaClaimRequest = {
  note?: string | null;
};

export type AuditLog = {
  id: Id;
  at: Timestamp;
  actor?: PrincipalRef | null;
  actor_kind: ActorKind;
  action: string;
  target?: AuditTarget | null;
  outcome: AuditOutcome;
  status_code?: number | null;
  scope_used?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  request_id: string;
  metadata?: Record<string, unknown>;
};

export type AuditOutcome = 'success' | 'denied' | 'failure';

export type AuditTarget = {
  resource?: string;
  id?: Id | null;
  label?: string | null;
};

export type AuthConfig = {
  access_token_ttl: Duration;
  refresh_token_ttl: Duration;
  password_min_length: number;
  session_max_per_principal: number;
};

export type BroadcastAnnouncementRequest = {
  channel_ids?: Id[];
  test?: boolean;
};

export type BroadcastRetryConfig = {
  max_attempts: number;
  backoff: Duration;
};

export type Capabilities = {
  crawler_embedded: boolean;
  public_read: boolean;
  sse: boolean;
  judges: Judge[];
  ingest_batch_max: number;
  idempotency_window: Duration;
  max_stream_connections: number;
};

export type ChangeFeed = {
  changes: ResourceChange[];
  cursor: string;
  has_more: boolean;
  server_time: Timestamp;
  retention: Duration;
};

export type ChangeOp = 'upsert' | 'delete';

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
};

export type Channel = {
  id: Id;
  name: string;
  kind: ChannelKind;
  target_masked: string;
  secret_set?: boolean;
  enabled: boolean;
  template?: string | null;
  mention_all?: boolean;
  rate_limit_per_minute?: number;
  visibility_filter?: 'public' | 'members' | 'all';
  created_by?: PrincipalRef | null;
  last_delivery_at?: Timestamp | null;
  last_error?: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type ChannelKind = 'qq_group' | 'qq_private' | 'webhook' | 'discord_webhook' | 'telegram';

export type ChannelRef = {
  id: Id;
  name: string;
  kind: ChannelKind;
};

export type ChannelTestResult = {
  ok: boolean;
  latency_ms: number | null;
  status_code?: number | null;
  error?: string | null;
  sent_at?: Timestamp;
};

export type ClubActivity = {
  club: ClubCode;
  status: ClubMembershipStatus;
  registered_at: Date;
  last_active_at?: Timestamp | null;
  active_days: number;
  submissions: number;
};

export type ClubCode = 'safewind_software' | 'acm_icpc';

export type ClubMembership = {
  club: ClubCode;
  status: ClubMembershipStatus;
  registered_at: string;
  ended_at?: string | null;
  role?: string | null | string;
  membership_no?: string | null | string;
};

export type ClubMembershipStatus = 'active' | 'inactive' | 'alumni';

export type Config = {
  revision: string;
  source: ConfigSource;
  updated_at: Timestamp;
  server: ServerConfig;
  auth: AuthConfig;
  accounts: AccountsConfig;
  ingest: IngestConfig;
  roster: RosterConfig;
  scoreboards: ScoreboardsConfig;
  stats: StatsConfig;
  announcements: AnnouncementsConfig;
  stream: StreamConfig;
  rate_limit: RateLimitConfig;
  judges: JudgesConfig;
  log: LogConfig;
  retention?: RetentionConfig;
  restart_required_fields: string[];
};

export type ConfigFieldSpec = {
  retention?: RetentionConfig;
  path: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'duration' | 'enum' | 'string_list' | 'object';
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
  secret?: boolean;
  mutable: boolean;
  restart_required: boolean;
  description: string;
};

export type ConfigPatch = {
  server?: {
    public_read?: boolean | null;
    base_url?: string | null;
    cors_origins?: string[] | null;
  } | null;
  auth?: {
    access_token_ttl?: Duration | null;
    refresh_token_ttl?: Duration | null;
    password_min_length?: number | null;
    session_max_per_principal?: number | null;
  } | null;
  accounts?: AccountsConfig;
  ingest?: {
    batch_max?: number | null;
    clock_skew_past?: Duration | null;
    clock_skew_future?: Duration | null;
    submissions_retention?: Duration | null;
  } | null;
  roster?: {
    active_within?: Duration | null;
    export_ttl?: Duration | null;
    export_row_limit?: number | null;
  } | null;
  scoreboards?: {
    refresh_interval?: Duration | null;
    freshness_bound?: Duration | null;
    max_entries?: number | null;
  } | null;
  stats?: {
    materialize_interval?: Duration | null;
    freshness_bound?: Duration | null;
    max_range_days?: number | null;
  } | null;
  announcements?: {
    max_pinned?: number | null;
    dedup_window?: Duration | null;
    broadcast_retry?: {
      max_attempts?: number | null;
      backoff?: Duration | null;
    } | null;
  } | null;
  stream?: {
    heartbeat_interval?: Duration | null;
    replay_buffer_events?: number | null;
    replay_buffer_duration?: Duration | null;
    stream_token_ttl?: Duration | null;
  } | null;
  rate_limit?: {
    default_per_minute?: number | null;
    ingest_per_minute?: number | null;
    export_per_hour?: number | null;
  } | null;
  judges?: {
    enabled?: Judge[] | null;
    crawl_interval?: Duration | null;
  } | null;
  log?: {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | null;
    format?: 'text' | 'json' | null;
  } | null;
};

export type ConfigSchema = {
  revision: string;
  sections: ConfigSectionSpec[];
};

export type ConfigSectionSpec = {
  key: string;
  title: string;
  description: string;
  fields: ConfigFieldSpec[];
};

export type ConfigSource = 'file' | 'api' | 'override';

export type ContestKind = 'regional' | 'provincial' | 'invitational' | 'ecfinal' | 'world_final' | 'online' | 'other';

export type ContestRef = {
  name: string;
  kind: ContestKind;
  season: string;
  external_id?: string | null;
  held_on?: Date | null;
  location?: string | null;
  url?: string | null;
};

export type CrawlerConfig = {
  revision: string;
  mode: 'embedded' | 'external';
  enabled: boolean;
  judges: CrawlerJudgeConfig[];
  schedule: {
    interval: Duration;
    jitter: Duration;
    timezone: string;
    active_hours?: {
      from: string;
      to: string;
    };
  };
  rate_limit: {
    requests_per_minute: number;
    concurrency: number;
  };
  proxy: ProxyConfig;
  retention?: {
    submissions: Duration;
    runs: Duration;
  };
  updated_at: Timestamp;
};

export type CrawlerConfigPatch = {
  enabled?: boolean;
  judges?: CrawlerJudgeConfig[];
  schedule?: {
    interval: Duration;
    jitter: Duration;
    timezone: string;
    active_hours?: {
      from: string;
      to: string;
    };
  };
  rate_limit?: {
    requests_per_minute: number;
    concurrency: number;
  };
  proxy?: ProxyConfig;
  retention?: {
    submissions: Duration;
    runs: Duration;
  };
};

export type CrawlerJudgeConfig = {
  judge: Judge;
  enabled: boolean;
  interval?: Duration | null;
  max_pages?: number | null;
  extra?: Record<string, unknown> | null;
};

export type CrawlerRun = {
  id: Id;
  judge: Judge;
  state: CrawlerRunState;
  trigger?: CrawlerRunTrigger;
  started_at: Timestamp;
  finished_at?: Timestamp | null;
  counts: CrawlerRunCounts;
  proxy_used?: boolean;
  proxy_failures?: number;
  error?: string | null;
  report_note?: string | null;
};

export type CrawlerRunCounts = {
  fetched: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  failed: number;
};

export type CrawlerRunReportRequest = {
  judge: Judge;
  state: CrawlerRunState;
  trigger?: CrawlerRunTrigger;
  started_at: Timestamp;
  finished_at?: Timestamp | null;
  counts: CrawlerRunCounts;
  proxy_used?: boolean;
  proxy_failures?: number;
  error?: string | null;
};

export type CrawlerRunState = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial';

export type CrawlerRunTrigger = 'schedule' | 'manual' | 'api';

export type CrawlerStatus = {
  mode: 'embedded' | 'external';
  enabled: boolean;
  last_run_at?: Timestamp | null;
  next_run_at?: Timestamp | null;
  judges: JudgeCollectionStatus[];
  pending_items: number;
  proxy_summary?: {
    healthy: number;
    unhealthy: number;
    unknown: number;
  } | null;
  generated_at: Timestamp;
};

export type CreateAccountRequest = {
  username: string;
  display_name: string;
  kind: PrincipalKind;
  labels?: LabelSet;
  template?: string;
  scopes?: ScopeSet;
  profile?: PrincipalProfileWrite;
  password?: string;
  status?: AccountStatus;
};

export type CreateAnnouncementRequest = {
  title: string;
  body_markdown: string;
  category: string;
  tags?: string[];
  priority?: AnnouncementPriority;
  pinned?: boolean;
  visibility?: Visibility;
  publish?: boolean;
  publish_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  broadcast?: boolean;
  channel_ids?: Id[];
  dedup_key?: string | null;
  source?: AnnouncementSource | null;
};

export type CreateChannelRequest = {
  name: string;
  kind: ChannelKind;
  target: string;
  secret?: string;
  enabled?: boolean;
  template?: string | null;
  mention_all?: boolean;
  rate_limit_per_minute?: number;
  visibility_filter?: 'public' | 'members' | 'all';
};

export type CreateQuotaClaimRequest = {
  team_id: Id;
  members: {
    principal_id: Id;
    role?: QuotaClaimMemberRole;
  }[];
  priority?: number;
  note?: string | null;
};

export type CreateQuotaRequest = {
  title: string;
  contest: ContestRef;
  quota_total: number;
  max_claims_per_team?: number;
  claim_window?: QuotaClaimWindow | null;
  eligibility?: QuotaEligibility | null;
  notes?: string | null;
};

export type CreateScoreboardRequest = {
  name: string;
  description?: string;
  scope: ScoreboardScope;
  metric: ScoreboardMetric;
  judge?: Judge | null;
  judge_label?: string;
  period?: ScoreboardPeriod;
  filter?: ScoreboardFilter;
  visibility?: Visibility;
};

export type CreateTeamRequest = {
  name: string;
  short_name?: string;
  season?: string;
  description?: string;
  labels?: LabelSet;
  external_id?: string | null;
};

export type Credential = {
  id: Id;
  principal_id: Id;
  kind: CredentialKind;
  name: string;
  prefix?: string;
  scopes: ScopeSet;
  created_at: Timestamp;
  created_by?: PrincipalRef | null;
  expires_at?: Timestamp | null;
  last_used_at?: Timestamp | null;
  revoked_at?: Timestamp | null;
};

export type CredentialKind = 'session' | 'api_key';

export type CursorPageMeta = {
  has_more: boolean;
  next_cursor: string | null;
};

export type Date = string;

export type Delivery = {
  id: Id;
  announcement_id: Id;
  channel: ChannelRef;
  state: DeliveryState;
  attempts: number;
  last_attempt_at?: Timestamp | null;
  sent_at?: Timestamp | null;
  error?: string | null;
  external_message_id?: string | null;
  next_attempt_at?: Timestamp | null;
  created_at: Timestamp;
};

export type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export type DistributionStats = {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p90?: number;
  p99?: number;
  stddev?: number;
};

export type Duration = string;

export type HealthCheck = {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  latency_ms?: number | null;
  message?: string | null;
};

export type HealthStatus = {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime_seconds: number;
  time: Timestamp;
  checks: HealthCheck[];
};

export type HeatmapDay = {
  date: Date;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  submissions?: number;
  accepted?: number;
};

export type HeatmapSummary = {
  total: number;
  max_day_value: number;
  active_days: number;
  longest_streak?: number;
  current_streak?: number;
  first_date?: Date | null;
  last_date?: Date | null;
  level_thresholds: number[];
};

export type HeatmapUnit = 'submissions' | 'accepted' | 'active_days';

export type HistogramBin = {
  lower: number;
  upper: number;
  count: number;
  ratio: number;
  label: string;
};

export type HistogramMetric = 'solved_count' | 'rating' | 'max_rating' | 'submissions_30d' | 'active_days_30d' | 'acceptance_rate' | 'rating_delta';

export type Id = string;

export type ImportMemberRow = {
  username: string;
  display_name?: string;
  student_id?: string;
  enrollment_year?: number;
  major?: string;
  email?: string;
  phone?: string;
  qq?: string;
  clubs?: ClubCode[];
  labels?: LabelSet;
  scopes?: ScopeSet;
  oj_handles?: {
    judge: Judge;
    handle: string;
  }[];
};

export type ImportRequest = {
  format: 'csv' | 'json';
  csv?: string;
  members?: ImportMemberRow[];
  on_conflict?: 'skip' | 'update' | 'fail';
  dry_run?: boolean;
};

export type ImportResult = {
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: ImportRowResult[];
};

export type ImportRowResult = {
  row_number: number;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  principal_id?: Id | null;
  errors: ValidationError[];
};

export type IngestConfig = {
  batch_max: number;
  clock_skew_past: Duration;
  clock_skew_future: Duration;
  submissions_retention: Duration;
};

export type IngestHandleSnapshotItem = {
  judge: Judge;
  handle: string;
  captured_at: Timestamp;
  rating?: number | null;
  max_rating?: number | null;
  solved_count?: number | null;
  attempted_count?: number | null;
  submissions_30d?: number | null;
  active_days_30d?: number | null;
};

export type IngestHandleSnapshotsRequest = {
  items: IngestHandleSnapshotItem[];
  crawler_run_id?: Id | null;
};

export type IngestItemResult = {
  index: number;
  status: 'accepted' | 'duplicate' | 'rejected';
  id?: Id | null;
  code?: string | null;
  message?: string | null;
  pointer?: string | null;
};

export type IngestProblemItem = {
  judge: Judge;
  external_id: string;
  title: string;
  tags?: string[];
  difficulty?: number | null;
  rating?: number | null;
  url?: string | null;
};

export type IngestProblemsRequest = {
  items: IngestProblemItem[];
  crawler_run_id?: Id | null;
};

export type IngestRatingRecordItem = {
  judge: Judge;
  handle: string;
  contest_id?: string;
  contest_name?: string | null;
  rating: number;
  max_rating?: number | null;
  rank?: number | null;
  performance?: number | null;
  at: Timestamp;
};

export type IngestRatingRecordsRequest = {
  items: IngestRatingRecordItem[];
  crawler_run_id?: Id | null;
};

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: number;
  items: IngestItemResult[];
  crawler_run_id?: Id | null;
  materialized_at?: Timestamp | null;
};

export type IngestSubmissionItem = {
  judge: Judge;
  submission_id: string;
  handle: string;
  problem: OjProblemRef;
  verdict?: OjVerdict | null;
  verdict_raw?: string | null;
  language?: string | null;
  submitted_at: Timestamp;
  contest_id?: string | null;
  contest_name?: string | null;
  is_first_ac?: boolean;
};

export type IngestSubmissionsRequest = {
  items: IngestSubmissionItem[];
  crawler_run_id?: Id | null;
};

export type IssueCredentialRequest = {
  kind: CredentialKind;
  name: string;
  scopes?: ScopeSet;
  expires_at?: Timestamp | null;
  expires_in?: number;
  description?: string;
};

export type IssuedCredential = Credential & {
  secret: string;
};

export type Job = {
  id: Id;
  kind: JobKind;
  state: JobState;
  progress: JobProgress;
  result?: Record<string, unknown> | null;
  error?: Problem | null;
  created_at: Timestamp;
  started_at?: Timestamp | null;
  finished_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  created_by?: PrincipalRef | null;
};

export type JobKind = 'roster_export' | 'scoreboard_rebuild' | 'crawler_run' | 'announcement_broadcast';

export type JobProgress = {
  percent: number;
  message?: string;
};

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export type Judge = 'codeforces' | 'atcoder' | 'luogu' | 'nowcoder' | 'vjudge' | 'qoj' | 'other';

export type JudgeCollectionStatus = {
  judge: Judge;
  enabled: boolean;
  last_attempt_at?: Timestamp | null;
  last_success_at?: Timestamp | null;
  lag?: Duration | null;
  consecutive_failures: number;
  last_error?: string | null;
  using_proxy?: boolean;
  collected_24h?: number;
};

export type JudgesConfig = {
  enabled: Judge[];
  crawl_interval: Duration;
};

export type Label = string;

export type LabelSet = Label[];

export type LinkOjHandleRequest = {
  principal_id?: Id;
  judge: Judge;
  judge_label?: string;
  handle: string;
};

export type LogConfig = {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  format: 'text' | 'json';
};

export type LoginRequest = {
  username: string;
  password: string;
  device_name?: string;
};

export type LogoutRequest = {
  refresh_token?: string;
  all_sessions?: boolean;
};

export type Me = Principal & {
  credential?: Credential | null;
  effective_scopes: ScopeSet;
};

export type Member = Principal & {
  clubs: ClubCode[];
  activity: MemberActivity;
  teams: TeamRef[];
  oj_handles: OjHandleRef[];
};

export type MemberActivity = {
  by_club: ClubActivity[];
  last_active_at: Timestamp | null;
  last_login_at?: Timestamp | null;
  last_api_use_at?: Timestamp | null;
  last_oj_activity_at: Timestamp | null;
  activity_state: 'active' | 'dormant' | 'inactive';
  active_days_30d?: number;
  solved_count_30d?: number;
  submissions_30d?: number;
  computed_at: Timestamp;
};

export type Meta = {
  idempotency_window?: Duration;
  max_stream_connections?: number;
  api_version: string;
  server_version: string;
  server_time: Timestamp;
  current_season: string;
  capabilities: Capabilities;
};

export type OjContestRef = {
  judge: Judge;
  contest_id: string;
  name?: string | null;
  url?: string | null;
  started_at?: Timestamp | null;
};

export type OjHandle = {
  id: Id;
  principal_id: Id;
  judge: Judge;
  judge_label?: string | null;
  handle: string;
  profile_url?: string | null;
  verified: boolean;
  verification_state: 'pending' | 'verified' | 'failed';
  verification_token?: string | null;
  verified_at?: Timestamp | null;
  linked_at: Timestamp;
  last_crawled_at?: Timestamp | null;
  last_submission_at?: Timestamp | null;
  summary?: OjHandleSummary | null;
  revision: string;
  updated_at: Timestamp;
};

export type OjHandleRef = {
  id: Id;
  judge: Judge;
  judge_label?: string | null;
  handle: string;
  verified: boolean;
  latest_rating?: number | null;
};

export type OjHandleStats = OjHandleSummary & {
  handle_id: Id;
  judge: Judge;
  handle: string;
  window: Duration;
  recent_submissions: OjSubmission[];
  rating_points: {
    at: Timestamp;
    rating: number;
  }[];
};

export type OjHandleSummary = {
  rating?: number | null;
  max_rating?: number | null;
  rating_delta_30d?: number | null;
  solved_count: number;
  attempted_count: number;
  submissions_30d?: number;
  active_days_30d?: number;
  computed_at: Timestamp;
};

export type OjProblem = {
  id: Id;
  judge: Judge;
  external_id: string;
  title: string;
  url?: string | null;
  tags: string[];
  difficulty?: number | null;
  rating?: number | null;
  solved_count?: number | null;
  attempt_count?: number | null;
  first_seen_at: Timestamp;
  updated_at: Timestamp;
};

export type OjProblemRef = {
  problem_id?: Id | null;
  judge: Judge;
  external_id: string;
  title?: string | null;
  url?: string | null;
  tags?: string[];
  difficulty?: number | null;
  rating?: number | null;
};

export type OjRatingHistoryPage = CursorPageMeta & {
  items: OjRatingRecord[];
};

export type OjRatingRecord = {
  id: Id;
  judge: Judge;
  handle: string;
  principal_id?: Id | null;
  contest?: OjContestRef | null;
  rating: number;
  delta?: number | null;
  max_rating?: number | null;
  rank?: number | null;
  performance?: number | null;
  at: Timestamp;
  ingested_at?: Timestamp;
};

export type OjSubmission = {
  id: Id;
  judge: Judge;
  submission_id: string;
  handle: string;
  principal_id?: Id | null;
  problem: OjProblemRef;
  verdict?: OjVerdict | null;
  verdict_raw?: string | null;
  language?: string | null;
  submitted_at: Timestamp;
  ingested_at: Timestamp;
  contest?: OjContestRef | null;
  is_first_ac?: boolean;
};

export type OjSubmissionPage = CursorPageMeta & {
  items: OjSubmission[];
};

export type OjVerdict = 'accepted' | 'wrong_answer' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'runtime_error' | 'compile_error' | 'presentation_error' | 'partial' | 'skipped' | 'other';

export type PageMeta = {
  page: number;
  size: number;
  total: number;
  has_next: boolean;
};

export type PagedAnnouncement = PageMeta & {
  items: Announcement[];
};

export type PagedAuditLog = CursorPageMeta & {
  items: AuditLog[];
};

export type PagedChannel = PageMeta & {
  items: Channel[];
};

export type PagedCrawlerRun = CursorPageMeta & {
  items: CrawlerRun[];
};

export type PagedCredential = PageMeta & {
  items: Credential[];
} & Record<string, never>;

export type PagedDelivery = PageMeta & {
  items: Delivery[];
};

export type PagedJob = PageMeta & {
  items: Job[];
};

export type PagedMember = PageMeta & {
  items: Member[];
};

export type PagedOjHandle = PageMeta & {
  items: OjHandle[];
} & Record<string, never>;

export type PagedOjProblem = PageMeta & {
  items: OjProblem[];
};

export type PagedPrincipal = PageMeta & {
  items: Principal[];
} & Record<string, never>;

export type PagedQuota = PageMeta & {
  items: Quota[];
};

export type PagedQuotaClaim = PageMeta & {
  items: QuotaClaim[];
};

export type PagedRosterExport = PageMeta & {
  items: RosterExport[];
};

export type PagedScoreboard = PageMeta & {
  items: Scoreboard[];
};

export type PagedScoreboardEntry = PageMeta & {
  items: ScoreboardEntry[];
  generated_at: Timestamp | null;
  stale: boolean;
};

export type PagedTeam = PageMeta & {
  items: Team[];
};

export type PinAnnouncementRequest = {
  pinned: boolean;
};

export type Principal = {
  id: Id;
  username: string;
  display_name: string;
  kind: PrincipalKind;
  labels: LabelSet;
  scopes: ScopeSet;
  profile?: PrincipalProfile;
  status: AccountStatus;
  disabled_at?: Timestamp | null;
  last_active_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type PrincipalKind = 'human' | 'service';

export type PrincipalProfile = {
  student_id?: string;
  enrollment_year?: number;
  grade?: string;
  major?: string;
  masked_fields?: string[];
  club_memberships?: ClubMembership[];
  email?: string;
  phone?: string;
  qq?: string;
  remark?: string;
};

export type PrincipalProfileWrite = {
  student_id?: string;
  enrollment_year?: number;
  major?: string;
  email?: string;
  phone?: string;
  qq?: string;
  remark?: string;
};

export type PrincipalRef = {
  id: Id;
  username: string;
  display_name: string;
  kind: PrincipalKind;
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: ProblemCode;
  request_id?: string;
  errors?: ValidationError[];
  retry_after_seconds?: number;
  docs_url?: string;
};

export type ProblemCode = 'bad_request' | 'validation_failed' | 'unauthenticated' | 'invalid_token' | 'token_expired' | 'insufficient_scope' | 'forbidden' | 'not_found' | 'method_not_allowed' | 'conflict' | 'idempotency_key_reused' | 'version_conflict' | 'precondition_failed' | 'quota_exceeded' | 'team_claim_limit_reached' | 'claim_window_closed' | 'quota_not_open' | 'quota_finalized' | 'handle_already_linked' | 'judge_not_supported' | 'dedup_conflict' | 'cursor_expired' | 'rate_limited' | 'payload_too_large' | 'unsupported_media_type' | 'unprocessable_entity' | 'crawler_not_embedded' | 'crawler_run_in_progress' | 'job_not_cancellable' | 'export_expired' | 'internal_error' | 'service_unavailable';

export type ProxyConfig = {
  enabled: boolean;
  strategy: 'failover' | 'round_robin' | 'always';
  direct_timeout: Duration;
  proxies: ProxyServer[];
  no_proxy?: string[];
};

export type ProxyHealth = {
  state: 'unknown' | 'healthy' | 'unhealthy';
  checked_at?: Timestamp | null;
  latency_ms?: number | null;
  last_error?: string | null;
};

export type ProxyServer = {
  id: Id;
  label: string;
  url: string;
  username?: string | null;
  password?: string | null;
  has_password?: boolean;
  enabled: boolean;
  priority?: number;
  health?: ProxyHealth | null;
};

export type PublishAnnouncementRequest = {
  publish_at?: Timestamp | null;
  broadcast?: boolean;
  channel_ids?: Id[];
};

export type Quota = {
  id: Id;
  title: string;
  contest: ContestRef;
  quota_total: number;
  max_claims_per_team: number;
  status: QuotaStatus;
  counts: QuotaCounts;
  claim_window?: QuotaClaimWindow | null;
  eligibility?: QuotaEligibility | null;
  notes?: string | null;
  created_by?: PrincipalRef | null;
  opened_at?: Timestamp | null;
  closed_at?: Timestamp | null;
  finalized_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type QuotaClaim = {
  id: Id;
  quota_id: Id;
  team: TeamRef;
  members: QuotaClaimMember[];
  status: QuotaClaimStatus;
  priority?: number;
  waitlist_position?: number | null;
  submitted_by: PrincipalRef;
  submitted_at: Timestamp;
  decided_by?: PrincipalRef | null;
  decided_at?: Timestamp | null;
  decision_note?: string | null;
  expires_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type QuotaClaimMember = {
  principal: PrincipalRef;
  role: QuotaClaimMemberRole;
  display_name?: string;
  student_id?: string | null;
  confirmed: boolean;
};

export type QuotaClaimMemberRole = 'member' | 'reserve' | 'coach';

export type QuotaClaimRef = {
  id: Id;
  team: TeamRef;
  status: QuotaClaimStatus;
  submitted_at: Timestamp;
  priority: number;
};

export type QuotaClaimStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'released';

export type QuotaClaimWindow = {
  opens_at: Timestamp;
  closes_at: Timestamp;
};

export type QuotaCounts = {
  claims_pending: number;
  claims_approved: number;
  claims_rejected: number;
  claims_withdrawn: number;
  remaining: number;
};

export type QuotaEligibility = {
  clubs?: ClubCode[];
  team_ids?: Id[];
  labels?: Label[];
  enrollment_years?: number[];
  min_team_size?: number;
  max_team_size?: number;
};

export type QuotaStatus = 'draft' | 'open' | 'closed' | 'finalized' | 'archived';

export type QuotaSummary = {
  quota_id: Id;
  quota_total: number;
  counts: QuotaCounts;
  approved_claims: QuotaClaimRef[];
  waitlist: QuotaClaimRef[];
  over_quota: false;
  generated_at: Timestamp;
};

export type RateLimitConfig = {
  default_per_minute: number;
  ingest_per_minute: number;
  export_per_hour: number;
};

export type ReadyStatus = {
  ready: boolean;
  checks: HealthCheck[];
};

export type RefreshRequest = {
  refresh_token: string;
};

export type RejectQuotaClaimRequest = {
  reason: string;
};

export type ReleaseQuotaClaimRequest = {
  reason?: string;
};

export type ResetPasswordRequest = {
  password: string;
};

export type ResourceChange = {
  resource: string;
  id: Id;
  op: ChangeOp;
  revision: string;
  updated_at: Timestamp;
};

export type RetentionConfig = {
  submissions?: Duration;
  audit_logs?: Duration;
  jobs?: Duration;
  sync_changes?: Duration;
  announcements_archived?: Duration;
};

export type RosterConfig = {
  current_season?: string;
  active_within: Duration;
  export_ttl: Duration;
  export_row_limit: number;
};

export type RosterExport = {
  id: Id;
  status: JobState;
  format: 'csv' | 'json';
  include_inactive: boolean;
  active_within: Duration;
  clubs?: ClubCode[];
  club_counts?: RosterExportClubCount[];
  row_count?: number | null;
  excluded_inactive_count?: number | null;
  size_bytes?: number | null;
  download_url?: string | null;
  download_expires_at?: Timestamp | null;
  created_by?: PrincipalRef | null;
  created_at: Timestamp;
  completed_at?: Timestamp | null;
  error?: Problem | null;
  filters?: RosterExportFilters;
  columns?: string[];
};

export type RosterExportClubCount = {
  club: ClubCode;
  included: number;
  excluded_inactive: number;
};

export type RosterExportFilters = {
  q?: string;
  labels?: LabelSet;
  enrollment_year?: number;
  enrollment_years?: number[];
  major?: string;
  team_id?: Id;
  status?: AccountStatus;
};

export type RosterExportRequest = {
  format?: 'csv' | 'json';
  clubs?: ClubCode[];
  include_inactive?: boolean;
  active_within?: Duration;
  columns?: string[];
  filters?: RosterExportFilters;
  include_oj_handles?: boolean;
  include_activity?: boolean;
};

export type Scope = '*' | string | string;

export type ScopeSet = Scope[];

export type Scoreboard = {
  id: Id;
  name: string;
  description?: string | null;
  scope: ScoreboardScope;
  metric: ScoreboardMetric;
  judge?: Judge | null;
  judge_label?: string | null;
  period: ScoreboardPeriod;
  filter: ScoreboardFilter;
  visibility: Visibility;
  entry_count: number;
  generated_at: Timestamp | null;
  stale: boolean;
  next_refresh_at?: Timestamp | null;
  source_updated_at?: Timestamp | null;
  revision: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by?: PrincipalRef | null;
};

export type ScoreboardEntry = {
  id: Id;
  scoreboard_id: Id;
  rank: number;
  display_name: string;
  principal?: PrincipalRef | null;
  team?: TeamRef | null;
  score: number;
  metric: ScoreboardMetric;
  solved_count: number;
  penalty?: number | null;
  activity_days?: number;
  rating?: number | null;
  rating_delta?: number | null;
  rank_delta?: number | null;
  per_judge: ScoreboardEntryJudge[];
  updated_at: Timestamp;
};

export type ScoreboardEntryHistory = {
  entry_id: Id;
  scoreboard_id: Id;
  points: ScoreboardHistoryPoint[];
  window: {
    from: Timestamp;
    to: Timestamp;
  };
};

export type ScoreboardEntryJudge = {
  judge: Judge;
  rating?: number | null;
  max_rating?: number | null;
  solved_count?: number;
  submissions?: number;
  rating_delta_30d?: number | null;
  last_accepted_at?: Timestamp | null;
};

export type ScoreboardFilter = {
  clubs?: ClubCode[];
  judges?: Judge[];
  enrollment_years?: number[];
  labels?: Label[];
  team_ids?: Id[];
  include_inactive?: boolean;
};

export type ScoreboardHistoryPoint = {
  at: Timestamp;
  rank?: number | null;
  score: number;
  solved_count: number;
  rating?: number | null;
};

export type ScoreboardMetric = 'solved_count' | 'rating' | 'rating_sum' | 'activity_days' | 'weighted';

export type ScoreboardPeriod = {
  kind: ScoreboardPeriodKind;
  season?: string | null;
  window?: Duration | null;
  from?: Timestamp | null;
  to?: Timestamp | null;
};

export type ScoreboardPeriodKind = 'all_time' | 'season' | 'rolling' | 'custom';

export type ScoreboardScope = 'individual' | 'team';

export type ScoreboardsConfig = {
  refresh_interval: Duration;
  freshness_bound: Duration;
  max_entries: number;
};

export type ServerConfig = {
  public_read: boolean;
  base_url: string | null;
  cors_origins: string[];
};

export type SetLabelsRequest = {
  labels: LabelSet;
};

export type SetMemberClubsRequest = {
  memberships: ClubMembership[];
};

export type SetMemberLabelsRequest = {
  labels: LabelSet;
};

export type SetMemberScopesRequest = {
  scopes: ScopeSet;
};

export type SetScopesRequest = {
  scopes: ScopeSet;
};

export type SetTeamMembersRequest = {
  members: {
    principal_id: Id;
    role?: 'member' | 'captain' | 'coach';
  }[];
};

export type SortOrder = 'asc' | 'desc';

export type StatsConfig = {
  materialize_interval: Duration;
  freshness_bound: Duration;
  max_range_days: number;
};

export type StatsGroupBy = 'none' | 'judge' | 'team' | 'club' | 'enrollment_year' | 'label';

export type StatsHeatmapResponse = {
  query: StatsQueryEcho;
  timezone: string;
  unit: HeatmapUnit;
  days: HeatmapDay[];
  summary: HeatmapSummary;
  generated_at: Timestamp;
  stale?: boolean;
};

export type StatsHistogramResponse = {
  query: StatsQueryEcho;
  metric: HistogramMetric;
  bins: HistogramBin[];
  stats: DistributionStats;
  generated_at: Timestamp;
  stale?: boolean;
};

export type StatsQueryEcho = {
  scope: ScoreboardScope;
  clubs?: ClubCode[];
  judges?: Judge[];
  team_ids?: Id[];
  enrollment_years?: number[];
  labels?: Label[];
  principal_id?: Id | null;
  handle?: string | null;
  from?: Timestamp | null;
  to?: Timestamp | null;
  timezone?: string;
  bucket?: TrendBucket;
  group_by?: StatsGroupBy;
  unit?: HeatmapUnit;
  metric?: string;
};

export type StatsSummaryResponse = {
  generated_at: Timestamp;
  stale: boolean;
  members: {
    by_club: {
      club: ClubCode;
      total: number;
      active_30d: number;
      dormant_90d: number;
      inactive_365d: number;
    }[];
    total: number;
    active_30d: number;
    dormant_90d: number;
    inactive_365d: number;
  };
  oj: {
    linked_handles: number;
    solved_total: number;
    submissions_30d: number;
    active_handles_30d: number;
  };
  ratings: {
    judges: {
      judge: Judge;
      max: number | null;
      avg: number | null;
      count: number;
    }[];
  };
  teams: {
    total: number;
    active: number;
  };
};

export type StatsTrendResponse = {
  query: StatsQueryEcho;
  groups: TrendGroup[];
  generated_at: Timestamp;
  stale?: boolean;
};

export type StreamConfig = {
  heartbeat_interval: Duration;
  replay_buffer_events: number;
  replay_buffer_duration: Duration;
  stream_token_ttl: Duration;
};

export type StreamEvent = {
  id: string;
  sequence: number;
  topic: StreamTopic;
  type: string;
  occurred_at: Timestamp;
  revision?: string | null;
  resource?: {
    kind: StreamResourceKind;
    id: Id;
  } | null;
  data: Record<string, unknown>;
};

export type StreamResourceKind = 'announcement' | 'channel' | 'delivery' | 'scoreboard' | 'member' | 'team' | 'quota' | 'job' | 'crawler_run' | 'oj_handle' | 'credential' | 'audit_log';

export type StreamToken = {
  token: string;
  expires_at: Timestamp;
  topics: StreamTopic[];
  url: string;
};

export type StreamTokenRequest = {
  topics?: StreamTopic[];
  expires_in?: number;
  last_event_id?: string | null;
};

export type StreamTopic = 'announcements' | 'scoreboards' | 'ingest' | 'quotas' | 'members' | 'jobs';

export type SyncResource = 'members' | 'teams' | 'oj-handles' | 'scoreboards' | 'announcements' | 'quotas' | 'channels' | 'config';

export type Team = {
  id: Id;
  name: string;
  short_name?: string;
  season?: string;
  description?: string;
  captain_id?: Id | null;
  external_id?: string | null;
  labels?: LabelSet;
  member_ids: Id[];
  member_count: number;
  members?: TeamMember[];
  created_at: Timestamp;
  updated_at: Timestamp;
  revision: string;
};

export type TeamMember = {
  principal: PrincipalRef;
  role: 'member' | 'captain' | 'coach';
  joined_at: Timestamp;
  masked_fields?: string[];
  student_id?: string;
  enrollment_year?: number;
};

export type TeamRef = {
  id: Id;
  name: string;
};

export type TestChannelRequest = {
  message?: string;
};

export type Timestamp = string;

export type TokenPair = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  principal: Principal;
};

export type TrendBucket = 'hour' | 'day' | 'week' | 'month';

export type TrendGroup = {
  key: string;
  label: string;
  points: TrendPoint[];
  series_summary: {
    total: number;
    average: number;
    max: number;
    min: number;
    last: number;
  };
};

export type TrendMetric = 'solved_count' | 'submissions' | 'accepted' | 'rating' | 'active_members' | 'acceptance_rate' | 'rating_delta';

export type TrendPoint = {
  bucket_start: Timestamp;
  bucket_end: Timestamp;
  value: number;
  sample_size?: number;
  label?: string;
};

export type TriggerCrawlerRunRequest = {
  judge: Judge;
  full?: boolean;
  since?: Timestamp | null;
};

export type UpdateAccountRequest = {
  display_name?: string;
  profile?: PrincipalProfileWrite;
  status?: AccountStatus;
};

export type UpdateAnnouncementRequest = {
  title?: string;
  body_markdown?: string;
  category?: string;
  tags?: string[];
  priority?: AnnouncementPriority;
  pinned?: boolean;
  visibility?: Visibility;
  publish_at?: Timestamp | null;
  expires_at?: Timestamp | null;
  broadcast?: boolean;
  channel_ids?: Id[];
};

export type UpdateChannelRequest = {
  name?: string;
  target?: string;
  secret?: string | null;
  enabled?: boolean;
  template?: string | null;
  mention_all?: boolean;
  rate_limit_per_minute?: number;
  visibility_filter?: 'public' | 'members' | 'all';
};

export type UpdateMeRequest = {
  display_name?: string;
  profile?: PrincipalProfileWrite;
};

export type UpdateMemberRequest = {
  display_name?: string;
  profile?: PrincipalProfileWrite;
};

export type UpdateQuotaRequest = {
  title?: string;
  contest?: ContestRef;
  quota_total?: number;
  max_claims_per_team?: number;
  claim_window?: QuotaClaimWindow | null;
  eligibility?: QuotaEligibility | null;
  notes?: string | null;
};

export type UpdateScoreboardRequest = {
  name?: string;
  description?: string | null;
  scope?: ScoreboardScope;
  metric?: ScoreboardMetric;
  judge?: Judge | null;
  judge_label?: string | null;
  period?: ScoreboardPeriod;
  filter?: ScoreboardFilter;
  visibility?: Visibility;
};

export type UpdateTeamRequest = {
  name?: string;
  short_name?: string;
  season?: string;
  description?: string;
  labels?: LabelSet;
  external_id?: string | null;
};

export type ValidationError = {
  pointer: string;
  message: string;
  code?: string;
};

export type VerifyOjHandleRequest = {
  token: string;
  evidence_url?: string;
};

export type Visibility = 'public' | 'members' | 'private';
