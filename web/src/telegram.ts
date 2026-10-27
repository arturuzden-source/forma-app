type TgWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string } };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  version?: string;
  platform?: string;
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
