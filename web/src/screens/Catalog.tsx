import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ExerciseBrief, ExerciseFull } from '../types';
import { PoseFigure } from '../components/Figure';
import { Banner, Spinner, TopBar } from '../components/ui';
import { CATEGORY_RU, EQUIPMENT_RU, LEVEL_RU, PLACE_RU, list } from '../labels';

export function Catalog({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<ExerciseBrief[] | null>(null);
  const [place, setPlace] = useState<string>('all');
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<{ exercises: ExerciseBrief[] }>('/api/catalog').then((r) => setItems(r.exercises)).catch(() => setErr(true));
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, ExerciseBrief[]>();
    for (const e of items ?? []) {
      if (place !== 'all' && !e.places.includes(place)) continue;
      const k = e.category;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    const order = ['warmup', 'mobility', 'strength', 'core', 'cardio'];
    return [...m.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [items, place]);

  return (
    <div className="screen-full">
      <TopBar title="Упражнения" sub={items ? `${items.length} карточек` : undefined} left={<button className="link" onClick={onBack}>Назад</button>} />
      <main className="scroll pad stack">
        <Banner kind="warn" title="Демонстрационный каталог">
          <p className="muted">Тексты и схемы подготовлены для проверки приложения и ещё не проверены специалистом по технике.</p>
        </Banner>
        <div className="chips" role="tablist">
          {[['all', 'Все'], ...Object.entries(PLACE_RU)].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={place === k} className={`chip-btn${place === k ? ' on' : ''}`} onClick={() => setPlace(k ?? 'all')}>{l}</button>
          ))}
        </div>
        {err && <p className="muted">Нет связи с сервером.</p>}
        {!items && !err && <Spinner />}
        {groups.map(([cat, list_]) => (
          <section key={cat} className="stack-sm">
            <p className="label">{CATEGORY_RU[cat] ?? cat}</p>
            {list_.map((e) => (
              <button key={e.id} className="ex-row" onClick={() => onOpen(e.id)}>
                <span className="ex-thumb">{e.pose && <PoseFigure pose={e.pose} size={44} label="" />}</span>
                <span className="ex-text">
                  <b>{e.name}</b>
                  <small>{list(e.equipment, EQUIPMENT_RU)} · {LEVEL_RU[e.level]}</small>
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}

export function Exercise({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const [e, setE] = useState<ExerciseFull | null>(null);
  const [err, setErr] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    setE(null);
    api<ExerciseFull>(`/api/catalog/${encodeURIComponent(id)}`).then(setE).catch(() => setErr(true));
  }, [id]);

  if (!e)
    return (
      <div className="screen-full">
        <TopBar title="Техника" left={<button className="link" onClick={onBack}>Назад</button>} />
        <div className="pad">{err ? <p className="muted">Нет связи с сервером. Текст карточки появится после подключения.</p> : <Spinner />}</div>
      </div>
    );
  const c = e.card;
  return (
    <div className="screen-full">
      <TopBar title="Техника" left={<button className="link" onClick={onBack}>Назад</button>} />
      <main className="scroll pad stack">
        <div>
          <p className="h2">{e.name}</p>
          <div className="chips" style={{ marginTop: 8 }}>
            {e.places.map((p) => <span key={p} className="tag">{PLACE_RU[p] ?? p}</span>)}
            <span className="tag">{list(e.equipment, EQUIPMENT_RU)}</span>
            <span className="tag">{LEVEL_RU[e.level]}</span>
          </div>
        </div>
        {e.isDemo && <div className="demo-note">Демонстрационный материал · не проверен специалистом</div>}
        <p className="cue">{c.short}</p>
        <div className={`frames n${Math.min(c.media.length, 3)}`}>
          {c.media.map((m, i) => (
            <figure key={i} className="frame">
              <button className="frame-btn" onClick={() => setZoom(m.pose)} aria-label={`Увеличить: ${m.caption}`}>
                <PoseFigure pose={m.pose} size={120} label={`${i + 1}. ${m.caption}`} />
              </button>
              <figcaption>{i + 1} · {m.caption}</figcaption>
            </figure>
          ))}
        </div>
        {c.scheme && <RunScheme scheme={c.scheme} />}
        <section className="card">
          <p className="label">Как выполнять</p>
          <ol className="steps">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {c.breathing && <p className="muted"><b className="ink">Дыхание:</b> {c.breathing}</p>}
        </section>
        <section className="card">
          <p className="label">Частые ошибки</p>
          <ul className="steps">{c.mistakes.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <p className="label danger-label">Остановитесь, если</p>
          <ul className="steps">{c.stop.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
        {(e.easierList.length > 0 || e.alternativeList.length > 0) && (
          <section className="stack-sm">
            {e.easierList.length > 0 && <p className="label">Проще</p>}
            <div className="chips">{e.easierList.map((x) => <button key={x.id} className="chip-btn" onClick={() => onOpen(x.id)}>{x.name}</button>)}</div>
            {e.alternativeList.length > 0 && <p className="label">Замены</p>}
            <div className="chips">{e.alternativeList.map((x) => <button key={x.id} className="chip-btn" onClick={() => onOpen(x.id)}>{x.name}</button>)}</div>
          </section>
        )}
        <p className="tiny">{e.id} · версия {e.version} · {e.source}{e.reviewedBy ? ` · проверено: ${e.reviewedBy}` : ''}</p>
      </main>
      {zoom && (
        <div className="zoom" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <PoseFigure pose={zoom} size={300} label="Увеличенная схема" />
          <p className="muted">Нажмите, чтобы закрыть</p>
        </div>
      )}
    </div>
  );
}

const INTENSITY_COLOR: Record<string, string> = { easy: 'var(--info)', moderate: 'var(--accent)', hard: 'var(--signal)', rest: 'var(--surface-raised)' };
const INTENSITY_RU: Record<string, string> = { easy: 'легко', moderate: 'умеренно', hard: 'быстро', rest: 'отдых' };

function RunScheme({ scheme }: { scheme: NonNullable<ExerciseFull['card']['scheme']> }) {
  const weight = (s: (typeof scheme)[number]) => s.minutes ?? (s.meters ? s.meters / 200 : 1);
  const total = scheme.reduce((a, s) => a + weight(s), 0);
  return (
    <section className="card">
      <p className="label">Схема задания</p>
      <div className="scheme" aria-hidden="true">
        {scheme.map((s, i) => <i key={i} style={{ flexGrow: weight(s) / total, background: INTENSITY_COLOR[s.intensity] }} />)}
      </div>
      <ol className="steps">
        {scheme.map((s, i) => (
          <li key={i}>
            {s.label} — {s.minutes ? `${s.minutes} мин` : `${s.meters} м`} <span className="faint">({INTENSITY_RU[s.intensity]})</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
