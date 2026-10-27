import crypto from 'node:crypto';

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: 'missing' | 'bad_hash' | 'expired' | 'no_user' | 'malformed' };

/**
 * Проверка подписи Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * hash = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
 */
export function verifyInitData(
  initData: string | undefined,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000)
): InitDataResult {
  if (!initData) return { ok: false, reason: 'missing' };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'bad_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  if (nowSec - authDate > maxAgeSec) return { ok: false, reason: 'expired' };

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'no_user' };
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    if (typeof user.id !== 'number') return { ok: false, reason: 'no_user' };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Только для тестов: собрать подписанную initData. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
