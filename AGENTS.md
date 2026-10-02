# AGENTS.md — 给 AI 编码代理的仓库指南

本仓库是 **DMU/ICPC 面板主服务器**的 API 契约（`doc/api`）+ TypeScript 客户端（`client`）。
契约优先：**先改契约，再改客户端与实现**。

## 硬性规则

1. `doc/api` 是唯一事实源。任何行为变更都必须先落在 OpenAPI 文档与
   `doc/api/README.md`（语义/时序）里。
2. 改完契约必须跑：

   ```sh
   npm run verify       # lint + bundle + typecheck + 全部测试
   ```

   零 error 才算完成；`npm run api:lint` 的告警也应视为需要处理。
3. 如果契约的 schema/示例变了，重新生成类型↔契约的桥：

   ```sh
   npm run fixtures     # 会先重建 bundle，再覆盖 client/test/fixtures.ts（请勿手改）
   ```

   它内部先跑 `api:build`，因此不会出现"用旧 bundle 生成 fixtures"的假成功。

4. 不要手改 `build/`（`api:bundle` 产物）与 `client/dist/`（`npm run build` 产物）。
5. 新增/删除端点时，必须同步更新对应资源模块的 `XXX_OPERATIONS` 清单——
   `client-contract.test.ts` 会强制"契约里的每个 operation 都被客户端覆盖"。
6. 权限、幂等、并发、时序语义写在 operation 的 `description` 与 `x-*` 扩展里，
   不要只写在代码注释里。

## 目录约定

```
doc/api/openapi.yaml         信息/服务/tags/security/paths 索引（只做 $ref 转发）
doc/api/paths/<domain>.yaml  路径项，每个文件若干命名键，键名由根文档固定
doc/api/components/schemas/<domain>.yaml   按领域分文件的 schema
doc/api/STYLE.md             契约编写规范（新端点必须遵守）
client/src/{http,auth,cache}/ 传输、会话、缓存与离线队列（核心层，改前先看测试）
client/src/resources/        每领域一个资源类 + XXX_OPERATIONS 清单（含 self：/auth/me* 自助端点）
client/src/types/            手写类型，导出名必须与 OpenAPI schema 名一致
client/test/                 行为测试 + 契约一致性测试
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run api:lint` | 契约 lint（redocly，零 error 是硬要求） |
| `npm run api:build` | lint + 打包成 `build/openapi.bundled.{yaml,json}` |
| `npm run api:docs` | 生成单文件文档 `build/docs.html`（给人看，不参与校验） |
| `npm run fixtures` | 先重建 bundle，再重新生成 `client/test/fixtures.ts` |
| `npm run typecheck` | 客户端类型检查（strict + noUncheckedIndexedAccess） |
| `npm test` | 契约构建 + 客户端全部测试 |
| `npm run verify` | 上面全部，提交前必须通过 |
| `npm run build` | 打包客户端（ESM/CJS/d.ts） |

## 容易踩的坑

- **npm 缓存**：沙箱内 `~/.npm` 不可写，安装依赖前先
  `export npm_config_cache="$PWD/.npm-cache"`（已加入 `.gitignore`）。
- **OpenAPI 3.1**：不要用 3.0 的 `nullable`，用 `type: [x, 'null']` 或 `oneOf`。
- **refs**：路径文件里引用 schema 用 `../components/schemas/...`（注意是 `../`）。
- **唯一性**：schema 名全局唯一，跨领域重复会被 bundle 重命名（`Xxx-2`）并让契约失真。
- **测试里的 baseUrl**：Node 环境必须给绝对地址，否则 `Transport` 直接抛错。
- **TypeScript**：`client` 依赖 TS 5.x（tsup 的 d.ts 打包要求）；TS 7 原生预览版会让
  `npm run build` 的 DTS 步骤崩溃。
