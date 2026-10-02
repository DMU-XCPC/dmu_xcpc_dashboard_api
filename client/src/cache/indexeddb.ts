import type { CacheEntry, CacheStore } from './store.js';

export interface IndexedDbCacheStoreOptions {
  /** 数据库名，默认 `dmu-xcpc-cache`。 */
  name?: string;
  /** 对象仓库名，默认 `entries`。 */
  storeName?: string;
  version?: number;
  /** 注入 `IDBFactory`（Node 测试可传 `fake-indexeddb` 的实现）。 */
  factory?: IDBFactory;
}

/**
 * 基于 IndexedDB 的本地缓存（浏览器"localDB"）。
 *
 * 在 Node 中需要通过 `factory` 注入实现（例如 `fake-indexeddb`），
 * 或改用 `MemoryCacheStore`。所有方法在数据库不可用时抛出明确错误，
 * 由调用方决定是否降级。
 */
export class IndexedDbCacheStore implements CacheStore {
  private readonly name: string;
  private readonly storeName: string;
  private readonly version: number;
  private readonly factory?: IDBFactory;
  private dbPromise?: Promise<IDBDatabase>;

  constructor(options: IndexedDbCacheStoreOptions = {}) {
    this.name = options.name ?? 'dmu-xcpc-cache';
    this.storeName = options.storeName ?? 'entries';
    this.version = options.version ?? 1;
    if (options.factory !== undefined) this.factory = options.factory;
  }

  private getFactory(): IDBFactory {
    if (this.factory) return this.factory;
    const globalFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!globalFactory) {
      throw new Error('当前环境没有 indexedDB；请注入 options.factory 或改用 MemoryCacheStore');
    }
    return globalFactory;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.getFactory().open(this.name, this.version);
        request.onupgradeneeded = () => {
          const db = request.result;
          const store = db.objectStoreNames.contains(this.storeName)
            ? request.transaction?.objectStore(this.storeName)
            : db.createObjectStore(this.storeName, { keyPath: 'key' });
          if (store && !store.indexNames.contains('resource')) {
            store.createIndex('resource', 'resource', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败'));
        request.onblocked = () => reject(new Error('IndexedDB 打开被阻塞（存在其它连接）'));
      });
    }
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, mode);
      const request = operation(transaction.objectStore(this.storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务被中止'));
    });
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const value = await this.run<CacheEntry<T> | undefined>('readonly', (store) => store.get(key) as IDBRequest<CacheEntry<T> | undefined>);
    return value ?? null;
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    await this.run('readwrite', (store) => store.put({ ...entry, key }) as IDBRequest<IDBValidKey>);
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = await this.run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    const strings = all.filter((key): key is string => typeof key === 'string');
    return prefix ? strings.filter((key) => key.startsWith(prefix)) : strings;
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.clear() as IDBRequest<undefined>);
  }

  /** 关闭底层连接（测试释放用）。 */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = undefined;
  }
}
