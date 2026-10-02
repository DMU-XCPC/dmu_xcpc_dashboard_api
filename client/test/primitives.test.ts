import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildUrl, serializeQuery, substitutePath } from '../src/http/query.js';
import { computeBackoffDelay, DEFAULT_RETRY_POLICY, isIdempotentMethod, resolveRetryPolicy } from '../src/http/retry.js';
import { normalizeProblem, problemCodeForStatus } from '../src/errors.js';

describe('查询串序列化', () => {
  it('数组使用重复键（与 OpenAPI explode: true 一致）', () => {
    expect(serializeQuery({ judge: ['codeforces', 'atcoder'], page: 1 })).toBe('?judge=codeforces&judge=atcoder&page=1');
  });

  it('跳过 null/undefined，布尔转字面量，Date 转 UTC ISO-8601', () => {
    const query = { a: undefined, b: null, c: true, d: false, when: new Date('2024-05-06T07:08:09.123Z') };
    expect(serializeQuery(query)).toBe('?c=true&d=false&when=2024-05-06T07%3A08%3A09.123Z');
  });

  it('空对象与 undefined 产生空串', () => {
    expect(serializeQuery({})).toBe('');
    expect(serializeQuery(undefined)).toBe('');
  });

  it('buildUrl 归一化斜杠', () => {
    expect(buildUrl('https://api.test/api/v1/', '/members', { page: 2 })).toBe('https://api.test/api/v1/members?page=2');
    expect(buildUrl('https://api.test/api/v1', 'members')).toBe('https://api.test/api/v1/members');
  });

  it('substitutePath 做 URL 编码并在缺参数时抛错', () => {
    expect(substitutePath('/accounts/{account_id}/scopes', { account_id: 'acc_1' })).toBe('/accounts/acc_1/scopes');
    expect(substitutePath('/oj-handles/{handle_id}', { handle_id: 'a/b' })).toBe('/oj-handles/a%2Fb');
    expect(() => substitutePath('/accounts/{account_id}', {})).toThrowError(/缺少参数/);
  });
});

describe('重试策略', () => {
  it('默认尊重 Retry-After 且只对幂等方法重试', () => {
    const policy = resolveRetryPolicy(undefined);
    expect(policy).toEqual(DEFAULT_RETRY_POLICY);
    expect(isIdempotentMethod('GET')).toBe(true);
    expect(isIdempotentMethod('PUT')).toBe(true);
    expect(isIdempotentMethod('DELETE')).toBe(true);
    expect(isIdempotentMethod('POST')).toBe(false);
    expect(isIdempotentMethod('PATCH')).toBe(false);
  });

  it('retry=false 关闭重试', () => {
    expect(resolveRetryPolicy(false).maxAttempts).toBe(1);
  });

  it('Retry-After 优先于指数退避，并受 maxDelayMs 约束', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 100, maxDelayMs: 5000, jitter: 'none' });
    expect(computeBackoffDelay(1, policy, 3)).toBe(3000);
    expect(computeBackoffDelay(1, policy, 600)).toBe(5000);
  });

  it('指数退避带抖动且不超过上限', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 100, maxDelayMs: 1000, jitter: 'none' });
    expect(computeBackoffDelay(1, policy)).toBe(100);
    expect(computeBackoffDelay(2, policy)).toBe(200);
    expect(computeBackoffDelay(5, policy)).toBe(1000);

    const jittered = resolveRetryPolicy({ baseDelayMs: 100, maxDelayMs: 10_000, jitter: 'full' });
    const values = [0, 0.5, 1].map(() => computeBackoffDelay(1, jittered, undefined, () => 0.5));
    expect(values.every((value) => value >= 0 && value <= 100)).toBe(true);
  });
});

describe('问题（RFC 7807）规范化', () => {
  it('保留合法 problem 的 code 与扩展字段', () => {
    const problem = normalizeProblem(
      { type: 'https://x/errors/quota_exceeded', title: 'Quota', status: 409, code: 'quota_exceeded', detail: '满了' },
      409,
      'Conflict',
    );
    expect(problem.code).toBe('quota_exceeded');
    expect(problem.detail).toBe('满了');
  });

  it('非 problem 响应体按状态码兜底，并截断过长文本', () => {
    const problem = normalizeProblem('x'.repeat(1000), 502, 'Bad Gateway');
    expect(problem.code).toBe('internal_error');
    expect(problem.detail?.length).toBeLessThan(600);
    expect(problem.type).toBe('about:blank');
  });

  it('状态码映射符合契约', () => {
    expect(problemCodeForStatus(401)).toBe('unauthenticated');
    expect(problemCodeForStatus(422)).toBe('validation_failed');
    expect(problemCodeForStatus(503)).toBe('service_unavailable');
    expect(problemCodeForStatus(599)).toBe('internal_error');
  });
});

describe('发布面：package.json 的入口都存在', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    main: string; module: string; types: string;
    exports: Record<string, { import: { types: string; default: string }; require: { types: string; default: string } }>;
    files: string[];
  };

  it('main/module/types 与 exports 指向的文件都已构建出来', () => {
    const paths = [
      pkg.main, pkg.module, pkg.types,
      pkg.exports['.']?.import.types, pkg.exports['.']?.import.default,
      pkg.exports['.']?.require.types, pkg.exports['.']?.require.default,
    ];
    expect(paths.every((rel) => existsSync(new URL(`../${rel}`, import.meta.url)))).toBe(true);
  });

  it('CJS 与 ESM 各用各自的类型声明，避免双包类型错配', () => {
    expect(pkg.exports['.']?.require.types).toBe('./dist/index.d.cts');
    expect(pkg.exports['.']?.import.types).toBe('./dist/index.d.ts');
  });

  it('发布内容只含 dist 与 README', () => {
    expect(pkg.files).toEqual(['dist', 'README.md']);
  });
});

