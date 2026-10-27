import type { Home as HomeT, Week } from '../types';
import { AvatarFigure } from '../components/Figure';
import { UserIcon } from '../components/ui';
import { STATUS_RU, dayLabel } from '../format';

function today() {
  return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function Home({ h, week, go, openSession, openPlan }: { h: HomeT; week: Week | null; go: (r: 'onboarding' | 'profile' | 'catalog' | 'settings') => void; openSession: (id: number) => void; openPlan: () => void }) {
  const name = h.profile.name;
  const av = h.profile.avatar;
  const confirmed = h.profile.status === 'confirmed';
  const main = h.goals[0];
  const sessions = week?.sessions ?? [];
  const todayS = sessions.find((s) => s.date === week?.today);
  const next = sessions.find((s) => s.date > (week?.today ?? '') && s.status === 'planned');
  const doneCount = sessions.filter((s) => s.status === 'done' || s.status === 'partial').length;
  const counted = sessions.filter((s) => s.status !== 'cancelled').length;

  return (
    <>
      <header className="home-top">
        <span className="brand">Форма</span>
        <button className="icon-btn" aria-label="Профиль и настройки" onClick={() => go('settings')}><UserIcon /></button>
      </header>
      <main className="scroll pad stack">
        <div>
          <p className="muted cap">{today()}</p>
          <p className="h1">{name ? `Привет, ${name}` : 'Привет'}</p>
        </div>

        {!confirmed && (
          <section className="card hl">
            <p className="label accent">Знакомство</p>
            <p className="h3">{h.onboarding.started ? 'Продолжим знакомство' : 'Давайте познакомимся'}</p>
            <p className="muted-hl">
              {h.onboarding.finished ? 'Беседа завершена — проверьте и подтвердите резюме, чтобы получить план.' : 'Несколько вопросов о целях, расписании и самочувствии. Можно прерваться и продолжить позже.'}
            </p>
            <button className="btn" onClick={() => go(h.onboarding.finished ? 'profile' : 'onboarding')}>
              {h.onboarding.finished ? 'Проверить резюме' : h.onboarding.started ? 'Продолжить' : 'Начать'}
            </button>
          </section>
        )}

        {av && !av.hidden && (
          <section className="avatar-row">
            <div className="avatar-frame">
              <span className="badge">1</span>
              <AvatarFigure sex={av.sex} build={av.build} width={104} />
            </div>
            <div className="card grow">
              <p className="label">Регулярность</p>
              <p className="h3">Уровень 1</p>
              <p className="muted">Уровень растёт за зачтённые недели. Пропуски его не снижают.</p>
              <p className="tiny">Аватар — иллюстрация, а не измерение тела</p>
            </div>
          </section>
        )}

        {confirmed && todayS && (
          <button className={`card ${todayS.status === 'planned' || todayS.status === 'started' ? 'hl' : ''} as-btn`} onClick={() => openSession(todayS.id)}>
            <p className={`label${todayS.status === 'planned' || todayS.status === 'started' ? ' accent' : ''}`}>Сегодня · {todayS.startTime} · {STATUS_RU[todayS.status]}</p>
            <p className="h3">{todayS.title}</p>
            <p className={todayS.status === 'planned' ? 'muted-hl' : 'muted'}>{todayS.durationMin} мин · {todayS.exercises.length} упражн.</p>
            {todayS.status === 'planned' && <span className="btn as-span">Начать с чек-ина</span>}
            {todayS.status === 'started' && <span className="btn as-span">Продолжить тренировку</span>}
          </button>
        )}
        {confirmed && !todayS && week?.plan && (
          <section className="card">
            <p className="label">Сегодня</p>
            <p className="h3">День отдыха</p>
            {next && <p className="muted">Следующее: {dayLabel(next.date).long}, {next.startTime} — {next.title}</p>}
          </section>
        )}
        {confirmed && !week?.plan && (
          <section className="card hl">
            <p className="label accent">План недели</p>
            <p className="muted-hl">Профиль подтверждён — можно составить план на оставшиеся дни недели.</p>
            <button className="btn" onClick={openPlan}>Перейти к плану</button>
          </section>
        )}

        {main && (
          <section className="card">
            <p className="label">Главная цель{main.deadline ? ` · до ${new Date(main.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : ''}</p>
            <p className="h3">{main.title}</p>
            {main.target != null && main.baseline != null ? <p className="muted">Исходно {main.baseline} · цель {main.target}{main.unit ? ` ${main.unit}` : ''}. Динамика появится в разделе «Прогресс».</p> : <p className="muted">Динамика появится после первых записей.</p>}
          </section>
        )}

        {week?.plan && (
          <section className="grid3">
            <div className="card mini"><p className="label">Неделя</p><p className="num mid">{doneCount} / {counted}</p></div>
            <div className="card mini"><p className="label">Подходов</p><p className="num mid">{sessions.reduce((a, s) => a + s.setsDone, 0)}</p></div>
            <button className="card mini as-btn" onClick={() => go('catalog')}><p className="label">Техника</p><p className="num mid">›</p></button>
          </section>
        )}
      </main>
    </>
  );
}
