import { tg } from './telegram';

export class ApiError extends Error {
  constructor(public kind: 'offline' | 'auth' | 'server', public status?: number, message?: string) {
    super(message ?? kind);
  }
}

const TIMEOUT_MS = 10_000;

export async function api<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': tg()?.initData ?? '', ...(init.headers ?? {}) }
    });
  } catch {
    throw new ApiError('offline');
  } finally {
    clearTimeout(t);
  }
  if (res.status === 401 || res.status === 403) throw new ApiError('auth', res.status);
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError('offline', res.status);
  if (!res.ok) throw new ApiError('server', res.status);
  return (await res.json()) as T;
}

/**
 * Кэш только для чтения при недоступном сервере. Привязан к Telegram ID:
 * при смене пользователя чужой кэш не показывается и удаляется.
 */
const KEY = 'forma.cache.v1';
type Cache = { userId: number; savedAt: string; data: Record<string, unknown> };

export function readCache(userId: number | undefined): Cache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    if (!userId || c.userId !== userId) {
      localStorage.removeItem(KEY);
      return null;
    }
    return c;
  } catch {
    return null;
  }
}

export function writeCache(userId: number, data: Record<string, unknown>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, savedAt: new Date().toISOString(), data }));
  } catch {
    /* хранилище недоступно — работаем без кэша */
  }
}
