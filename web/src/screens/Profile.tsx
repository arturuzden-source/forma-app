import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import type { Goal, Profile as P, ProfileResp, Slot } from '../types';
import { Banner, Spinner, TopBar } from '../components/ui';
import {
  ACTIVITY_RU, DAY_RU, DAYS, EQUIPMENT_RU, EXPERIENCE_RU, FATIGUE_RU, FIELD_RU, GOAL_KIND_RU, NOTIFY_RU, PERIOD_RU, PLACE_RU,
  SLEEP_Q_RU, WORK_RU, list
} from '../labels';

type SectionId = 'basics' | 'goals' | 'experience' | 'health' | 'schedule' | 'place' | 'recovery' | 'nutrition' | 'notify' | 'other';

export function Profile({ onBack, onConfirmed, onOnboarding }: { onBack: () => void; onConfirmed: () => void; onOnboarding: () => void }) {
  const [r, setR] = useState<ProfileResp | null>(null);
  const [edit, setEdit] = useState<SectionId | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api<ProfileResp>('/api/profile').then(setR).catch(() => setErr('Нет связи с сервером.'));
  useEffect(() => {
    void load();
  }, []);

  async function save(patch: Partial<P>, unknownFields?: string[]) {
    if (!r) return false;
    setSaving(true);
    setErr(null);
    try {
      const next = await api<ProfileResp>('/api/profile', { method: 'PATCH', body: JSON.stringify({ version: r.version, patch, unknown: unknownFields }) });
      setR({ ...r, ...next });
      haptic('success');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Профиль изменился в другом окне — данные обновлены, повторите правку.');
        await load();
      } else if (e instanceof ApiError && e.status === 422) setErr('Некоторые значения вне допустимых пределов — проверьте и сохраните ещё раз.');
      else setErr('Нет связи — изменения не сохранены.');
      haptic('error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    if (!r) return;
    setSaving(true);
    setErr(null);
    try {
      await api('/api/profile/confirm', { method: 'POST', body: JSON.stringify({ version: r.version }) });
      haptic('success');
      onConfirmed();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Профиль изменился — проверьте данные ещё раз.');
        await load();
      } else setErr('Не удалось подтвердить. Проверьте обязательные поля и связь.');
    } finally {
      setSaving(false);
    }
  }

  if (!r)
    return (
      <div className="screen-full">
        <TopBar title="Профиль" left={<button className="link" onClick={onBack}>Назад</button>} />
        <div className="pad">{err ? <p className="muted">{err}</p> : <Spinner />}</div>
      </div>
    );

  const d = r.data;
  const unk = (f: string) => r.unknown.includes(f);
  const val = (v: ReactNode, f: string) => (v === undefined || v === null || v === '' ? <span className={r.missing.includes(f) ? 'miss' : 'faint'}>{unk(f) ? 'не знаю' : r.missing.includes(f) ? 'нужно заполнить' : 'не указано'}</span> : v);

  return (
    <div className="screen-full">
      <TopBar title={r.status === 'confirmed' ? 'Профиль' : 'Проверьте данные'} sub={r.status === 'confirmed' ? 'подтверждён' : 'перед первым планом'} left={<button className="link" onClick={onBack}>Назад</button>} />
      <main className="scroll pad stack">
        {r.status === 'draft' && <p className="muted">Я записал только то, что вы сказали. Необязательное можно заполнить позже.</p>}
        {err && <Banner kind="warn" title={err} />}
        {r.missing.length > 0 && (
          <Banner kind="warn" title="Не хватает для плана">
            <p className="muted">{r.missing.map((f) => FIELD_RU[f] ?? f).join(', ')}</p>
          </Banner>
        )}

        <Section title="Основное" onEdit={() => setEdit('basics')}>
          <Row k="Имя" v={val(d.name, 'name')} />
          <Row k="Возраст" v={val(d.age, 'age')} />
          <Row k="Рост" v={val(d.height_cm && `${d.height_cm} см`, 'height_cm')} />
          <Row k="Вес" v={val(d.weight_kg && `${d.weight_kg} кг`, 'weight_kg')} />
          <Row k="Пол для расчётов" v={val(d.sex && (d.sex === 'male' ? 'мужской' : 'женский'), 'sex')} />
          <Row k="Часовой пояс" v={val(d.timezone, 'timezone')} />
        </Section>

        <Section title="Цели" onEdit={() => setEdit('goals')}>
          {(d.goals ?? []).length === 0 && <Row k="Цели" v={val(undefined, 'goals')} />}
          {(d.goals ?? []).map((g, i) => (
            <Row key={i} k={i === 0 ? 'Главная' : GOAL_KIND_RU[g.kind] ?? 'Цель'} v={`${g.title}${g.target != null ? ` → ${g.target}${g.unit ? ' ' + g.unit : ''}` : ''}${g.deadline ? `, до ${g.deadline}` : ''}`} />
          ))}
        </Section>

        <Section title="Подготовка" onEdit={() => setEdit('experience')}>
          <Row k="Опыт" v={val(d.experience && EXPERIENCE_RU[d.experience], 'experience')} />
          <Row k="Занятий в неделю сейчас" v={val(d.sessions_per_week_now, 'sessions_per_week_now')} />
          <Row k="Перерыв" v={val(d.break_weeks != null ? `${d.break_weeks} нед.` : undefined, 'break_weeks')} />
          <Row k="Активность днём" v={val(d.daily_activity && ACTIVITY_RU[d.daily_activity], 'daily_activity')} />
          <Row k="Результаты" v={val((d.known_results ?? []).map((x) => `${x.metric}: ${x.value} ${x.unit}`).join('; '), 'known_results')} />
        </Section>

        <Section title="Самочувствие и ограничения" onEdit={() => setEdit('health')}>
          <Row k="Боли" v={val(list(d.pains) || (d.pains ? 'нет' : undefined), 'pains')} />
          <Row k="Травмы" v={val(list(d.injuries) || (d.injuries ? 'нет' : undefined), 'injuries')} />
          <Row k="Рекомендации врача" v={val(d.doctor_notes === '' ? 'нет' : d.doctor_notes, 'doctor_notes')} />
          <Row k="Дискомфорт" v={val(list(d.discomfort_exercises) || (d.discomfort_exercises ? 'нет' : undefined), 'discomfort_exercises')} />
        </Section>

        <Section title="Расписание" onEdit={() => setEdit('schedule')}>
          {(d.schedule ?? []).length === 0 && <Row k="Дни и время" v={val(undefined, 'schedule')} />}
          {(d.schedule ?? []).map((s, i) => <Row key={i} k={DAY_RU[s.day] ?? s.day} v={`${s.from}–${s.to}`} />)}
          <Row k="Длительность" v={val(d.max_minutes && `до ${d.max_minutes} мин`, 'max_minutes')} />
          <Row k="Занятий в неделю" v={val(d.sessions_per_week, 'sessions_per_week')} />
        </Section>

        <Section title="Место и оборудование" onEdit={() => setEdit('place')}>
          <Row k="Где" v={val(list(d.places, PLACE_RU), 'places')} />
          <Row k="Инвентарь" v={val(list(d.equipment, EQUIPMENT_RU), 'equipment')} />
          <Row k="Бег" v={val(d.can_run === undefined ? undefined : d.can_run ? 'можно' : 'нельзя', 'can_run')} />
        </Section>

        <Section title="Восстановление" onEdit={() => setEdit('recovery')}>
          <Row k="Сон" v={val(d.sleep_hours && `${d.sleep_hours} ч${d.sleep_quality ? ', ' + SLEEP_Q_RU[d.sleep_quality] : ''}`, 'sleep_hours')} />
          <Row k="Усталость" v={val(d.fatigue && FATIGUE_RU[d.fatigue], 'fatigue')} />
          <Row k="Работа" v={val(d.work_load && WORK_RU[d.work_load], 'work_load')} />
        </Section>

        <Section title="Питание" onEdit={() => setEdit('nutrition')}>
          <Row k="Раздел питания" v={val(d.nutrition_enabled === undefined ? undefined : d.nutrition_enabled ? 'включён' : 'выключен', 'nutrition_enabled')} />
          {d.nutrition_enabled && (
            <>
              <Row k="Бюджет" v={val(d.food_budget && `${d.food_budget.amount.toLocaleString('ru-RU')} ${d.food_budget.currency === 'RUB' ? '₽' : d.food_budget.currency} ${PERIOD_RU[d.food_budget.period]}`, 'food_budget')} />
              <Row k="Аллергии" v={val(list(d.allergies) || (d.allergies ? 'нет' : undefined), 'allergies')} />
              <Row k="Не ем" v={val(list(d.excluded_foods) || (d.excluded_foods ? 'всё ем' : undefined), 'excluded_foods')} />
              <Row k="Готовка" v={val(d.cooking_minutes != null ? `до ${d.cooking_minutes} мин` : undefined, 'cooking_minutes')} />
              <Row k="Приёмов пищи" v={val(d.meals_per_day, 'meals_per_day')} />
            </>
          )}
        </Section>

        <Section title="Напоминания" onEdit={() => setEdit('notify')}>
          <Row k="Типы" v={val(d.notify_types ? (d.notify_types.length ? list(d.notify_types, NOTIFY_RU) : 'выключены') : undefined, 'notify_types')} />
          <Row k="Тихие часы" v={val(d.quiet_from && d.quiet_to ? `${d.quiet_from}–${d.quiet_to}` : undefined, 'quiet_from')} />
        </Section>

        {r.status === 'draft' && (
          <button className="link" onClick={onOnboarding}>Вернуться к беседе</button>
        )}
      </main>
      {r.status === 'draft' && (
        <div className="footer">
          <button className="btn" disabled={saving || r.missing.length > 0} onClick={() => void confirm()}>
            {r.missing.length > 0 ? 'Заполните обязательные поля' : 'Всё верно — подтвердить'}
          </button>
        </div>
      )}
      {edit && <EditSheet section={edit} data={d} saving={saving} onClose={() => setEdit(null)} onSave={async (patch, u) => { if (await save(patch, u)) setEdit(null); }} />}
    </div>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <p className="label">{title}</p>
        <button className="link small" onClick={onEdit}>Изменить</button>
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

// ——— Редактор раздела ———

function num(s: string): number | undefined {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
}
function splitList(s: string) {
  return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

function EditSheet({ section, data, saving, onClose, onSave }: { section: SectionId; data: P; saving: boolean; onClose: () => void; onSave: (p: Partial<P>, unknown?: string[]) => void }) {
  const [d, setD] = useState<P>(JSON.parse(JSON.stringify(data)));
  const set = <K extends keyof P>(k: K, v: P[K]) => setD((x) => ({ ...x, [k]: v }));
  const [lists, setLists] = useState({
    pains: (data.pains ?? []).join(', '),
    injuries: (data.injuries ?? []).join(', '),
    discomfort: (data.discomfort_exercises ?? []).join(', '),
    allergies: (data.allergies ?? []).join(', '),
    excluded: (data.excluded_foods ?? []).join(', ')
  });

  function submit() {
    const patch: Partial<P> = {};
    const pick = (...keys: (keyof P)[]) => keys.forEach((k) => d[k] !== undefined && ((patch as Record<string, unknown>)[k] = d[k]));
    switch (section) {
      case 'basics':
        pick('name', 'age', 'height_cm', 'weight_kg', 'sex', 'timezone');
        break;
      case 'goals':
        patch.goals = (d.goals ?? []).filter((g) => g.title.trim()).map((g, i) => ({ ...g, priority: i + 1 }));
        break;
      case 'experience':
        pick('experience', 'sessions_per_week_now', 'break_weeks', 'daily_activity');
        break;
      case 'health':
        patch.pains = splitList(lists.pains);
        patch.injuries = splitList(lists.injuries);
        patch.discomfort_exercises = splitList(lists.discomfort);
        patch.doctor_notes = d.doctor_notes ?? '';
        break;
      case 'schedule':
        pick('schedule', 'max_minutes', 'sessions_per_week');
        break;
      case 'place':
        pick('places', 'equipment', 'can_run');
        break;
      case 'recovery':
        pick('sleep_hours', 'sleep_quality', 'fatigue', 'work_load');
        break;
      case 'nutrition':
        pick('nutrition_enabled', 'food_budget', 'cooking_minutes', 'meals_per_day');
        patch.allergies = splitList(lists.allergies);
        patch.excluded_foods = splitList(lists.excluded);
        break;
      case 'notify':
        pick('notify_types', 'quiet_from', 'quiet_to');
        break;
    }
    onSave(patch);
  }

  const toggle = (arr: string[] | undefined, v: string) => (arr ?? []).includes(v) ? (arr ?? []).filter((x) => x !== v) : [...(arr ?? []), v];

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true">
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        <div className="stack scroll-y">
          {section === 'basics' && (
            <>
              <Field label="Имя"><input className="input" value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
              <div className="grid3">
                <Field label="Возраст"><input className="input" inputMode="numeric" value={d.age ?? ''} onChange={(e) => set('age', num(e.target.value))} /></Field>
                <Field label="Рост, см"><input className="input" inputMode="numeric" value={d.height_cm ?? ''} onChange={(e) => set('height_cm', num(e.target.value))} /></Field>
                <Field label="Вес, кг"><input className="input" inputMode="decimal" value={d.weight_kg ?? ''} onChange={(e) => set('weight_kg', num(e.target.value))} /></Field>
              </div>
              <Field label="Пол для расчётов питания">
                <Seg value={d.sex} options={[['male', 'Мужской'], ['female', 'Женский']]} onChange={(v) => set('sex', v as P['sex'])} />
              </Field>
              <Field label="Часовой пояс"><TzSelect value={d.timezone} onChange={(v) => set('timezone', v)} /></Field>
            </>
          )}
          {section === 'goals' && <GoalsEditor goals={d.goals ?? []} onChange={(g) => set('goals', g)} />}
          {section === 'experience' && (
            <>
              <Field label="Опыт"><Seg value={d.experience} options={Object.entries(EXPERIENCE_RU)} onChange={(v) => set('experience', v)} /></Field>
              <div className="grid2">
                <Field label="Занятий в неделю сейчас"><input className="input" inputMode="numeric" value={d.sessions_per_week_now ?? ''} onChange={(e) => set('sessions_per_week_now', num(e.target.value))} /></Field>
                <Field label="Перерыв, недель"><input className="input" inputMode="numeric" value={d.break_weeks ?? ''} onChange={(e) => set('break_weeks', num(e.target.value))} /></Field>
              </div>
              <Field label="Активность днём"><Seg value={d.daily_activity} options={Object.entries(ACTIVITY_RU)} onChange={(v) => set('daily_activity', v)} /></Field>
              <p className="muted">Известные результаты можно добавить в беседе с помощником.</p>
            </>
          )}
          {section === 'health' && (
            <>
              <p className="muted">Через запятую. Пустое поле — «нет». ИИ не ставит диагнозы и не отменяет рекомендации врача.</p>
              <Field label="Боли"><input className="input" value={lists.pains} onChange={(e) => setLists({ ...lists, pains: e.target.value })} /></Field>
              <Field label="Травмы"><input className="input" value={lists.injuries} onChange={(e) => setLists({ ...lists, injuries: e.target.value })} /></Field>
              <Field label="Упражнения с дискомфортом"><input className="input" value={lists.discomfort} onChange={(e) => setLists({ ...lists, discomfort: e.target.value })} /></Field>
              <Field label="Рекомендации врача"><textarea className="input" rows={3} value={d.doctor_notes ?? ''} onChange={(e) => set('doctor_notes', e.target.value)} /></Field>
            </>
          )}
          {section === 'schedule' && (
            <>
              <ScheduleEditor slots={d.schedule ?? []} onChange={(s) => set('schedule', s)} />
              <div className="grid2">
                <Field label="Максимум минут"><input className="input" inputMode="numeric" value={d.max_minutes ?? ''} onChange={(e) => set('max_minutes', num(e.target.value))} /></Field>
                <Field label="Занятий в неделю"><input className="input" inputMode="numeric" value={d.sessions_per_week ?? ''} onChange={(e) => set('sessions_per_week', num(e.target.value))} /></Field>
              </div>
            </>
          )}
          {section === 'place' && (
            <>
              <Field label="Где заниматься">
                <div className="chips">{Object.entries(PLACE_RU).map(([k, l]) => <button key={k} className={`chip-btn${(d.places ?? []).includes(k) ? ' on' : ''}`} onClick={() => set('places', toggle(d.places, k))}>{l}</button>)}</div>
              </Field>
              <Field label="Инвентарь">
                <div className="chips">{Object.entries(EQUIPMENT_RU).map(([k, l]) => <button key={k} className={`chip-btn${(d.equipment ?? []).includes(k) ? ' on' : ''}`} onClick={() => set('equipment', toggle(d.equipment, k))}>{l}</button>)}</div>
              </Field>
              <Field label="Бег"><Seg value={d.can_run === undefined ? undefined : d.can_run ? 'y' : 'n'} options={[['y', 'Можно'], ['n', 'Нельзя']]} onChange={(v) => set('can_run', v === 'y')} /></Field>
            </>
          )}
          {section === 'recovery' && (
            <>
              <Field label="Сон, часов"><input className="input" inputMode="decimal" value={d.sleep_hours ?? ''} onChange={(e) => set('sleep_hours', num(e.target.value))} /></Field>
              <Field label="Качество сна"><Seg value={d.sleep_quality} options={Object.entries(SLEEP_Q_RU)} onChange={(v) => set('sleep_quality', v)} /></Field>
              <Field label="Усталость"><Seg value={d.fatigue} options={Object.entries(FATIGUE_RU)} onChange={(v) => set('fatigue', v)} /></Field>
              <Field label="Работа"><Seg value={d.work_load} options={Object.entries(WORK_RU)} onChange={(v) => set('work_load', v)} /></Field>
            </>
          )}
          {section === 'nutrition' && (
            <>
              <Field label="Раздел питания"><Seg value={d.nutrition_enabled === undefined ? undefined : d.nutrition_enabled ? 'y' : 'n'} options={[['y', 'Включён'], ['n', 'Выключен']]} onChange={(v) => set('nutrition_enabled', v === 'y')} /></Field>
              {d.nutrition_enabled && (
                <>
                  <div className="grid3">
                    <Field label="Бюджет"><input className="input" inputMode="numeric" value={d.food_budget?.amount ?? ''} onChange={(e) => set('food_budget', { currency: 'RUB', period: 'month', ...d.food_budget, amount: num(e.target.value) ?? 0 })} /></Field>
                    <Field label="Валюта"><input className="input" value={d.food_budget?.currency ?? 'RUB'} onChange={(e) => set('food_budget', { amount: 0, period: 'month', ...d.food_budget, currency: e.target.value.toUpperCase().slice(0, 8) })} /></Field>
                    <Field label="Период"><select className="input" value={d.food_budget?.period ?? 'month'} onChange={(e) => set('food_budget', { amount: 0, currency: 'RUB', ...d.food_budget, period: e.target.value as 'day' | 'week' | 'month' })}><option value="day">день</option><option value="week">неделя</option><option value="month">месяц</option></select></Field>
                  </div>
                  <Field label="Аллергии (через запятую)"><input className="input" value={lists.allergies} onChange={(e) => setLists({ ...lists, allergies: e.target.value })} /></Field>
                  <Field label="Не ем (через запятую)"><input className="input" value={lists.excluded} onChange={(e) => setLists({ ...lists, excluded: e.target.value })} /></Field>
                  <div className="grid2">
                    <Field label="Готовка, мин"><input className="input" inputMode="numeric" value={d.cooking_minutes ?? ''} onChange={(e) => set('cooking_minutes', num(e.target.value))} /></Field>
                    <Field label="Приёмов пищи"><input className="input" inputMode="numeric" value={d.meals_per_day ?? ''} onChange={(e) => set('meals_per_day', num(e.target.value))} /></Field>
                  </div>
                </>
              )}
            </>
          )}
          {section === 'notify' && (
            <>
              <Field label="Напоминания">
                <div className="chips">{Object.entries(NOTIFY_RU).map(([k, l]) => <button key={k} className={`chip-btn${(d.notify_types ?? []).includes(k) ? ' on' : ''}`} onClick={() => set('notify_types', toggle(d.notify_types, k))}>{l}</button>)}</div>
              </Field>
              <div className="grid2">
                <Field label="Тихие часы с"><input className="input" type="time" value={d.quiet_from ?? ''} onChange={(e) => set('quiet_from', e.target.value)} /></Field>
                <Field label="до"><input className="input" type="time" value={d.quiet_to ?? ''} onChange={(e) => set('quiet_to', e.target.value)} /></Field>
              </div>
            </>
          )}
        </div>
        <div className="sheet-actions">
          <button className="btn2" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={saving} onClick={submit}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Seg({ value, options, onChange }: { value: string | undefined; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([k, l]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function TzSelect({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (value && !zones.includes(value)) zones = [value, ...zones];
  if (zones.length === 0) return <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Europe/Moscow" />;
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>Выберите</option>
      {zones.map((z) => <option key={z} value={z}>{z}</option>)}
    </select>
  );
}

function ScheduleEditor({ slots, onChange }: { slots: Slot[]; onChange: (s: Slot[]) => void }) {
  const byDay = new Map(slots.map((s) => [s.day, s]));
  return (
    <div className="stack-sm">
      <span className="field-label">Дни и время</span>
      {DAYS.map((day) => {
        const s = byDay.get(day);
        return (
          <div key={day} className="sched-row">
            <button type="button" className={`chip-btn${s ? ' on' : ''}`} onClick={() => onChange(s ? slots.filter((x) => x.day !== day) : [...slots, { day, from: '19:00', to: '20:30' }].sort((a, b) => DAYS.indexOf(a.day as never) - DAYS.indexOf(b.day as never)))}>
              {DAY_RU[day]}
            </button>
            {s ? (
              <>
                <input aria-label={`${DAY_RU[day]} с`} className="input" type="time" value={s.from} onChange={(e) => onChange(slots.map((x) => (x.day === day ? { ...x, from: e.target.value } : x)))} />
                <input aria-label={`${DAY_RU[day]} до`} className="input" type="time" value={s.to} onChange={(e) => onChange(slots.map((x) => (x.day === day ? { ...x, to: e.target.value } : x)))} />
              </>
            ) : (
              <span className="faint">не тренируюсь</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GoalsEditor({ goals, onChange }: { goals: Goal[]; onChange: (g: Goal[]) => void }) {
  const upd = (i: number, p: Partial<Goal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...p } : g)));
  return (
    <div className="stack">
      <p className="muted">Первая цель — главная. Срок — по желанию: гарантировать результат к дате нельзя, но план будет на него ориентироваться.</p>
      {goals.map((g, i) => (
        <div key={i} className="card inner stack-sm">
          <div className="card-head">
            <p className="label">{i === 0 ? 'Главная цель' : `Цель ${i + 1}`}</p>
            <button className="link small danger" onClick={() => onChange(goals.filter((_, j) => j !== i))}>Удалить</button>
          </div>
          <Field label="Что"><input className="input" value={g.title} onChange={(e) => upd(i, { title: e.target.value })} /></Field>
          <Field label="Тип"><select className="input" value={g.kind} onChange={(e) => upd(i, { kind: e.target.value })}>{Object.entries(GOAL_KIND_RU).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <div className="grid3">
            <Field label="Сейчас"><input className="input" inputMode="decimal" value={g.baseline ?? ''} onChange={(e) => upd(i, { baseline: num(e.target.value) ?? null })} /></Field>
            <Field label="Цель"><input className="input" inputMode="decimal" value={g.target ?? ''} onChange={(e) => upd(i, { target: num(e.target.value) ?? null })} /></Field>
            <Field label="Ед."><input className="input" value={g.unit ?? ''} onChange={(e) => upd(i, { unit: e.target.value || null })} /></Field>
          </div>
          <Field label="Срок"><input className="input" type="date" value={g.deadline ?? ''} onChange={(e) => upd(i, { deadline: e.target.value || null })} /></Field>
        </div>
      ))}
      {goals.length < 6 && (
        <button className="btn2" onClick={() => onChange([...goals, { kind: 'strength', title: '', metric: null, unit: null, baseline: null, target: null, deadline: null, priority: goals.length + 1 }])}>
          + Добавить цель
        </button>
      )}
    </div>
  );
}
