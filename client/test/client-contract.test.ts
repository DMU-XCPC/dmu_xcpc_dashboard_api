/**
 * 客户端 ↔ 契约一致性。
 *
 * 这是"客户端不能悄悄偏离契约"的强制约束：
 *
 * 1. 每个资源模块导出的 `XXX_OPERATIONS` 清单必须与契约的
 *    `operationId` / 路径模板 / HTTP 方法完全一致（键就是 operationId）；
 * 2. 契约里的**每个** operation 都必须被客户端覆盖，或明确由核心层承担
 *    （`SessionManager` 负责 auth 系列，`SseClient` 负责 SSE 流）；
 * 3. 关键实体的示例数据同时被 TypeScript 类型（编译期 `satisfies`，见 `fixtures.ts`）
 *    与契约 schema（运行期 Ajv）约束——任何一侧漂移都会失败。
 */
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { fixtures } from './fixtures.js';
import { createValidator, loadSpec, operationsOf } from './spec.js';

const spec = loadSpec();
const operations = operationsOf(spec);
const validate = createValidator(spec);

/** 由核心层承担、因此不在任何资源类清单里的 operation。 */
const HANDLED_BY_CORE = new Set([
  'login',
  'refreshToken',
  'logout',
  'streamEvents',
]);

type Manifest = Record<string, { method: string; path: string }>;

const manifests = Object.entries(api).filter(([name, value]) => name.endsWith('_OPERATIONS') && typeof value === 'object') as Array<
  [string, Manifest]
>;

describe('客户端覆盖契约', () => {
  it('至少覆盖 15 个资源模块、100 个端点', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(15);
    const total = manifests.reduce((sum, [, manifest]) => sum + Object.keys(manifest).length, 0);
    expect(total).toBeGreaterThanOrEqual(100);
  });

  it('清单里的端点必须与契约的方法、路径模板、operationId 完全一致', () => {
    const mismatches: string[] = [];
    for (const [constName, manifest] of manifests) {
      for (const [operationId, entry] of Object.entries(manifest)) {
        const path = entry.path;
        const method = entry.method.toLowerCase();
        const item = spec.paths[path];
        if (!item) {
          mismatches.push(`${constName}.${operationId}: 契约里没有路径 ${path}`);
          continue;
        }
        const op = item[method];
        if (!op) {
          mismatches.push(`${constName}.${operationId}: 契约里 ${path} 没有 ${entry.method}`);
          continue;
        }
        if (op.operationId !== operationId) {
          mismatches.push(
            `${constName}.${operationId}: 契约中 ${entry.method} ${path} 的 operationId 是 ${String(op.operationId)}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('契约里的每个 operation 都被覆盖（或由核心层承担）', () => {
    const covered = new Set<string>();
    for (const [, manifest] of manifests) for (const operationId of Object.keys(manifest)) covered.add(operationId);

    const allIds = new Set(operations.map(({ op }) => op.operationId as string));
    for (const operationId of HANDLED_BY_CORE) {
      expect(allIds.has(operationId), `核心层清单里的 ${operationId} 在契约中不存在（是否改名？）`).toBe(true);
    }

    const missing = [...allIds].filter((operationId) => !covered.has(operationId) && !HANDLED_BY_CORE.has(operationId));
    expect(missing.sort()).toEqual([]);
  });
});

describe('XcpcClient 组装', () => {
  const client = new api.XcpcClient({ baseUrl: 'https://api.test/api/v1' });

  it('暴露全部资源实例', () => {
    expect(client.accounts).toBeInstanceOf(api.AccountsResource);
    expect(client.credentials).toBeInstanceOf(api.CredentialsResource);
    expect(client.ojHandles).toBeInstanceOf(api.OjHandlesResource);
    expect(client.oj).toBeInstanceOf(api.OjDataResource);
    expect(client.members).toBeInstanceOf(api.MembersResource);
    expect(client.teams).toBeInstanceOf(api.TeamsResource);
    expect(client.roster).toBeInstanceOf(api.RosterResource);
    expect(client.ingest).toBeInstanceOf(api.IngestResource);
    expect(client.crawler).toBeInstanceOf(api.CrawlerResource);
    expect(client.scoreboards).toBeInstanceOf(api.ScoreboardsResource);
    expect(client.stats).toBeInstanceOf(api.StatsResource);
    expect(client.announcements).toBeInstanceOf(api.AnnouncementsResource);
    expect(client.channels).toBeInstanceOf(api.ChannelsResource);
    expect(client.stream).toBeInstanceOf(api.StreamResource);
    expect(client.quotas).toBeInstanceOf(api.QuotasResource);
    expect(client.config).toBeInstanceOf(api.ConfigResource);
    expect(client.audit).toBeInstanceOf(api.AuditResource);
    expect(client.ops).toBeInstanceOf(api.OpsResource);
    expect(client.syncResource).toBeInstanceOf(api.SyncApiResource);
  });

  it('默认启用缓存与离线队列，并暴露同步与 SSE 能力', () => {
    expect(client.cache).toBeInstanceOf(api.ApiCache);
    expect(client.outbox).toBeInstanceOf(api.Outbox);
    expect(client.sync).toBeInstanceOf(api.SyncEngine);
    expect(client.session).toBeInstanceOf(api.SessionManager);
    expect(client.transport).toBeInstanceOf(api.Transport);
    expect(typeof client.subscribe).toBe('function');
  });

  it('cache: false / outbox: false 时关闭对应能力', () => {
    const minimal = new api.XcpcClient({ baseUrl: 'https://api.test/api/v1', cache: false, outbox: false });
    expect(minimal.cache).toBeUndefined();
    expect(minimal.outbox).toBeUndefined();
    expect(minimal.store).toBeInstanceOf(api.MemoryCacheStore);
  });

  it('apiKey 模式下会话即已认证', () => {
    const bot = new api.XcpcClient({ baseUrl: 'https://api.test/api/v1', apiKey: 'xcp_secret', apiKeyHeader: 'x-api-key' });
    expect(bot.session.isApiKeyAuth).toBe(true);
    expect(bot.session.isAuthenticated()).toBe(true);
  });
});

describe('示例数据同时受 TypeScript 类型与契约 schema 约束', () => {
  const names = Object.keys(fixtures);

  it('覆盖了关键实体', () => {
    expect(names).toContain('Member');
    expect(names).toContain('Announcement');
    expect(names).toContain('QuotaClaim');
    expect(names).toContain('Scoreboard');
    expect(names).toContain('Config');
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it.each(names)('%s 的 fixture 通过契约 schema 校验', (name) => {
    expect(spec.components.schemas[name], `契约里没有 schema ${name}`).toBeDefined();
    const result = validate(name, (fixtures as Record<string, unknown>)[name]);
    expect(result.ok, `${name}: ${result.errors}`).toBe(true);
  });
});
