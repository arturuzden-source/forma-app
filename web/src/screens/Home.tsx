import type { Home as HomeT } from '../types';
import { AvatarFigure } from '../components/Figure';
import { UserIcon } from '../components/ui';

function today() {
  return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function Home({ h, go }: { h: HomeT; go: (r: 'onboarding' | 'profile' | 'catalog' | 'settings') => void }) {
  const name = h.profile.name;
  const av = h.profile.avatar;
  const confirmed = h.profile.status === 'confirmed';
  const main = h.goals[0];
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

        {confirmed && (
          <section className="card hl">
            <p className="label accent">План недели</p>
            <p className="h3">Профиль подтверждён</p>
            <p className="muted-hl">Составление плана — следующее обновление приложения. Пока можно посмотреть каталог упражнений.</p>
            <button className="btn" onClick={() => go('catalog')}>Каталог упражнений</button>
          </section>
        )}

        {main && (
          <section className="card">
            <p className="label">Главная цель{main.deadline ? ` · до ${new Date(main.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : ''}</p>
            <p className="h3">{main.title}</p>
            {main.target != null && main.baseline != null && main.target !== main.baseline ? (
              <>
                <div className="bar"><i style={{ width: '0%' }} /></div>
                <p className="muted">Исходно {main.baseline} · цель {main.target}{main.unit ? ` ${main.unit}` : ''}. Прогресс появится после первых записей.</p>
              </>
            ) : (
              <p className="muted">Прогресс появится после первых записей.</p>
            )}
          </section>
        )}

        {confirmed && (
          <button className="link" onClick={() => go('profile')}>Профиль и цели</button>
        )}
      </main>
    </>
  );
}
