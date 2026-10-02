import { ApiProblemError, isNetworkError } from '../errors.js';
import type { AuthProvider, HttpMethod, Transport } from '../http/transport.js';
import type { Principal, Problem, TokenPair } from '../types/common.js';

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** 访问令牌过期时刻（epoch ms）。 */
  accessExpiresAt?: number;
  /** 刷新令牌过期时刻（epoch ms）。 */
  refreshExpiresAt?: number;
  principal?: Principal;
}

/** 令牌持久化抽象：浏览器可给 localStorage/IndexedDB 实现，Node 给文件实现。 */
export interface TokenStore {
  load(): Promise<StoredTokens | null> | StoredTokens | null;
  save(tokens: StoredTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** 默认的内存令牌存储（进程内有效）。 */
export class MemoryTokenStore implements TokenStore {
  private tokens: StoredTokens | null = null;
  private username?: string;

  load(): StoredTokens | null {
    return this.tokens;
  }

  save(tokens: StoredTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

export interface SessionOptions {
  transport: Transport;
  store?: TokenStore;
  /** 机器人 / 采集器使用的长期 API Key；与用户名口令登录互斥。 */
  apiKey?: string;
  /** API Key 的传递方式，默认 `Authorization: Bearer`。 */
  apiKeyHeader?: 'authorization' | 'x-api-key';
  now?: () => number;
  /** 过期前多久主动刷新（默认 30 秒）。 */
  refreshSkewMs?: number;
  onTokensChanged?: (tokens: StoredTokens | null) => void;
  /** 刷新失败（网络错误或 401）时回调；不会中断当前请求。 */
  onRefreshFailed?: (error: unknown) => void;
}

/**
 * 会话管理：登录、单飞刷新、登出、令牌注入与 `401` 恢复。
 *
 * 关键时序（契约要求）：
 * - 刷新令牌**单次使用并轮换**，因此并发 401 只能触发一次刷新，其余请求等待同一次结果；
 * - 访问令牌在过期前 `refreshSkewMs` 主动刷新；
 * - `401` 后最多重放一次，避免刷新循环。
 */
export class SessionManager implements AuthProvider {
  private readonly transport: Transport;
  private readonly store: TokenStore;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly apiKey?: string;
  private readonly apiKeyHeader: 'authorization' | 'x-api-key';
  private readonly options: SessionOptions;
  private tokens: StoredTokens | null = null;
  private username?: string;
  private loaded = false;
  private refreshInFlight?: Promise<TokenPair>;

  constructor(options: SessionOptions) {
    this.options = options;
    this.transport = options.transport;
    this.store = options.store ?? new MemoryTokenStore();
    this.now = options.now ?? (() => Date.now());
    this.refreshSkewMs = options.refreshSkewMs ?? 30_000;
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    this.apiKeyHeader = options.apiKeyHeader ?? 'authorization';
  }

  get isApiKeyAuth(): boolean {
    return this.apiKey !== undefined;
  }

  get accessToken(): string | undefined {
    return this.apiKey ?? this.tokens?.accessToken;
  }

  get principal(): Principal | undefined {
    return this.tokens?.principal;
  }

  get refreshToken(): string | undefined {
    return this.tokens?.refreshToken;
  }

  /**
   * 当前身份指纹，用于把本地缓存隔离到调用者：优先用登录用户名，其次用 API Key 前缀，
   * 都没有时是 `anonymous`。用户登出或换账号后指纹变化，缓存会被清空。
   */
  identity(): string {
    if (this.username) return `user:${this.username}`;
    if (this.apiKey) return `api-key:${this.apiKey.slice(0, 12)}`;
    return 'anonymous';
  }

  isAuthenticated(): boolean {
    return this.apiKey !== undefined || Boolean(this.tokens?.accessToken);
  }

  /** 是否已经可以判断认证状态（用于避免在首次加载前误判为未登录）。 */
  isReady(): boolean {
    return this.apiKey !== undefined || this.loaded;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await this.store.load();
    if (stored) this.tokens = stored;
  }

  async authorize(headers: Headers, _ctx: { method: HttpMethod; path: string }): Promise<void> {
    if (this.apiKey !== undefined) {
      this.applyApiKey(headers);
      return;
    }
    await this.ensureLoaded();
    const tokens = this.tokens;
    if (!tokens?.accessToken) return;
    if (this.isExpiring(tokens) && tokens.refreshToken) {
      try {
        await this.refresh();
      } catch (error) {
        // 主动刷新失败不应中断请求：继续用旧令牌尝试，让服务端给出结论。
        this.options.onRefreshFailed?.(error);
      }
    }
    const token = this.tokens?.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  private applyApiKey(headers: Headers): void {
    if (this.apiKey === undefined) return;
    if (this.apiKeyHeader === 'x-api-key') headers.set('X-API-Key', this.apiKey);
    else headers.set('Authorization', `Bearer ${this.apiKey}`);
  }

  private isExpiring(tokens: StoredTokens): boolean {
    if (tokens.accessExpiresAt === undefined) return false;
    return tokens.accessExpiresAt - this.now() <= this.refreshSkewMs;
  }

  async onUnauthorized(
    problem: Problem,
    _ctx: { method: HttpMethod; path: string; retry: () => Promise<boolean> },
  ): Promise<boolean> {
    if (this.apiKey !== undefined) return false;
    await this.ensureLoaded();
    if (!this.tokens?.refreshToken) return false;
    if (problem.code === 'invalid_token') {
      // 刷新令牌族已被判定泄露或撤销，重试无意义。
      if (this.tokens.refreshToken) {
        try {
          await this.refresh();
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** 登录并保存令牌对。 */
  async login(username: string, password: string, options: { deviceName?: string } = {}): Promise<TokenPair> {
    this.username = username;
    const body: Record<string, unknown> = { username, password };
    if (options.deviceName) body['device_name'] = options.deviceName;
    const result = await this.transport.post<TokenPair>('/auth/login', {
      body,
      noAuth: true,
      idempotencyKey: false,
      retry: false,
      parse: 'json',
    });
    await this.applyTokenPair(result.data);
    return result.data;
  }

  /** 直接写入令牌对（例如从服务端渲染或另一标签页同步而来）。 */
  async applyTokenPair(pair: TokenPair): Promise<void> {
    const now = this.now();
    const tokens: StoredTokens = {
      accessToken: pair.access_token,
      refreshToken: pair.refresh_token,
      accessExpiresAt: now + pair.expires_in * 1000,
      refreshExpiresAt: now + pair.refresh_expires_in * 1000,
      principal: pair.principal,
    };
    this.tokens = tokens;
    this.loaded = true;
    await this.store.save(tokens);
    this.options.onTokensChanged?.(tokens);
  }

  /**
   * 刷新令牌对。并发调用共享同一次请求（单飞），
   * 因为刷新令牌一旦被并发使用会被服务端判定为泄露。
   */
  async refresh(): Promise<TokenPair> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) throw new Error('没有可用的刷新令牌');
    const promise = (async (): Promise<TokenPair> => {
      try {
        const result = await this.transport.post<TokenPair>('/auth/refresh', {
          body: { refresh_token: refreshToken },
          noAuth: true,
          idempotencyKey: false,
          retry: false,
          parse: 'json',
        });
        await this.applyTokenPair(result.data);
        return result.data;
      } catch (error) {
        if (error instanceof ApiProblemError && error.status === 401) {
          await this.clear();
        }
        this.options.onRefreshFailed?.(error);
        throw error;
      } finally {
        this.refreshInFlight = undefined;
      }
    })();
    this.refreshInFlight = promise;
    return promise;
  }

  /**
   * 登出。契约保证 `204` 且幂等；网络失败时仍然清理本地令牌
   * （离线登出是用户可见行为，不能被网络阻断）。
   */
  async logout(options: { allSessions?: boolean } = {}): Promise<void> {
    if (this.apiKey === undefined) {
      try {
        await this.transport.post<void>('/auth/logout', {
          body: options.allSessions ? { all_sessions: true } : {},
          idempotencyKey: false,
          retry: false,
          parse: 'none',
        });
      } catch (error) {
        if (!isNetworkError(error)) this.options.onRefreshFailed?.(error);
      }
    }
    await this.clear();
  }

  /** 清空本地令牌（不发请求）。 */
  async clear(): Promise<void> {
    this.username = undefined;
    this.tokens = null;
    this.loaded = true;
    await this.store.clear();
    this.options.onTokensChanged?.(null);
  }
}
