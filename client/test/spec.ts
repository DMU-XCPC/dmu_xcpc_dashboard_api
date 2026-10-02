/**
 * 契约测试的共享工具：加载 bundle、解析内部 `$ref`、按 schema 校验数据。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const BUNDLE_JSON = fileURLToPath(new URL('../../build/openapi.bundled.json', import.meta.url));
export const README_PATH = fileURLToPath(new URL('../../doc/api/README.md', import.meta.url));

export interface Operation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: unknown[];
  'x-idempotent'?: boolean;
  'x-consistency'?: string;
  'x-freshness-bound'?: string;
  deprecated?: boolean;
}

export interface Spec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description?: string }>;
  security?: unknown[];
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
    responses: Record<string, unknown>;
    parameters: Record<string, unknown>;
  };
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export function loadSpec(): Spec {
  try {
    return JSON.parse(readFileSync(BUNDLE_JSON, 'utf8')) as Spec;
  } catch (error) {
    throw new Error(
      `缺少或无法解析 ${BUNDLE_JSON}：先运行 \`npm run api:build\`（仓库根目录）。原始错误：${String(error)}`,
    );
  }
}

/** 展开 bundle 内部 `$ref`（bundle 之后不应再有外部引用）。 */
export function createDeref(spec: Spec): <T = Record<string, unknown>>(node: unknown, depth?: number) => T {
  const deref = <T = Record<string, unknown>>(node: unknown, depth = 0): T => {
    if (depth > 20) throw new Error('引用嵌套过深');
    if (node && typeof node === 'object' && '$ref' in (node as Record<string, unknown>)) {
      const ref = String((node as Record<string, unknown>)['$ref']);
      if (!ref.startsWith('#/')) throw new Error(`bundle 中仍有外部引用：${ref}`);
      let current: unknown = spec;
      for (const segment of ref.slice(2).split('/')) {
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
        current = (current as Record<string, unknown>)[key];
      }
      return deref<T>(current, depth + 1);
    }
    return node as T;
  };
  return deref;
}

/** 用 Ajv（JSON Schema 2020-12）按 `components.schemas` 校验数据。 */
export function createValidator(spec: Spec): (schemaName: string, value: unknown) => { ok: boolean; errors: string } {
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, validateFormats: true });
  addFormats(ajv);
  ajv.addSchema(spec as unknown as Record<string, unknown>, 'spec');
  const cache = new Map<string, ValidateFunction>();
  return (schemaName, value) => {
    let compiled = cache.get(schemaName);
    if (!compiled) {
      const found = ajv.getSchema(`spec#/components/schemas/${schemaName}`) as ValidateFunction | undefined;
      if (!found) throw new Error(`schema ${schemaName} 不存在`);
      compiled = found;
      cache.set(schemaName, compiled);
    }
    const ok = compiled(value) as boolean;
    return { ok, errors: JSON.stringify(compiled.errors ?? []) };
  };
}

/** 收集一个 operation 的路径列表（含 path item 级共享参数）。 */
export function operationsOf(spec: Spec): Array<{ path: string; method: string; op: Operation }> {
  const list: Array<{ path: string; method: string; op: Operation }> = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if ((HTTP_METHODS as readonly string[]).includes(method)) list.push({ path, method, op });
    }
  }
  return list;
}
