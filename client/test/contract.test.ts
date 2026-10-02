/**
 * 契约自身的不变量（不需要客户端代码）。
 *
 * 这些断言把 `doc/api/STYLE.md` 的硬性规范变成可执行的约束：
 * 媒体类型、operation 形状、幂等键、路径参数、一致性扩展、分页形状、
 * 示例与 schema 一致、引用已解析。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync as runSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLUB_CODES, KNOWN_PROBLEM_CODES } from '../src/index.js';
import { STREAM_TOPICS } from '../src/sse.js';
import { STREAM_KIND_TO_RESOURCES } from '../src/resources/stream.js';
import { fixtures } from './fixtures.js';
import { createDeref, createValidator, loadSpec, operationsOf, README_PATH, type Spec } from './spec.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
/** 这些写操作在契约里明确豁免 `Idempotency-Key`（见 doc/api/STYLE.md §3）。 */
/**
 * 幂等豁免的唯一出处是契约里的 `x-idempotency-exempt: true`（README/STYLE 只引用它）。
 * 这里从 spec 惰性推导，避免手抄清单各自漂移。
 */
const idempotencyExempt = (): Set<string> =>
  new Set(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.values(item as Record<string, { 'x-idempotency-exempt'?: boolean }>)
        .filter((op) => op?.['x-idempotency-exempt'] === true)
        .map(() => path),
    ),
  );
const ALLOWED_MEDIA_TYPES = new Set([
  'application/json',
  'application/problem+json',
  'text/event-stream',
  'text/csv',
  'text/plain',
]);

const spec: Spec = loadSpec();
const operations = operationsOf(spec);
const deref = createDeref(spec);
const validate = createValidator(spec);

describe('契约：文档级不变量', () => {
  it('是 OpenAPI 3.1，且声明了服务地址与设计文档', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.info.description).toContain('README.md');
    expect(operations.length).toBeGreaterThan(100);
  });

  it('每个 tag 都有描述，且所有 operation 的 tag 都已声明', () => {
    const tagNames = new Set(spec.tags.map((tag) => tag.name));
    for (const tag of spec.tags) expect(tag.description, `tag ${tag.name} 缺 description`).toBeTruthy();
    for (const { path, method, op } of operations) {
      expect(op.tags, `${method.toUpperCase()} ${path} 缺 tags`).toBeTruthy();
      expect(op.tags?.length, `${method.toUpperCase()} ${path} 应恰好一个 tag`).toBe(1);
      expect(tagNames.has(op.tags?.[0] ?? ''), `${method.toUpperCase()} ${path} 的 tag 未声明`).toBe(true);
    }
  });

  it('不含 XML 表示，且媒体类型都在允许集合内', () => {
    const visited: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // OpenAPI 的 `xml` 关键字是 3.1 里唯一的 XML 表示入口，本契约必须完全不用。
        expect(key, `${path} 使用了 OpenAPI 的 xml 关键字`).not.toBe('xml');
        if (key === 'content' && value && typeof value === 'object') {
          for (const mediaType of Object.keys(value as Record<string, unknown>)) {
            expect(ALLOWED_MEDIA_TYPES.has(mediaType), `${path} 使用了未允许的媒体类型 ${mediaType}`).toBe(true);
          }
        }
        walk(value, `${path}/${key}`);
      }
    };
    walk(spec, '#');
    visited.push('ok');
    expect(visited).toEqual(['ok']);
  });

  it('bundle 之后没有残留的外部引用', () => {
    const raw = JSON.stringify(spec);
    expect(raw).not.toContain('.yaml#');
    expect(raw).not.toContain('"$ref":"../');
  });
});

describe('契约：operation 形状', () => {
  it('operationId 唯一、命名合法，且有 summary 与中文 description', () => {
    const seen = new Map<string, string>();
    for (const { path, method, op } of operations) {
      const id = op.operationId;
      expect(id, `${method.toUpperCase()} ${path} 缺 operationId`).toBeTruthy();
      expect(id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(seen.has(id as string), `operationId 重复：${id}`).toBe(false);
      seen.set(id as string, `${method} ${path}`);
      expect(op.summary, `${id} 缺 summary`).toBeTruthy();
      expect(op.description, `${id} 缺 description`).toBeTruthy();
      expect(String(op.description)).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('每个 operation 都有 2xx 与 4xx 响应，错误响应是 problem+json', () => {
    for (const { path, method, op } of operations) {
      const responses = op.responses ?? {};
      const codes = Object.keys(responses);
      expect(codes.some((code) => code.startsWith('2')), `${method} ${path} 缺 2xx`).toBe(true);
      expect(codes.some((code) => code.startsWith('4')), `${method} ${path} 缺 4xx`).toBe(true);
      for (const [code, response] of Object.entries(responses)) {
        if (code === '304' || code === '204') continue;
        if (!code.startsWith('4') && !code.startsWith('5')) continue;
        const resolved = deref<{ content?: Record<string, unknown> }>(response);
        expect(
          Object.keys(resolved.content ?? {}),
          `${method} ${path} 的 ${code} 不是 application/problem+json`,
        ).toEqual(['application/problem+json']);
      }
    }
  });

  it('路径参数都在 parameters 中声明（operation 级或 path item 级）', () => {
    for (const { path, method, op } of operations) {
      const pathItem = spec.paths[path] as Record<string, unknown>;
      const shared = (pathItem['parameters'] ?? []) as unknown[];
      const declared = new Set(
        [...(op.parameters ?? []), ...shared].map((parameter) => {
          const resolved = deref<{ name?: string; in?: string }>(parameter);
          return `${resolved.in}:${resolved.name}`;
        }),
      );
      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        const name = match[1] as string;
        expect(declared.has(`path:${name}`), `${method.toUpperCase()} ${path} 未声明路径参数 ${name}`).toBe(true);
      }
    }
  });

  it('写操作要求 Idempotency-Key（豁免清单除外）', () => {
    for (const { path, method, op } of operations) {
      if (!WRITE_METHODS.has(method)) continue;
      const pathItem = spec.paths[path] as Record<string, unknown>;
      const shared = (pathItem['parameters'] ?? []) as unknown[];
      const resolvedParameters = [...(op.parameters ?? []), ...shared].map((parameter) => deref<{ name?: string }>(parameter));
      const hasKey = resolvedParameters.some((parameter) => parameter.name === 'Idempotency-Key');
      if (idempotencyExempt().has(path)) {
        expect(hasKey, `${method.toUpperCase()} ${path} 属于豁免清单，不应要求 Idempotency-Key`).toBe(false);
      } else {
        expect(hasKey, `${method.toUpperCase()} ${path} 缺少 Idempotency-Key 参数`).toBe(true);
      }
    }
  });

  it('每个 operation 标注 x-idempotent 与 x-consistency，eventual 必须给出上界', () => {
    for (const { path, method, op } of operations) {
      expect(typeof op['x-idempotent'], `${method} ${path} 缺 x-idempotent`).toBe('boolean');
      expect(['strong', 'eventual']).toContain(op['x-consistency']);
      if (op['x-consistency'] === 'eventual') {
        expect(op['x-freshness-bound'], `${method} ${path} 是 eventual 但缺 x-freshness-bound`).toMatch(/^P/);
      }
    }
  });

  it('安全方法必须幂等；标注非幂等的 operation 必须在 description 里说明原因', () => {
    for (const { path, method, op } of operations) {
      if (['get', 'head', 'options'].includes(method)) {
        expect(op['x-idempotent'], `${method.toUpperCase()} ${path} 应标注 x-idempotent: true`).toBe(true);
      }
      // PUT/DELETE 允许 x-idempotent: false（例如修改口令重放必然失败），
      // 但必须在 description 里解释"为什么重放不安全"，避免读者误判。
      if (op['x-idempotent'] === false && ['put', 'delete'].includes(method)) {
        expect(String(op.description), `${method.toUpperCase()} ${path} 标注非幂等但未解释原因`).toContain('幂等');
      }
    }
  });
});

describe('契约：schema 与示例', () => {

  it('每个 schema 都有 description', () => {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      expect(schema['description'], `schema ${name} 缺 description`).toBeTruthy();
    }
  });

  it('所有 schema 级 examples 都通过自身 schema 校验', () => {
    const failures: string[] = [];
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      const examples = schema['examples'];
      if (!Array.isArray(examples)) continue;
      for (const [index, example] of examples.entries()) {
        const result = validate(name, example);
        if (!result.ok) failures.push(`${name}.examples[${index}]: ${result.errors}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('共享 Problem 覆盖所有已登记的 ProblemCode', () => {
    const codeSchema = spec.components.schemas['ProblemCode'] as { enum?: string[] };
    expect(Array.isArray(codeSchema.enum)).toBe(true);
    expect(codeSchema.enum?.length ?? 0).toBeGreaterThan(25);
    // Problem 自身示例必须合法
    const problemExamples = (spec.components.schemas['Problem'] as { examples?: unknown[] }).examples ?? [];
    expect(problemExamples.length).toBeGreaterThan(0);
    for (const example of problemExamples) {
      const result = validate('Problem', example);
      expect(result.ok, result.errors).toBe(true);
    }
  });

  it('分页响应形状一致：偏移分页带 page/size/total/has_next，游标分页带 has_more/next_cursor', () => {
    const offsetPaged = [
      'listAccounts',
      'listCredentials',
      'listOjHandles',
      'listMembers',
      'listTeams',
      'listRosterExports',
      'listScoreboards',
      'listScoreboardEntries',
      'listQuotas',
      'listQuotaClaims',
      'listAnnouncements',
      'listAnnouncementDeliveries',
      'listChannels',
      'listOjProblems',
      'listJobs',
    ];
    const cursorPaged = ['listOjSubmissions', 'listOjRatingHistory', 'listCrawlerRuns', 'listAuditLogs'];
    const byId = new Map(operations.map(({ path, method, op }) => [op.operationId as string, { path, method, op }]));

    const propertiesOf = (schema: Record<string, unknown>, depth = 0): Record<string, unknown> => {
      if (depth > 10) return {};
      const merged: Record<string, unknown> = { ...((schema['properties'] ?? {}) as Record<string, unknown>) };
      for (const part of (schema['allOf'] ?? []) as unknown[]) {
        Object.assign(merged, propertiesOf(deref<Record<string, unknown>>(part), depth + 1));
      }
      return merged;
    };

    for (const [operationId, fields] of [...offsetPaged.map((id) => [id, ['page', 'size', 'total', 'has_next']] as const), ...cursorPaged.map((id) => [id, ['has_more', 'next_cursor']] as const)]) {
      const entry = byId.get(operationId);
      expect(entry, `契约里缺少列表端口 ${operationId}`).toBeDefined();
      const responses = entry?.op.responses ?? {};
      const ok = responses['200'] ?? responses['201'];
      expect(ok, `${operationId} 缺 200 响应`).toBeDefined();
      const resolved = deref<{ content?: Record<string, { schema?: Record<string, unknown> }> }>(ok);
      const schema = deref<Record<string, unknown>>(resolved.content?.['application/json']?.schema);
      const properties = propertiesOf(schema);
      expect(properties['items'], `${operationId} 缺 items`).toBeTruthy();
      for (const field of fields) {
        expect(properties[field], `${operationId} 缺分页字段 ${field}`).toBeTruthy();
      }
    }
  });
});

describe('契约：rating 只记录观测值，delta 是派生量', () => {
  interface Shape {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('OjRatingRecord 不要求 delta，rating 本身独立成立', () => {
    const record = schemaOf('OjRatingRecord');
    expect(record.required).toEqual(expect.arrayContaining(['id', 'judge', 'handle', 'rating', 'at']));
    expect(record.required).not.toContain('delta');
    const delta = record.properties?.['delta'];
    expect(delta?.['type']).toEqual(['integer', 'null']);
    expect(String(delta?.['description'])).toContain('派生');
    expect(String(record.properties?.['rating']?.['description'])).toContain('观测值');
  });

  it('上报条目只需要 judge/handle/rating/at，且不接受 delta 作为输入', () => {
    const item = schemaOf('IngestRatingRecordItem');
    expect(item.required).toEqual(['judge', 'handle', 'rating', 'at']);
    expect(Object.keys(item.properties ?? {})).not.toContain('delta');
    // contest_id 可省略（周期性 rating 快照没有比赛上下文）
    expect(item.required).not.toContain('contest_id');
  });

  it('端点与命名已从“变化”改为“记录”', () => {
    expect(spec.paths['/ingest/oj/rating-changes']).toBeUndefined();
    expect(spec.paths['/ingest/oj/ratings']?.['post']?.operationId).toBe('ingestOjRatings');
    expect(Object.keys(spec.components.schemas)).toContain('OjRatingRecord');
    expect(Object.keys(spec.components.schemas)).not.toContain('OjRatingChange');
    expect(spec.paths['/oj/rating-history']?.['get']?.operationId).toBe('listOjRatingHistory');
  });

  it('榜单/统计里的 rating 变化量都标注为派生字段', () => {
    for (const [schemaName, field] of [
      ['ScoreboardEntry', 'rating_delta'],
      ['ScoreboardEntryJudge', 'rating_delta_30d'],
    ] as const) {
      const description = String(schemaOf(schemaName).properties?.[field]?.['description'] ?? '');
      expect(description, `${schemaName}.${field} 应说明是由 rating 记录派生`).toContain('派生');
    }
  });
});

describe('契约：Member 是 Principal 的投影，不是第二种身份', () => {
  interface Shape {
    description?: string;
    required?: string[];
    allOf?: unknown[];
    properties?: Record<string, unknown>;
  }
  const member = spec.components.schemas['Member'] as Shape;
  const projection = (member.allOf?.[1] ?? {}) as Shape;

  it('Member = Principal + 恰好 4 个成员名单专属字段', () => {
    // allOf[0] 必须就是 identity.yaml 的 Principal 本体（投影而非复制）
    expect(deref(member.allOf?.[0])).toBe(spec.components.schemas['Principal']);
    expect(projection.required).toEqual(['clubs', 'activity', 'teams', 'oj_handles']);
    expect(String(member.description)).toContain('投影');
    expect(String(member.description)).toContain('不是独立实体');
  });

  it('明确写出"成员没有独立 id"，并与账号视图共享同一 ETag', () => {
    const description = String(member.description);
    expect(description).toContain('不存在 `mem_` 前缀');
    expect(description).toContain('同一份数据、同一个 `ETag`');
    expect(String((spec.components.schemas['MemberActivity'] as Shape).description)).toContain('时效不同');
  });

  it('member_id 与 account_id 使用同一个标识 schema', () => {
    const paramOf = (path: string, name: string): { schema?: { $ref?: string } } | undefined =>
      (spec.paths[path]?.['get']?.parameters ?? [])
        .map((parameter) => deref<{ name?: string; schema?: { $ref?: string } }>(parameter))
        .find((parameter) => parameter.name === name);
    expect(paramOf('/members/{member_id}', 'member_id')?.schema?.$ref).toBe('#/components/schemas/Id');
    expect(paramOf('/accounts/{account_id}', 'account_id')?.schema?.$ref).toBe('#/components/schemas/Id');
  });

  it('示例里不再出现未登记的 id 前缀（含已淘汰的 mem_）', () => {
    const idDescription = String((spec.components.schemas['Id'] as Shape).description);
    const documented = new Set(
      [...idDescription.matchAll(/`([a-z][a-z0-9]{1,7})_`/g)].map((match) => match[1] as string),
    );
    const used = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === 'string') {
        const match = /^([a-z][a-z0-9]{1,7})_[0-9A-HJKMNP-TV-Z]{26}$/.exec(node);
        if (match?.[1]) used.add(match[1]);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(spec);

    expect(used.has('mem'), '成员没有独立 id，示例里不应出现 mem_ 前缀').toBe(false);
    const undocumented = [...used].filter((prefix) => !documented.has(prefix)).sort();
    expect(undocumented, `未在 Id.description 登记的前缀：${undocumented.join(', ')}`).toEqual([]);
  });
});

describe('契约：示例中的成员引用必须自洽', () => {
  it('同一示例里的 member_ids 与 members[].principal.id 一致（member_id 就是主体 id）', () => {
    const mismatches: Array<{ path: string; memberIds: unknown; fromMembers: unknown }> = [];
    let checked = 0;
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;
      const record = node as { member_ids?: unknown; members?: unknown };
      if (Array.isArray(record.member_ids) && Array.isArray(record.members)) {
        checked += 1;
        const fromMembers = (record.members as Array<{ principal?: { id?: string } }>).map((entry) => entry.principal?.id);
        if (JSON.stringify(fromMembers) !== JSON.stringify(record.member_ids)) {
          mismatches.push({ path, memberIds: record.member_ids, fromMembers });
        }
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) walk(value, `${path}/${key}`);
    };
    walk(spec, '#');

    expect(checked).toBeGreaterThanOrEqual(3);
    expect(mismatches).toEqual([]);
  });
});

describe('契约：权限词汇表是机器可读且自洽的', () => {
  /** 非 scope 的 `x:y` 写法（自然键、CSV 列、通配语法、以及"明确不存在的 scope"负例）。 */
  const NOT_SCOPES = new Set(['judge:handle', 'ingest:read']);

  const canonical = (): Set<string> => {
    const list = (spec as unknown as { 'x-scopes'?: string[] })['x-scopes'];
    expect(Array.isArray(list), '契约根级缺少 x-scopes 词汇表').toBe(true);
    return new Set(list ?? []);
  };

  it('文档里出现的每个 `资源:动作` 都在 x-scopes 中登记', () => {
    const allowed = canonical();
    const offenders = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === 'string') {
        for (const match of node.matchAll(/`([a-z][a-z0-9_]*):([a-z_*]+)`/g)) {
          const pair = `${match[1]}:${match[2]}`;
          if (pair.endsWith(':*') || NOT_SCOPES.has(pair)) continue;
          if (!allowed.has(pair)) offenders.add(pair);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(spec);
    expect([...offenders].sort(), '这些 scope 未登记在 info.x-scopes').toEqual([]);
  });

  it('README 的权限表与 x-scopes 完全一致（两边不会各说各话）', () => {
    const documented = canonical();
    const readme = readFileSync(README_PATH, 'utf8');
    const tableScopes = new Set<string>();
    for (const line of readme.split('\n')) {
      if (!line.startsWith('| `')) continue;
      const firstCell = line.split('|')[1] ?? '';
      for (const match of firstCell.matchAll(/`([a-z][a-z0-9_]*:[a-z_*]+)`/g)) {
        const pair = match[1] as string;
        if (pair.endsWith(':*')) continue;
        tableScopes.add(pair);
      }
    }
    expect([...documented].sort()).toEqual([...tableScopes].sort());
  });

  it('x-scopes 里没有已废弃或从不使用的条目', () => {
    const raw = JSON.stringify(spec);
    const unused = [...canonical()].filter((scope) => !raw.includes(`\`${scope}\``));
    expect(unused, '这些 scope 在契约里从未被提及').toEqual([]);
  });
});

describe('契约：描述排版（括号夹注限制，见 STYLE.md §7.1）', () => {
  interface Texts {
    summary: Array<{ path: string; value: string }>;
    firstLine: Array<{ path: string; value: string }>;
    tooMany: Array<{ path: string; value: string }>;
    nested: Array<{ path: string; value: string }>;
  }
  const collect = (): Texts => {
    const found: Texts = { summary: [], firstLine: [], tooMany: [], nested: [] };
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (typeof value === 'string' && key === 'summary' && value.includes('（')) {
          found.summary.push({ path, value });
        }
        if (typeof value === 'string' && key === 'description') {
          const firstLine = value.split('\n').find((line) => line.trim() !== '') ?? '';
          if ((firstLine.match(/（/g) ?? []).length > 1) found.firstLine.push({ path, value: firstLine.trim() });
          if ((value.match(/（/g) ?? []).length > 7) found.tooMany.push({ path, value: value.slice(0, 60) });
          if (value.includes('（（') || value.includes('））')) found.nested.push({ path, value: value.slice(0, 60) });
        }
        walk(value, `${path}/${key}`);
      }
    };
    walk(spec, '#');
    return found;
  };

  const found = collect();

  it('summary 一律不使用括号', () => {
    expect(found.summary.map((item) => `${item.path}: ${item.value}`)).toEqual([]);
  });

  it('描述首行的括号不超过 1 个', () => {
    expect(found.firstLine.map((item) => `${item.path}: ${item.value}`)).toEqual([]);
  });

  it('单个描述的括号总数不超过 7 个', () => {
    expect(found.tooMany.map((item) => `${item.path}: ${item.value}…`)).toEqual([]);
  });

  it('没有嵌套或半截括号', () => {
    expect(found.nested.map((item) => `${item.path}: ${item.value}…`)).toEqual([]);
  });

  it('Id 前缀表的描述不使用夹注（关键位置）', () => {
    const description = String((spec.components.schemas['Id'] as { description?: string }).description);
    expect(description).not.toContain('（');
    expect(description).not.toContain('）');
    expect(description).toContain('| 前缀 | 资源 |');
  });
});

describe('契约：两个社团身份，可只注册其一或两者', () => {
  interface Shape {
    enum?: string[];
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
    description?: string;
    allOf?: unknown[];
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('ClubCode 恰好是海风社团软件部与 ACM/ICPC 学社', () => {
    expect(schemaOf('ClubCode').enum).toEqual(['safewind_software', 'acm_icpc']);
  });

  it('社团身份是档案里的一对多注册记录，不再是单一布尔', () => {
    const profile = schemaOf('PrincipalProfile');
    expect(profile.properties?.['club_memberships']).toBeTruthy();
    expect(profile.properties?.['club_registered']).toBeUndefined();
    expect(profile.properties?.['club_registered_at']).toBeUndefined();
    expect(schemaOf('ClubMembership').required).toEqual(['club', 'status', 'registered_at']);
    // 只读：写入走独立端点，避免两处都能写
    expect(profile.properties?.['club_memberships']?.['readOnly']).toBe(true);
  });

  it('Member 用 clubs 表达当前社团，没有单一的是否在册布尔', () => {
    const projection = (schemaOf('Member').allOf?.[1] ?? {}) as Shape;
    expect(projection.required).toEqual(['clubs', 'activity', 'teams', 'oj_handles']);
    expect(Object.keys(projection.properties ?? {})).not.toContain('is_member');
    expect(String(projection.properties?.['clubs']?.['description'])).toContain('社团');
  });

  it('成员与账号列表都能按社团筛选，导出也按社团', () => {
    const namesOf = (path: string): string[] =>
      (spec.paths[path]?.['get']?.parameters ?? []).map((parameter) => deref<{ name?: string }>(parameter).name ?? '');
    expect(namesOf('/members')).toContain('club');
    expect(namesOf('/accounts')).toContain('club');

    const exportRequest = schemaOf('RosterExportRequest');
    expect(exportRequest.properties?.['clubs']).toBeTruthy();
    expect(schemaOf('RosterExportClubCount').required).toEqual(['club', 'included', 'excluded_inactive']);
  });

  it('活跃度提供按社团切分的切片', () => {
    const activity = schemaOf('MemberActivity');
    expect(activity.required).toContain('by_club');
    expect(String(activity.description)).toContain('by_club');
    expect(schemaOf('ClubActivity').required).toEqual(['club', 'status', 'registered_at', 'active_days', 'submissions']);
  });

  it('社团身份有独立写入端点，且请求体是整体替换', () => {
    const put = spec.paths['/members/{member_id}/clubs']?.['put'];
    expect(put?.operationId).toBe('setMemberClubs');
    expect(put?.['x-idempotent']).toBe(true);
    expect(schemaOf('SetMemberClubsRequest').required).toEqual(['memberships']);
  });

  it('看板与统计都能按社团分组或筛选', () => {
    expect(schemaOf('StatsGroupBy').enum).toContain('club');
    expect(schemaOf('ScoreboardFilter').properties?.['clubs']).toBeTruthy();
    expect(schemaOf('StatsQueryEcho').properties?.['clubs']).toBeTruthy();
  });
});

describe('契约：一版定稿的几条硬约束', () => {
  interface Shape {
    enum?: string[];
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
    allOf?: unknown[];
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('不存在"免审核直接占用名额"的开关', () => {
    expect(schemaOf('Quota').properties?.['approval_required']).toBeUndefined();
    expect(schemaOf('Quota').required ?? []).not.toContain('approval_required');
  });

  it('JobKind 只列真正由 202 端点产生的任务类型', () => {
    expect(schemaOf('JobKind').enum).toEqual([
      'roster_export',
      'scoreboard_rebuild',
      'crawler_run',
      'announcement_broadcast',
    ]);
  });

  it('导出状态机复用共享 JobState，不再各有一套', () => {
    const status = schemaOf('RosterExport').properties?.['status'];
    expect(String(status?.['$ref'])).toContain('JobState');
    expect(status?.['enum']).toBeUndefined();
  });

  it('术语统一：正文不出现"名册"与"爬虫"', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}[${index}]`));
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (typeof value === 'string' && (key === 'description' || key === 'summary' || key === 'title')) {
          for (const banned of ['名册', '爬虫']) {
            if (value.includes(banned)) offenders.push(`${path}/${key}: ${banned}`);
          }
        }
        walk(value, `${path}/${key}`);
      }
    };
    walk(spec, '#');
    expect(offenders).toEqual([]);
  });
});

describe('契约：名额按赛季分配', () => {
  interface Shape { required?: string[]; properties?: Record<string, Record<string, unknown>> }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('比赛描述必须带赛季，且赛季与名称构成唯一键', () => {
    const contest = schemaOf('ContestRef');
    expect(contest.required).toContain('season');
    expect(String(contest.properties?.['season']?.['description'])).toContain('唯一');
  });

  it('每队认领上限有默认值 2，并在 1..10 之间', () => {
    const cap = schemaOf('Quota').properties?.['max_claims_per_team'] as Record<string, unknown>;
    expect(cap?.['default']).toBe(2);
    expect([cap?.['minimum'], cap?.['maximum']]).toEqual([1, 10]);
  });

  it('名额池列表可以按赛季筛选', () => {
    const names = (spec.paths['/quotas']?.['get']?.parameters ?? []).map((p) => deref<{ name?: string }>(p).name);
    expect(names).toContain('season');
  });
});

describe('契约：档案的读写分离', () => {
  interface Shape {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
    allOf?: unknown[];
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('可写档案结构不含任何只读字段', () => {
    const write = schemaOf('PrincipalProfileWrite');
    expect(write.properties?.['club_memberships']).toBeUndefined();
    expect(write.properties?.['grade']).toBeUndefined();
  });

  it('响应侧档案把派生与社团记录标为只读', () => {
    const read = schemaOf('PrincipalProfile');
    expect(read.properties?.['grade']?.['readOnly']).toBe(true);
    expect(read.properties?.['club_memberships']?.['readOnly']).toBe(true);
  });

  it('所有请求体的 profile 都指向可写结构，不可能把只读字段发出去', () => {
    const requests = ['CreateAccountRequest', 'UpdateAccountRequest', 'UpdateMeRequest', 'UpdateMemberRequest'];
    const refs = requests.map((name) => String(schemaOf(name).properties?.['profile']?.['$ref'] ?? ''));
    expect(refs.every((ref) => ref.endsWith('PrincipalProfileWrite'))).toBe(true);
  });

  it('社团注册记录只能通过专用端点写入', () => {
    const put = spec.paths['/members/{member_id}/clubs']?.['put'];
    expect(put?.operationId).toBe('setMemberClubs');
    // 请求体只接受 memberships，且成员资格是 clubs 这一派生视图
    expect(schemaOf('SetMemberClubsRequest').required).toEqual(['memberships']);
    expect(schemaOf('Member').allOf?.[1]).toMatchObject({ required: ['clubs', 'activity', 'teams', 'oj_handles'] });
  });
});

describe('契约：成员自助维护自己的档案', () => {
  interface Shape {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
    examples?: Array<Record<string, any>>;
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('四个字段组 scope 都登记在 x-scopes 里', () => {
    const scopes = (spec as unknown as { 'x-scopes'?: string[] })['x-scopes'] ?? [];
    for (const scope of ['profile:display', 'profile:contact', 'profile:academic', 'profile:clubs']) {
      expect(scopes).toContain(scope);
    }
  });

  it('默认模板给全四组，成员开箱即可自助维护', () => {
    const example = schemaOf('AccountsConfig').examples?.[0] ?? {};
    const defaultTemplate = String(example['default_template']);
    expect(defaultTemplate).toBe('user');
    const scopes = example['templates']?.[defaultTemplate]?.scopes ?? [];
    expect(scopes).toEqual(
      expect.arrayContaining(['profile:display', 'profile:contact', 'profile:academic', 'profile:clubs']),
    );
  });

  it('创建账号可以套用模板，且与显式 scopes 互斥', () => {
    const template = schemaOf('CreateAccountRequest').properties?.['template'];
    expect(template).toBeTruthy();
    expect(String(template?.['description'])).toContain('互斥');
  });

  it('自助社团登记是独立端点，与管理端点写同一份数据', () => {
    const put = spec.paths['/auth/me/clubs']?.['put'];
    expect(put?.operationId).toBe('setOwnClubs');
    expect(String(put?.['description'])).toContain('profile:clubs');
    // 管理端点仍在，且两者都指向同一个请求体结构
    expect(spec.paths['/members/{member_id}/clubs']?.['put']?.operationId).toBe('setMemberClubs');
    const body = JSON.stringify(put?.['requestBody']);
    expect(body).toContain('SetMemberClubsRequest');
  });

  it('字段级授权写清楚了：越权字段整请求失败并列在 errors 里', () => {
    const description = String(spec.paths['/auth/me']?.['patch']?.['description']);
    expect(description).toContain('profile:academic');
    expect(description).toContain('profile:contact');
    expect(description).toContain('403');
    expect(description).toContain('pointer');
  });
});

describe('契约：默认值与新鲜度上界的唯一出处', () => {
  interface Shape {
    properties?: Record<string, Record<string, unknown>>;
    description?: string;
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('Config 字段描述里写的默认值必须等于机器可读的 default', () => {
    const offenders: string[] = [];
    for (const section of ['server', 'auth', 'accounts', 'ingest', 'roster', 'scoreboards', 'stats', 'announcements', 'stream', 'rate_limit', 'judges', 'log']) {
      const name = section.replace(/(^|_)([a-z])/g, (_m, _p, c: string) => c.toUpperCase()) + 'Config';
      const schema = spec.components.schemas[name] as Shape | undefined;
      if (!schema?.properties) continue;
      for (const [field, def] of Object.entries(schema.properties)) {
        const stated = /默认\s*`([^`]+)`/.exec(String(def['description'] ?? ''))?.[1];
        if (stated === undefined) continue;
        const actual = def['default'];
        if (String(actual) !== stated) offenders.push(`${name}.${field}: 描述=${stated} default=${String(actual)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('榜单与统计端点上的 x-freshness-bound 等于 Config 里的默认上界', () => {
    const boundOf = (name: string, field: string): string =>
      String((schemaOf(name).properties?.[field] as Record<string, unknown>)?.['default']);
    expect(boundOf('ScoreboardsConfig', 'freshness_bound')).toBe('PT15M');
    expect(boundOf('StatsConfig', 'freshness_bound')).toBe('PT1H');
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const tag = (op.tags ?? [])[0];
        const bound = op['x-freshness-bound'];
        if (bound === undefined) continue;
        if (tag === 'scoreboards') expect([path, method, bound]).toEqual([path, method, 'PT15M']);
        if (tag === 'stats') expect([path, method, bound]).toEqual([path, method, 'PT1H']);
        if (tag === 'ingest') expect([path, method, bound]).toEqual([path, method, 'PT5M']);
      }
    }
  });

  it('原始 OJ 数据的可见滞后是 5 分钟，聚合才是 15 分钟/1 小时', () => {
    const raw = ['/oj/submissions', '/oj/rating-history', '/oj/problems'];
    for (const path of raw) {
      expect([path, spec.paths[path]?.['get']?.['x-freshness-bound']]).toEqual([path, 'PT5M']);
    }
    expect(spec.paths['/oj/handles/{handle_id}/stats']?.['get']?.['x-freshness-bound']).toBe('PT15M');
  });
});

describe('契约：按社团筛选的三种问法', () => {
  const paramsOf = (path: string): Array<Record<string, any>> =>
    (spec.paths[path]?.['get']?.parameters ?? []).map((p) => deref<Record<string, any>>(p));

  it('成员与账号列表都支持 club 与 club_match', () => {
    for (const path of ['/members', '/accounts']) {
      const names = paramsOf(path).map((p) => p.name);
      expect([path, names.includes('club'), names.includes('club_match')]).toEqual([path, true, true]);
    }
  });

  it('club_match 取 any/all/none，默认 any，且不是自由文本', () => {
    for (const path of ['/members', '/accounts']) {
      const param = paramsOf(path).find((p) => p.name === 'club_match') ?? {};
      expect([path, param.schema?.enum, param.schema?.default]).toEqual([path, ['any', 'all', 'none'], 'any']);
    }
  });

  it('club 只接受真实的社团代号，不再用 none 兼职表达排除', () => {
    for (const path of ['/members', '/accounts']) {
      const param = paramsOf(path).find((p) => p.name === 'club') ?? {};
      const items = param.schema?.items ?? {};
      expect([path, items.enum?.includes('none') ?? false]).toEqual([path, false]);
    }
  });
});

describe('契约：文档完备性（STYLE 硬规则）', () => {
  it('每个 object 类 schema 至少有一个 schema 级 examples', () => {
    const missing = Object.entries(spec.components.schemas)
      .filter(([, schema]) => {
        const sc = schema as Record<string, unknown>;
        return sc['type'] === 'object' && !Array.isArray(sc['examples']);
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('每个 operation 都有 operationId、summary、description 与 responses', () => {
    const bad: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        for (const field of ['operationId', 'summary', 'description', 'responses']) {
          if (!op[field]) bad.push(`${method.toUpperCase()} ${path} 缺 ${field}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个写操作都标了 x-idempotent，每个操作都声明了 security', () => {
    const bad: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        if (!op['security']) bad.push(`${method.toUpperCase()} ${path} 缺 security`);
        if (['post', 'put', 'patch', 'delete'].includes(method) && op['x-idempotent'] === undefined) {
          bad.push(`${method.toUpperCase()} ${path} 缺 x-idempotent`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('文档与契约对账：README 里写死的数字', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const operationCount = Object.values(spec.paths).reduce(
    (n, item) => n + Object.keys(item as Record<string, unknown>).filter((m) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length,
    0,
  );

  it('README 声明的模块数与 operation 数和契约一致', () => {
    const claimed = /(\d+) 个模块（(\d+) 条路径、(\d+) 个 operation）/.exec(readme);
    expect(claimed?.[1]).toBe('20');
    expect(claimed?.[2]).toBe(String(Object.keys(spec.paths).length));
    expect(claimed?.[3]).toBe(String(operationCount));
  });

  it('README 声明的 schema 数与契约一致', () => {
    const claimed = /(\d+) 个 schema（bundle 去重后口径/.exec(readme);
    expect(claimed?.[1]).toBe(String(Object.keys(spec.components.schemas).length));
  });

  it('README 声明的 scope 数与契约一致（§5 表格由既有测试约束）', () => {
    const scopes = (spec as unknown as { 'x-scopes'?: string[] })['x-scopes'] ?? [];
    expect(scopes.length).toBe(35);
  });
});

describe('契约自洽性：条件请求、异步任务与扩展字段', () => {
  interface AnyOp {
    operationId?: string;
    parameters?: Array<Record<string, unknown>>;
    responses?: Record<string, { headers?: Record<string, unknown> }>;
    security?: unknown[];
    'x-consistency'?: string;
    'x-freshness-bound'?: string;
    'x-cacheable'?: boolean;
    description?: string;
  }
  const names = (list: Array<Record<string, unknown>> | undefined): string[] =>
    (list ?? []).map((entry) => String(entry['$ref'] ?? entry['name'] ?? ''));
  const responsesOf = (op: AnyOp): Array<[string, { headers?: Record<string, unknown> }]> =>
    Object.entries(op.responses ?? {});
  const flatten = (op: AnyOp): Array<[string, string, AnyOp]> =>
    [];

  it('声明了 304 的读操作必须同时给出 ETag 与 If-None-Match', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        if (method !== 'get') continue;
        const op = raw;
        const codes = responsesOf(op).map(([code]) => code);
        if (!codes.includes('304')) continue;
        const ok = op.responses?.['200']?.headers ?? {};
        const hasEtag = Object.values(ok).some((h) => String((h as Record<string, unknown>)['$ref'] ?? '').includes('ETag'));
        const hasIfNoneMatch = names(op.parameters).some((n) => n.includes('IfNoneMatch'));
        if (!hasEtag || !hasIfNoneMatch) {
          offenders.push(`${method.toUpperCase()} ${path}: ETag=${hasEtag} If-None-Match=${hasIfNoneMatch}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('缓存标记与条件请求不混用：不返回 ETag 的操作不得声明 304', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        const op = raw;
        const codes = responsesOf(op).map(([code]) => code);
        if (!codes.includes('304')) continue;
        const ok = op.responses?.['200']?.headers ?? {};
        const hasEtag = Object.values(ok).some((h) => String((h as Record<string, unknown>)['$ref'] ?? '').includes('ETag'));
        if (!hasEtag) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('所有 202 都给出 Location，并配 Retry-After 供轮询', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        const accepted = raw.responses?.['202'];
        if (!accepted) continue;
        seen += 1;
        const headers = Object.values(accepted.headers ?? {});
        const has = (needle: string): boolean =>
          headers.some((h) => String((h as Record<string, unknown>)['$ref'] ?? h ?? '').includes(needle));
        if (!has('Location') || !has('RetryAfter')) {
          offenders.push(`${method.toUpperCase()} ${path}: Location=${has('Location')} Retry-After=${has('RetryAfter')}`);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it('eventual ⟺ 有 x-freshness-bound，且取值是合法 ISO-8601 时长', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        const consistency = raw['x-consistency'];
        const bound = raw['x-freshness-bound'];
        if (consistency === 'eventual' && bound === undefined) offenders.push(`${method.toUpperCase()} ${path} 缺 bound`);
        if (consistency === 'strong' && bound !== undefined) offenders.push(`${method.toUpperCase()} ${path} strong 却带 bound`);
        if (bound !== undefined && !/^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/.test(bound)) {
          offenders.push(`${method.toUpperCase()} ${path} bound 不是合法时长：${bound}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('空名或重复导致的重命名不会混进契约（无 Xxx-2）', () => {
    const renamed = Object.keys(spec.components.schemas).filter((name) => /-\d+$/.test(name));
    expect(renamed).toEqual([]);
  });

  it('幂等键参数必须必填且复用共享组件', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
        if (idempotencyExempt().has(path)) continue;
        const param = (raw.parameters ?? []).find((p) => String((p as Record<string, unknown>)['$ref'] ?? p?.['name'] ?? '').includes('IdempotencyKey'));
        if (!param) {
          offenders.push(`${method.toUpperCase()} ${path} 缺 Idempotency-Key`);
          continue;
        }
        if (!param['$ref']) offenders.push(`${method.toUpperCase()} ${path} 未复用共享参数组件`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('每个 ProblemCode 都在某个 4xx/5xx 响应或描述里被用到', () => {
    const codes = (spec.components.schemas['ProblemCode'] as { enum?: string[] }).enum ?? [];
    const haystack: string[] = [
      JSON.stringify(spec.components.responses ?? {}),
      JSON.stringify(spec.components.schemas['ProblemCode'] ?? {}),
    ];
    for (const item of Object.values(spec.paths)) {
      for (const [method, raw] of Object.entries(item as Record<string, AnyOp>)) {
        void method;
        haystack.push(JSON.stringify(raw.responses ?? {}));
        haystack.push(String(raw.description ?? ''));
      }
    }
    const text = haystack.join('\n');
    const unused = codes.filter((code) => !text.includes(code));
    expect(unused).toEqual([]);
  });

  it('可写档案结构里没有任何只读字段，只读字段只在响应结构里', () => {
    const write = spec.components.schemas['PrincipalProfileWrite'] as { properties?: Record<string, Record<string, unknown>> };
    const read = spec.components.schemas['PrincipalProfile'] as { properties?: Record<string, Record<string, unknown>> };
    const writeFields = Object.keys(write.properties ?? {});
    const readOnlyFields = Object.entries(read.properties ?? {})
      .filter(([, def]) => def['readOnly'] === true)
      .map(([name]) => name);
    expect(writeFields.some((field) => readOnlyFields.includes(field))).toBe(false);
    expect(readOnlyFields.sort()).toEqual(['club_memberships', 'grade', 'masked_fields']);
    const readFields = Object.keys(read.properties ?? {});
    expect(readFields.filter((field) => !readOnlyFields.includes(field)).sort()).toEqual(writeFields.sort());
  });
});

describe('枚举对账与 fixtures 新鲜度', () => {
  const enumOf = (name: string): string[] =>
    ((spec.components.schemas[name] as { enum?: string[] }).enum ?? []).slice().sort();

  it('手写联合的运行期镜像与契约枚举集合相等', () => {
    expect([...KNOWN_PROBLEM_CODES].sort()).toEqual(enumOf('ProblemCode'));
    expect([...STREAM_TOPICS].sort()).toEqual(enumOf('StreamTopic'));
    expect([...CLUB_CODES].sort()).toEqual(enumOf('ClubCode'));
  });

  it('签入的 fixtures 与当前契约生成结果一致（防止快照过期）', () => {
    const generatedAt = join(tmpdir(), `fixtures-${randomUUID()}.ts`);
    runSync(process.execPath, [join(repoRoot, 'scripts/generate-fixtures.mjs'), generatedAt], {
      cwd: repoRoot,
      env: process.env,
    });
    const committed = readFileSync(new URL('./fixtures.ts', import.meta.url), 'utf8');
    const fresh = readFileSync(generatedAt, 'utf8');
    rmSync(generatedAt, { force: true });
    expect(fresh, 'fixtures.ts 已过期：在仓库根目录运行 `npm run fixtures`').toBe(committed);
  });

  it('fixtures 覆盖的 schema 都在契约里存在，且每个都真的被校验过', () => {
    const unknown = Object.keys(fixtures).filter((name) => !(name in spec.components.schemas));
    expect(unknown).toEqual([]);
    // 反向：桥覆盖了哪些 schema，作为"类型↔契约"护栏的实际范围写进断言，
    // 缩小时必须显式改这里，避免静默退化成只覆盖少数几个。
    expect(Object.keys(fixtures).sort()).toEqual([
      'Announcement',
      'AuditLog',
      'ChangeFeed',
      'Channel',
      'Config',
      'CrawlerConfig',
      'Delivery',
      'IngestRatingRecordItem',
      'IngestResult',
      'Job',
      'Member',
      'OjHandle',
      'OjRatingRecord',
      'OjSubmission',
      'PagedMember',
      'Principal',
      'Problem',
      'Quota',
      'QuotaClaim',
      'RosterExport',
      'Scoreboard',
      'ScoreboardEntry',
      'StatsTrendResponse',
      'Team',
    ]);
  });
});

describe('契约完整性：源文件里的 schema 一个都不能被丢弃', () => {
  it('源文件定义的 schema 与 bundle 里的 schema 完全一致', () => {
    const defined = new Set<string>();
    for (const file of readdirSync(fileURLToPath(new URL('../../doc/api/components/schemas', import.meta.url)))) {
      const text = readFileSync(
        fileURLToPath(new URL(`../../doc/api/components/schemas/${file}`, import.meta.url)),
        'utf8',
      );
      for (const match of text.matchAll(/^    ([A-Za-z][A-Za-z0-9]*):$/gm)) {
        defined.add(match[1] as string);
      }
    }
    const bundled = Object.keys(spec.components.schemas);
    const dropped = [...defined].filter((name) => !bundled.includes(name)).sort();
    const extra = bundled.filter((name) => !defined.has(name)).sort();
    expect({ dropped, extra }).toEqual({ dropped: [], extra: [] });
    expect(defined.size).toBeGreaterThan(200);
  });

  it('bundle 里没有重命名产生的 Xxx-2', () => {
    expect(Object.keys(spec.components.schemas).filter((n) => /-\d+$/.test(n))).toEqual([]);
  });
});

describe('SSE 事件与缓存失效的对账', () => {
  it('契约里的 StreamResourceKind 与客户端的映射表键一一对应', () => {
    const kinds = (
      spec.components.schemas['StreamResourceKind'] as { enum?: string[] }
    ).enum ?? [];
    expect(Object.keys(STREAM_KIND_TO_RESOURCES).sort()).toEqual([...kinds].sort());
  });

  it('映射到的缓存集合名都是客户端真实使用的资源标签', () => {
    const tags = new Set<string>();
    const dir = fileURLToPath(new URL('../src/resources', import.meta.url));
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const match of text.matchAll(/resource: '([a-z-]+)'/g)) tags.add(match[1] as string);
    }
    const unknown = Object.values(STREAM_KIND_TO_RESOURCES)
      .flat()
      .filter((name) => !tags.has(name));
    expect(unknown).toEqual([]);
  });
});

describe('契约：PII 读权限分级', () => {
  interface Shape { properties?: Record<string, Record<string, unknown>>; enum?: string[] }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('member:read_pii 已登记在 x-scopes 里', () => {
    expect(((spec as unknown as { 'x-scopes'?: string[] })['x-scopes'] ?? [])).toContain('member:read_pii');
  });

  it('档案给出脱敏标记，且它是只读字段', () => {
    const masked = schemaOf('PrincipalProfile').properties?.['masked_fields'];
    expect(masked).toBeTruthy();
    expect(masked?.['readOnly']).toBe(true);
    expect(String(masked?.['description'])).toContain('脱敏');
  });

  it('队伍详情同样能表达脱敏', () => {
    expect(schemaOf('TeamMember').properties?.['masked_fields']).toBeTruthy();
  });

  it('默认 user 模板不含 PII 读取，管理员模板含', () => {
    const example = (spec.components.schemas['AccountsConfig'] as { examples?: Array<Record<string, any>> }).examples?.[0] ?? {};
    const templates = example['templates'] ?? {};
    expect(templates['user']?.scopes ?? []).not.toContain('member:read_pii');
    expect(templates['manager']?.scopes ?? []).toContain('member:read_pii');
  });

  it('读 PII 的四个入口都写明了脱敏规则', () => {
    const places: Array<[string, string]> = [
      ['/members', 'get'], ['/members/{member_id}', 'get'],
      ['/accounts', 'get'], ['/teams/{team_id}', 'get'],
    ];
    for (const [path, method] of places) {
      const description = String(spec.paths[path]?.[method]?.['description'] ?? '');
      expect([path, description.includes('masked_fields')]).toEqual([path, true]);
    }
  });
});

describe('契约：幂等豁免与赛季的唯一出处', () => {
  interface Shape {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('豁免清单由 x-idempotency-exempt 驱动，且只有那 5 个端点', () => {
    expect([...idempotencyExempt()].sort()).toEqual(
      ['/auth/login', '/auth/me/password', '/auth/logout', '/auth/refresh', '/stream/tokens'].sort(),
    );
  });

  it('被标记豁免的端点不得声明 Idempotency-Key 参数', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        if (op['x-idempotency-exempt'] !== true) continue;
        const refs = JSON.stringify(op.parameters ?? []);
        if (refs.includes('IdempotencyKey')) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('未标记豁免的写操作必须带 x-idempotent', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, any>)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
        if (op['x-idempotency-exempt'] === true) continue;
        if (op['x-idempotent'] === undefined) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('当前赛季在 Meta 与 Config 里都能查到，创建队伍会回落到它', () => {
    expect(schemaOf('Meta').required ?? []).toContain('current_season');
    expect(schemaOf('RosterConfig').properties?.['current_season']).toBeTruthy();
    const teamsCreate = String(spec.paths['/teams']?.['post']?.['description'] ?? '');
    expect(teamsCreate).toContain('current_season');
  });
});

describe('契约：名额生命周期', () => {
  interface Shape { enum?: string[]; description?: string }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('认领状态机把 released 与 expired 都变成可达状态', () => {
    expect(schemaOf('QuotaClaimStatus').enum).toEqual([
      'pending', 'approved', 'rejected', 'withdrawn', 'expired', 'released',
    ]);
    expect(String(schemaOf('QuotaClaimStatus').description)).toContain('released');
  });

  it('释放已批准认领、队员确认、归档各有独立端点', () => {
    const put = (p: string): Record<string, any> => spec.paths[p]?.['post'] ?? {};
    expect(put('/quotas/{quota_id}/claims/{claim_id}/release')['operationId']).toBe('releaseQuotaClaim');
    expect(put('/quotas/{quota_id}/claims/{claim_id}/confirm')['operationId']).toBe('confirmQuotaClaimMember');
    expect(put('/quotas/{quota_id}/archive')['operationId']).toBe('archiveQuota');
    // 释放需要管理员，队员确认是自助
    expect(String(put('/quotas/{quota_id}/claims/{claim_id}/release')['description'])).toContain('quota:manage');
    expect(String(put('/quotas/{quota_id}/claims/{claim_id}/confirm')['description'])).toContain('quota:claim');
  });

  it('定案不再把候补静默作废：候补置 expired，非候补 409', () => {
    const description = String(spec.paths['/quotas/{quota_id}/finalize']?.['post']?.['description'] ?? '');
    expect(description).toContain('expired');
    expect(description).toContain('409');
    expect(description).toContain('waitlist_position');
  });
});

describe('契约：保留期只有一个出处', () => {
  interface Shape { properties?: Record<string, Record<string, unknown>> }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('Config.retention 给出各数据的默认保留期', () => {
    const retention = schemaOf('RetentionConfig').properties ?? {};
    expect(retention['submissions']?.['default']).toBe('P2Y');
    expect(retention['sync_changes']?.['default']).toBe('P30D');
    expect(retention['jobs']?.['default']).toBe('P30D');
    expect(retention['audit_logs']?.['default']).toBe('P2Y');
    expect(schemaOf('Config').properties?.['retention']).toBeTruthy();
  });

  it('采集侧的保留期字段只是引用 Config.retention，不再自报另一个默认值', () => {
    const ingest = schemaOf('IngestConfig').properties?.['submissions_retention'] ?? {};
    expect(String(ingest['description'])).toContain('Config.retention.submissions');
    const crawlerRetention = (schemaOf('CrawlerConfig').properties?.['retention'] ?? {}) as Shape;
    const submissions = crawlerRetention.properties?.['submissions'] ?? {};
    expect(String(submissions['description'])).toContain('Config.retention.submissions');
    // 采集保留期的旧写法（1095 天）必须消失；注意 `clock_skew_past` 用 P1095D 是另一回事
    expect(JSON.stringify(submissions)).not.toContain('P1095D');
    expect(String(ingest['description'] ?? '')).not.toContain('P1095D');
  });
});

describe('文档与契约对账：STYLE 的 scope 清单', () => {
  it('STYLE 列出的资源前缀与 x-scopes 实际使用的前缀一致', () => {
    const style = readFileSync(
      fileURLToPath(new URL('../../doc/api/STYLE.md', import.meta.url)),
      'utf8',
    );
    const section = style.slice(style.indexOf('**只有这些资源前缀**'), style.indexOf('动作只允许'));
    const listed = new Set(Array.from(section.matchAll(/`([a-z_]+)`/g), (m) => m[1] as string));
    const scopes = (spec as unknown as { 'x-scopes'?: string[] })['x-scopes'] ?? [];
    const actual = new Set(scopes.map((scope) => scope.split(':')[0] as string));
    expect([...listed].sort()).toEqual([...actual].sort());
  });
});

describe('契约：能力开关可发现', () => {
  interface Shape { required?: string[]; properties?: Record<string, Record<string, unknown>> }
  const schemaOf = (name: string): Shape => spec.components.schemas[name] as Shape;

  it('幂等窗口与 SSE 并发上限由 /meta 公布，不再靠文档里写死', () => {
    const caps = schemaOf('Capabilities');
    expect(caps.required ?? []).toContain('idempotency_window');
    expect(caps.required ?? []).toContain('max_stream_connections');
    expect(caps.properties?.['idempotency_window']?.['examples']).toEqual(['PT24H']);
  });

  it('README 与 stream 的描述都指向这两个能力字段', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    expect(readme).toContain('capabilities.idempotency_window');
    const stream = String(spec.paths['/stream/events']?.['get']?.['description'] ?? '');
    expect(stream).toContain('capabilities.max_stream_connections');
  });
});

