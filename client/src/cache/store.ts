/**
 * 本地缓存存储抽象。
 *
 * 契约（`doc/api/README.md` §4.9）要求客户端能把资源副本存在本地数据库里，
 * 在弱网/离线时降级为读缓存。存储实现必须只保存**可结构化克隆的纯数据**
 * （解析后的 JSON），不得保存 `Response` 或流。
 */

export interface CacheEntry<T = unknown> {
  /** 逻辑键，例如 `members:list:page=1&size=50` 或 `members:item:mem_1`。 */
  key: string;
  value: T;
  /** 写入时刻（epoch ms），用于 TTL 与 `stale` 判定。 */
  updatedAt: number;
  /** 服务端强 ETag，用于条件读取。 */
  etag?: string;
  /** ETag 去引号后的版本号（= 资源 `revision`）。 */
  revision?: string;
  /** 所属资源集合名，便于按资源批量失效。 */
  resource?: string;
  /** 资源 id（单资源条目）。 */
  id?: string;
  /** 服务端给出的 `generated_at`/`stale` 等新鲜度提示。 */
  serverStale?: boolean;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

/** 内存实现：Node 默认，也是测试基准。 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 500;
  }

  get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);
    // LRU：命中后移到末尾
    this.entries.delete(key);
    this.entries.set(key, entry);
    return Promise.resolve(entry as CacheEntry<T>);
  }

  set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, entry as CacheEntry<unknown>);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  keys(prefix?: string): Promise<string[]> {
    const all = [...this.entries.keys()];
    return Promise.resolve(prefix ? all.filter((key) => key.startsWith(prefix)) : all);
  }

  clear(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}
