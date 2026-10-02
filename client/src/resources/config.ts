/**
 * 运行时配置资源（契约 `paths/config.yaml`）。
 *
 * 配置只收发 JSON（服务端只支持 TOML/YAML 文件与环境变量覆盖，绝不支持 XML）；
 * `patch` 为整体校验、全量应用或全部拒绝，并支持离线队列。
 */

import type { HttpMethod } from '../http/transport.js';
import type { Config, ConfigPatch, ConfigSchema } from '../types/config.js';
import { readJson, writeJson, writeWithQueue, type ReadOptions, type ResourceContext, type WriteOptions, type WriteOutcome } from './helpers.js';

/** 本资源模块覆盖的契约操作（键 = operationId）。 */
export const CONFIG_OPERATIONS = {
  getConfig: { method: 'GET', path: '/config' },
  patchConfig: { method: 'PATCH', path: '/config' },
  getConfigSchema: { method: 'GET', path: '/config/schema' },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

export class ConfigResource {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * 获取当前生效的完整配置快照；需要 `config:read`。敏感项只以 `*_set` 反映。
   * 幂等只读，带强 `ETag`（`If-None-Match` 命中 304，继续用本地快照）。
   * 401 未认证；403 缺 scope；429 限流；500 内部错误。
   */
  get(options?: ReadOptions): Promise<Config> {
    return readJson<Config>(this.ctx, { path: '/config', resource: 'config', options });
  }

  /**
   * 运行时修改配置（叶子级合并，`null` 恢复文件默认值）；需要 `config:manage`。
   * 幂等写：`If-Match` 不匹配返回 412 precondition_failed，整体校验失败不产生部分生效。
   * 401 未认证；403 缺 scope；409 字段被环境变量覆盖不可改；422 含 errors[].pointer。
   */
  patch(body: ConfigPatch, options: WriteOptions & { queueIfOffline: true }): Promise<WriteOutcome<Config>>;
  patch(body: ConfigPatch, options?: WriteOptions): Promise<Config>;
  async patch(body: ConfigPatch, options?: WriteOptions): Promise<Config | WriteOutcome<Config>> {
    if (options?.queueIfOffline) return writeWithQueue<Config>(this.ctx, { method: 'PATCH', path: '/config', body, options });
    return writeJson<Config>(this.ctx, { method: 'PATCH', path: '/config', body, options });
  }

  /**
   * 获取配置字段元数据（类型、枚举、上下界、`secret`/`mutable`/`restart_required`）。
   * 需要 `config:read`。幂等只读，带强 `ETag`，`revision` 与 `Config.revision` 对齐。
   * 401 未认证；403 缺 scope；429 限流；500 内部错误。
   */
  schema(options?: ReadOptions): Promise<ConfigSchema> {
    return readJson<ConfigSchema>(this.ctx, { path: '/config/schema', resource: 'config-schema', options });
  }
}
