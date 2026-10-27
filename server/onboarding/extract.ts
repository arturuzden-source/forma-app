import type { JsonSchema } from '../ai/openai.js';
import { DAYS, EQUIPMENT, GOAL_KINDS, PLACES } from '../profile/schema.js';

const n = (t: string | string[], extra: Record<string, unknown> = {}) => ({ type: [...(Array.isArray(t) ? t : [t]), 'null'], ...extra });
const nEnum = (vals: readonly string[]) => ({ type: ['string', 'null'], enum: [...vals, null] });
const nArr = (items: Record<string, unknown>) => ({ type: ['array', 'null'], items });
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const nObj = (props: Record<string, unknown>) => ({ ...obj(props), type: ['object', 'null'] });

const time = { type: 'string', description: 'ЧЧ:ММ, 24 часа' };

const fields = {
  name: n('string'),
  age: n('integer'),
  height_cm: n('integer'),
  weight_kg: n('number'),
  sex: nEnum(['male', 'female']),
  timezone: n('string', { description: 'IANA, например Europe/Moscow' }),
  goals: nArr(
    obj({
      kind: { type: 'string', enum: [...GOAL_KINDS] },
      title: { type: 'string', description: 'кратко по-русски' },
      metric: n('string', { description: 'например «подтягивания», «бег 3 км»' }),
      unit: n('string', { description: 'повт, мин:сек, кг, раз в неделю' }),
      baseline: n('number'),
      target: n('number', { description: 'для времени — в секундах' }),
      deadline: n('string', { description: 'ГГГГ-ММ-ДД' }),
      priority: { type: 'integer', description: '1 — главная' }
    })
  ),
  experience: nEnum(['none', 'beginner', 'intermediate', 'advanced']),
  sessions_per_week_now: n('integer'),
  break_weeks: n('integer'),
  known_results: nArr(obj({ metric: { type: 'string' }, value: { type: 'number', description: 'время — в секундах' }, unit: { type: 'string' } })),
  daily_activity: nEnum(['low', 'medium', 'high']),
  pains: nArr({ type: 'string' }),
  injuries: nArr({ type: 'string' }),
  doctor_notes: n('string'),
  discomfort_exercises: nArr({ type: 'string' }),
  schedule: nArr(obj({ day: { type: 'string', enum: [...DAYS] }, from: time, to: time })),
  max_minutes: n('integer'),
  sessions_per_week: n('integer'),
  schedule_flexible: n('boolean'),
  places: nArr({ type: 'string', enum: [...PLACES] }),
  equipment: nArr({ type: 'string', enum: [...EQUIPMENT] }),
  can_run: n('boolean'),
  place_notes: n('string'),
  sleep_hours: n('number'),
  sleep_quality: nEnum(['poor', 'ok', 'good']),
  fatigue: nEnum(['low', 'medium', 'high']),
  work_load: nEnum(['sedentary', 'mixed', 'physical']),
  nutrition_enabled: n('boolean'),
  food_preferences: n('string'),
  allergies: nArr({ type: 'string' }),
  excluded_foods: nArr({ type: 'string' }),
  food_budget: nObj({ amount: { type: 'number' }, currency: { type: 'string', description: 'RUB по умолчанию' }, period: { type: 'string', enum: ['day', 'week', 'month'] } }),
  cooking_minutes: n('integer'),
  meals_per_day: n('integer'),
  notify_types: nArr({ type: 'string', enum: ['workout', 'result', 'weekly', 'photo', 'comeback'] }),
  quiet_from: n('string'),
  quiet_to: n('string')
};

export const EXTRACT_SCHEMA: JsonSchema = {
  name: 'profile_update',
  schema: obj({
    updates: obj(fields),
    dont_know: { type: 'array', items: { type: 'string' }, description: 'поля, о которых пользователь прямо сказал «не знаю»' },
    clarify: n('string', { description: 'один короткий уточняющий вопрос, если ответ неоднозначен; иначе null' }),
    reply: { type: 'string', description: 'одна короткая фраза-реакция на русском, без вопросов и восклицаний' }
  })
};

export const EXTRACT_SYSTEM = [
  'Ты помогаешь заполнить профиль в приложении для тренировок. Извлеки из ответа пользователя данные профиля.',
  'Правила:',
  '— заполняй только то, что пользователь сказал явно; всё остальное — null. Ничего не придумывай и не подставляй «типичные» значения;',
  '— из одного сообщения можно извлечь несколько полей, в том числе не относящихся к текущему вопросу;',
  '— рост в сантиметрах, вес в килограммах, время результатов в секундах;',
  '— дни недели: mon tue wed thu fri sat sun. «Будни» = mon–fri. Если сказано «вечером после 19» без конца — to = 21:00 и упомяни это в reply;',
  '— цели: kind из списка; title по-русски кратко; если целей несколько и главная неясна — задай clarify о приоритете;',
  '— если ответ неоднозначен для текущего вопроса (например, «пару раз в неделю» без дней), задай clarify; иначе clarify = null;',
  '— бюджет питания: если валюта не названа — RUB; период обязателен, если не назван — спроси через clarify;',
  '— reply: одна короткая нейтральная фраза на «вы», без вопросов, без восклицательных знаков, без оценок человека.'
].join('\n');
