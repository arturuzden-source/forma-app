import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { AiError, callStructured, estimateCost, reserve, settle, type JsonSchema } from './openai.js';

export type AiService = {
  available: () => boolean;
  structured: (o: { purpose: string; model: string; system: string; user: string; schema: JsonSchema; maxOutput: number; estInput: number }) => Promise<unknown>;
};

/**
 * Единая точка вызова ИИ: резерв стоимости → вызов → уточнение расхода.
 * Ошибка не меняет данные: вызывающий код сохраняет результат только после проверки.
 */
export function createAiService(cfg: Config, db: DB, fetchImpl?: typeof fetch): AiService {
  const budget = { monthlyUsd: cfg.AI_MONTHLY_BUDGET_USD, dailyText: cfg.AI_DAILY_TEXT_LIMIT, dailyImage: cfg.AI_DAILY_IMAGE_LIMIT };
  return {
    available: () => Boolean(cfg.OPENAI_API_KEY),
    async structured(o) {
      if (!cfg.OPENAI_API_KEY) throw new AiError('no_key', 'ИИ не подключён');
      const id = reserve(db, budget, o.purpose, o.model, 'text', estimateCost(o.model, o.estInput, o.maxOutput));
      try {
        const r = await callStructured(
          { apiKey: cfg.OPENAI_API_KEY, baseUrl: cfg.OPENAI_BASE_URL, timeoutMs: cfg.AI_TIMEOUT_MS, fetchImpl },
          o.model,
          o.system,
          o.user,
          o.schema,
          o.maxOutput
        );
        settle(db, id, { ok: true, cost: r.costUsd, input: r.usage.input, cached: r.usage.cached, output: r.usage.output, latencyMs: r.latencyMs });
        return r.json;
      } catch (e) {
        const err = e as AiError & { usage?: { input: number; cached: number; output: number }; latencyMs?: number };
        const cost = err.usage ? estimateCost(o.model, err.usage.input, err.usage.output, err.usage.cached) : 0;
        settle(db, id, { ok: false, cost, input: err.usage?.input ?? 0, cached: err.usage?.cached ?? 0, output: err.usage?.output ?? 0, latencyMs: err.latencyMs ?? 0, error: err.code ?? 'error' });
        throw e;
      }
    }
  };
}

export function aiErrorMessage(e: unknown): string {
  const code = (e as AiError)?.code;
  switch (code) {
    case 'budget':
      return 'Месячный бюджет ИИ исчерпан. Ответьте кнопкой или заполните раздел вручную в резюме.';
    case 'daily_limit':
      return 'На сегодня лимит обращений к ИИ исчерпан. Ответьте кнопкой или продолжите завтра.';
    case 'no_key':
      return 'ИИ не подключён. Ответьте кнопкой или заполните раздел вручную в резюме.';
    case 'timeout':
      return 'ИИ не ответил вовремя. Попробуйте ещё раз — ответ не потерян.';
    default:
      return 'ИИ сейчас недоступен. Попробуйте ещё раз или ответьте кнопкой.';
  }
}
