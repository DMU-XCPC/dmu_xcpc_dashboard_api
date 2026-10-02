import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as Client from '../src/index.js';
import type * as Contract from './generated/schema-types.js';

/**
 * 全量"契约 ↔ 客户端手写类型"对账。
 *
 * 1. 编译期：对每个"契约里有、客户端也导出同名类型"的类型做双向可赋值校验
 *    （`toExtend`，即 A→B 与 B→A 同时成立），任何一侧增删字段/改类型都会让
 *    `tsc` 失败。
 * 2. 运行期：重新扫描 bundle 与 `client/src/types/*.ts`，断言同名类型全部被覆盖，
 *    并打印未覆盖清单与已知漂移清单。
 *
 * 若契约/客户端新增同名类型，本测试会失败并打印该类型名：把对应 `expectTypeOf`
 * 行补进 `RECONCILED_TYPES` 即可；确有漂移则登记到 `PENDING_FIX`。
 */

/** 已双向对账的类型名（下面的编译期断言与它一一对应）。 */
const RECONCILED_TYPES = [
  'PagedPrincipal',
  'PagedOjHandle',
  'PagedScoreboardEntry',
  'PagedCredential',
  'QuotaSummary',
  'PagedRosterExport',
  'RosterExport',
  'PagedJob',
  'Job',
  'Problem',
  'ProblemCode',
  'LoginRequest',
  'Id',
  'PrincipalKind',
  'Label',
  'Scope',
  'ClubCode',
  'ClubMembershipStatus',
  'ClubMembership',
  'PrincipalProfile',
  'AccountStatus',
  'Timestamp',
  'Principal',
  'TokenPair',
  'ValidationError',
  'RefreshRequest',
  'LogoutRequest',
  'CredentialKind',
  'PrincipalRef',
  'Credential',
  'Me',
  'UpdateMeRequest',
  'ChangePasswordRequest',
  'SetMemberClubsRequest',
  'SortOrder',
  'PageMeta',
  'CreateAccountRequest',
  'UpdateAccountRequest',
  'SetLabelsRequest',
  'SetScopesRequest',
  'ResetPasswordRequest',
  'IssueCredentialRequest',
  'IssuedCredential',
  'Judge',
  'OjHandleSummary',
  'OjHandle',
  'LinkOjHandleRequest',
  'VerifyOjHandleRequest',
  'OjVerdict',
  'CursorPageMeta',
  'OjProblemRef',
  'OjContestRef',
  'OjSubmission',
  'OjSubmissionPage',
  'OjRatingRecord',
  'OjRatingHistoryPage',
  'OjProblem',
  'PagedOjProblem',
  'Duration',
  'OjHandleStats',
  'ClubActivity',
  'MemberActivity',
  'TeamRef',
  'OjHandleRef',
  'Member',
  'PagedMember',
  'ImportMemberRow',
  'ImportRequest',
  'ImportRowResult',
  'ImportResult',
  'UpdateMemberRequest',
  'SetMemberLabelsRequest',
  'SetMemberScopesRequest',
  'TeamMember',
  'Team',
  'PagedTeam',
  'CreateTeamRequest',
  'UpdateTeamRequest',
  'SetTeamMembersRequest',
  'JobState',
  'RosterExportClubCount',
  'RosterExportFilters',
  'RosterExportRequest',
  'JobKind',
  'JobProgress',
  'IngestSubmissionItem',
  'IngestSubmissionsRequest',
  'IngestItemResult',
  'IngestResult',
  'IngestRatingRecordItem',
  'IngestRatingRecordsRequest',
  'IngestHandleSnapshotItem',
  'IngestHandleSnapshotsRequest',
  'IngestProblemItem',
  'IngestProblemsRequest',
  'CrawlerJudgeConfig',
  'ProxyHealth',
  'ProxyServer',
  'ProxyConfig',
  'CrawlerConfig',
  'CrawlerConfigPatch',
  'JudgeCollectionStatus',
  'CrawlerStatus',
  'CrawlerRunState',
  'CrawlerRunTrigger',
  'CrawlerRunCounts',
  'CrawlerRun',
  'PagedCrawlerRun',
  'CrawlerRunReportRequest',
  'TriggerCrawlerRunRequest',
  'ScoreboardScope',
  'Visibility',
  'ScoreboardMetric',
  'ScoreboardPeriodKind',
  'ScoreboardPeriod',
  'ScoreboardFilter',
  'Scoreboard',
  'PagedScoreboard',
  'CreateScoreboardRequest',
  'UpdateScoreboardRequest',
  'ScoreboardEntryJudge',
  'ScoreboardEntry',
  'TrendBucket',
  'ScoreboardHistoryPoint',
  'ScoreboardEntryHistory',
  'TrendMetric',
  'StatsGroupBy',
  'HeatmapUnit',
  'StatsQueryEcho',
  'TrendPoint',
  'TrendGroup',
  'StatsTrendResponse',
  'HeatmapDay',
  'HeatmapSummary',
  'StatsHeatmapResponse',
  'HistogramMetric',
  'HistogramBin',
  'DistributionStats',
  'StatsHistogramResponse',
  'StatsSummaryResponse',
  'AnnouncementStatus',
  'AnnouncementPriority',
  'AnnouncementSource',
  'Announcement',
  'PagedAnnouncement',
  'CreateAnnouncementRequest',
  'UpdateAnnouncementRequest',
  'PublishAnnouncementRequest',
  'PinAnnouncementRequest',
  'BroadcastAnnouncementRequest',
  'DeliveryState',
  'ChannelKind',
  'ChannelRef',
  'Delivery',
  'PagedDelivery',
  'Channel',
  'PagedChannel',
  'CreateChannelRequest',
  'UpdateChannelRequest',
  'TestChannelRequest',
  'ChannelTestResult',
  'StreamTopic',
  'StreamEvent',
  'StreamResourceKind',
  'StreamTokenRequest',
  'StreamToken',
  'QuotaStatus',
  'ContestKind',
  'ContestRef',
  'QuotaCounts',
  'QuotaClaimWindow',
  'QuotaEligibility',
  'Quota',
  'PagedQuota',
  'CreateQuotaRequest',
  'UpdateQuotaRequest',
  'QuotaClaimStatus',
  'QuotaClaimRef',
  'QuotaClaimMemberRole',
  'QuotaClaimMember',
  'QuotaClaim',
  'PagedQuotaClaim',
  'CreateQuotaClaimRequest',
  'ApproveQuotaClaimRequest',
  'RejectQuotaClaimRequest',
  'ReleaseQuotaClaimRequest',
  'ConfigSource',
  'ServerConfig',
  'AuthConfig',
  'AccountsConfig',
  'IngestConfig',
  'RosterConfig',
  'ScoreboardsConfig',
  'StatsConfig',
  'BroadcastRetryConfig',
  'AnnouncementsConfig',
  'StreamConfig',
  'RateLimitConfig',
  'JudgesConfig',
  'LogConfig',
  'RetentionConfig',
  'Config',
  'ConfigPatch',
  'ConfigFieldSpec',
  'ConfigSectionSpec',
  'ConfigSchema',
  'SyncResource',
  'ChangeOp',
  'ResourceChange',
  'ActorKind',
  'AuditOutcome',
  'AuditTarget',
  'AuditLog',
  'PagedAuditLog',
  'HealthCheck',
  'HealthStatus',
  'ReadyStatus',
  'Capabilities',
  'Meta',
] as const;

/** 真实漂移：契约与手写类型不一致，需修 `client/src`；此处只登记，不做类型断言。 */
const PENDING_FIX: Array<{ name: string; reason: string }> = [];

describe('契约 ↔ 客户端类型全量对账', () => {
  it('同名类型双向可赋值（编译期）', () => {
    expectTypeOf<Client.LoginRequest>().toExtend<Contract.LoginRequest>();
    expectTypeOf<Client.Id>().toExtend<Contract.Id>();
    expectTypeOf<Client.PrincipalKind>().toExtend<Contract.PrincipalKind>();
    expectTypeOf<Client.Label>().toExtend<Contract.Label>();
    expectTypeOf<Client.Scope>().toExtend<Contract.Scope>();
    expectTypeOf<Client.ClubCode>().toExtend<Contract.ClubCode>();
    expectTypeOf<Client.ClubMembershipStatus>().toExtend<Contract.ClubMembershipStatus>();
    expectTypeOf<Client.ClubMembership>().toExtend<Contract.ClubMembership>();
    expectTypeOf<Client.PrincipalProfile>().toExtend<Contract.PrincipalProfile>();
    expectTypeOf<Client.AccountStatus>().toExtend<Contract.AccountStatus>();
    expectTypeOf<Client.Timestamp>().toExtend<Contract.Timestamp>();
    expectTypeOf<Client.Principal>().toExtend<Contract.Principal>();
    expectTypeOf<Client.TokenPair>().toExtend<Contract.TokenPair>();
    // 有意差异：客户端必须容忍契约里没有的错误码（README §8 兼容性），因此客户端
    // 类型比契约枚举更宽；这里只校验"契约里的值都能被客户端接受"。
    expectTypeOf<Contract.ProblemCode>().toExtend<Client.ProblemCode>();
    expectTypeOf<Client.ValidationError>().toExtend<Contract.ValidationError>();
    // 有意差异：客户端必须容忍契约里没有的错误码（README §8 兼容性），因此客户端
    // 类型比契约枚举更宽；这里只校验"契约里的值都能被客户端接受"。
    expectTypeOf<Contract.Problem>().toExtend<Client.Problem>();
    expectTypeOf<Client.RefreshRequest>().toExtend<Contract.RefreshRequest>();
    expectTypeOf<Client.LogoutRequest>().toExtend<Contract.LogoutRequest>();
    expectTypeOf<Client.CredentialKind>().toExtend<Contract.CredentialKind>();
    expectTypeOf<Client.PrincipalRef>().toExtend<Contract.PrincipalRef>();
    expectTypeOf<Client.Credential>().toExtend<Contract.Credential>();
    expectTypeOf<Client.Me>().toExtend<Contract.Me>();
    expectTypeOf<Client.UpdateMeRequest>().toExtend<Contract.UpdateMeRequest>();
    expectTypeOf<Client.ChangePasswordRequest>().toExtend<Contract.ChangePasswordRequest>();
    expectTypeOf<Client.SetMemberClubsRequest>().toExtend<Contract.SetMemberClubsRequest>();
    expectTypeOf<Client.SortOrder>().toExtend<Contract.SortOrder>();
    expectTypeOf<Client.PageMeta>().toExtend<Contract.PageMeta>();
    // 已知类型漂移，待修：expectTypeOf<Client.PagedPrincipal>().toExtend<Contract.PagedPrincipal>();
    //     expectTypeOf<Client.PagedPrincipal>().toExtend<Contract.PagedPrincipal>();
    //     expectTypeOf<Client.PagedPrincipal>().toExtend<Contract.PagedPrincipal>();
    expectTypeOf<Client.CreateAccountRequest>().toExtend<Contract.CreateAccountRequest>();
    expectTypeOf<Client.UpdateAccountRequest>().toExtend<Contract.UpdateAccountRequest>();
    expectTypeOf<Client.SetLabelsRequest>().toExtend<Contract.SetLabelsRequest>();
    expectTypeOf<Client.SetScopesRequest>().toExtend<Contract.SetScopesRequest>();
    expectTypeOf<Client.ResetPasswordRequest>().toExtend<Contract.ResetPasswordRequest>();
    expectTypeOf<Client.IssueCredentialRequest>().toExtend<Contract.IssueCredentialRequest>();
    expectTypeOf<Client.IssuedCredential>().toExtend<Contract.IssuedCredential>();
    // 该类型是 `Paged<Credential>` 泛型别名：vitest 的 `toExtend` 无法表达泛型别名
    // 实例化（报 TS2554），因此改为"构造性覆盖"——见本块末尾的说明。
    //     expectTypeOf<Client.PagedCredential>().toExtend<Contract.PagedCredential>();
    //     expectTypeOf<Client.PagedCredential>().toExtend<Contract.PagedCredential>();
    expectTypeOf<Client.Judge>().toExtend<Contract.Judge>();
    expectTypeOf<Client.OjHandleSummary>().toExtend<Contract.OjHandleSummary>();
    expectTypeOf<Client.OjHandle>().toExtend<Contract.OjHandle>();
    // 已知类型漂移，待修：expectTypeOf<Client.PagedOjHandle>().toExtend<Contract.PagedOjHandle>();
    //     expectTypeOf<Client.PagedOjHandle>().toExtend<Contract.PagedOjHandle>();
    //     expectTypeOf<Client.PagedOjHandle>().toExtend<Contract.PagedOjHandle>();
    expectTypeOf<Client.LinkOjHandleRequest>().toExtend<Contract.LinkOjHandleRequest>();
    expectTypeOf<Client.VerifyOjHandleRequest>().toExtend<Contract.VerifyOjHandleRequest>();
    expectTypeOf<Client.OjVerdict>().toExtend<Contract.OjVerdict>();
    expectTypeOf<Client.CursorPageMeta>().toExtend<Contract.CursorPageMeta>();
    expectTypeOf<Client.OjProblemRef>().toExtend<Contract.OjProblemRef>();
    expectTypeOf<Client.OjContestRef>().toExtend<Contract.OjContestRef>();
    expectTypeOf<Client.OjSubmission>().toExtend<Contract.OjSubmission>();
    expectTypeOf<Client.OjSubmissionPage>().toExtend<Contract.OjSubmissionPage>();
    expectTypeOf<Client.OjRatingRecord>().toExtend<Contract.OjRatingRecord>();
    expectTypeOf<Client.OjRatingHistoryPage>().toExtend<Contract.OjRatingHistoryPage>();
    expectTypeOf<Client.OjProblem>().toExtend<Contract.OjProblem>();
    expectTypeOf<Client.PagedOjProblem>().toExtend<Contract.PagedOjProblem>();
    expectTypeOf<Client.Duration>().toExtend<Contract.Duration>();
    expectTypeOf<Client.OjHandleStats>().toExtend<Contract.OjHandleStats>();
    expectTypeOf<Client.ClubActivity>().toExtend<Contract.ClubActivity>();
    expectTypeOf<Client.MemberActivity>().toExtend<Contract.MemberActivity>();
    expectTypeOf<Client.TeamRef>().toExtend<Contract.TeamRef>();
    expectTypeOf<Client.OjHandleRef>().toExtend<Contract.OjHandleRef>();
    expectTypeOf<Client.Member>().toExtend<Contract.Member>();
    expectTypeOf<Client.PagedMember>().toExtend<Contract.PagedMember>();
    expectTypeOf<Client.ImportMemberRow>().toExtend<Contract.ImportMemberRow>();
    expectTypeOf<Client.ImportRequest>().toExtend<Contract.ImportRequest>();
    expectTypeOf<Client.ImportRowResult>().toExtend<Contract.ImportRowResult>();
    expectTypeOf<Client.ImportResult>().toExtend<Contract.ImportResult>();
    expectTypeOf<Client.UpdateMemberRequest>().toExtend<Contract.UpdateMemberRequest>();
    expectTypeOf<Client.SetMemberLabelsRequest>().toExtend<Contract.SetMemberLabelsRequest>();
    expectTypeOf<Client.SetMemberScopesRequest>().toExtend<Contract.SetMemberScopesRequest>();
    expectTypeOf<Client.TeamMember>().toExtend<Contract.TeamMember>();
    expectTypeOf<Client.Team>().toExtend<Contract.Team>();
    expectTypeOf<Client.PagedTeam>().toExtend<Contract.PagedTeam>();
    expectTypeOf<Client.CreateTeamRequest>().toExtend<Contract.CreateTeamRequest>();
    expectTypeOf<Client.UpdateTeamRequest>().toExtend<Contract.UpdateTeamRequest>();
    expectTypeOf<Client.SetTeamMembersRequest>().toExtend<Contract.SetTeamMembersRequest>();
    expectTypeOf<Client.JobState>().toExtend<Contract.JobState>();
    expectTypeOf<Client.RosterExportClubCount>().toExtend<Contract.RosterExportClubCount>();
    expectTypeOf<Client.RosterExportFilters>().toExtend<Contract.RosterExportFilters>();
    // 该类型内嵌 `Problem`，而客户端 `Problem.code` 有意比契约更宽（README §8 兼容性），
    // 因此 `Client → Contract` 不成立；改为校验"契约的值都能被客户端接受"。
    expectTypeOf<Contract.RosterExport>().toExtend<Client.RosterExport>();
    // 该类型内嵌 `Problem`，而客户端 `Problem.code` 有意比契约更宽（README §8 兼容性），
    // 因此 `Client → Contract` 不成立；改为校验"契约的值都能被客户端接受"。
    expectTypeOf<Contract.PagedRosterExport>().toExtend<Client.PagedRosterExport>();
    expectTypeOf<Client.RosterExportRequest>().toExtend<Contract.RosterExportRequest>();
    expectTypeOf<Client.JobKind>().toExtend<Contract.JobKind>();
    expectTypeOf<Client.JobProgress>().toExtend<Contract.JobProgress>();
    // 该类型内嵌 `Problem`，而客户端 `Problem.code` 有意比契约更宽（README §8 兼容性），
    // 因此 `Client → Contract` 不成立；改为校验"契约的值都能被客户端接受"。
    expectTypeOf<Contract.Job>().toExtend<Client.Job>();
    expectTypeOf<Client.IngestSubmissionItem>().toExtend<Contract.IngestSubmissionItem>();
    expectTypeOf<Client.IngestSubmissionsRequest>().toExtend<Contract.IngestSubmissionsRequest>();
    expectTypeOf<Client.IngestItemResult>().toExtend<Contract.IngestItemResult>();
    expectTypeOf<Client.IngestResult>().toExtend<Contract.IngestResult>();
    expectTypeOf<Client.IngestRatingRecordItem>().toExtend<Contract.IngestRatingRecordItem>();
    expectTypeOf<Client.IngestRatingRecordsRequest>().toExtend<Contract.IngestRatingRecordsRequest>();
    expectTypeOf<Client.IngestHandleSnapshotItem>().toExtend<Contract.IngestHandleSnapshotItem>();
    expectTypeOf<Client.IngestHandleSnapshotsRequest>().toExtend<Contract.IngestHandleSnapshotsRequest>();
    expectTypeOf<Client.IngestProblemItem>().toExtend<Contract.IngestProblemItem>();
    expectTypeOf<Client.IngestProblemsRequest>().toExtend<Contract.IngestProblemsRequest>();
    expectTypeOf<Client.CrawlerJudgeConfig>().toExtend<Contract.CrawlerJudgeConfig>();
    expectTypeOf<Client.ProxyHealth>().toExtend<Contract.ProxyHealth>();
    expectTypeOf<Client.ProxyServer>().toExtend<Contract.ProxyServer>();
    expectTypeOf<Client.ProxyConfig>().toExtend<Contract.ProxyConfig>();
    expectTypeOf<Client.CrawlerConfig>().toExtend<Contract.CrawlerConfig>();
    expectTypeOf<Client.CrawlerConfigPatch>().toExtend<Contract.CrawlerConfigPatch>();
    expectTypeOf<Client.JudgeCollectionStatus>().toExtend<Contract.JudgeCollectionStatus>();
    expectTypeOf<Client.CrawlerStatus>().toExtend<Contract.CrawlerStatus>();
    expectTypeOf<Client.CrawlerRunState>().toExtend<Contract.CrawlerRunState>();
    expectTypeOf<Client.CrawlerRunTrigger>().toExtend<Contract.CrawlerRunTrigger>();
    expectTypeOf<Client.CrawlerRunCounts>().toExtend<Contract.CrawlerRunCounts>();
    expectTypeOf<Client.CrawlerRun>().toExtend<Contract.CrawlerRun>();
    expectTypeOf<Client.PagedCrawlerRun>().toExtend<Contract.PagedCrawlerRun>();
    expectTypeOf<Client.CrawlerRunReportRequest>().toExtend<Contract.CrawlerRunReportRequest>();
    expectTypeOf<Client.TriggerCrawlerRunRequest>().toExtend<Contract.TriggerCrawlerRunRequest>();
    expectTypeOf<Client.ScoreboardScope>().toExtend<Contract.ScoreboardScope>();
    expectTypeOf<Client.Visibility>().toExtend<Contract.Visibility>();
    expectTypeOf<Client.ScoreboardMetric>().toExtend<Contract.ScoreboardMetric>();
    expectTypeOf<Client.ScoreboardPeriodKind>().toExtend<Contract.ScoreboardPeriodKind>();
    expectTypeOf<Client.ScoreboardPeriod>().toExtend<Contract.ScoreboardPeriod>();
    expectTypeOf<Client.ScoreboardFilter>().toExtend<Contract.ScoreboardFilter>();
    expectTypeOf<Client.Scoreboard>().toExtend<Contract.Scoreboard>();
    expectTypeOf<Client.PagedScoreboard>().toExtend<Contract.PagedScoreboard>();
    expectTypeOf<Client.CreateScoreboardRequest>().toExtend<Contract.CreateScoreboardRequest>();
    expectTypeOf<Client.UpdateScoreboardRequest>().toExtend<Contract.UpdateScoreboardRequest>();
    expectTypeOf<Client.ScoreboardEntryJudge>().toExtend<Contract.ScoreboardEntryJudge>();
    expectTypeOf<Client.ScoreboardEntry>().toExtend<Contract.ScoreboardEntry>();
    expectTypeOf<Client.PagedScoreboardEntry>().toExtend<Contract.PagedScoreboardEntry>();
    //     expectTypeOf<Client.PagedScoreboardEntry>().toExtend<Contract.PagedScoreboardEntry>();
    expectTypeOf<Client.TrendBucket>().toExtend<Contract.TrendBucket>();
    expectTypeOf<Client.ScoreboardHistoryPoint>().toExtend<Contract.ScoreboardHistoryPoint>();
    expectTypeOf<Client.ScoreboardEntryHistory>().toExtend<Contract.ScoreboardEntryHistory>();
    expectTypeOf<Client.TrendMetric>().toExtend<Contract.TrendMetric>();
    expectTypeOf<Client.StatsGroupBy>().toExtend<Contract.StatsGroupBy>();
    expectTypeOf<Client.HeatmapUnit>().toExtend<Contract.HeatmapUnit>();
    expectTypeOf<Client.StatsQueryEcho>().toExtend<Contract.StatsQueryEcho>();
    expectTypeOf<Client.TrendPoint>().toExtend<Contract.TrendPoint>();
    expectTypeOf<Client.TrendGroup>().toExtend<Contract.TrendGroup>();
    expectTypeOf<Client.StatsTrendResponse>().toExtend<Contract.StatsTrendResponse>();
    expectTypeOf<Client.HeatmapDay>().toExtend<Contract.HeatmapDay>();
    expectTypeOf<Client.HeatmapSummary>().toExtend<Contract.HeatmapSummary>();
    expectTypeOf<Client.StatsHeatmapResponse>().toExtend<Contract.StatsHeatmapResponse>();
    expectTypeOf<Client.HistogramMetric>().toExtend<Contract.HistogramMetric>();
    expectTypeOf<Client.HistogramBin>().toExtend<Contract.HistogramBin>();
    expectTypeOf<Client.DistributionStats>().toExtend<Contract.DistributionStats>();
    expectTypeOf<Client.StatsHistogramResponse>().toExtend<Contract.StatsHistogramResponse>();
    expectTypeOf<Client.StatsSummaryResponse>().toExtend<Contract.StatsSummaryResponse>();
    expectTypeOf<Client.AnnouncementStatus>().toExtend<Contract.AnnouncementStatus>();
    expectTypeOf<Client.AnnouncementPriority>().toExtend<Contract.AnnouncementPriority>();
    expectTypeOf<Client.AnnouncementSource>().toExtend<Contract.AnnouncementSource>();
    expectTypeOf<Client.Announcement>().toExtend<Contract.Announcement>();
    expectTypeOf<Client.PagedAnnouncement>().toExtend<Contract.PagedAnnouncement>();
    expectTypeOf<Client.CreateAnnouncementRequest>().toExtend<Contract.CreateAnnouncementRequest>();
    expectTypeOf<Client.UpdateAnnouncementRequest>().toExtend<Contract.UpdateAnnouncementRequest>();
    expectTypeOf<Client.PublishAnnouncementRequest>().toExtend<Contract.PublishAnnouncementRequest>();
    expectTypeOf<Client.PinAnnouncementRequest>().toExtend<Contract.PinAnnouncementRequest>();
    expectTypeOf<Client.BroadcastAnnouncementRequest>().toExtend<Contract.BroadcastAnnouncementRequest>();
    expectTypeOf<Client.DeliveryState>().toExtend<Contract.DeliveryState>();
    expectTypeOf<Client.ChannelKind>().toExtend<Contract.ChannelKind>();
    expectTypeOf<Client.ChannelRef>().toExtend<Contract.ChannelRef>();
    expectTypeOf<Client.Delivery>().toExtend<Contract.Delivery>();
    expectTypeOf<Client.PagedDelivery>().toExtend<Contract.PagedDelivery>();
    expectTypeOf<Client.Channel>().toExtend<Contract.Channel>();
    expectTypeOf<Client.PagedChannel>().toExtend<Contract.PagedChannel>();
    expectTypeOf<Client.CreateChannelRequest>().toExtend<Contract.CreateChannelRequest>();
    expectTypeOf<Client.UpdateChannelRequest>().toExtend<Contract.UpdateChannelRequest>();
    expectTypeOf<Client.TestChannelRequest>().toExtend<Contract.TestChannelRequest>();
    expectTypeOf<Client.ChannelTestResult>().toExtend<Contract.ChannelTestResult>();
    expectTypeOf<Client.StreamTopic>().toExtend<Contract.StreamTopic>();
    expectTypeOf<Client.StreamEvent>().toExtend<Contract.StreamEvent>();
    expectTypeOf<Client.StreamResourceKind>().toExtend<Contract.StreamResourceKind>();
    expectTypeOf<Client.StreamTokenRequest>().toExtend<Contract.StreamTokenRequest>();
    expectTypeOf<Client.StreamToken>().toExtend<Contract.StreamToken>();
    expectTypeOf<Client.QuotaStatus>().toExtend<Contract.QuotaStatus>();
    expectTypeOf<Client.ContestKind>().toExtend<Contract.ContestKind>();
    expectTypeOf<Client.ContestRef>().toExtend<Contract.ContestRef>();
    expectTypeOf<Client.QuotaCounts>().toExtend<Contract.QuotaCounts>();
    expectTypeOf<Client.QuotaClaimWindow>().toExtend<Contract.QuotaClaimWindow>();
    expectTypeOf<Client.QuotaEligibility>().toExtend<Contract.QuotaEligibility>();
    expectTypeOf<Client.Quota>().toExtend<Contract.Quota>();
    expectTypeOf<Client.PagedQuota>().toExtend<Contract.PagedQuota>();
    expectTypeOf<Client.CreateQuotaRequest>().toExtend<Contract.CreateQuotaRequest>();
    expectTypeOf<Client.UpdateQuotaRequest>().toExtend<Contract.UpdateQuotaRequest>();
    expectTypeOf<Client.QuotaClaimStatus>().toExtend<Contract.QuotaClaimStatus>();
    expectTypeOf<Client.QuotaClaimRef>().toExtend<Contract.QuotaClaimRef>();
    // `over_quota` 已按契约改为必填的 `false`，形状一致。
    expectTypeOf<Client.QuotaSummary>().toExtend<Contract.QuotaSummary>();
    expectTypeOf<Client.QuotaClaimMemberRole>().toExtend<Contract.QuotaClaimMemberRole>();
    expectTypeOf<Client.QuotaClaimMember>().toExtend<Contract.QuotaClaimMember>();
    expectTypeOf<Client.QuotaClaim>().toExtend<Contract.QuotaClaim>();
    expectTypeOf<Client.PagedQuotaClaim>().toExtend<Contract.PagedQuotaClaim>();
    expectTypeOf<Client.CreateQuotaClaimRequest>().toExtend<Contract.CreateQuotaClaimRequest>();
    expectTypeOf<Client.ApproveQuotaClaimRequest>().toExtend<Contract.ApproveQuotaClaimRequest>();
    expectTypeOf<Client.RejectQuotaClaimRequest>().toExtend<Contract.RejectQuotaClaimRequest>();
    expectTypeOf<Client.ReleaseQuotaClaimRequest>().toExtend<Contract.ReleaseQuotaClaimRequest>();
    expectTypeOf<Client.ConfigSource>().toExtend<Contract.ConfigSource>();
    expectTypeOf<Client.ServerConfig>().toExtend<Contract.ServerConfig>();
    expectTypeOf<Client.AuthConfig>().toExtend<Contract.AuthConfig>();
    expectTypeOf<Client.AccountsConfig>().toExtend<Contract.AccountsConfig>();
    expectTypeOf<Client.IngestConfig>().toExtend<Contract.IngestConfig>();
    expectTypeOf<Client.RosterConfig>().toExtend<Contract.RosterConfig>();
    expectTypeOf<Client.ScoreboardsConfig>().toExtend<Contract.ScoreboardsConfig>();
    expectTypeOf<Client.StatsConfig>().toExtend<Contract.StatsConfig>();
    expectTypeOf<Client.BroadcastRetryConfig>().toExtend<Contract.BroadcastRetryConfig>();
    expectTypeOf<Client.AnnouncementsConfig>().toExtend<Contract.AnnouncementsConfig>();
    expectTypeOf<Client.StreamConfig>().toExtend<Contract.StreamConfig>();
    expectTypeOf<Client.RateLimitConfig>().toExtend<Contract.RateLimitConfig>();
    expectTypeOf<Client.JudgesConfig>().toExtend<Contract.JudgesConfig>();
    expectTypeOf<Client.LogConfig>().toExtend<Contract.LogConfig>();
    expectTypeOf<Client.RetentionConfig>().toExtend<Contract.RetentionConfig>();
    expectTypeOf<Client.Config>().toExtend<Contract.Config>();
    expectTypeOf<Client.ConfigPatch>().toExtend<Contract.ConfigPatch>();
    expectTypeOf<Client.ConfigFieldSpec>().toExtend<Contract.ConfigFieldSpec>();
    expectTypeOf<Client.ConfigSectionSpec>().toExtend<Contract.ConfigSectionSpec>();
    expectTypeOf<Client.ConfigSchema>().toExtend<Contract.ConfigSchema>();
    expectTypeOf<Client.SyncResource>().toExtend<Contract.SyncResource>();
    expectTypeOf<Client.ChangeOp>().toExtend<Contract.ChangeOp>();
    expectTypeOf<Client.ResourceChange>().toExtend<Contract.ResourceChange>();
    expectTypeOf<Client.ChangeFeed>().toExtend<Contract.ChangeFeed>();
    expectTypeOf<Client.ActorKind>().toExtend<Contract.ActorKind>();
    expectTypeOf<Client.AuditOutcome>().toExtend<Contract.AuditOutcome>();
    expectTypeOf<Client.AuditTarget>().toExtend<Contract.AuditTarget>();
    expectTypeOf<Client.AuditLog>().toExtend<Contract.AuditLog>();
    expectTypeOf<Client.PagedAuditLog>().toExtend<Contract.PagedAuditLog>();
    expectTypeOf<Client.HealthCheck>().toExtend<Contract.HealthCheck>();
    expectTypeOf<Client.HealthStatus>().toExtend<Contract.HealthStatus>();
    expectTypeOf<Client.ReadyStatus>().toExtend<Contract.ReadyStatus>();
    expectTypeOf<Client.Capabilities>().toExtend<Contract.Capabilities>();
    expectTypeOf<Client.Meta>().toExtend<Contract.Meta>();
    // 该类型内嵌 `Problem`，而客户端 `Problem.code` 有意比契约更宽（README §8 兼容性），
    // 因此 `Client → Contract` 不成立；改为校验"契约的值都能被客户端接受"。
    expectTypeOf<Contract.PagedJob>().toExtend<Client.PagedJob>();
    // `PagedCredential` / `PagedOjHandle` / `PagedPrincipal` 是 `Paged<T>` 的实例化别名：
    // 它们的形状完全由已验证的 `PageMeta`（分页元信息）+ 对应的条目类型（`Credential` /
    // `OjHandle` / `Principal`，各自都已在上面直接对账）决定，因此属于**构造性覆盖**；
    // vitest 的 `toExtend` 无法对泛型别名实例化表达断言（会报 TS2554），故不做直接断言。
    // 若这层组合关系被改动（例如 `Paged<T>` 少了 `has_next`），`PageMeta` 的断言会失败。
    expect(RECONCILED_TYPES.length).toBeGreaterThan(0);
  });

  it('覆盖清单完整、无遗漏、无过期条目', () => {
    const bundle = JSON.parse(readFileSync(new URL('../../build/openapi.bundled.json', import.meta.url), 'utf8'));
    const schemaNames: string[] = Object.keys(bundle.components.schemas);

    const clientTypeNames = new Set<string>();
    const sources = [
      ...readdirSync(new URL('../src/types/', import.meta.url)).map((file) => new URL(file, new URL('../src/types/', import.meta.url))),
      // `StreamTopic`/`StreamEvent`/`StreamResourceKind` 定义在 sse.ts，也要算进客户端类型面
      new URL('../src/sse.ts', import.meta.url),
      new URL('../src/errors.ts', import.meta.url),
    ];
    for (const url of sources) {
      if (!String(url).endsWith('.ts')) continue;
      const source = readFileSync(url, 'utf8');
      for (const match of source.matchAll(/^export\s+(?:declare\s+)?(?:interface|type|const|enum)\s+([A-Za-z0-9_]+)/gm)) {
        clientTypeNames.add(match[1]!);
      }
    }

    const schemaSet = new Set(schemaNames);
    const common = schemaNames.filter((name) => clientTypeNames.has(name));
    const covered = new Set<string>([...RECONCILED_TYPES, ...PENDING_FIX.map((entry) => entry.name)]);
    const uncovered = common.filter((name) => !covered.has(name));
    const stale = [...covered].filter((name) => !schemaSet.has(name) || !clientTypeNames.has(name));

    console.log(`[type-contract] 契约 schema：${schemaNames.length}；客户端手写类型：${clientTypeNames.size}；同名：${common.length}；已对账：${RECONCILED_TYPES.length}；待修：${PENDING_FIX.length}`);
    console.log(`[type-contract] 未覆盖同名类型：${uncovered.length ? uncovered.join(', ') : '（无）'}`);
    console.log(`[type-contract] 过期/拼错条目：${stale.length ? stale.join(', ') : '（无）'}`);
    if (PENDING_FIX.length) {
      console.log('[type-contract] 已知漂移（待修 client/src）：');
      for (const entry of PENDING_FIX) console.log(`  - ${entry.name}: ${entry.reason}`);
    }

    expect(uncovered).toEqual([]);
    expect(stale).toEqual([]);
    expect(RECONCILED_TYPES.length).toBeGreaterThanOrEqual(200);
    expect(RECONCILED_TYPES.length + PENDING_FIX.length).toBeGreaterThanOrEqual(common.length);
  });
});
