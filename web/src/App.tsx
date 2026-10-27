import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, readCache, writeCache } from './api';
import { tg } from './telegram';

type Me = { user: { telegramId: number; firstName: string | null; since: string }; server: { version: string; schema: number } };
type Note = { id: number; text: string; created_at: string };

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; me: Me; notes: Note[] }
  | { kind: 'offline'; cached: { me: Me; notes: Note[]; savedAt: string } | null }
  | { kind: 'auth'; status?: number }
  | { kind: 'error' };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState<{ opId: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tgUserId = tg()?.initDataUnsafe?.user?.id;

  const load = useCallback(async () => {
    try {
      const me = await api<Me>('/api/me');
      const { notes } = await api<{ notes: Note[] }>('/api/pilot/notes');
      writeCache(me.user.telegramId, { me, notes });
      setState({ kind: 'ready', me, notes });
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') {
        const c = readCache(tgUserId);
        setState({ kind: 'offline', cached: c ? { me: c.data.me as Me, notes: c.data.notes as Note[], savedAt: c.savedAt } : null });
      } else if (e instanceof ApiError && e.kind === 'auth') setState({ kind: 'auth', status: e.status });
      else setState({ kind: 'error' });
    }
  }, [tgUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // В режиме «нет связи» повторяем попытку каждые 30 секунд.
  useEffect(() => {
    if (state.kind !== 'offline') return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [state.kind, load]);

  async function save() {
    if (!text.trim()) return;
    // Один и тот же opId при повторе: сервер не создаст вторую запись.
    const opId = saving?.opId ?? crypto.randomUUID();
    setSaving({ opId });
    setSaveError(null);
    try {
      await api('/api/pilot/notes', { method: 'POST', body: JSON.stringify({ opId, text }) });
      setText('');
      setSaving(null);
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError && e.kind === 'offline' ? 'Нет связи — запись не сохранена. Повторите.' : 'Не удалось сохранить.');
      setSaving({ opId });
    }
  }

  if (state.kind === 'loading') return <div className="screen"><p className="muted">Подключаюсь к серверу…</p></div>;

  if (state.kind === 'auth')
    return (
      <div className="screen">
        <p className="title">Форма</p>
        <div className="card warn">
          <p className="head">Нет доступа</p>
          <p className="muted">
            {state.status === 403 ? 'Это закрытый пилот: доступ есть только у владельца.' : 'Откройте приложение из бота в Telegram — так сервер сможет проверить, что это вы.'}
          </p>
        </div>
      </div>
    );

  if (state.kind === 'error')
    return (
      <div className="screen">
        <p className="title">Форма</p>
        <div className="card warn"><p className="head">Ошибка сервера</p><p className="muted">Попробуйте ещё раз через минуту.</p></div>
        <button className="btn" onClick={() => void load()}>Повторить</button>
      </div>
    );

  if (state.kind === 'offline')
    return (
      <div className="screen">
        <p className="title">Форма</p>
        <div className="card warn">
          <p className="head">Нет связи с сервером</p>
          <p className="muted">Записи и изменения сейчас не сохраняются. Проверяю каждые 30 секунд.</p>
        </div>
        {state.cached ? (
          <>
            <p className="muted faint">Данные загружены {new Date(state.cached.savedAt).toLocaleString('ru-RU')} и могут быть неактуальны.</p>
            <Notes notes={state.cached.notes} />
          </>
        ) : (
          <p className="muted">Для первой загрузки нужен работающий сервер.</p>
        )}
        <button className="btn" disabled>Записать — нужна связь</button>
        <button className="btn2" onClick={() => void load()}>Повторить подключение</button>
      </div>
    );

  const { me, notes } = state;
  return (
    <div className="screen">
      <div>
        <p className="muted">Этап 0 · проверка сервера</p>
        <p className="title">Привет, {me.user.firstName ?? 'владелец'}</p>
      </div>
      <section className="card hl">
        <p className="label ok">Подключено</p>
        <div className="row"><span>Сервер</span><span>{me.server.version}</span></div>
        <div className="row"><span>Схема базы</span><span>v{me.server.schema}</span></div>
        <div className="row"><span>Аккаунт</span><span>проверен Telegram</span></div>
      </section>
      <section className="card">
        <p className="label">Проверка сохранности данных</p>
        <p className="muted">Добавьте запись, затем обновите сервис на Railway. Запись должна остаться.</p>
        <label className="muted" htmlFor="note">Текст записи</label>
        <input id="note" className="input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Например: до обновления" />
        {saveError && <p className="muted bad">{saveError}</p>}
        <button className="btn" disabled={!text.trim()} onClick={() => void save()}>{saving && !saveError ? 'Сохраняю…' : 'Сохранить запись'}</button>
      </section>
      <Notes notes={notes} />
    </div>
  );
}

function Notes({ notes }: { notes: Note[] }) {
  return (
    <section className="card">
      <p className="label">Записи · {notes.length}</p>
      {notes.length === 0 && <p className="muted">Пока нет записей.</p>}
      {notes.map((n) => (
        <div className="note" key={n.id}>
          <span>{n.text}</span>
          <span className="faint">{new Date(n.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
      ))}
    </section>
  );
}
