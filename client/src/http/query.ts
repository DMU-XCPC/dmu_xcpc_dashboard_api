/** 查询串与路径模板工具。 */

export type QueryPrimitive = string | number | boolean | Date | null | undefined;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];
export type QueryParams = Record<string, QueryValue>;

function formatPrimitive(value: Exclude<QueryPrimitive, null | undefined>): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function isPrimitiveArray(value: QueryValue): value is readonly QueryPrimitive[] {
  return Array.isArray(value);
}

/**
 * 序列化为查询串。
 *
 * - `undefined` / `null` 被跳过（不发空参数）；
 * - 数组使用**重复键**（`?judge=a&judge=b`），与 OpenAPI 默认的
 *   `explode: true` 一致；
 * - `Date` 序列化为 UTC ISO-8601。
 */
export function serializeQuery(params?: QueryParams): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    const values: readonly QueryPrimitive[] = isPrimitiveArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(formatPrimitive(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** 拼接 baseUrl、路径与查询串，保证两者之间恰好一个 `/`。 */
export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}${serializeQuery(query)}`;
}

/**
 * 替换路径模板中的 `{name}` 占位符（值会被 URL 编码）。
 * 缺少参数时立即抛错——这属于调用方 bug，不应发出请求。
 */
export function substitutePath(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`路径模板 ${template} 缺少参数 ${name}`);
    return encodeURIComponent(String(value));
  });
}
