#!/usr/bin/env node
/**
 * 从 `build/openapi.bundled.json` 的 `components.schemas` 生成
 * `client/test/generated/schema-types.ts`。
 *
 * 生成文件里的每个类型与契约 schema **同名同形**，作为"契约 ↔ 客户端手写类型"
 * 的编译期对账基准：`client/test/type-contract.test.ts` 会对客户端导出的同名类型
 * 逐一做双向可赋值校验，任何一侧漂移都会让 `tsc` / `vitest` 失败。
 *
 * 支持的特性（详见 README / 测试报告）：
 *   - object / properties / required → 对象字面量与 `?:`
 *   - `type: [x, 'null']` 与 `oneOf` 里的 `{ type: 'null' }` → `| null`
 *   - allOf（交叉）、oneOf / anyOf（联合）、enum（字面量联合）、const（字面量）
 *   - array + items、additionalProperties（true / schema / false）
 *   - `$ref`（bundle 内 `#/components/schemas/X`）、无 `type` 时的推断
 *
 * 用法：先 `npm run api:build`，再 `node scripts/generate-types.mjs [输出路径]`。
 * 缺少 bundle 或存在无法解析的 `$ref` 时会给出可读错误并以非零码退出。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUNDLE = fileURLToPath(new URL('../build/openapi.bundled.json', import.meta.url));
const DEFAULT_OUT = fileURLToPath(new URL('../client/test/generated/schema-types.ts', import.meta.url));

const bundlePath = process.env.OPENAPI_BUNDLE ?? DEFAULT_BUNDLE;
const outPath = process.argv[2] ?? DEFAULT_OUT;

if (!existsSync(bundlePath)) {
  console.error(
    `[generate-types] 找不到 OpenAPI bundle：${bundlePath}\n` +
      '请先运行 `npm run api:build`（lint + bundle）再重试。',
  );
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(readFileSync(bundlePath, 'utf8'));
} catch (error) {
  console.error(`[generate-types] 无法解析 ${bundlePath}：${error.message}`);
  process.exit(1);
}

const schemas = spec?.components?.schemas;
if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
  console.error(
    `[generate-types] ${bundlePath} 里没有 components.schemas；bundle 可能不完整，请重跑 \`npm run api:build\`。`,
  );
  process.exit(1);
}

const schemaNames = Object.keys(schemas).sort();

/* ------------------------------------------------------------ 类型表达式 */

/** 字面量 → TS 字面量类型。 */
function literal(value) {
  if (value === null) return { kind: 'prim', name: 'null' };
  if (typeof value === 'string') return { kind: 'literal', text: quote(value) };
  if (typeof value === 'number') return { kind: 'literal', text: Object.is(value, -0) ? '0' : String(value) };
  if (typeof value === 'boolean') return { kind: 'literal', text: value ? 'true' : 'false' };
  // JSON 字面量里不该出现别的类型；保守退化为 unknown。
  return { kind: 'prim', name: 'unknown' };
}

function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * 解析一个 schema 节点为类型 AST。
 * @param {any} schema
 * @param {string} path 仅用于错误信息
 */
function typeOf(schema, path) {
  if (schema === true || schema === undefined) return { kind: 'prim', name: 'unknown' };
  if (schema === false) return { kind: 'prim', name: 'never' };
  if (typeof schema !== 'object') return { kind: 'prim', name: 'unknown' };

  // $ref（可能与其他类型约束并存 → 取交叉）
  if (typeof schema.$ref === 'string') {
    const target = refTarget(schema.$ref, path);
    const refNode = { kind: 'ref', name: target };
    const rest = stripKeys(schema, ['$ref']);
    if (!hasTypeConstraints(rest)) return refNode;
    return intersect([refNode, typeOf(rest, path)]);
  }

  // 顶层联合
  const unionBranches = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(unionBranches)) {
    const base = stripKeys(schema, ['oneOf', 'anyOf']);
    const members = unionBranches.map((branch, i) => typeOf(branch, `${path}.oneOf[${i}]`));
    if (hasTypeConstraints(base)) members.push(typeOf(base, path));
    return union(members);
  }

  // 顶层交叉
  if (Array.isArray(schema.allOf)) {
    const base = stripKeys(schema, ['allOf']);
    const members = schema.allOf.map((branch, i) => typeOf(branch, `${path}.allOf[${i}]`));
    if (hasTypeConstraints(base)) members.push(typeOf(base, path));
    return intersect(members);
  }

  // const
  if (schema.const !== undefined) return literal(schema.const);

  // enum：字面量联合；`type: [..., 'null']` 时补上 `null`
  if (Array.isArray(schema.enum)) {
    const members = schema.enum.map(literal);
    const typeList = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
    if (typeList.includes('null') && !schema.enum.includes(null)) members.push({ kind: 'prim', name: 'null' });
    return union(members);
  }

  // type 为数组（例如 ["integer","null"]）→ 逐项联合
  if (Array.isArray(schema.type)) {
    const types = schema.type;
    const withoutType = stripKeys(schema, ['type']);
    return union(types.map((t) => typeOf({ ...withoutType, type: t }, `${path}<${t}>`)));
  }

  switch (schema.type) {
    case 'string':
      return { kind: 'prim', name: 'string' };
    case 'integer':
    case 'number':
      return { kind: 'prim', name: 'number' };
    case 'boolean':
      return { kind: 'prim', name: 'boolean' };
    case 'null':
      return { kind: 'prim', name: 'null' };
    case 'array':
      return { kind: 'array', of: typeOf(schema.items, `${path}.items`) };
    case 'object':
      return objectOf(schema, path);
    case undefined:
      return infer(schema, path);
    default:
      throw new Error(`[generate-types] 不认识的 type ${JSON.stringify(schema.type)}（${path}）`);
  }
}

/** 没有显式 `type` 时，按约束关键字推断。 */
function infer(schema, path) {
  const keys = Object.keys(schema);
  if (
    keys.some((k) => ['properties', 'required', 'additionalProperties', 'patternProperties', 'minProperties', 'maxProperties'].includes(k))
  ) {
    return objectOf({ type: 'object', ...schema }, path);
  }
  if (keys.includes('items') || keys.includes('prefixItems')) {
    return { kind: 'array', of: typeOf(schema.items ?? schema.prefixItems, `${path}.items`) };
  }
  if (keys.some((k) => ['pattern', 'format', 'minLength', 'maxLength', 'contentMediaType', 'contentEncoding'].includes(k))) {
    return { kind: 'prim', name: 'string' };
  }
  if (keys.some((k) => ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].includes(k))) {
    return { kind: 'prim', name: 'number' };
  }
  if (keys.includes('const')) return literal(schema.const);
  if (keys.includes('enum')) return union(schema.enum.map(literal));
  if (keys.includes('not')) return { kind: 'prim', name: 'unknown' };
  // `{}` / 只有 description 等注解 → unknown
  return { kind: 'prim', name: 'unknown' };
}

/** object：properties → 字段；additionalProperties → 索引签名 / Record。 */
function objectOf(schema, path) {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const props = Object.entries(properties).map(([key, value]) => ({
    key,
    optional: !required.has(key),
    type: typeOf(value, `${path}.${key}`),
  }));

  const additional = schema.additionalProperties;
  let index = null;
  if (additional === true) index = { kind: 'prim', name: 'unknown' };
  else if (isPlainObject(additional)) index = typeOf(additional, `${path}.additionalProperties`);

  if (props.length === 0 && index === null) {
    // 显式 additionalProperties: false 或空对象 → 无字段、无索引签名。
    return { kind: 'object', props: [], closed: additional !== undefined };
  }
  return { kind: 'object', props, index };
}

function union(members) {
  const flat = [];
  for (const member of members) {
    if (!member) continue;
    if (member.kind === 'union') flat.push(...member.of);
    else flat.push(member);
  }
  if (flat.length === 0) return { kind: 'prim', name: 'unknown' };
  if (flat.length === 1) return flat[0];
  return { kind: 'union', of: flat };
}

function intersect(members) {
  const flat = [];
  for (const member of members) {
    if (!member) continue;
    if (member.kind === 'intersection') flat.push(...member.of);
    else flat.push(member);
  }
  if (flat.length === 0) return { kind: 'prim', name: 'unknown' };
  if (flat.length === 1) return flat[0];
  return { kind: 'intersection', of: flat };
}

function refTarget(ref, path) {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`[generate-types] 不支持的 $ref ${JSON.stringify(ref)}（${path}）；只支持 bundle 内的 ${prefix}X`);
  }
  const name = ref.slice(prefix.length);
  if (!SchemaSet.has(name)) {
    throw new Error(`[generate-types] $ref 指向不存在的 schema ${JSON.stringify(name)}（${path}）`);
  }
  return name;
}

const SchemaSet = new Set(schemaNames);

function stripKeys(schema, keys) {
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

/** 只影响类型形状的关键字；纯注解（description/default/examples/readOnly...）不算。 */
const TYPE_CONSTRAINT_KEYS = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'patternProperties',
  'items',
  'prefixItems',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'if',
  'pattern',
  'format',
  'contentMediaType',
  'contentEncoding',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

function hasTypeConstraints(schema) {
  return isPlainObject(schema) && Object.keys(schema).some((key) => TYPE_CONSTRAINT_KEYS.has(key));
}

/* ---------------------------------------------------------------- 打印器 */

const PRECEDENCE = { union: 1, intersection: 2, atom: 3 };

function precedenceOf(node) {
  if (node.kind === 'union') return PRECEDENCE.union;
  if (node.kind === 'intersection') return PRECEDENCE.intersection;
  return PRECEDENCE.atom;
}

function print(node, indent) {
  const pad = '  '.repeat(indent);
  switch (node.kind) {
    case 'ref':
      return node.name;
    case 'literal':
      return node.text;
    case 'prim':
      return node.name;
    case 'array': {
      const inner = print(node.of, indent);
      return precedenceOf(node.of) < PRECEDENCE.atom ? `(${inner})[]` : `${inner}[]`;
    }
    case 'record':
      return `Record<string, ${node.value ? print(node.value, indent) : 'unknown'}>`;
    case 'object': {
      if (node.props.length === 0) {
        if (node.index) return `Record<string, ${print(node.index, indent)}>`;
        return 'Record<string, never>';
      }
      const body = node.props
        .map((p) => `${'  '.repeat(indent + 1)}${propertyKey(p.key)}${p.optional ? '?' : ''}: ${print(p.type, indent + 1)};`)
        .join('\n');
      const indexLine = node.index ? `\n${'  '.repeat(indent + 1)}[key: string]: ${print(node.index, indent + 1)};` : '';
      return `{\n${body}${indexLine}\n${pad}}`;
    }
    case 'union':
      return node.of.map((m) => wrap(m, PRECEDENCE.union, indent)).join(' | ');
    case 'intersection':
      return node.of.map((m) => wrap(m, PRECEDENCE.intersection, indent)).join(' & ');
    default:
      throw new Error(`[generate-types] 未知 AST 节点 ${node.kind}`);
  }
}

function wrap(node, parentPrecedence, indent) {
  const text = print(node, indent);
  return precedenceOf(node) < parentPrecedence ? `(${text})` : text;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function propertyKey(key) {
  return IDENTIFIER_RE.test(key) ? key : quote(key);
}

/* ------------------------------------------------------------------ 输出 */

const header = `/**
 * 自动生成，请勿手工编辑：由 \`scripts/generate-types.mjs\` 从
 * \`build/openapi.bundled.json\` 的 \`components.schemas\` 生成（${schemaNames.length} 个 schema）。
 *
 * 它是"契约 ↔ 客户端手写类型"的编译期对账基准：\`client/test/type-contract.test.ts\`
 * 对客户端导出的同名类型做双向可赋值校验。契约一旦新增可选字段、删字段或改类型，
 * 这里会同形变化，从而让 \`tsc\` / \`vitest\` 失败，而不是静默漂移。
 *
 * 重新生成：\`npm run api:build && node scripts/generate-types.mjs\`
 */
`;

const body = schemaNames
  .map((name) => `export type ${name} = ${print(typeOf(schemas[name], name), 0)};`)
  .join('\n\n');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${header}\n${body}\n`);
console.log(`[generate-types] 已生成 ${outPath}（${schemaNames.length} 个 schema 类型）`);
