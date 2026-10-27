import type { JsonSchema } from '../ai/openai.js';
import type { Exercise } from '../catalog/store.js';
import type { Profile } from '../profile/schema.js';
import type { Proposed, Window } from './planner.js';
import { targetSessions } from './planner.js';
import { healthText } from './content.js';

const nInt = { type: ['integer', 'null'] };

export const PLAN_SCHEMA: JsonSchema = {
  name: 'week_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['sessions', 'explanation'],
    properties: {
      sessions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'start_time', 'title', 'purpose', 'warmup_min', 'cooldown_min', 'items'],
          properties: {
            date: { type: 'string', description: 'ГГГГ-ММ-ДД из списка окон' },
            start_time: { type: 'string', description: 'ЧЧ:ММ' },
            title: { type: 'string', description: 'коротко, по-русски' },
            purpose: { type: 'string', description: 'задача занятия одной фразой' },
            warmup_min: { type: 'integer' },
            cooldown_min: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['exercise_id', 'sets', 'reps', 'seconds', 'meters', 'rest_s', 'note'],
                properties: {
                  exercise_id: { type: 'string' },
                  sets: { type: 'integer' },
                  reps: nInt,
                  seconds: nInt,
                  meters: nInt,
                  rest_s: { type: 'integer' },
                  note: { type: ['string', 'null'], description: 'ориентир интенсивности, например «запас 2 повтора»' }
                }
              }
            }
          }
        }
      },
      explanation: { type: 'string', description: '2–4 предложения: почему такая нагрузка и как она связана с целью; на какие данные опирается' }
    }
  }
};

export const PLAN_SYSTEM = [
  'Ты составляешь недельный план тренировок для приложения. Отвечай по-русски, строго по JSON-схеме.',
  'Жёсткие правила (сервер их проверяет и отклонит план с нарушениями):',
  '— только упражнения из списка allowed_exercises, по их id; не придумывай упражнений;',
  '— только даты и время из windows; начало не раньше earliest; занятие целиком (разминка + подходы + отдых + заминка) помещается в окно;',
  '— длительность занятия считается так: разминка + заминка + для каждого упражнения: подходы × (повторы×3 с, или секунды, или метры×0,36 с) + отдых между подходами + 45 с на переход; итог не больше max_minutes;',
  '— не больше sessions_target занятий, не больше двух тренировочных дней подряд, одно занятие в день;',
  '— для measure=reps указывай reps, для time — seconds, для distance — meters или seconds; остальные поля null;',
  '— учитывай ограничения по здоровью: при сомнении выбирай более щадящее упражнение;',
  '— стартовая нагрузка умеренная, с запасом. Нагрузку повышай только при наличии результатов, а не из-за новой недели;',
  '— если данных о результатах нет, прямо скажи об этом в explanation.',
  'В explanation не обещай гарантированного результата и не используй восклицательные знаки.'
].join('\n');

export function planPrompt(p: Profile, windows: Window[], allowed: Exercise[], history: unknown, today: string) {
  return JSON.stringify({
    today,
    windows: windows.map((w) => ({ date: w.date, earliest: w.earliest, to: w.to })),
    sessions_target: targetSessions(p, windows),
    max_minutes: p.max_minutes ?? 60,
    athlete: {
      age: p.age ?? null,
      experience: p.experience ?? null,
      sessions_per_week_now: p.sessions_per_week_now ?? null,
      break_weeks: p.break_weeks ?? null,
      goals: (p.goals ?? []).map((g) => ({ kind: g.kind, title: g.title, baseline: g.baseline, target: g.target, unit: g.unit, deadline: g.deadline, priority: g.priority })),
      known_results: p.known_results ?? [],
      limitations: healthText(p) || 'нет',
      places: p.places ?? [],
      can_run: p.can_run ?? null,
      sleep_hours: p.sleep_hours ?? null,
      fatigue: p.fatigue ?? null
    },
    allowed_exercises: allowed.map((e) => ({ id: e.id, name: e.name, pattern: e.pattern, measure: e.measure, level: e.level })),
    recent_results: history
  });
}

export function toProposed(json: unknown): Proposed[] {
  const r = json as { sessions?: { date: string; start_time: string; title: string; purpose: string; warmup_min: number; cooldown_min: number; items: Proposed['content']['items'] }[] };
  return (r.sessions ?? []).map((s) => ({
    date: s.date,
    start_time: s.start_time,
    title: s.title,
    purpose: s.purpose,
    content: { warmup_min: s.warmup_min, cooldown_min: s.cooldown_min, items: s.items }
  }));
}
