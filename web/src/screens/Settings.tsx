import { useState } from 'react';
import { api } from '../api';
import type { Avatar, Home } from '../types';
import { AvatarFigure } from '../components/Figure';
import { TopBar } from '../components/ui';

export function Settings({ h, onBack, go, reload }: { h: Home; onBack: () => void; go: (r: 'profile' | 'onboarding' | 'catalog') => void; reload: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const av = h.profile.avatar;

  async function setAvatar(a: Avatar) {
    try {
      const p = await api<{ version: number }>('/api/profile');
      await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ version: p.version, patch: { avatar: a } }) });
      setMsg('Аватар сохранён');
      reload();
    } catch {
      setMsg('Нет связи — аватар не сохранён');
    }
  }

  return (
    <div className="screen-full">
      <TopBar title="Профиль и настройки" left={<button className="link" onClick={onBack}>Назад</button>} />
      <main className="scroll pad stack">
        <div className="group">
          <button className="item" onClick={() => go('profile')}><span>Профиль, цели, ограничения</span><span className="v">›</span></button>
          <div className="item"><span>Часовой пояс</span><span className="v">{h.profile.timezone ?? 'не указан'}</span></div>
          <button className="item" onClick={() => go('catalog')}><span>Каталог упражнений</span><span className="v">›</span></button>
        </div>

        <p className="label">Аватар</p>
        <div className="avatar-pick">
          {(['m', 'f'] as const).flatMap((sex) =>
            [1, 2, 3].map((build) => {
              const on = av && !av.hidden && av.sex === sex && av.build === build;
              return (
                <button key={`${sex}${build}`} className={`avatar-opt${on ? ' on' : ''}`} aria-pressed={!!on} aria-label={`${sex === 'm' ? 'Мужской' : 'Женский'}, вариант ${build}`} onClick={() => void setAvatar({ sex, build, hidden: false })}>
                  <AvatarFigure sex={sex} build={build} width={44} />
                  <span>{build}</span>
                </button>
              );
            })
          )}
        </div>
        <button className="link" onClick={() => av && void setAvatar({ ...av, hidden: !av.hidden })}>{av?.hidden ? 'Показывать аватар' : 'Скрыть аватар'}</button>
        <p className="tiny">Варианты не означают «лучше» или «хуже». Аватар — иллюстрация, а не измерение тела.</p>

        <p className="label">Данные</p>
        <div className="group">
          <div className="item"><span>Расход ИИ в этом месяце</span><span className="v">{h.ai.spentUsd.toFixed(2)} $ из {h.ai.budgetUsd} $</span></div>
          <div className="item"><span>Что передаётся ИИ</span><span className="v small">ответы беседы и нужная часть профиля, без фото — OpenAI</span></div>
          <button className="item" onClick={() => go('onboarding')}><span>Открыть беседу-знакомство</span><span className="v">›</span></button>
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </main>
    </div>
  );
}

export function Soon({ title, text }: { title: string; text: string }) {
  return (
    <main className="scroll pad stack">
      <p className="h1">{title}</p>
      <section className="card">
        <p className="label">Скоро</p>
        <p className="muted">{text}</p>
      </section>
    </main>
  );
}
