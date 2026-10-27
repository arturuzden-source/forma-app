import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, readCache, writeCache } from './api';
import { bindBackButton, tg } from './telegram';
import type { Home as HomeT, Week } from './types';
import { Banner, Spinner, TabBar, type Tab } from './components/ui';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { Catalog, Exercise } from './screens/Catalog';
import { Settings, Soon } from './screens/Settings';
import { PlanTab, SessionScreen } from './screens/Plan';
import { Checkin } from './screens/Checkin';
import { Workout } from './screens/Workout';

type Route =
  | { name: 'tab' } | { name: 'onboarding' } | { name: 'profile' } | { name: 'catalog' } | { name: 'exercise'; id: string } | { name: 'settings' }
  | { name: 'session'; id: number } | { name: 'checkin'; id: number; minutes: number } | { name: 'workout'; id: number };

type Load = { kind: 'loading' } | { kind: 'ready'; home: HomeT } | { kind: 'offline'; cached: HomeT | null; savedAt: string | null } | { kind: 'auth'; status?: number } | { kind: 'error' };

export function App() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('home');
  const [week, setWeek] = useState<Week | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'tab' }]);
  const route = stack[stack.length - 1]!;
  const tgUserId = tg()?.initDataUnsafe?.user?.id;

  const push = (r: Route) => setStack((s) => [...s, r]);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  const refresh = useCallback(async () => {
    try {
      const home = await api<HomeT>('/api/home');
      const wk = await api<Week>('/api/plan');
      setWeek(wk);
      if (tgUserId) writeCache(tgUserId, { home, week: wk });
      setLoad({ kind: 'ready', home });
      return home;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') {
        const c = readCache(tgUserId);
        setLoad({ kind: 'offline', cached: (c?.data.home as HomeT) ?? null, savedAt: c?.savedAt ?? null });
      } else if (e instanceof ApiError && e.kind === 'auth') setLoad({ kind: 'auth', status: e.status });
      else setLoad({ kind: 'error' });
      return null;
    }
  }, [tgUserId]);

  useEffect(() => {
    void refresh().then((h) => {
      // Первый вход: сразу открыть беседу-знакомство.
      if (h && h.profile.status === 'draft' && !h.onboarding.finished) setStack([{ name: 'tab' }, { name: 'onboarding' }]);
    });
  }, [refresh]);

  useEffect(() => {
    if (load.kind !== 'offline') return;
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [load.kind, refresh]);

  useEffect(() => bindBackButton(stack.length > 1, pop), [stack.length, pop]);

  const back = () => {
    pop();
    void refresh();
  };

  if (load.kind === 'loading') return <div className="screen-center"><Spinner label="Подключаюсь к серверу" /></div>;
  if (load.kind === 'auth')
    return (
      <div className="screen-full pad stack">
        <p className="h1">Форма</p>
        <Banner kind="warn" title="Нет доступа">
          <p className="muted">{load.status === 403 ? 'Это закрытый пилот: доступ есть только у владельца.' : 'Откройте приложение из бота в Telegram — так сервер сможет проверить, что это вы.'}</p>
        </Banner>
      </div>
    );
  if (load.kind === 'error')
    return (
      <div className="screen-full pad stack">
        <p className="h1">Форма</p>
        <Banner kind="warn" title="Ошибка сервера"><p className="muted">Попробуйте ещё раз через минуту.</p></Banner>
        <button className="btn" onClick={() => void refresh()}>Повторить</button>
      </div>
    );
  if (load.kind === 'offline')
    return (
      <div className="screen-full pad stack">
        <p className="h1">Форма</p>
        <Banner kind="warn" title="Нет связи с сервером">
          <p className="muted">Записи и изменения сейчас не сохраняются. Проверяю каждые 30 секунд.</p>
        </Banner>
        {load.cached ? (
          <section className="card">
            <p className="label">Данные на {load.savedAt ? new Date(load.savedAt).toLocaleString('ru-RU') : '—'}</p>
            <p className="muted">{load.cached.profile.name ? `${load.cached.profile.name}, ` : ''}цели: {load.cached.goals.map((g) => g.title).join(', ') || 'нет'}</p>
          </section>
        ) : (
          <p className="muted">Для первой загрузки нужен работающий сервер.</p>
        )}
        <button className="btn2" onClick={() => void refresh()}>Повторить подключение</button>
      </div>
    );

  const home = load.home;

  switch (route.name) {
    case 'onboarding':
      return <Onboarding onClose={back} onReview={() => setStack([{ name: 'tab' }, { name: 'profile' }])} />;
    case 'profile':
      return <Profile onBack={back} onConfirmed={() => { setStack([{ name: 'tab' }]); setTab('plan'); void refresh(); }} onOnboarding={() => push({ name: 'onboarding' })} />;
    case 'catalog':
      return <Catalog onBack={back} onOpen={(id) => push({ name: 'exercise', id })} />;
    case 'exercise':
      return <Exercise id={route.id} onBack={back} onOpen={(id) => push({ name: 'exercise', id })} />;
    case 'settings':
      return <Settings h={home} onBack={back} go={(r) => push({ name: r })} reload={() => void refresh()} />;
    case 'session':
      return (
        <SessionScreen
          id={route.id}
          onBack={back}
          onExercise={(id) => push({ name: 'exercise', id })}
          onCheckin={() => push({ name: 'checkin', id: route.id, minutes: week?.sessions.find((x) => x.id === route.id)?.durationMin ?? 60 })}
          onWorkout={() => push({ name: 'workout', id: route.id })}
        />
      );
    case 'checkin':
      return (
        <Checkin
          sessionId={route.id}
          plannedMin={route.minutes}
          onCancel={back}
          onStarted={() => { setStack((st) => [...st.slice(0, -1), { name: 'workout', id: route.id }]); void refresh(); }}
          onDone={() => { setStack([{ name: 'tab' }]); void refresh(); }}
        />
      );
    case 'workout':
      return (
        <Workout
          sessionId={route.id}
          onMinimize={() => { setStack([{ name: 'tab' }]); void refresh(); }}
          onExercise={(id) => push({ name: 'exercise', id })}
          onFinished={() => { setStack([{ name: 'tab' }, { name: 'session', id: route.id }]); void refresh(); }}
        />
      );
  }

  const go = (r: 'onboarding' | 'profile' | 'catalog' | 'settings') => push({ name: r });
  return (
    <div className="screen-full">
      {tab === 'home' && <Home h={home} week={week} go={go} openSession={(id) => push({ name: 'session', id })} openPlan={() => setTab('plan')} />}
      {tab === 'plan' && (
        <PlanTab
          week={week}
          reload={async () => { await refresh(); }}
          openSession={(id) => push({ name: 'session', id })}
          openCatalog={() => go('catalog')}
          goProfile={() => go(home.onboarding.finished ? 'profile' : 'onboarding')}
        />
      )}
      {tab === 'food' && <Soon title="Питание" text="Меню, замены блюд и дневник по тексту и фото — на этапе 5." />}
      {tab === 'progress' && <Soon title="Прогресс" text="Графики результатов, регулярность и личные фотоотчёты — на этапе 6. Данные начнут копиться с первых тренировок." />}
      {tab === 'assistant' && <Soon title="Помощник" text="Чат для изменений плана: «сегодня только 20 минут», «перенеси на субботу» — на этапе 4." />}
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
