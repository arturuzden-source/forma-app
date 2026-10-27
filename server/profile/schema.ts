import { z } from 'zod';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_RU: Record<(typeof DAYS)[number], string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const GOAL_KINDS = ['strength', 'muscle', 'body_weight', 'endurance', 'standard', 'regularity', 'recovery', 'mobility'] as const;
export const GOAL_KIND_RU: Record<(typeof GOAL_KINDS)[number], string> = {
  strength: 'Сила',
  muscle: 'Мышечная масса',
  body_weight: 'Масса тела',
  endurance: 'Выносливость',
  standard: 'Норматив',
  regularity: 'Регулярность',
  recovery: 'Восстановление',
  mobility: 'Подвижность'
};

export const goalSchema = z.object({
  kind: z.enum(GOAL_KINDS),
  title: z.string().min(1).max(120),
  metric: z.string().max(60).nullable().default(null),
  unit: z.string().max(20).nullable().default(null),
  baseline: z.number().nullable().default(null),
  target: z.number().nullable().default(null),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  priority: z.number().int().min(1).max(5).default(1)
});
export type Goal = z.infer<typeof goalSchema>;

export const EQUIPMENT = ['none', 'pullup_bar', 'dumbbells', 'kettlebell', 'bands', 'bench', 'barbell', 'machines', 'mat', 'parallel_bars'] as const;
export const EQUIPMENT_RU: Record<(typeof EQUIPMENT)[number], string> = {
  none: 'без инвентаря',
  pullup_bar: 'турник',
  dumbbells: 'гантели',
  kettlebell: 'гиря',
  bands: 'резинки',
  bench: 'скамья',
  barbell: 'штанга',
  machines: 'тренажёры',
  mat: 'коврик',
  parallel_bars: 'брусья'
};
export const PLACES = ['home', 'outdoor', 'gym'] as const;
export const PLACE_RU: Record<(typeof PLACES)[number], string> = { home: 'дом', outdoor: 'улица', gym: 'зал' };

/**
 * Профиль. Все поля необязательны в черновике: беседа заполняет их постепенно.
 * Обязательность проверяется отдельно (REQUIRED), чтобы не придумывать значения.
 */
export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    age: z.number().int().min(14).max(100),
    height_cm: z.number().int().min(120).max(230),
    weight_kg: z.number().min(30).max(250),
    sex: z.enum(['male', 'female']),
    timezone: z.string().min(3).max(60),

    goals: z.array(goalSchema).max(6),

    experience: z.enum(['none', 'beginner', 'intermediate', 'advanced']),
    sessions_per_week_now: z.number().int().min(0).max(14),
    break_weeks: z.number().int().min(0).max(520),
    known_results: z.array(z.object({ metric: z.string().max(60), value: z.number(), unit: z.string().max(20) })).max(20),
    daily_activity: z.enum(['low', 'medium', 'high']),

    pains: z.array(z.string().max(200)).max(10),
    injuries: z.array(z.string().max(200)).max(10),
    doctor_notes: z.string().max(500),
    discomfort_exercises: z.array(z.string().max(120)).max(20),

    schedule: z.array(z.object({ day: z.enum(DAYS), from: time, to: time })).max(14),
    max_minutes: z.number().int().min(10).max(240),
    sessions_per_week: z.number().int().min(1).max(7),
    schedule_flexible: z.boolean(),

    places: z.array(z.enum(PLACES)).max(3),
    equipment: z.array(z.enum(EQUIPMENT)).max(10),
    can_run: z.boolean(),
    place_notes: z.string().max(300),

    sleep_hours: z.number().min(2).max(14),
    sleep_quality: z.enum(['poor', 'ok', 'good']),
    fatigue: z.enum(['low', 'medium', 'high']),
    work_load: z.enum(['sedentary', 'mixed', 'physical']),

    nutrition_enabled: z.boolean(),
    food_preferences: z.string().max(300),
    allergies: z.array(z.string().max(80)).max(20),
    excluded_foods: z.array(z.string().max(80)).max(30),
    food_budget: z.object({ amount: z.number().positive(), currency: z.string().min(1).max(8), period: z.enum(['day', 'week', 'month']) }),
    cooking_minutes: z.number().int().min(0).max(240),
    meals_per_day: z.number().int().min(1).max(8),

    notify_types: z.array(z.enum(['workout', 'result', 'weekly', 'photo', 'comeback'])),
    quiet_from: time,
    quiet_to: time,

    avatar: z.object({ sex: z.enum(['m', 'f']), build: z.number().int().min(1).max(3), hidden: z.boolean() })
  })
  .partial();

export type Profile = z.infer<typeof profileSchema>;
export type ProfileField = keyof Profile;
export const PROFILE_FIELDS = Object.keys(profileSchema.shape) as ProfileField[];

/** Без этих полей план не строится. «Не знаю» допустимо для части из них (см. темы). */
export const REQUIRED: ProfileField[] = ['name', 'age', 'height_cm', 'weight_kg', 'timezone', 'goals', 'experience', 'schedule', 'max_minutes', 'places', 'equipment'];

export function missingRequired(p: Profile, unknown: string[]): ProfileField[] {
  return REQUIRED.filter((f) => {
    if (unknown.includes(f)) return false;
    const v = p[f];
    if (v === undefined || v === null) return true;
    if (Array.isArray(v) && v.length === 0 && f !== 'equipment') return true;
    return false;
  });
}

/**
 * Проверить и слить частичное обновление. Невалидные поля отбрасываются
 * (не сохраняем то, что не прошло схему), null не затирает существующее значение.
 */
export function mergeProfile(current: Profile, patch: Record<string, unknown>): { next: Profile; changed: ProfileField[]; rejected: string[] } {
  const next: Profile = { ...current };
  const changed: ProfileField[] = [];
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in profileSchema.shape)) {
      rejected.push(k);
      continue;
    }
    if (v === null || v === undefined) continue;
    const field = k as ProfileField;
    const parsed = (profileSchema.shape[field] as z.ZodTypeAny).safeParse(v);
    if (!parsed.success) {
      rejected.push(k);
      continue;
    }
    if (JSON.stringify(next[field]) !== JSON.stringify(parsed.data)) {
      (next as Record<string, unknown>)[field] = parsed.data;
      changed.push(field);
    }
  }
  return { next, changed, rejected };
}
