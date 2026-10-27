import { useState } from 'react';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import type { SessionDetail, Week } from '../types';
import { Banner, Spinner, TopBar } from '../components/ui';
import { PoseFigure } from '../components/Figure';
import { STATUS_RU, addDays, dayLabel, itemLine } from '../format';
import { useEffect } from 'react';

function weekRange(a: string, b: string) {
  const f = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
  return `${f(a)} – ${f(b)}`;
}

export function PlanTab({ week, reload, openSession, openCatalog, goProfile }: { week: Week | null; reload: () => Promise<void>; openSession: (id: number) => void; openCatalog: () => void; goProfile: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);

  async function generate(reason: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ warnings: string[] }>('/api/plan/generate', { method: 'POST', body: JSON.stringify({ reason }) }, 120_000);
      setWarn(r.warnings ?? []);
      haptic('success');
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — план не изменён.' : 'Не удалось составить план. Действующий план не изменён.');
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  if (!week) return <main className="scroll pad"><Spinner /></main>;
  if (!week.profileConfirmed)
    return (
      <main className="scroll pad stack">
        <p className="h1">План</p>
        <section className="card hl">
          <p className="label accent">Сначала профиль</p>
          <p className="muted-hl">План строится по вашим целям, расписанию и ограничениям. Завершите знакомство и подтвердите резюме.</p>
          <button className="btn" onClick={goProfile}>Открыть профиль</button>
        </section>
      </main>
    );

  const days = Array.from({ length: 7 }, (_, i) => addDays(week.weekStart, i));
  const byDate = new Map(week.sessions.map((s) => [s.date, s]));

  return (
    <main className="scroll pad stack">
      <div className="row-between">
        <div>
          <p className="h1">План</p>
          <p className="muted">{weekRange(week.weekStart, week.weekEnd)}{week.plan ? ` · версия ${week.plan.version}` : ''}</p>
        </div>
        {week.plan && <button className="link small" disabled={busy} onClick={() => void generate('пересоставить по запросу')}>Пересоставить</button>}
      </div>

      <div className="week-strip">
        {days.map((d) => {
          const s = byDate.get(d);
          const l = dayLabel(d);
          const today = d === week.today;
          return (
            <button key={d} className={`day${today ? ' today' : ''}`} disabled={!s} onClick={() => s && openSession(s.id)} aria-label={`${l.long}${s ? `: ${s.title}` : ', нет занятия'}`}>
              <span>{l.wd}</span>
              <b>{l.day}</b>
              <i className={s ? `dot ${s.status}` : 'dot none'} />
            </button>
          );
        })}
      </div>

      {err && <Banner kind="warn" title={err} />}
      {warn.length > 0 && <Banner kind="info" title="Составлено по базовым правилам"><p className="muted">{warn.join(' ')}</p></Banner>}

      {!week.plan && (
        <section className="card hl">
          <p className="label accent">План недели</p>
          <p className="muted-hl">Составлю занятия на оставшиеся дни недели: по вашему расписанию, с учётом ограничений и лимита времени. Сервер проверит каждое занятие.</p>
          <button className="btn" disabled={busy} onClick={() => void generate('первый план')}>{busy ? 'Составляю — до минуты…' : 'Составить план'}</button>
        </section>
      )}
      {busy && week.plan && <div className="card"><Spinner label="Составляю план" /><p className="muted">Составляю новый вариант. Текущий план не изменится, пока новый не пройдёт проверку.</p></div>}

      {week.plan && (
        <div className="stack-sm">
          {days.map((d) => {
            const s = byDate.get(d);
            const l = dayLabel(d);
            if (!s) return <p key={d} className="rest-row"><span>{l.wd}</span><span>Отдых</span></p>;
            const today = d === week.today;
            return (
              <button key={d} className={`ses${today && s.status === 'planned' ? ' hl' : ''}`} onClick={() => openSession(s.id)}>
                <span className="ses-d">{l.wd}<b>{l.day}</b></span>
                <span className="ses-t">
                  <b>{s.title}</b>
                  <small>{s.startTime} · {s.durationMin} мин · {s.exercises.slice(0, 3).join(', ')}{s.exercises.length > 3 ? '…' : ''}</small>
                </span>
                <span className={`st st-${s.status}${today && s.status === 'planned' ? ' st-today' : ''}`}>{today && s.status === 'planned' ? 'Сегодня' : STATUS_RU[s.status]}</span>
              </button>
            );
          })}
        </div>
      )}

      {week.plan && (
        <section className="card">
          <p className="label">Почему такой план</p>
          <p className="body">{week.plan.explanation}</p>
          <p className="tiny">{week.plan.source === 'ai' ? `Составлен ИИ (${week.plan.model}) и проверен сервером` : 'Составлен по базовым правилам'} · версия {week.plan.version}</p>
        </section>
      )}
      <button className="link" onClick={openCatalog}>Каталог упражнений</button>
    </main>
  );
}

export function SessionScreen({ id, onBack, onCheckin, onWorkout, onExercise }: { id: number; onBack: () => void; onCheckin: () => void; onWorkout: () => void; onExercise: (id: string) => void }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<SessionDetail>(`/api/sessions/${id}`).then(setS).catch(() => setErr(true));
  }, [id]);

  if (!s)
    return (
      <div className="screen-full">
        <TopBar title="Занятие" left={<button className="link" onClick={onBack}>Назад</button>} />
        <div className="pad">{err ? <p className="muted">Нет связи с сервером.</p> : <Spinner />}</div>
      </div>
    );
  const l = dayLabel(s.date);
  const resultOf = (i: number) => s.results.filter((r) => r.item_index === i);
  return (
    <div className="screen-full">
      <TopBar title="Занятие" sub={`${l.long}, ${s.startTime}`} left={<button className="link" onClick={onBack}>Назад</button>} />
      <main className="scroll pad stack">
        <div>
          <p className="h2">{s.title}</p>
          <p className="muted">{s.purpose} · {s.durationMin} мин · {STATUS_RU[s.status]}</p>
        </div>
        {s.items.some((i) => i.isDemo) && <div className="demo-note">Карточки техники демонстрационные — не проверены специалистом</div>}
        <section className="card">
          {s.warmupMin > 0 && <div className="row"><span>Разминка</span><span>{s.warmupMin} мин</span></div>}
          {s.items.map((it, i) => {
            const rs = resultOf(i);
            return (
              <button key={i} className="item-row" onClick={() => onExercise(it.exercise_id)}>
                <span className="ex-thumb sm">{it.pose && <PoseFigure pose={it.pose} size={36} label="" />}</span>
                <span className="ex-text">
                  <b>{it.name}</b>
                  <small>{itemLine(it)}{it.note ? ` · ${it.note}` : ''}</small>
                  {rs.length > 0 && <small className="ok">Сделано: {rs.map((r) => r.reps ?? (r.seconds != null ? `${r.seconds} с` : r.meters != null ? `${r.meters} м` : '✓')).join(', ')}</small>}
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            );
          })}
          {s.cooldownMin > 0 && <div className="row"><span>Заминка</span><span>{s.cooldownMin} мин</span></div>}
        </section>
        <p className="tiny">Длительность включает разминку, подходы, отдых и заминку. Нажмите на упражнение, чтобы посмотреть технику.</p>
      </main>
      <div className="footer">
        {s.status === 'planned' && <button className="btn" onClick={onCheckin}>Начать с чек-ина</button>}
        {s.status === 'started' && <button className="btn" onClick={onWorkout}>Продолжить тренировку</button>}
        {(s.status === 'done' || s.status === 'partial') && <button className="btn2" onClick={onWorkout}>Исправить результаты</button>}
        {s.status === 'cancelled' && <p className="muted center">Занятие отменено по самочувствию. Перенос — в следующем обновлении.</p>}
      </div>
    </div>
  );
}
