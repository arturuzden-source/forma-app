import type { DB } from '../db/index.js';
import { AiError, callStructured, estimateCost, listModels, priceOf, reserve, settle, type ClientOptions, type JsonSchema } from './openai.js';

/**
 * Проверка моделей этапа 0: русский язык, соблюдение JSON-схемы, правила сервера,
 * задержка и обработка ошибок. Каждый вызов проходит через резерв бюджета.
 */

const CATALOG = [
  { id: 'warmup-joint', name: 'Суставная разминка', kind: 'time' },
  { id: 'pullup', name: 'Подтягивания', kind: 'reps' },
  { id: 'squat-bw', name: 'Приседание с собственным весом', kind: 'reps' },
  { id: 'lunge-back', name: 'Выпады назад', kind: 'reps' },
  { id: 'jump-squat', name: 'Приседание с выпрыгиванием', kind: 'reps', tags: ['прыжки'] },
  { id: 'db-row', name: 'Тяга гантели в наклоне', kind: 'reps' },
  { id: 'plank', name: 'Планка', kind: 'time' },
  { id: 'stretch-legs', name: 'Растяжка ног', kind: 'time' }
];

type Check = { ok: boolean; note: string };
type Case = {
  id: string;
  title: string;
  system: string;
  user: string;
  schema: JsonSchema;
  maxOutput: number;
  check: (json: any) => Check[];
};

const SYS = 'Ты — помощник в приложении для тренировок. Отвечай только на русском. Не придумывай сведения, которых нет во входных данных. Отвечай строго по JSON-схеме.';

const nullableInt = { type: ['integer', 'null'] };
const nullableStr = { type: ['string', 'null'] };

export const CASES: Case[] = [
  {
    id: 'extract',
    title: 'Извлечение профиля из свободного текста',
    system: SYS + ' Извлеки поля профиля. Если сведения нет — null. В unknown перечисли важные поля, о которых пользователь не сказал.',
    user: 'Меня зовут Артур, мне 31, рост 180, вешу примерно 78. Могу по понедельникам, средам и пятницам после семи вечера, не больше часа. Колено иногда побаливает, когда прыгаю.',
    schema: {
      name: 'profile',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'age', 'height_cm', 'weight_kg', 'sex', 'days', 'earliest_time', 'max_minutes', 'limitations', 'unknown'],
        properties: {
          name: nullableStr,
          age: nullableInt,
          height_cm: nullableInt,
          weight_kg: { type: ['number', 'null'] },
          sex: { type: ['string', 'null'], enum: ['male', 'female', null] },
          days: { type: 'array', items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
          earliest_time: nullableStr,
          max_minutes: nullableInt,
          limitations: { type: 'array', items: { type: 'string' } },
          unknown: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    maxOutput: 1500,
    check: (j) => [
      { ok: j.name === 'Артур' && j.age === 31 && j.height_cm === 180, note: 'имя, возраст, рост' },
      { ok: typeof j.weight_kg === 'number' && Math.abs(j.weight_kg - 78) < 0.6, note: 'вес 78' },
      { ok: ['mon', 'wed', 'fri'].every((d) => j.days?.includes(d)) && j.days?.length === 3, note: 'дни пн/ср/пт' },
      { ok: j.max_minutes === 60, note: 'не больше 60 мин' },
      { ok: j.sex === null, note: 'пол не выдуман' },
      { ok: (j.limitations ?? []).some((s: string) => /колен/i.test(s)), note: 'ограничение по колену' }
    ]
  },
  {
    id: 'plan',
    title: 'Тренировка на 40 минут из каталога',
    system:
      SYS +
      ' Составь одну тренировку только из упражнений каталога (поле exercise_id — id из каталога). Общая длительность, включая разминку, работу, отдых и заминку, не больше лимита. Учитывай ограничения. Работа одного повторения ≈ 3 секунды.',
    user: JSON.stringify({
      limit_minutes: 40,
      goal: 'подтягивания 12 → 18, сила ног',
      limitations: ['правое колено: дискомфорт при прыжках'],
      catalog: CATALOG
    }),
    schema: {
      name: 'workout',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['warmup_minutes', 'cooldown_minutes', 'items', 'explanation'],
        properties: {
          warmup_minutes: { type: 'integer' },
          cooldown_minutes: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['exercise_id', 'sets', 'reps', 'seconds', 'rest_seconds'],
              properties: {
                exercise_id: { type: 'string' },
                sets: { type: 'integer' },
                reps: nullableInt,
                seconds: nullableInt,
                rest_seconds: { type: 'integer' }
              }
            }
          },
          explanation: { type: 'string' }
        }
      }
    },
    maxOutput: 4000,
    check: (j) => {
      const ids = new Set(CATALOG.map((c) => c.id));
      const items: any[] = j.items ?? [];
      const total =
        (j.warmup_minutes ?? 0) * 60 +
        (j.cooldown_minutes ?? 0) * 60 +
        items.reduce((s, it) => s + it.sets * ((it.reps ? it.reps * 3 : it.seconds ?? 0) + it.rest_seconds), 0);
      return [
        { ok: items.length > 0 && items.every((it) => ids.has(it.exercise_id)), note: 'только упражнения каталога' },
        { ok: !items.some((it) => it.exercise_id === 'jump-squat'), note: 'без прыжков (колено)' },
        { ok: total <= 40 * 60, note: `длительность ${Math.round(total / 60)} мин ≤ 40` },
        { ok: items.some((it) => it.exercise_id === 'pullup'), note: 'есть подтягивания' },
        { ok: isRussian(j.explanation), note: 'объяснение на русском' }
      ];
    }
  },
  {
    id: 'clarify',
    title: 'Неоднозначная команда → уточнение',
    system: SYS + ' Определи, можно ли выполнить команду без уточнения. Если неясно, какую тренировку или на какой день перенести, — action=clarify и короткий вопрос.',
    user: JSON.stringify({
      command: 'Перенеси тренировку',
      today: '2026-10-27',
      upcoming: [
        { id: 's1', date: '2026-10-28', title: 'Бег: интервалы' },
        { id: 's2', date: '2026-10-30', title: 'Сила: спина и корпус' }
      ]
    }),
    schema: {
      name: 'decision',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'session_id', 'new_date', 'question'],
        properties: {
          action: { type: 'string', enum: ['apply', 'clarify'] },
          session_id: nullableStr,
          new_date: nullableStr,
          question: nullableStr
        }
      }
    },
    maxOutput: 1000,
    check: (j) => [
      { ok: j.action === 'clarify', note: 'запросил уточнение' },
      { ok: typeof j.question === 'string' && isRussian(j.question), note: 'вопрос на русском' }
    ]
  },
  {
    id: 'explain',
    title: 'Объяснение изменения по фактам',
    system: SYS + ' Объясни решение одной-двумя фразами, опираясь только на переданные факты. Без восклицаний и мотивационных лозунгов.',
    user: JSON.stringify({
      decision: 'объём бега на следующей неделе не увеличивать',
      facts: { sleep_avg_hours: 6.8, runs_done: 2, runs_planned: 2, pain: 'нет' }
    }),
    schema: {
      name: 'explanation',
      schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }
    },
    maxOutput: 1000,
    check: (j) => [
      { ok: isRussian(j.text), note: 'на русском' },
      { ok: typeof j.text === 'string' && j.text.length <= 320, note: 'коротко (≤ 320 знаков)' },
      { ok: /сон|сп(ал|ите|ать)|6[,.]8/i.test(j.text ?? ''), note: 'опирается на сон' },
      { ok: !/!/.test(j.text ?? ''), note: 'без восклицаний' }
    ]
  }
];

function isRussian(s: unknown) {
  if (typeof s !== 'string' || s.length < 5) return false;
  const letters = s.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  const cyr = s.match(/[А-Яа-яЁё]/g) ?? [];
  return letters.length > 0 && cyr.length / letters.length > 0.8;
}

const EST_INPUT_TOKENS = 900;
export const RUNS_PER_CASE = 2;

export function estimateEval(models: string[]) {
  let total = 0;
  const rows = models.map((m) => {
    let c = 0;
    for (const k of CASES) c += estimateCost(m, EST_INPUT_TOKENS, k.maxOutput) * RUNS_PER_CASE;
    total += c;
    return { model: m, maxUsd: c };
  });
  return { rows, totalMaxUsd: total, calls: models.length * CASES.length * RUNS_PER_CASE };
}

export type EvalReport = {
  available: string[];
  models: {
    model: string;
    passed: number;
    total: number;
    caseResults: { case: string; run: number; ok: boolean; failed: string[]; latencyMs: number | null; costUsd: number; error?: string }[];
    avgLatencyMs: number | null;
    maxLatencyMs: number | null;
    costUsd: number;
    avgTokens: { input: number; output: number };
  }[];
  errorHandling: { name: string; ok: boolean; note: string }[];
  spentUsd: number;
  stoppedByBudget: boolean;
};

export async function runEval(db: DB, client: ClientOptions, models: string[], evalBudgetUsd: number, monthlyUsd: number): Promise<EvalReport> {
  const available = await listModels(client);
  const report: EvalReport = { available: models.filter((m) => available.includes(m)), models: [], errorHandling: [], spentUsd: 0, stoppedByBudget: false };

  for (const model of models) {
    const mr: EvalReport['models'][number] = { model, passed: 0, total: 0, caseResults: [], avgLatencyMs: null, maxLatencyMs: null, costUsd: 0, avgTokens: { input: 0, output: 0 } };
    report.models.push(mr);
    if (!available.includes(model)) {
      mr.caseResults.push({ case: '—', run: 0, ok: false, failed: ['модель недоступна для ключа'], latencyMs: null, costUsd: 0 });
      continue;
    }
    try {
      priceOf(model);
    } catch {
      mr.caseResults.push({ case: '—', run: 0, ok: false, failed: ['нет цены в таблице'], latencyMs: null, costUsd: 0 });
      continue;
    }
    const lat: number[] = [];
    let inTok = 0, outTok = 0, n = 0;
    for (const c of CASES) {
      for (let run = 1; run <= RUNS_PER_CASE; run++) {
        const reserveUsd = estimateCost(model, EST_INPUT_TOKENS * 1.5, c.maxOutput);
        if (report.spentUsd + reserveUsd > evalBudgetUsd) {
          report.stoppedByBudget = true;
          break;
        }
        mr.total++;
        let id: number;
        try {
          id = reserve(db, { monthlyUsd, dailyText: 0, dailyImage: 0 }, `eval:${c.id}`, model, 'text', reserveUsd);
        } catch (e) {
          report.stoppedByBudget = true;
          mr.caseResults.push({ case: c.id, run, ok: false, failed: [(e as Error).message], latencyMs: null, costUsd: 0 });
          break;
        }
        try {
          const r = await callStructured(client, model, c.system, c.user, c.schema, c.maxOutput);
          const checks = c.check(r.json as any);
          const failed = checks.filter((x) => !x.ok).map((x) => x.note);
          settle(db, id, { ok: true, cost: r.costUsd, input: r.usage.input, cached: r.usage.cached, output: r.usage.output, latencyMs: r.latencyMs });
          report.spentUsd += r.costUsd;
          mr.costUsd += r.costUsd;
          lat.push(r.latencyMs);
          inTok += r.usage.input;
          outTok += r.usage.output;
          n++;
          if (failed.length === 0) mr.passed++;
          mr.caseResults.push({ case: c.id, run, ok: failed.length === 0, failed, latencyMs: r.latencyMs, costUsd: r.costUsd });
        } catch (e) {
          const err = e as AiError & { usage?: { input: number; cached: number; output: number }; latencyMs?: number };
          const cost = err.usage ? estimateCost(model, err.usage.input, err.usage.output, err.usage.cached) : 0;
          settle(db, id, { ok: false, cost, input: err.usage?.input ?? 0, cached: err.usage?.cached ?? 0, output: err.usage?.output ?? 0, latencyMs: err.latencyMs ?? 0, error: err.code });
          report.spentUsd += cost;
          mr.costUsd += cost;
          mr.caseResults.push({ case: c.id, run, ok: false, failed: [err.code ?? 'error'], latencyMs: err.latencyMs ?? null, costUsd: cost, error: err.message });
        }
      }
      if (report.stoppedByBudget) break;
    }
    mr.avgLatencyMs = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    mr.maxLatencyMs = lat.length ? Math.max(...lat) : null;
    mr.avgTokens = { input: n ? Math.round(inTok / n) : 0, output: n ? Math.round(outTok / n) : 0 };
    if (report.stoppedByBudget) break;
  }

  // Обработка ошибок: бесплатные проверки.
  try {
    await listModels({ ...client, apiKey: 'sk-invalid-key-for-test' });
    report.errorHandling.push({ name: 'неверный ключ', ok: false, note: 'ошибка не получена' });
  } catch (e) {
    report.errorHandling.push({ name: 'неверный ключ', ok: (e as AiError).code === 'auth', note: `код ${(e as AiError).code}` });
  }
  try {
    await callStructured({ ...client, timeoutMs: 1 }, models[0] ?? 'gpt-6-luna', SYS, 'тест', CASES[3]!.schema, 16);
    report.errorHandling.push({ name: 'тайм-аут', ok: false, note: 'ответ пришёл быстрее 1 мс' });
  } catch (e) {
    report.errorHandling.push({ name: 'тайм-аут', ok: (e as AiError).code === 'timeout', note: `код ${(e as AiError).code}` });
  }
  try {
    await callStructured(client, 'model-that-does-not-exist', SYS, 'тест', CASES[3]!.schema, 16);
    report.errorHandling.push({ name: 'несуществующая модель', ok: false, note: 'ошибка не получена' });
  } catch (e) {
    const code = (e as AiError).code;
    report.errorHandling.push({ name: 'несуществующая модель', ok: code === 'model_not_found' || code === 'bad_request', note: `код ${code}` });
  }
  return report;
}

/** Оценка месяца по измеренным токенам: 30 текстовых обращений в день + 1 план в неделю. */
export function monthlyScenario(report: EvalReport, chatModel: string, planModel: string) {
  const chat = report.models.find((m) => m.model === chatModel);
  const plan = report.models.find((m) => m.model === planModel);
  if (!chat || !plan || !chat.avgTokens.input || !plan.avgTokens.input) return null;
  const chatCall = estimateCost(chatModel, chat.avgTokens.input * 2, chat.avgTokens.output);
  const planCall = estimateCost(planModel, plan.avgTokens.input * 4, plan.avgTokens.output * 2);
  const month = chatCall * 30 * 30 + planCall * 5;
  return { chatCallUsd: chatCall, planCallUsd: planCall, monthUsd: month };
}

export function formatReport(r: EvalReport, chatModel: string, planModel: string): string {
  const lines: string[] = ['Проверка моделей OpenAI', ''];
  for (const m of r.models) {
    if (m.total === 0) {
      lines.push(`${m.model}: ${m.caseResults[0]?.failed.join(', ') ?? 'не проверена'}`);
      continue;
    }
    lines.push(
      `${m.model}: ${m.passed}/${m.total} без замечаний · средняя задержка ${fmtMs(m.avgLatencyMs)}, макс ${fmtMs(m.maxLatencyMs)} · ${fmtUsd(m.costUsd)}`
    );
    const fails = m.caseResults.filter((c) => !c.ok);
    for (const f of fails.slice(0, 6)) lines.push(`  — ${f.case} #${f.run}: ${f.failed.join('; ')}`);
  }
  lines.push('', 'Обработка ошибок:');
  for (const e of r.errorHandling) lines.push(`  ${e.ok ? '✓' : '✗'} ${e.name} (${e.note})`);
  lines.push('', `Потрачено на проверку: ${fmtUsd(r.spentUsd)}${r.stoppedByBudget ? ' · остановлено пределом бюджета' : ''}`);
  const s = monthlyScenario(r, chatModel, planModel);
  if (s) lines.push(`Оценка месяца (30 обращений в день к ${chatModel}, 5 планов к ${planModel}): ≈ ${fmtUsd(s.monthUsd)}`);
  return lines.join('\n');
}

function fmtMs(ms: number | null) {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)} с`;
}
export function fmtUsd(v: number) {
  return `${v.toFixed(v < 0.1 ? 4 : 2)} $`;
}
