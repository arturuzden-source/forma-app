export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DAY_RU: Record<string, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
export const EQUIPMENT_RU: Record<string, string> = {
  none: 'без инвентаря', pullup_bar: 'турник', dumbbells: 'гантели', kettlebell: 'гиря', bands: 'резинки', bench: 'скамья',
  barbell: 'штанга', machines: 'тренажёры', mat: 'коврик', parallel_bars: 'брусья'
};
export const PLACE_RU: Record<string, string> = { home: 'дом', outdoor: 'улица', gym: 'зал' };
export const GOAL_KIND_RU: Record<string, string> = {
  strength: 'Сила', muscle: 'Мышечная масса', body_weight: 'Масса тела', endurance: 'Выносливость', standard: 'Норматив',
  regularity: 'Регулярность', recovery: 'Восстановление', mobility: 'Подвижность'
};
export const EXPERIENCE_RU: Record<string, string> = { none: 'не тренируюсь', beginner: 'меньше года', intermediate: '1–3 года', advanced: 'больше 3 лет' };
export const ACTIVITY_RU: Record<string, string> = { low: 'низкая', medium: 'средняя', high: 'высокая' };
export const SLEEP_Q_RU: Record<string, string> = { poor: 'плохо', ok: 'нормально', good: 'хорошо' };
export const FATIGUE_RU: Record<string, string> = { low: 'низкая', medium: 'средняя', high: 'высокая' };
export const WORK_RU: Record<string, string> = { sedentary: 'сидячая', mixed: 'смешанная', physical: 'физическая' };
export const PERIOD_RU: Record<string, string> = { day: 'в день', week: 'в неделю', month: 'в месяц' };
export const NOTIFY_RU: Record<string, string> = { workout: 'о тренировке', result: 'внести результат', weekly: 'итоги недели', photo: 'фотоотчёт', comeback: 'после перерыва' };
export const CATEGORY_RU: Record<string, string> = { warmup: 'Разминка', mobility: 'Подвижность', strength: 'Сила', core: 'Корпус', cardio: 'Бег' };
export const LEVEL_RU: Record<number, string> = { 1: 'Уровень 1', 2: 'Уровень 2', 3: 'Уровень 3' };
export const FIELD_RU: Record<string, string> = {
  name: 'Имя', age: 'Возраст', height_cm: 'Рост', weight_kg: 'Вес', sex: 'Пол', timezone: 'Часовой пояс', goals: 'Цели',
  experience: 'Опыт', schedule: 'Расписание', max_minutes: 'Длительность занятия', places: 'Место', equipment: 'Оборудование',
  food_budget: 'Бюджет', nutrition_enabled: 'Питание'
};

export function list(items: string[] | undefined, dict?: Record<string, string>) {
  if (!items || items.length === 0) return '';
  return items.map((x) => (dict ? dict[x] ?? x : x)).join(', ');
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
