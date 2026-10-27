import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';

/** Цены за 1 млн токенов, USD. Проверено по developers.openai.com/api/docs/pricing 27.10.2026. */
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6.1-terra': { input: 1.0, cached: 0.05, output: 5.0 },
  'gpt-6.1-sol': { input: 2.0, cached: 0.1, output: 10.0 },
  'gpt-6-astra': { input: 10.0, cached: 1.0, output: 50.0 }
};

export function priceOf(model: string) {
  const p = PRICES[model];
  if (!p) throw new AiError('unknown_price', `Нет цены для модели ${model}: добавьте её в PRICES`);
  return p;
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0) {
  const p = priceOf(model);
  return ((inputTokens - cachedTokens) * p.input + cachedTokens * p.cached + outputTokens * p.output) / 1_000_000;
}

export class AiError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

export type Budget = { monthlyUsd: number; dailyText: number; dailyImage: number };

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
function dayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function spentThisMonth(db: DB, now = new Date()) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved_usd ELSE cost_usd END),0) AS s
       FROM ai_usage WHERE created_at >= ?`
    )
    .get(monthStart(now)) as { s: number };
  return r.s;
}

/**
 * Резерв стоимости до вызова. Отказ, если резерв выводит за месячный бюджет
 * или превышен дневной лимит обращений. Всё — в одной транзакции.
 */
export function reserve(db: DB, b: Budget, purpose: string, model: string, kind: 'text' | 'image', reservedUsd: number, now = new Date()) {
  return withTx(db, () => {
    const spent = spentThisMonth(db, now);
    if (spent + reservedUsd > b.monthlyUsd) throw new AiError('budget', 'Месячный бюджет ИИ исчерпан');
    const day = db
      .prepare(`SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= ? AND kind = ? AND purpose NOT LIKE 'eval:%'`)
      .get(dayStart(now), kind) as { n: number };
    const limit = kind === 'image' ? b.dailyImage : b.dailyText;
    if (!purpose.startsWith('eval:') && day.n >= limit) throw new AiError('daily_limit', 'Дневной лимит обращений исчерпан');
    const r = db
      .prepare(
        `INSERT INTO ai_usage (created_at, purpose, model, kind, status, reserved_usd) VALUES (?, ?, ?, ?, 'reserved', ?)`
      )
      .run(now.toISOString(), purpose, model, kind, reservedUsd);
    return Number(r.lastInsertRowid);
  });
}

export function settle(db: DB, id: number, u: { ok: boolean; cost: number; input: number; cached: number; output: number; latencyMs: number; error?: string }) {
  db.prepare(
    `UPDATE ai_usage SET status=?, cost_usd=?, input_tokens=?, cached_tokens=?, output_tokens=?, latency_ms=?, error=? WHERE id=?`
  ).run(u.ok ? 'ok' : 'error', u.cost, u.input, u.cached, u.output, u.latencyMs, u.error ?? null, id);
}

export type JsonSchema = { name: string; schema: Record<string, unknown> };

export type CallResult = {
  text: string;
  json: unknown;
  usage: { input: number; cached: number; output: number };
  costUsd: number;
  latencyMs: number;
  model: string;
};

export type ClientOptions = { apiKey: string; baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch };

/**
 * Вызов OpenAI Responses API со структурированным ответом по JSON-схеме.
 * Ключ уходит только в заголовок запроса к OpenAI; в журналы и ответы клиенту не попадает.
 */
export async function callStructured(
  opts: ClientOptions,
  model: string,
  system: string,
  user: string,
  schema: JsonSchema,
  maxOutputTokens = 1500
): Promise<CallResult> {
  const f = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await f(`${opts.baseUrl}/responses`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_output_tokens: maxOutputTokens,
        text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } }
      })
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('timeout', `Нет ответа за ${opts.timeoutMs} мс`);
    throw new AiError('network', 'Сеть недоступна');
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const code = res.status === 401 ? 'auth' : res.status === 429 ? 'rate_limit' : res.status === 404 ? 'model_not_found' : res.status >= 500 ? 'provider' : 'bad_request';
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = (body.error?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 300);
    } catch {
      /* пусто */
    }
    throw new AiError(code, `OpenAI ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  const body = (await res.json()) as {
    output_text?: string;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    status?: string;
    incomplete_details?: { reason?: string };
  };
  const text =
    body.output_text ??
    (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text' && c.text)
      .map((c) => c.text)
      .join('');
  const usage = {
    input: body.usage?.input_tokens ?? 0,
    cached: body.usage?.input_tokens_details?.cached_tokens ?? 0,
    output: body.usage?.output_tokens ?? 0
  };
  if (body.status === 'incomplete') {
    // Чаще всего ответ обрезан пределом max_output_tokens (у рассуждающих моделей
    // в него входят и токены рассуждения) — это не «плохой JSON», а нехватка места.
    const reason = body.incomplete_details?.reason ?? 'unknown';
    throw Object.assign(new AiError('truncated', `Ответ не завершён: ${reason}`), { usage, latencyMs });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw Object.assign(new AiError('bad_json', 'Ответ не является JSON'), { usage, latencyMs });
  }
  return { text, json, usage, costUsd: estimateCost(model, usage.input, usage.output, usage.cached), latencyMs, model };
}

export async function listModels(opts: ClientOptions): Promise<string[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.baseUrl}/models`, { headers: { authorization: `Bearer ${opts.apiKey}` } });
  if (res.status === 401) throw new AiError('auth', 'Ключ OpenAI не принят', 401);
  if (!res.ok) throw new AiError('provider', `OpenAI ${res.status}`, res.status);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}
