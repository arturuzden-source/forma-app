import type { Profile, ProfileField } from '../profile/schema.js';

export type Quick = { id: string; label: string; patch?: Record<string, unknown>; unknown?: ProfileField[]; skip?: boolean };

export type Topic = {
  id: string;
  question: string | ((p: Profile, ctx: { tz?: string }) => string);
  why?: string;
  /** Поля темы: тема закрыта, когда все обязательные из них заполнены или отмечены «не знаю». */
  fields: ProfileField[];
  required: ProfileField[];
  quick?: Quick[] | ((p: Profile, ctx: { tz?: string }) => Quick[]);
  when?: (p: Profile) => boolean;
  optional?: boolean;
};

const SKIP: Quick = { id: 'later', label: 'Заполню позже', skip: true };

export const TOPICS: Topic[] = [
  {
    id: 'name',
    question: 'Привет! Я помогу составить план тренировок под вашу жизнь. Как к вам обращаться?',
    fields: ['name'],
    required: ['name']
  },
  {
    id: 'basics',
    question: (p) => `${p.name ? p.name + ', с' : 'С'}колько вам лет, какой рост и вес?`,
    why: 'Нужно, чтобы подобрать нагрузку и ориентиры питания. Эти данные видите только вы.',
    fields: ['age', 'height_cm', 'weight_kg'],
    required: ['age', 'height_cm', 'weight_kg']
  },
  {
    id: 'sex',
    question: 'Для расчёта калорий формулы различаются по полу. Какой указать?',
    why: 'Используется только в расчётах питания. Можно не указывать — тогда ориентиры будут шире.',
    fields: ['sex'],
    required: [],
    quick: [
      { id: 'm', label: 'Мужской', patch: { sex: 'male' } },
      { id: 'f', label: 'Женский', patch: { sex: 'female' } },
      { id: 'no', label: 'Не указывать', unknown: ['sex'] }
    ]
  },
  {
    id: 'goals',
    question: 'Чего хотите добиться в ближайшие месяцы? Опишите своими словами — например, «подтягиваться 18 раз и пробежать 3 км быстрее». Если есть срок — назовите.',
    fields: ['goals'],
    required: ['goals']
  },
  {
    id: 'experience',
    question: 'Какой у вас опыт тренировок? Сколько раз в неделю занимаетесь сейчас и был ли перерыв?',
    fields: ['experience', 'sessions_per_week_now', 'break_weeks', 'daily_activity'],
    required: ['experience'],
    quick: [
      { id: 'none', label: 'Не тренируюсь', patch: { experience: 'none', sessions_per_week_now: 0 } },
      { id: 'beg', label: 'Меньше года', patch: { experience: 'beginner' } },
      { id: 'mid', label: '1–3 года', patch: { experience: 'intermediate' } },
      { id: 'adv', label: 'Больше 3 лет', patch: { experience: 'advanced' } }
    ]
  },
  {
    id: 'results',
    question: 'Знаете свои текущие результаты? Например, сколько раз подтягиваетесь, время на 3 км, рабочие веса. «Не знаю» — тоже нормальный ответ, тестов сдавать не нужно.',
    fields: ['known_results'],
    required: [],
    optional: true,
    quick: [{ id: 'dk', label: 'Не знаю', unknown: ['known_results'] }]
  },
  {
    id: 'health',
    question: 'Есть ли сейчас боли, травмы, ограничения или рекомендации врача? Упражнения, которые вызывают дискомфорт?',
    why: 'Чтобы не ставить в план то, что может навредить. Я не ставлю диагнозы и не отменяю рекомендации врача.',
    fields: ['pains', 'injuries', 'doctor_notes', 'discomfort_exercises'],
    required: [],
    quick: [{ id: 'none', label: 'Ничего такого', patch: { pains: [], injuries: [], doctor_notes: '', discomfort_exercises: [] } }]
  },
  {
    id: 'schedule',
    question: 'В какие дни и в какое время можете тренироваться? Сколько минут максимум на одно занятие и сколько занятий в неделю хотите?',
    fields: ['schedule', 'max_minutes', 'sessions_per_week', 'schedule_flexible'],
    required: ['schedule', 'max_minutes']
  },
  {
    id: 'place',
    question: 'Где будете заниматься — дома, на улице, в зале? Что есть из инвентаря? Можно ли бегать?',
    fields: ['places', 'equipment', 'can_run', 'place_notes'],
    required: ['places', 'equipment'],
    quick: [
      { id: 'home0', label: 'Дома без инвентаря', patch: { places: ['home'], equipment: ['none'] } },
      { id: 'bar', label: 'Дом + турник во дворе', patch: { places: ['home', 'outdoor'], equipment: ['pullup_bar'] } },
      { id: 'gym', label: 'Зал', patch: { places: ['gym'], equipment: ['barbell', 'dumbbells', 'machines', 'bench', 'pullup_bar'] } }
    ]
  },
  {
    id: 'recovery',
    question: 'Сколько обычно спите и как себя чувствуете днём? Работа сидячая или физическая?',
    fields: ['sleep_hours', 'sleep_quality', 'fatigue', 'work_load'],
    required: [],
    optional: true
  },
  {
    id: 'nutrition',
    question: 'Нужен ли раздел питания: меню, замены блюд, дневник? Его можно включить и позже.',
    fields: ['nutrition_enabled'],
    required: ['nutrition_enabled'],
    quick: [
      { id: 'yes', label: 'Да, нужен', patch: { nutrition_enabled: true } },
      { id: 'no', label: 'Пока нет', patch: { nutrition_enabled: false } }
    ]
  },
  {
    id: 'food',
    when: (p) => p.nutrition_enabled === true,
    question: 'Есть ли аллергии или продукты, которые вы не едите? Какой бюджет на продукты и за какой период? Сколько времени готовы готовить и сколько приёмов пищи удобно?',
    fields: ['allergies', 'excluded_foods', 'food_preferences', 'food_budget', 'cooking_minutes', 'meals_per_day'],
    required: ['food_budget'],
    optional: true
  },
  {
    id: 'notify',
    question: 'Какие напоминания присылать в Telegram и когда точно не беспокоить?',
    fields: ['notify_types', 'quiet_from', 'quiet_to'],
    required: [],
    quick: [
      { id: 'all', label: 'Все, тихо с 22 до 8', patch: { notify_types: ['workout', 'result', 'weekly', 'photo', 'comeback'], quiet_from: '22:00', quiet_to: '08:00' } },
      { id: 'min', label: 'Только о тренировках', patch: { notify_types: ['workout', 'weekly'], quiet_from: '22:00', quiet_to: '08:00' } },
      { id: 'off', label: 'Без напоминаний', patch: { notify_types: [] } }
    ]
  },
  {
    id: 'timezone',
    question: (_p, ctx) => (ctx.tz ? `Ваш часовой пояс по данным телефона — ${ctx.tz}. Верно?` : 'В каком городе или часовом поясе вы живёте?'),
    fields: ['timezone'],
    required: ['timezone'],
    quick: (_p, ctx) => (ctx.tz ? [{ id: 'yes', label: 'Да, верно', patch: { timezone: ctx.tz } }] : [])
  },
  {
    id: 'avatar',
    question: 'Последнее: выберите персонажа для главного экрана. Это иллюстрация для мотивации, а не измерение тела. Вариант можно сменить в любой момент.',
    fields: ['avatar'],
    required: [],
    quick: [
      { id: 'm1', label: 'Мужской · 1', patch: { avatar: { sex: 'm', build: 1, hidden: false } } },
      { id: 'm2', label: 'Мужской · 2', patch: { avatar: { sex: 'm', build: 2, hidden: false } } },
      { id: 'm3', label: 'Мужской · 3', patch: { avatar: { sex: 'm', build: 3, hidden: false } } },
      { id: 'f1', label: 'Женский · 1', patch: { avatar: { sex: 'f', build: 1, hidden: false } } },
      { id: 'f2', label: 'Женский · 2', patch: { avatar: { sex: 'f', build: 2, hidden: false } } },
      { id: 'f3', label: 'Женский · 3', patch: { avatar: { sex: 'f', build: 3, hidden: false } } },
      { id: 'hide', label: 'Не показывать', patch: { avatar: { sex: 'm', build: 2, hidden: true } } }
    ]
  }
];

export function topicQuick(t: Topic, p: Profile, ctx: { tz?: string }): Quick[] {
  const q = typeof t.quick === 'function' ? t.quick(p, ctx) : t.quick ?? [];
  return t.required.length === 0 || t.optional ? q : [...q, SKIP];
}

export function topicQuestion(t: Topic, p: Profile, ctx: { tz?: string }) {
  return typeof t.question === 'function' ? t.question(p, ctx) : t.question;
}

/** Тема закрыта: все её обязательные поля есть или отмечены «не знаю»; для необязательных — есть хоть одно поле. */
export function topicSatisfied(t: Topic, p: Profile, unknown: string[]) {
  const has = (f: ProfileField) => p[f] !== undefined || unknown.includes(f);
  if (t.required.length) return t.required.every(has);
  return t.fields.some(has);
}
