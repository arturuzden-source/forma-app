import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import type { PlanItem, SessionDetail, SetResult } from '../types';
import { Banner, Spinner, TopBar } from '../components/ui';
import { PoseFigure } from '../components/Figure';
import { mmss, planValue } from '../format';

/**
 * Состояние экрана тренировки хранится локально (номер упражнения и таймер отдыха),
 * поэтому открытие карточки техники или сворачивание приложения его не сбрасывает.
 * Результаты — только на сервере: несохранённый подход не показывается как сохранённый.
 */
type Local = { idx: number; restUntil: number | null; restTotal: number };
const key = (id: number) => `forma.workout.${id}`;
function readLocal(id: number): Local {
  try {
    const raw = localStorage.getItem(key(id));
    if (raw) return JSON.parse(raw) as Local;
  } catch {
    /* нет хранилища */
  }
  return { idx: 0, restUntil: null, restTotal: 0 };
}
function writeLocal(id: number, l: Local) {
  try {
    localStorage.setItem(key(id), JSON.stringify(l));
  } catch {
    /* нет хранилища */
  }
}

function valueOf(it: PlanItem, r?: SetResult | null) {
  if (it.reps != null) return r?.reps ?? it.reps;
  if (it.seconds != null) return r?.seconds ?? it.seconds;
  return r?.meters ?? it.meters ?? 0;
}

export function Workout({ sessionId, onMinimize, onExercise, onFinished }: { sessionId: number; onMinimize: () => void; onExercise: (id: string) => void; onFinished: () => void }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [local, setLocalState] = useState<Local>(() => readLocal(sessionId));
  const [now, setNow] = useState(Date.now());
  const [val, setVal] = useState<number | null>(null);
  const [weight, setWeight] = useState<string>('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [workTimer, setWorkTimer] = useState<number | null>(null);
  const vibrated = useRef(false);

  const setLocal = useCallback((l: Local) => {
    setLocalState(l);
    writeLocal(sessionId, l);
  }, [sessionId]);

  const load = useCallback(async () => {
    try {
      setS(await api<SessionDetail>(`/api/sessions/${sessionId}`));
    } catch {
      setErr('Нет связи с сервером. Записанные подходы сохранены на сервере.');
    }
  }, [sessionId]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const idx = s ? Math.min(local.idx, s.items.length - 1) : 0;
  const it = s?.items[idx];
  const done = useMemo(() => (s ? s.results.filter((r) => r.item_index === idx) : []), [s, idx]);
  const nextSet = it ? Array.from({ length: it.sets }, (_, i) => i).find((i) => !done.some((r) => r.set_index === i)) ?? null : null;
  const restLeft = local.restUntil ? Math.max(0, (local.restUntil - now) / 1000) : 0;
  const workLeft = workTimer ? Math.max(0, (workTimer - now) / 1000) : 0;

  useEffect(() => {
    if (it && nextSet != null) setVal(valueOf(it));
    setRpe(null);
    setPain(false);
  }, [idx, nextSet, it]);

  useEffect(() => {
    if (local.restUntil && restLeft === 0 && !vibrated.current) {
      vibrated.current = true;
      haptic('success');
    }
    if (restLeft > 0) vibrated.current = false;
  }, [restLeft, local.restUntil]);

  useEffect(() => {
    if (workTimer && workLeft === 0) {
      setWorkTimer(null);
      haptic('success');
    }
  }, [workLeft, workTimer]);

  if (!s || !it)
    return (
      <div className="screen-full">
        <TopBar title="Тренировка" left={<button className="link" onClick={onMinimize}>Свернуть</button>} />
        <div className="pad">{err ? <p className="muted">{err}</p> : <Spinner />}</div>
      </div>
    );

  const allPlanned = s.items.reduce((a, x) => a + x.sets, 0);
  const allDone = s.results.filter((r) => s.items[r.item_index] && r.set_index < s.items[r.item_index]!.sets).length;
  const finishedItem = nextSet == null;
  const isLastItem = idx === s.items.length - 1;
  const step = it.reps != null ? 1 : it.seconds != null ? (it.seconds >= 300 ? 60 : 5) : 100;
  const unit = it.reps != null ? 'повт' : it.seconds != null ? (it.seconds >= 300 ? '' : 'с') : 'м';
  const showWeight = it.reps != null && it.equipment.some((e) => ['dumbbells', 'barbell', 'kettlebell', 'machines'].includes(e));

  async function saveSet(setIndex: number, value: number) {
    if (!it) return;
    setBusy(true);
    setErr(null);
    const body = {
      item_index: idx,
      set_index: setIndex,
      reps: it.reps != null ? value : null,
      seconds: it.seconds != null ? value : null,
      meters: it.reps == null && it.seconds == null ? value : null,
      weight_kg: weight ? Number(weight.replace(',', '.')) || null : null,
      rpe,
      pain,
      note: null
    };
    try {
      await api(`/api/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify(body) });
      haptic('success');
      await load();
      const lastSet = setIndex >= it.sets - 1;
      if (!lastSet && it.rest_s > 0) setLocal({ ...local, idx, restUntil: Date.now() + it.rest_s * 1000, restTotal: it.rest_s });
      else if (lastSet && !isLastItem) setLocal({ idx: idx + 1, restUntil: Date.now() + Math.max(60, it.rest_s) * 1000, restTotal: Math.max(60, it.rest_s) });
      else setLocal({ ...local, idx, restUntil: null });
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — подход НЕ сохранён. Нажмите ещё раз.' : 'Подход не сохранён. Попробуйте ещё раз.');
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/sessions/${sessionId}/finish`, { method: 'POST', body: '{}' });
      try {
        localStorage.removeItem(key(sessionId));
      } catch {
        /* нет хранилища */
      }
      haptic('success');
      onFinished();
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — тренировка не завершена.' : 'Запишите хотя бы один подход или выйдите без сохранения.');
    } finally {
      setBusy(false);
    }
  }

  async function abandon() {
    try {
      await api(`/api/sessions/${sessionId}/abandon`, { method: 'POST', body: '{}' });
      onFinished();
    } catch {
      setErr('Есть записанные подходы — завершите тренировку.');
    }
  }

  const pct = local.restTotal ? restLeft / local.restTotal : 0;
  const R = 54;
  const C = 2 * Math.PI * R;

  return (
    <div className="screen-full">
      <TopBar title={s.title} sub={`упражнение ${idx + 1} из ${s.items.length}`} left={<button className="link" onClick={onMinimize}>Свернуть</button>} right={<button className="link" onClick={() => setFinishing(true)}>Финиш</button>} />
      <div className="segbar">{s.items.map((x, i) => {
        const d = s.results.filter((r) => r.item_index === i).length;
        return <i key={i} className={d >= x.sets ? 'full' : i === idx ? 'cur' : d > 0 ? 'half' : ''} />;
      })}</div>
      <main className="scroll pad stack">
        {restLeft > 0 && (
          <section className="timer-card">
            <div className="ring">
              <svg viewBox="0 0 132 132" width="128" height="128" aria-hidden="true">
                <circle cx="66" cy="66" r={R} fill="none" stroke="var(--surface-raised)" strokeWidth="10" />
                <circle cx="66" cy="66" r={R} fill="none" stroke="var(--signal)" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 66 66)" />
              </svg>
              <div className="ring-text" role="timer" aria-live="off">
                <span className="ring-label">ОТДЫХ</span>
                <span className="num big">{mmss(restLeft)}</span>
              </div>
            </div>
            <div className="stack-sm grow">
              <p className="muted">{finishedItem ? 'Дальше: следующее упражнение' : `Дальше: подход ${(nextSet ?? 0) + 1} из ${it.sets}`}</p>
              <div className="row-gap">
                <button className="pill" onClick={() => setLocal({ ...local, restUntil: (local.restUntil ?? Date.now()) - 15000 })}>−15 с</button>
                <button className="pill" onClick={() => setLocal({ ...local, restUntil: (local.restUntil ?? Date.now()) + 15000, restTotal: local.restTotal + 15 })}>+15 с</button>
              </div>
              <button className="pill signal" onClick={() => setLocal({ ...local, restUntil: null })}>Пропустить отдых</button>
            </div>
          </section>
        )}

        <section className="card">
          <div className="ex-head">
            <span className="ex-thumb">{it.pose && <PoseFigure pose={it.pose} size={44} label="" />}</span>
            <div className="grow">
              <p className="h3 sm">{it.name}</p>
              <p className="muted">{it.short}</p>
              {it.note && <p className="muted accent-text">{it.note}</p>}
            </div>
          </div>
          <div className="grid2">
            <button className="btn2" onClick={() => onExercise(it.exercise_id)}>Как выполнять</button>
            <button className="btn2" disabled title="Замены через помощника — этап 4">Заменить</button>
          </div>
        </section>

        <section className="card sets">
          <div className="set head"><span>№</span><span>План</span><span>Факт</span><span /></div>
          {Array.from({ length: it.sets }, (_, i) => {
            const r = done.find((x) => x.set_index === i);
            const cur = i === nextSet;
            return (
              <div key={i} className={`set${cur ? ' cur' : ''}`}>
                <span className="n">{i + 1}</span>
                <span className="p">{planValue(it)}</span>
                {cur ? (
                  <span className="stp">
                    <button aria-label="Меньше" onClick={() => setVal((v) => Math.max(0, (v ?? 0) - step))}>−</button>
                    <span className="num">{it.seconds != null && it.seconds >= 300 ? mmss(val ?? 0) : `${val ?? 0}${unit ? ' ' + unit : ''}`}</span>
                    <button aria-label="Больше" onClick={() => setVal((v) => (v ?? 0) + step)}>+</button>
                  </span>
                ) : (
                  <span className="f num">{r ? (r.reps ?? (r.seconds != null ? (r.seconds >= 300 ? mmss(r.seconds) : `${r.seconds} с`) : `${r.meters} м`)) : '—'}{r?.weight_kg ? ` · ${r.weight_kg} кг` : ''}</span>
                )}
                <span>{r && <span className={`okdot${r.pain ? ' pain' : ''}`} aria-label={r.pain ? 'с болью' : 'записан'}>{r.pain ? '!' : '✓'}</span>}</span>
              </div>
            );
          })}
        </section>

        {!finishedItem && (
          <section className="stack-sm">
            {it.seconds != null && it.seconds < 300 && (
              <button className="btn2" onClick={() => setWorkTimer(workTimer ? null : Date.now() + (val ?? it.seconds!) * 1000)}>
                {workTimer ? `Идёт: ${mmss(workLeft)} — остановить` : `Запустить таймер ${val ?? it.seconds} с`}
              </button>
            )}
            {showWeight && (
              <label className="field inline">
                <span className="field-label">Вес, кг (если с отягощением)</span>
                <input className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="—" />
              </label>
            )}
            <div className="row-between">
              <div className="row-gap" role="radiogroup" aria-label="Насколько тяжело">
                <span className="muted">Тяжесть</span>
                {[6, 7, 8, 9, 10].map((n) => (
                  <button key={n} role="radio" aria-checked={rpe === n} className={`pill sm${rpe === n ? ' on' : ''}`} onClick={() => setRpe(rpe === n ? null : n)}>{n}</button>
                ))}
              </div>
              <button className={`pain-btn${pain ? ' on' : ''}`} onClick={() => setPain(!pain)} aria-pressed={pain}>Боль</button>
            </div>
            {pain && <Banner kind="warn" title="Отмечена боль"><p className="muted">Не продолжайте упражнение через боль. Можно перейти к следующему или завершить тренировку. При острой боли, боли в груди или головокружении — остановитесь.</p></Banner>}
          </section>
        )}

        {finishedItem && !isLastItem && <Banner kind="ok" title="Упражнение выполнено"><p className="muted">Дальше: {s.items[idx + 1]!.name}</p></Banner>}
        {finishedItem && isLastItem && <Banner kind="ok" title="Все упражнения выполнены"><p className="muted">Не забудьте заминку {s.cooldownMin ? `${s.cooldownMin} мин` : ''} и завершите тренировку.</p></Banner>}

        <div className="row-between">
          <button className="link small" disabled={idx === 0} onClick={() => setLocal({ ...local, idx: idx - 1, restUntil: null })}>← Предыдущее</button>
          <button className="link small" disabled={isLastItem} onClick={() => setLocal({ ...local, idx: idx + 1, restUntil: null })}>Следующее →</button>
        </div>
        {!isLastItem && <p className="tiny">Потом: {s.items[idx + 1]!.name} · {s.items[idx + 1]!.sets} × {planValue(s.items[idx + 1]!)}</p>}
        {err && <Banner kind="warn" title={err} />}
      </main>
      <div className="footer">
        {!finishedItem ? (
          <button className="btn" disabled={busy || val == null} onClick={() => void saveSet(nextSet!, val!)}>
            {busy ? 'Сохраняю…' : `Записать подход ${(nextSet ?? 0) + 1}${it.reps != null ? ` · ${val} повт` : ''}`}
          </button>
        ) : isLastItem ? (
          <button className="btn" disabled={busy} onClick={() => void finish()}>Завершить тренировку · {allDone}/{allPlanned}</button>
        ) : (
          <button className="btn" onClick={() => setLocal({ ...local, idx: idx + 1 })}>Следующее упражнение</button>
        )}
      </div>

      {finishing && (
        <div className="sheet-wrap" role="dialog" aria-modal="true">
          <div className="sheet-backdrop" onClick={() => setFinishing(false)} />
          <div className="sheet stack">
            <div className="sheet-grip" />
            <p className="h3">Завершить тренировку?</p>
            <p className="muted">Записано {allDone} из {allPlanned} подходов. {allDone < allPlanned ? 'Тренировка будет отмечена как выполненная частично.' : ''}</p>
            {allDone > 0 ? (
              <button className="btn" disabled={busy} onClick={() => void finish()}>Завершить</button>
            ) : (
              <button className="btn2" onClick={() => void abandon()}>Выйти без записи — вернуть в план</button>
            )}
            <button className="btn2" onClick={() => setFinishing(false)}>Продолжить тренировку</button>
          </div>
        </div>
      )}
    </div>
  );
}
