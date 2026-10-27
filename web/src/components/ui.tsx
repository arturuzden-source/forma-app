import type { ReactNode } from 'react';

export type Tab = 'home' | 'plan' | 'food' | 'progress' | 'assistant';

const ICONS: Record<Tab, ReactNode> = {
  home: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />,
  plan: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  food: (
    <>
      <path d="M4 12h16a8 8 0 0 1-16 0z" />
      <path d="M10 8c0-2 2-2 2-4M15 8c0-2 2-2 2-4" />
    </>
  ),
  progress: <path d="M5 20v-8M11 20V5M17 20v-5M3 20h18" />,
  assistant: <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
};
const LABELS: Record<Tab, string> = { home: 'Главная', plan: 'План', food: 'Питание', progress: 'Прогресс', assistant: 'Помощник' };

export function TabBar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {(Object.keys(LABELS) as Tab[]).map((t) => (
        <button key={t} className={`tab${t === active ? ' on' : ''}`} onClick={() => onSelect(t)} aria-current={t === active ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[t]}</svg>
          {LABELS[t]}
        </button>
      ))}
    </nav>
  );
}

export function TopBar({ title, sub, left, right }: { title: string; sub?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-side">{left}</div>
      <h1>
        {title}
        {sub && <small>{sub}</small>}
      </h1>
      <div className="topbar-side right">{right}</div>
    </header>
  );
}

export function Banner({ kind, title, children }: { kind: 'warn' | 'info' | 'ok'; title: string; children?: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === 'warn' ? 'alert' : undefined}>
      <p className="banner-title">{title}</p>
      {children && <div className="banner-body">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <span className="sr">{label}</span>
    </div>
  );
}

export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
