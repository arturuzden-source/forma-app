import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { deviceTz, haptic } from '../telegram';
import type { OnbView } from '../types';
import { SendIcon, Spinner, TopBar } from '../components/ui';

export function Onboarding({ onClose, onReview }: { onClose: () => void; onReview: () => void }) {
  const [v, setV] = useState<OnbView | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const tz = deviceTz();

  useEffect(() => {
    api<OnbView>(`/api/onboarding?tz=${encodeURIComponent(tz ?? '')}`)
      .then(setV)
      .catch(() => setErr('Нет связи с сервером. Ответы сохраняются на сервере — продолжите, когда связь появится.'));
  }, [tz]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [v?.messages.length, busy]);

  async function call(path: string, body: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<OnbView>(path, { method: 'POST', body: JSON.stringify(body) });
      setV(r);
      haptic('light');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErr('Предыдущий ответ ещё обрабатывается.');
      else setErr('Нет связи с сервером — ответ не отправлен. Повторите.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    if (await call('/api/onboarding/answer', { text: t, tz })) setText('');
  }

  if (!v)
    return (
      <div className="screen-full">
        <TopBar title="Знакомство" left={<button className="link" onClick={onClose}>Закрыть</button>} />
        <div className="pad">{err ? <p className="muted">{err}</p> : <Spinner />}</div>
      </div>
    );

  const pct = v.progress.total ? Math.round((v.progress.step / v.progress.total) * 100) : 0;
  return (
    <div className="screen-full">
      <TopBar
        title="Знакомство"
        sub={v.finished ? 'готово' : `шаг ${v.progress.step} из ${v.progress.total}`}
        left={<button className="link" onClick={onClose}>Закрыть</button>}
        right={v.finished ? null : <button className="link" onClick={onClose}>Позже</button>}
      />
      <div className="progress-line" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <main className="chat" aria-live="polite">
        <p className="chat-note">Ответы сохраняются — можно закрыть и продолжить позже</p>
        {v.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <p>{m.text}</p>
            {m.why && <p className="why">{m.why}</p>}
          </div>
        ))}
        {busy && <div className="bubble bot typing"><Spinner label="Обрабатываю ответ" /></div>}
        {err && <p className="chat-err" role="alert">{err}</p>}
        {!v.finished && v.quick.length > 0 && (
          <div className="quick">
            {v.quick.map((q) => (
              <button key={q.id} className="chip-btn" disabled={busy} onClick={() => void call('/api/onboarding/quick', { id: q.id, tz })}>
                {q.label}
              </button>
            ))}
          </div>
        )}
        {v.canGoBack && !busy && (
          <button className="link back-link" onClick={() => void call('/api/onboarding/back', { tz })}>← Изменить предыдущий ответ</button>
        )}
        {!v.aiAvailable && !v.finished && <p className="chat-note">ИИ сейчас не подключён: отвечайте кнопками, остальное можно заполнить в резюме.</p>}
        <div ref={bottom} />
      </main>
      {v.finished ? (
        <div className="footer">
          <button className="btn" onClick={onReview}>Проверить резюме</button>
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="answer" className="sr">Ваш ответ</label>
          <input id="answer" className="composer-input" value={text} maxLength={1000} placeholder="Ответить текстом…" onChange={(e) => setText(e.target.value)} disabled={busy} autoComplete="off" />
          <button className="send" type="submit" aria-label="Отправить" disabled={busy || !text.trim()}>
            <SendIcon />
          </button>
        </form>
      )}
    </div>
  );
}
