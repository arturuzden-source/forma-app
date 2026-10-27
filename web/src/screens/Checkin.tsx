import { useState } from 'react';
import { api, ApiError } from '../api';
import { haptic } from '../telegram';
import type { CheckinResp } from '../types';
import { Banner, TopBar } from '../components/ui';

const ALARM: [string, string][] = [
  ['chest_pain', 'Боль или давление в груди'],
  ['breath', 'Сильная одышка в покое'],
  ['dizzy', 'Головокружение, обморок'],
  ['acute_joint', 'Острая боль в суставе, травма'],
  ['other_alarm', 'Другое, что тревожит']
];

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T | null; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="q">
      <p className="q-title">{label}</p>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([k, l]) => (
          <button key={String(k)} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Checkin({ sessionId, plannedMin, onCancel, onStarted, onDone }: { sessionId: number; plannedMin: number; onCancel: () => void; onStarted: () => void; onDone: () => void }) {
  const [wellbeing, setWellbeing] = useState<number | null>(null);
  const [sleep, setSleep] = useState<'poor' | 'ok' | 'good' | null>(null);
  const [fatigue, setFatigue] = useState<'low' | 'medium' | 'high' | null>(null);
  const [pain, setPain] = useState<'none' | 'mild' | 'alarm' | null>(null);
  const [alarm, setAlarm] = useState<string[]>([]);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [resp, setResp] = useState<CheckinResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = wellbeing && sleep && fatigue && pain && (pain !== 'alarm' || alarm.length > 0);
  const timeOptions: [number, string][] = [
    [20, '20 мин'],
    [40, '40 мин'],
    [plannedMin, `${plannedMin} мин`]
  ].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i && (x[0] as number) <= plannedMin) as [number, string][];

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<CheckinResp>(`/api/sessions/${sessionId}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ wellbeing, sleep, fatigue, pain, alarm, minutes: minutes && minutes < plannedMin ? minutes : null })
      });
      setResp(r);
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — ответы не отправлены.' : 'Не удалось отправить. Возможно, занятие уже начато.');
    } finally {
      setBusy(false);
    }
  }

  async function choose(optionId: string) {
    if (!resp) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ status: string }>(`/api/sessions/${sessionId}/choose`, { method: 'POST', body: JSON.stringify({ checkinId: resp.checkinId, optionId, contentVersion: resp.contentVersion }) });
      haptic('success');
      if (r.status === 'started') onStarted();
      else onDone();
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — выбор не сохранён. Повторите.' : 'Занятие изменилось — откройте его заново.');
    } finally {
      setBusy(false);
    }
  }

  if (resp) {
    const stop = resp.options.length === 1 && resp.options[0]!.id === 'stop';
    return (
      <div className="screen-full">
        <TopBar title="Перед тренировкой" left={<button className="link" onClick={onCancel}>Отмена</button>} />
        <main className="scroll pad stack">
          {stop ? <Banner kind="warn" title="Сегодня без тренировки"><p className="muted">{resp.message}</p></Banner> : <p className="body">{resp.message}</p>}
          {err && <Banner kind="warn" title={err} />}
          {resp.options.map((o) => (
            <button key={o.id} className={`opt${o.recommended ? ' rec' : ''}`} disabled={busy} onClick={() => void choose(o.id)}>
              {o.recommended && <span className="label accent">Предлагаю</span>}
              <b>{o.title}</b>
              <small>{o.description}</small>
            </button>
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="screen-full">
      <TopBar title="Перед тренировкой" sub="около 30 секунд" left={<button className="link" onClick={onCancel}>Отмена</button>} />
      <main className="scroll pad stack">
        <Seg label="Как самочувствие?" value={wellbeing} onChange={setWellbeing} options={[[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]} />
        <div className="scale-hint"><span>плохо</span><span>отлично</span></div>
        <Seg label="Как спали?" value={sleep} onChange={setSleep} options={[['poor', 'Плохо'], ['ok', 'Нормально'], ['good', 'Хорошо']]} />
        <Seg label="Насколько устали?" value={fatigue} onChange={setFatigue} options={[['low', 'Мало'], ['medium', 'Средне'], ['high', 'Сильно']]} />
        <Seg label="Боль или новые симптомы?" value={pain} onChange={(v) => { setPain(v); if (v !== 'alarm') setAlarm([]); }} options={[['none', 'Нет'], ['mild', 'Есть дискомфорт'], ['alarm', 'Тревожное']]} />
        {pain === 'alarm' && (
          <div className="stack-sm">
            <p className="muted">Что именно? Можно выбрать несколько.</p>
            <div className="chips">
              {ALARM.map(([k, l]) => (
                <button key={k} className={`chip-btn${alarm.includes(k) ? ' on' : ''}`} onClick={() => setAlarm((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <Seg label="Сколько времени есть сегодня?" value={minutes ?? plannedMin} onChange={setMinutes} options={timeOptions} />
        {err && <Banner kind="warn" title={err} />}
      </main>
      <div className="footer">
        <button className="btn" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Проверяю…' : 'Дальше'}</button>
      </div>
    </div>
  );
}
