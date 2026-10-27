/** Работа с датами по часовому поясу пользователя. Моменты храним в UTC, даты — локальными строками ГГГГ-ММ-ДД. */

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WD)[number];

export function localParts(at: Date, tz: string): { date: string; time: string; weekday: Weekday } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  const wd = (p.weekday ?? 'Mon').toLowerCase().slice(0, 3) as Weekday;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, weekday: wd };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Понедельник недели, в которую входит дата. */
export function weekStartOf(date: string): string {
  const wd = WD.indexOf(weekdayOf(date));
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

function offsetMs(at: Date, tz: string) {
  const p = localParts(at, tz);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = p.time.split(':').map(Number) as [number, number];
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  return asUtc - Math.floor(at.getTime() / 60000) * 60000;
}

/** Местное время в часовом поясе → момент UTC (ISO). */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t).toISOString();
}

export function minutesOf(time: string) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function timeOf(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
