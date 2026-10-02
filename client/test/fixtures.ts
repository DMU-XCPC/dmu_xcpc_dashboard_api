/**
 * 自动生成，请勿手工编辑：由 `scripts/generate-fixtures.mjs` 从
 * `build/openapi.bundled.json` 的 schema `examples[0]` 提取。
 *
 * 作用是把"契约 schema ↔ 客户端 TypeScript 类型"钉在一起：
 * 每个 fixture 都带 `satisfies <类型>`，因此只要契约字段与手写类型不一致，
 * `tsc` 就会失败；同时 `test/client-contract.test.ts` 会用 Ajv 依据契约
 * 校验同一份数据。任何一侧漂移都会让 `npm run verify` 失败。
 */
import type {
  Principal,
  Member,
  PagedMember,
  Team,
  Announcement,
  Channel,
  Delivery,
  Quota,
  QuotaClaim,
  Scoreboard,
  ScoreboardEntry,
  OjHandle,
  OjSubmission,
  OjRatingRecord,
  IngestRatingRecordItem,
  CrawlerConfig,
  Config,
  ChangeFeed,
  Job,
  Problem,
  AuditLog,
  RosterExport,
  IngestResult,
  StatsTrendResponse,
} from '../src/index.js';

export const fixtures = {
  Principal: {
    "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "username": "alice",
    "display_name": "张三",
    "kind": "human",
    "labels": [
      "member",
      "2022"
    ],
    "scopes": [
      "account:self",
      "member:read"
    ],
    "profile": {
      "student_id": "2220210000",
      "enrollment_year": 2022,
      "grade": "2022级",
      "major": "计算机科学与技术",
      "club_memberships": [
        {
          "club": "acm_icpc",
          "status": "active",
          "registered_at": "2023-09-20",
          "role": "成员"
        }
      ],
      "email": "alice@example.edu.cn"
    },
    "status": "active",
    "disabled_at": null,
    "last_active_at": "2024-05-06T07:08:09.123Z",
    "created_at": "2023-09-01T02:00:00.000Z",
    "updated_at": "2024-05-06T07:08:09.123Z",
    "revision": "17"
  } satisfies Principal,
  Member: {
    "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "username": "alice",
    "display_name": "张三",
    "kind": "human",
    "labels": [
      "member",
      "2022"
    ],
    "scopes": [
      "account:self",
      "member:read"
    ],
    "profile": {
      "student_id": "2220210000",
      "enrollment_year": 2022,
      "grade": "2022级",
      "major": "计算机科学与技术",
      "club_memberships": [
        {
          "club": "acm_icpc",
          "status": "active",
          "registered_at": "2023-09-20",
          "role": "成员"
        }
      ],
      "email": "alice@example.edu.cn",
      "phone": "13800000000",
      "qq": "10001"
    },
    "status": "active",
    "disabled_at": null,
    "last_active_at": "2024-05-06T07:08:09.123Z",
    "created_at": "2023-09-01T02:00:00.000Z",
    "updated_at": "2024-05-06T07:08:09.123Z",
    "revision": "17",
    "clubs": [
      "acm_icpc",
      "safewind_software"
    ],
    "activity": {
      "by_club": [
        {
          "club": "acm_icpc",
          "status": "active",
          "registered_at": "2024-03-01",
          "last_active_at": "2024-05-06T07:08:09.123Z",
          "active_days": 21,
          "submissions": 84
        }
      ],
      "last_active_at": "2024-05-06T07:08:09.123Z",
      "last_login_at": "2024-05-06T07:00:00.000Z",
      "last_api_use_at": "2024-05-06T07:08:09.123Z",
      "last_oj_activity_at": "2024-05-05T18:20:00.000Z",
      "activity_state": "active",
      "active_days_30d": 21,
      "solved_count_30d": 37,
      "submissions_30d": 84,
      "computed_at": "2024-05-06T07:10:00.000Z"
    },
    "teams": [
      {
        "id": "team_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "name": "DMU-1"
      }
    ],
    "oj_handles": [
      {
        "id": "ojh_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "judge": "codeforces",
        "judge_label": null,
        "handle": "alice",
        "verified": true,
        "latest_rating": 1834
      }
    ]
  } satisfies Member,
  PagedMember: {
    "page": 1,
    "size": 20,
    "total": 137,
    "has_next": true,
    "items": [
      {
        "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "username": "alice",
        "display_name": "张三",
        "kind": "human",
        "labels": [
          "member"
        ],
        "scopes": [
          "account:self"
        ],
        "status": "active",
        "created_at": "2023-09-01T02:00:00.000Z",
        "updated_at": "2024-05-06T07:08:09.123Z",
        "revision": "17",
        "clubs": [
          "acm_icpc",
          "safewind_software"
        ],
        "activity": {
          "by_club": [
            {
              "club": "acm_icpc",
              "status": "active",
              "registered_at": "2024-03-01",
              "last_active_at": "2024-05-06T07:08:09.123Z",
              "active_days": 21,
              "submissions": 84
            }
          ],
          "last_active_at": "2024-05-06T07:08:09.123Z",
          "last_login_at": "2024-05-06T07:00:00.000Z",
          "last_api_use_at": "2024-05-06T07:08:09.123Z",
          "last_oj_activity_at": "2024-05-05T18:20:00.000Z",
          "activity_state": "active",
          "active_days_30d": 21,
          "solved_count_30d": 37,
          "submissions_30d": 84,
          "computed_at": "2024-05-06T07:10:00.000Z"
        },
        "teams": [],
        "oj_handles": []
      }
    ]
  } satisfies PagedMember,
  Team: {
    "id": "team_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "name": "DMU-1",
    "short_name": "DMU-1",
    "season": "2024-2025",
    "description": "2024 赛季一队。",
    "captain_id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "external_id": "ICPC-2024-CN-0123",
    "labels": [
      "2024",
      "a-team"
    ],
    "member_ids": [
      "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0"
    ],
    "member_count": 1,
    "members": [
      {
        "principal": {
          "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
          "username": "alice",
          "display_name": "张三",
          "kind": "human"
        },
        "role": "captain",
        "joined_at": "2024-01-10T02:00:00.000Z",
        "student_id": "2220210000",
        "enrollment_year": 2022
      }
    ],
    "created_at": "2024-01-10T02:00:00.000Z",
    "updated_at": "2024-05-06T07:08:09.123Z",
    "revision": "4"
  } satisfies Team,
  Announcement: {
    "id": "ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "title": "2024 暑期集训安排",
    "body_markdown": "## 时间：7 月 8 日起每周一、三、五 14:00 在 A301 训练。",
    "category": "training",
    "tags": [
      "训练",
      "通知"
    ],
    "priority": "normal",
    "pinned": true,
    "status": "published",
    "visibility": "members",
    "publish_at": null,
    "published_at": "2024-05-06T07:08:09.123Z",
    "expires_at": null,
    "archived_at": null,
    "source": {
      "kind": "manual"
    },
    "dedup_key": null,
    "broadcast_on_publish": true,
    "broadcast_channel_ids": [
      "chn_01J8Z5V6Q0K3M7N9P2R4T6W8X0"
    ],
    "author": null,
    "created_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "delivery_summary": {
      "pending": 0,
      "sent": 2,
      "failed": 1
    },
    "created_at": "2024-05-06T07:00:00.000Z",
    "updated_at": "2024-05-06T07:08:09.123Z",
    "revision": "3"
  } satisfies Announcement,
  Channel: {
    "id": "chn_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "name": "2024 级训练群",
    "kind": "qq_group",
    "target_masked": "****1234",
    "secret_set": true,
    "enabled": true,
    "template": "【公告",
    "mention_all": false,
    "rate_limit_per_minute": 30,
    "visibility_filter": "members",
    "created_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "last_delivery_at": "2024-05-06T07:08:10.000Z",
    "last_error": null,
    "created_at": "2024-05-01T02:00:00.000Z",
    "updated_at": "2024-05-06T07:00:00.000Z",
    "revision": "2"
  } satisfies Channel,
  Delivery: {
    "id": "dlv_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "announcement_id": "ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "channel": {
      "id": "chn_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "name": "2024 级训练群",
      "kind": "qq_group"
    },
    "state": "failed",
    "attempts": 2,
    "last_attempt_at": "2024-05-06T07:09:00.000Z",
    "sent_at": null,
    "error": "HTTP 500 from upstream",
    "external_message_id": null,
    "next_attempt_at": "2024-05-06T07:11:00.000Z",
    "created_at": "2024-05-06T07:08:09.123Z"
  } satisfies Delivery,
  Quota: {
    "id": "quota_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "title": "2024 南京站名额",
    "contest": {
      "name": "2024 ICPC 亚洲区域赛（南京）",
      "kind": "regional",
      "season": "2024-2025",
      "external_id": "icpc-2024-nanjing",
      "held_on": "2024-11-16",
      "location": "南京",
      "url": "https://icpc.example.edu/nanjing-2024"
    },
    "quota_total": 6,
    "max_claims_per_team": 2,
    "status": "open",
    "counts": {
      "claims_pending": 2,
      "claims_approved": 3,
      "claims_rejected": 1,
      "claims_withdrawn": 0,
      "remaining": 3
    },
    "claim_window": {
      "opens_at": "2024-09-01T00:00:00.000Z",
      "closes_at": "2024-09-15T00:00:00.000Z"
    },
    "eligibility": null,
    "notes": "每队最多 3 人，含 1 名替补。",
    "created_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "opened_at": "2024-09-01T00:00:00.000Z",
    "closed_at": null,
    "finalized_at": null,
    "created_at": "2024-08-20T02:00:00.000Z",
    "updated_at": "2024-09-03T07:08:09.123Z",
    "revision": "7"
  } satisfies Quota,
  QuotaClaim: {
    "id": "claim_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "quota_id": "quota_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "team": {
      "id": "team_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "name": "DMU-1"
    },
    "members": [
      {
        "principal": {
          "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
          "username": "alice",
          "display_name": "张三",
          "kind": "human"
        },
        "role": "member",
        "display_name": "张三",
        "student_id": "2220210000",
        "confirmed": true
      }
    ],
    "status": "pending",
    "priority": 100,
    "waitlist_position": null,
    "submitted_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "submitted_at": "2024-09-02T03:04:05.000Z",
    "decided_by": null,
    "decided_at": null,
    "decision_note": null,
    "expires_at": null,
    "created_at": "2024-09-02T03:04:05.000Z",
    "updated_at": "2024-09-02T03:04:05.000Z",
    "revision": "1"
  } satisfies QuotaClaim,
  Scoreboard: {
    "id": "sbd_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "name": "CF 2024-2025 个人榜",
    "description": "跨平台个人积分榜，按累计解题数排名。",
    "scope": "individual",
    "metric": "solved_count",
    "judge": "codeforces",
    "judge_label": null,
    "period": {
      "kind": "season",
      "season": "2024-2025",
      "window": null,
      "from": null,
      "to": null
    },
    "filter": {
      "judges": [
        "codeforces",
        "atcoder"
      ],
      "enrollment_years": [
        2022,
        2023
      ],
      "labels": [
        "member"
      ],
      "team_ids": [],
      "include_inactive": false
    },
    "visibility": "public",
    "entry_count": 137,
    "generated_at": "2024-05-06T07:00:00.000Z",
    "stale": false,
    "next_refresh_at": "2024-05-06T07:15:00.000Z",
    "source_updated_at": "2024-05-06T06:58:00.000Z",
    "revision": "17",
    "created_at": "2024-01-02T03:04:05.000Z",
    "updated_at": "2024-05-06T07:00:00.000Z",
    "created_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    }
  } satisfies Scoreboard,
  ScoreboardEntry: {
    "id": "sbe_01J8Z5V6Q0K3M7N9P2R4T6W8X1",
    "scoreboard_id": "sbd_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "rank": 3,
    "display_name": "张三",
    "principal": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "team": {
      "id": "team_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "name": "DMU-1"
    },
    "score": 812,
    "metric": "solved_count",
    "solved_count": 812,
    "penalty": null,
    "activity_days": 96,
    "rating": 1873,
    "rating_delta": 42,
    "rank_delta": 2,
    "per_judge": [
      {
        "judge": "codeforces",
        "rating": 1873,
        "max_rating": 1901,
        "solved_count": 812,
        "submissions": 2310,
        "rating_delta_30d": 42,
        "last_accepted_at": "2024-05-05T13:20:00.000Z"
      }
    ],
    "updated_at": "2024-05-06T07:00:00.000Z"
  } satisfies ScoreboardEntry,
  OjHandle: {
    "id": "ojh_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "principal_id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "judge": "codeforces",
    "judge_label": null,
    "handle": "tourist",
    "profile_url": "https://codeforces.com/profile/tourist",
    "verified": true,
    "verification_state": "verified",
    "verification_token": null,
    "verified_at": "2024-04-01T02:00:00.000Z",
    "linked_at": "2024-03-20T08:00:00.000Z",
    "last_crawled_at": "2024-05-06T07:00:00.000Z",
    "last_submission_at": "2024-05-06T06:59:12.000Z",
    "summary": {
      "rating": 3721,
      "max_rating": 3800,
      "rating_delta_30d": 42,
      "solved_count": 1873,
      "attempted_count": 2104,
      "submissions_30d": 96,
      "active_days_30d": 21,
      "computed_at": "2024-05-06T07:00:05.000Z"
    },
    "revision": "17",
    "updated_at": "2024-05-06T07:00:05.000Z"
  } satisfies OjHandle,
  OjSubmission: {
    "id": "sub_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "judge": "codeforces",
    "submission_id": "223456789",
    "handle": "tourist",
    "principal_id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "problem": {
      "problem_id": "pbl_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "judge": "codeforces",
      "external_id": "1873A",
      "title": "Short Sort",
      "url": "https://codeforces.com/contest/1873/problem/A",
      "tags": [
        "implementation"
      ],
      "difficulty": 800,
      "rating": 800
    },
    "verdict": "accepted",
    "verdict_raw": "OK",
    "language": "GNU C++17",
    "submitted_at": "2024-05-06T06:59:12.000Z",
    "ingested_at": "2024-05-06T07:01:00.000Z",
    "contest": {
      "judge": "codeforces",
      "contest_id": "1873",
      "name": "Codeforces Round 898 (Div. 4)",
      "url": "https://codeforces.com/contest/1873",
      "started_at": "2023-09-21T14:35:00.000Z"
    },
    "is_first_ac": true
  } satisfies OjSubmission,
  OjRatingRecord: {
    "id": "rch_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "judge": "codeforces",
    "handle": "tourist",
    "principal_id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "contest": {
      "judge": "codeforces",
      "contest_id": "1873",
      "name": "Codeforces Round 898 (Div. 4)",
      "url": "https://codeforces.com/contest/1873",
      "started_at": "2023-09-21T14:35:00.000Z"
    },
    "rating": 3721,
    "delta": 42,
    "max_rating": 3800,
    "rank": 7,
    "performance": 3810,
    "at": "2023-09-21T16:35:00.000Z",
    "ingested_at": "2024-05-06T07:01:00.000Z"
  } satisfies OjRatingRecord,
  IngestRatingRecordItem: {
    "judge": "codeforces",
    "handle": "tourist",
    "contest_id": "1873",
    "contest_name": "Codeforces Round 898 (Div. 4)",
    "rating": 3721,
    "max_rating": 3800,
    "rank": 7,
    "performance": 3810,
    "at": "2023-09-21T16:35:00.000Z"
  } satisfies IngestRatingRecordItem,
  CrawlerConfig: {
    "revision": "7",
    "mode": "embedded",
    "enabled": true,
    "judges": [
      {
        "judge": "codeforces",
        "enabled": true,
        "interval": "PT15M",
        "max_pages": 20,
        "extra": null
      },
      {
        "judge": "atcoder",
        "enabled": true,
        "interval": null,
        "max_pages": null,
        "extra": null
      }
    ],
    "schedule": {
      "interval": "PT30M",
      "jitter": "PT2M",
      "timezone": "Asia/Shanghai",
      "active_hours": {
        "from": "08:00",
        "to": "23:30"
      }
    },
    "rate_limit": {
      "requests_per_minute": 60,
      "concurrency": 2
    },
    "proxy": {
      "enabled": true,
      "strategy": "failover",
      "direct_timeout": "PT10S",
      "no_proxy": [
        "*.dmu.edu.cn"
      ],
      "proxies": [
        {
          "id": "pxy_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
          "label": "hk-1",
          "url": "socks5://10.0.0.9:1080",
          "username": "crawler",
          "has_password": true,
          "enabled": true,
          "priority": 10,
          "health": null
        }
      ]
    },
    "retention": {
      "submissions": "P2Y",
      "runs": "P90D"
    },
    "updated_at": "2024-05-06T07:00:00.000Z"
  } satisfies CrawlerConfig,
  Config: {
    "revision": "42",
    "source": "api",
    "updated_at": "2024-05-06T07:08:09.123Z",
    "server": {
      "public_read": true,
      "base_url": "https://dashboard.dmu.edu.cn",
      "cors_origins": [
        "https://dashboard.dmu.edu.cn"
      ]
    },
    "auth": {
      "access_token_ttl": "PT30M",
      "refresh_token_ttl": "P30D",
      "password_min_length": 12,
      "session_max_per_principal": 10
    },
    "accounts": {
      "default_template": "user",
      "templates": {
        "user": {
          "description": "普通成员；可自助维护自己的档案与社团登记。",
          "scopes": [
            "account:self",
            "profile:display",
            "profile:contact",
            "profile:academic",
            "profile:clubs",
            "member:read",
            "team:read",
            "oj:read",
            "oj:write",
            "quota:claim"
          ]
        },
        "manager": {
          "description": "管理员；在 user 基础上可读 PII、管人与管名额。",
          "scopes": [
            "account:self",
            "profile:display",
            "profile:contact",
            "profile:academic",
            "profile:clubs",
            "member:read",
            "team:read",
            "oj:read",
            "oj:write",
            "quota:claim",
            "member:read_pii",
            "member:manage",
            "member:assign",
            "team:manage",
            "oj:manage",
            "quota:read",
            "quota:manage",
            "scoreboard:read",
            "scoreboard:manage",
            "stats:read",
            "sync:read",
            "audit:read",
            "announcement:read",
            "announcement:write",
            "announcement:publish"
          ]
        },
        "collector": {
          "description": "采集器；只写采集通道。",
          "scopes": [
            "ingest:write",
            "crawler:read"
          ]
        }
      }
    },
    "ingest": {
      "batch_max": 500,
      "clock_skew_past": "P1095D",
      "clock_skew_future": "P1D",
      "submissions_retention": "P2Y"
    },
    "roster": {
      "active_within": "P365D",
      "export_ttl": "PT15M",
      "export_row_limit": 10000
    },
    "scoreboards": {
      "refresh_interval": "PT15M",
      "freshness_bound": "PT15M",
      "max_entries": 5000
    },
    "stats": {
      "materialize_interval": "PT1H",
      "freshness_bound": "PT1H",
      "max_range_days": 730
    },
    "announcements": {
      "max_pinned": 3,
      "dedup_window": "P7D",
      "broadcast_retry": {
        "max_attempts": 5,
        "backoff": "PT30S"
      }
    },
    "stream": {
      "heartbeat_interval": "PT15S",
      "replay_buffer_events": 1000,
      "replay_buffer_duration": "PT5M",
      "stream_token_ttl": "PT10M"
    },
    "rate_limit": {
      "default_per_minute": 600,
      "ingest_per_minute": 3000,
      "export_per_hour": 20
    },
    "judges": {
      "enabled": [
        "codeforces",
        "atcoder"
      ],
      "crawl_interval": "PT30M"
    },
    "log": {
      "level": "info",
      "format": "json"
    },
    "restart_required_fields": []
  } satisfies Config,
  ChangeFeed: {
    "changes": [
      {
        "resource": "members",
        "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "op": "upsert",
        "revision": "17",
        "updated_at": "2024-05-06T07:08:09.123Z"
      },
      {
        "resource": "teams",
        "id": "team_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "op": "delete",
        "revision": "4",
        "updated_at": "2024-05-06T07:08:10.000Z"
      }
    ],
    "cursor": "eyJ0IjoiMjAyNC0wNS0wNlQwNzowODoxMC4wMDBaIiwiaWQiOiJ0ZWFtXzAxSjhaNVY2UTBLM003TjlQMlI0VDZXOFgwIn0",
    "has_more": false,
    "server_time": "2024-05-06T07:08:11.000Z",
    "retention": "P30D"
  } satisfies ChangeFeed,
  Job: {
    "id": "job_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "kind": "roster_export",
    "state": "succeeded",
    "progress": {
      "percent": 100
    },
    "result": {
      "export_id": "exp_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "row_count": 87
    },
    "error": null,
    "created_at": "2024-05-06T07:08:09.123Z",
    "started_at": "2024-05-06T07:08:09.500Z",
    "finished_at": "2024-05-06T07:08:11.000Z",
    "expires_at": "2024-05-07T07:08:09.123Z"
  } satisfies Job,
  Problem: {
    "type": "https://docs.dmu-xcpc.example/errors/insufficient_scope",
    "title": "Insufficient scope",
    "status": 403,
    "code": "insufficient_scope",
    "detail": "凭证缺少 member:manage 权限",
    "instance": "/api/v1/members/acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "request_id": "req_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "docs_url": "https://docs.dmu-xcpc.example/errors/insufficient_scope"
  } satisfies Problem,
  AuditLog: {
    "id": "aud_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "at": "2024-05-06T07:08:09.123Z",
    "actor": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "actor_kind": "human",
    "action": "announcement.publish",
    "target": {
      "resource": "announcements",
      "id": "ann_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "label": "2024 暑期集训安排"
    },
    "outcome": "success",
    "status_code": 200,
    "scope_used": "announcement:publish",
    "ip": "2001:db8::1",
    "user_agent": "Mozilla/5.0",
    "request_id": "req_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "metadata": {
      "channel_count": 2
    }
  } satisfies AuditLog,
  RosterExport: {
    "id": "exp_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "status": "succeeded",
    "format": "csv",
    "include_inactive": false,
    "active_within": "P365D",
    "row_count": 87,
    "excluded_inactive_count": 12,
    "size_bytes": 20480,
    "download_url": "/api/v1/roster/exports/exp_01J8Z5V6Q0K3M7N9P2R4T6W8X0/download?download_token=xcd_7f3aQ0K3M7N9P2R4T6W8X0",
    "download_expires_at": "2024-05-06T07:23:09.123Z",
    "created_by": {
      "id": "acc_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
      "username": "alice",
      "display_name": "张三",
      "kind": "human"
    },
    "created_at": "2024-05-06T07:08:09.123Z",
    "completed_at": "2024-05-06T07:08:11.000Z",
    "error": null,
    "filters": {
      "labels": [
        "member"
      ]
    },
    "columns": [
      "username",
      "display_name",
      "student_id"
    ]
  } satisfies RosterExport,
  IngestResult: {
    "accepted": 2,
    "duplicates": 1,
    "rejected": 1,
    "crawler_run_id": "run_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
    "materialized_at": "2024-05-06T07:15:00.000Z",
    "items": [
      {
        "index": 0,
        "status": "accepted",
        "id": "sub_01J8Z5V6Q0K3M7N9P2R4T6W8X0",
        "code": null,
        "message": null,
        "pointer": null
      },
      {
        "index": 1,
        "status": "duplicate",
        "id": "sub_01J8Z5V6Q0K3M7N9P2R4T6W8X1",
        "code": null,
        "message": null,
        "pointer": null
      },
      {
        "index": 2,
        "status": "accepted",
        "id": "sub_01J8Z5V6Q0K3M7N9P2R4T6W8X2",
        "code": null,
        "message": null,
        "pointer": null
      },
      {
        "index": 3,
        "status": "rejected",
        "id": null,
        "code": "validation_failed",
        "message": "submitted_at 必须落在 now-3y .. now+1d 之内",
        "pointer": "/items/3/submitted_at"
      }
    ]
  } satisfies IngestResult,
  StatsTrendResponse: {
    "query": {
      "scope": "individual",
      "judges": [
        "codeforces"
      ],
      "from": "2024-02-06T00:00:00.000Z",
      "to": "2024-05-06T00:00:00.000Z",
      "timezone": "Asia/Shanghai",
      "bucket": "day",
      "group_by": "judge",
      "metric": "solved_count"
    },
    "groups": [
      {
        "key": "codeforces",
        "label": "Codeforces",
        "points": [
          {
            "bucket_start": "2024-05-05T16:00:00.000Z",
            "bucket_end": "2024-05-06T16:00:00.000Z",
            "value": 37,
            "sample_size": 12,
            "label": "05-06"
          }
        ],
        "series_summary": {
          "total": 512,
          "average": 5.68,
          "max": 41,
          "min": 0,
          "last": 37
        }
      }
    ],
    "generated_at": "2024-05-06T07:00:00.000Z",
    "stale": false
  } satisfies StatsTrendResponse,
};
