type TgWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string } };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  version?: string;
  platform?: string;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: { impactOccurred: (s: 'light' | 'medium') => void; notificationOccurred: (s: 'success' | 'error' | 'warning') => void };
  isVersionAtLeast?: (v: string) => boolean;
};

export function tg(): TgWebApp | null {
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
}

export function initTelegram() {
  const w = tg();
  if (!w) return;
  w.ready();
  w.expand();
  try {
    w.setHeaderColor?.('#0d0e10');
    w.setBackgroundColor?.('#0d0e10');
  } catch {
    /* старые клиенты */
  }
}

/** Нативная кнопка «Назад» Telegram. Возвращает функцию отписки. */
export function bindBackButton(visible: boolean, onBack: () => void) {
  const b = tg()?.BackButton;
  if (!b) return () => {};
  if (visible) b.show();
  else b.hide();
  b.onClick(onBack);
  return () => b.offClick(onBack);
}

export function haptic(kind: 'light' | 'success' | 'error') {
  try {
    const h = tg()?.HapticFeedback;
    if (kind === 'light') h?.impactOccurred('light');
    else h?.notificationOccurred(kind);
  } catch {
    /* нет поддержки */
  }
}

export function deviceTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
