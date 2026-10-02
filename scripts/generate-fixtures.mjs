#!/usr/bin/env node
/**
 * 从 `build/openapi.bundled.json` 的 `components.schemas.<Name>.examples[0]`
 * 生成 `client/test/fixtures.ts`。
 *
 * 生成的文件带 `satisfies <类型>`，因此它同时约束两件事：
 *   - 编译期：契约示例必须能被客户端 TypeScript 类型接受（`tsc` 失败即漂移）；
 *   - 运行期：`test/client-contract.test.ts` 用 Ajv 依据契约 schema 校验同一份数据。
 *
 * **覆盖范围**：只覆盖下面 `SCHEMAS` 列出的 schema（当前 24 个），不是全部 218 个。
 * 未列入的 schema 仍受两条护栏保护：redocly lint 会用 schema 校验各自的示例；
 * 枚举类 schema 另有 `contract.test.ts` 的"运行期镜像对账"断言。
 *
 * 用法：先 `npm run api:build`，再 `node scripts/generate-fixtures.mjs`。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMAS = [
  'Principal',
  'Member',
  'PagedMember',
  'Team',
  'Announcement',
  'Channel',
  'Delivery',
  'Quota',
  'QuotaClaim',
  'Scoreboard',
  'ScoreboardEntry',
  'OjHandle',
  'OjSubmission',
  'OjRatingRecord',
  'IngestRatingRecordItem',
  'CrawlerConfig',
  'Config',
  'ChangeFeed',
  'Job',
  'Problem',
  'AuditLog',
  'RosterExport',
  'IngestResult',
  'StatsTrendResponse',
];

const bundlePath = fileURLToPath(new URL('../build/openapi.bundled.json', import.meta.url));
const outPath = process.argv[2] ?? fileURLToPath(new URL('../client/test/fixtures.ts', import.meta.url));
const spec = JSON.parse(readFileSync(bundlePath, 'utf8'));

const picked = [];
for (const name of SCHEMAS) {
  const schema = spec.components?.schemas?.[name];
  if (!schema) throw new Error(`契约中不存在 schema ${name}`);
  const example = (schema.examples ?? [])[0];
  if (example === undefined) throw new Error(`schema ${name} 没有 examples[0]，无法生成 fixture`);
  picked.push([name, example]);
}

const header = `/**
 * 自动生成，请勿手工编辑：由 \`scripts/generate-fixtures.mjs\` 从
 * \`build/openapi.bundled.json\` 的 schema \`examples[0]\` 提取。
 *
 * 作用是把"契约 schema ↔ 客户端 TypeScript 类型"钉在一起：
 * 每个 fixture 都带 \`satisfies <类型>\`，因此只要契约字段与手写类型不一致，
 * \`tsc\` 就会失败；同时 \`test/client-contract.test.ts\` 会用 Ajv 依据契约
 * 校验同一份数据。任何一侧漂移都会让 \`npm run verify\` 失败。
 */
`;
const typeImports = `import type {\n${SCHEMAS.map((name) => `  ${name},`).join('\n')}\n} from '../src/index.js';\n\n`;
const body =
  'export const fixtures = {\n' +
  picked
    .map(([name, example]) => `  ${name}: ${JSON.stringify(example, null, 2).split('\n').join('\n  ')} satisfies ${name},`)
    .join('\n') +
  '\n};\n';

writeFileSync(outPath, header + typeImports + body);
console.log(`已生成 ${outPath}（${picked.length} 个 fixture）`);
