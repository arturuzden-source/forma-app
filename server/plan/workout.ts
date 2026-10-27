import { z } from 'zod';
import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';
import { durationMinutes, reduceVolume, shorten, type Content } from './content.js';
import { recoveryContent } from './planner.js';
import type { Exercise } from '../catalog/store.js';
import type { SessionRow } from './store.js';

export const ALARM_SYMPTOMS = ['chest_pain', 'breath', 'dizzy', 'acute_joint', 'other_alarm'] as const;
export const ALARM_RU: Record<(typeof ALARM_SYMPTOMS)[number], string> = {
  chest_pain: 'боль или давление в груди',
  breath: 'сильная одышка в покое',
  dizzy: 'головокружение, обморок',
  acute_joint: 'острая боль в суставе или травма',
  other_alarm: 'другое, что вас тревожит'
};

export const checkinSchema = z.object({
  wellbeing: z.number().int().min(1).max(5),
  sleep: z.enum(['poor', 'ok', 'good']),
  fatigue: z.enum(['low', 'medium', 'high']),
  pain: z.enum(['none', 'mild', 'alarm']),
  alarm: z.array(z.enum(ALARM_SYMPTOMS)).max(5).default([]),
  minutes: z.number().int().min(5).max(240).nullable()
});
export type CheckinAnswers = z.infer<typeof checkinSchema>;

export type Option = {
  id: 'keep' | 'short' | 'reduce' | 'recovery' | 'rest' | 'stop';
  title: string;
  description: string;
  recommended: boolean;
  durationMin: number | null;
  content: Content | null;
};

/**
 * Правила чек-ина — на сервере. Модель здесь не участвует: решение о допустимости
 * нагрузки принимается детерминированно. При тревожных симптомах — только остановка.
 */
export function checkinOptions(a: CheckinAnswers, current: Content, allowed: Map<string, Exercise>): { message: string; options: Option[] } {
  if (a.pain === 'alarm' || a.alarm.length > 0) {
    return {
      message:
        'Сегодня тренировку проводить не нужно. Если сейчас боль или давление в груди, обморок, сильная одышка в покое — вызовите скорую помощь (112). При острой боли в суставе или травме обратитесь к врачу. Я не ставлю диагнозы.',
      options: [{ id: 'stop', title: 'Понятно, без тренировки', description: 'Занятие будет отменено по самочувствию. Перенос предложу позже.', recommended: true, durationMin: null, content: null }]
    };
  }
  const opts: Option[] = [];
  const dur = durationMinutes(current);
  const tired = a.wellbeing <= 2 || (a.sleep === 'poor' && a.fatigue === 'high');
  const lowish = a.wellbeing === 3 && (a.sleep === 'poor' || a.fatigue === 'high');
  const recovery = recoveryContent(allowed);
  let message = 'Можно тренироваться по плану.';

  let base = current;
  if (a.minutes && a.minutes < dur) {
    const s = shorten(current, a.minutes);
    if (s) {
      base = s;
      opts.push({ id: 'short', title: `Сократить до ${durationMinutes(s)} мин`, description: `Меньше подходов и упражнений с конца. Нагрузка не переносится на другие дни.`, recommended: !tired && a.pain === 'none', durationMin: durationMinutes(s), content: s });
      message = `Есть ${a.minutes} мин — сокращаю занятие.`;
    } else {
      message = `${a.minutes} мин мало для этого занятия — предлагаю короткое восстановительное или отдых.`;
    }
  } else {
    opts.push({ id: 'keep', title: `По плану · ${dur} мин`, description: 'Без изменений.', recommended: !tired && !lowish && a.pain === 'none', durationMin: dur, content: null });
  }

  if (tired || lowish || a.pain === 'mild') {
    const r = reduceVolume(base, 0.35);
    opts.push({ id: 'reduce', title: `Облегчить · ${durationMinutes(r)} мин`, description: 'Те же упражнения, примерно на треть меньше подходов.', recommended: lowish && a.pain === 'none', durationMin: durationMinutes(r), content: r });
    message = a.pain === 'mild' ? 'Есть дискомфорт — лучше облегчить или сделать восстановительное занятие. Упражнения, вызывающие боль, пропускайте.' : 'Самочувствие ниже обычного — предлагаю облегчить занятие.';
  }

  const recFits = !a.minutes || durationMinutes(recovery) <= a.minutes;
  if (recFits) opts.push({ id: 'recovery', title: `Восстановительное · ${durationMinutes(recovery)} мин`, description: 'Подвижность и лёгкие упражнения без нагрузки.', recommended: tired || a.pain === 'mild', durationMin: durationMinutes(recovery), content: recovery });
  opts.push({ id: 'rest', title: 'Сегодня отдых', description: 'Занятие отменится по самочувствию и не засчитается как пропуск. Перенос предложу позже.', recommended: false, durationMin: null, content: null });

  if (!opts.some((o) => o.recommended)) opts[0]!.recommended = true;
  return { message, options: opts };
}

export class SessionStateError extends Error {}

export function saveCheckin(db: DB, s: SessionRow, userId: number, a: CheckinAnswers, r: { options: Option[] }) {
  return Number(
    db.prepare('INSERT INTO checkins (session_id, user_id, answers, options, created_at) VALUES (?, ?, ?, ?, ?)').run(s.id, userId, JSON.stringify(a), JSON.stringify(r.options), new Date().toISOString()).lastInsertRowid
  );
}

/**
 * Применить выбор чек-ина. Атомарно: проверка статуса и версии содержания,
 * сохранение версии, по которой занятие начато (started_content).
 */
export function chooseOption(db: DB, userId: number, sessionId: number, checkinId: number, optionId: string, expectedVersion: number) {
  return withTx(db, () => {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(sessionId, userId) as SessionRow | undefined;
    if (!s) throw new SessionStateError('Занятие не найдено');
    const ck = db.prepare('SELECT options, chosen FROM checkins WHERE id=? AND session_id=?').get(checkinId, sessionId) as { options: string; chosen: string | null } | undefined;
    if (!ck) throw new SessionStateError('Чек-ин не найден');
    if (ck.chosen) {
      // Повторное нажатие: ничего не меняем, возвращаем текущее состояние.
      return { status: s.status, replay: true };
    }
    if (s.status !== 'planned') throw new SessionStateError('Занятие уже начато или завершено');
    if (s.content_version !== expectedVersion) throw new SessionStateError('Занятие изменилось — откройте его заново');
    const opt = (JSON.parse(ck.options) as Option[]).find((o) => o.id === optionId);
    if (!opt) throw new SessionStateError('Вариант не найден');
    const now = new Date().toISOString();
    db.prepare('UPDATE checkins SET chosen=? WHERE id=?').run(optionId, checkinId);
    if (opt.id === 'rest' || opt.id === 'stop') {
      db.prepare("UPDATE sessions SET status='cancelled', updated_at=? WHERE id=?").run(now, sessionId);
      return { status: 'cancelled', replay: false };
    }
    const content = opt.content ?? (JSON.parse(s.content) as Content);
    const text = JSON.stringify(content);
    db.prepare(
      `UPDATE sessions SET content=?, content_version=content_version+?, duration_min=?, started_content=?, status='started', started_at=?, updated_at=? WHERE id=?`
    ).run(text, opt.content ? 1 : 0, durationMinutes(content), text, now, now, sessionId);
    return { status: 'started', replay: false };
  });
}

export const setSchema = z.object({
  item_index: z.number().int().min(0).max(20),
  set_index: z.number().int().min(0).max(20),
  reps: z.number().int().min(0).max(500).nullable().default(null),
  seconds: z.number().int().min(0).max(36000).nullable().default(null),
  meters: z.number().int().min(0).max(100000).nullable().default(null),
  weight_kg: z.number().min(0).max(500).nullable().default(null),
  rpe: z.number().int().min(1).max(10).nullable().default(null),
  pain: z.boolean().default(false),
  note: z.string().max(300).nullable().default(null)
});
export type SetInput = z.infer<typeof setSchema>;

/**
 * Записать подход. Ключ (занятие, упражнение, номер подхода) делает запись идемпотентной:
 * повтор того же запроса не создаёт дубль, повтор с другими значениями — исправление.
 */
export function recordSet(db: DB, userId: number, sessionId: number, x: SetInput) {
  return withTx(db, () => {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(sessionId, userId) as SessionRow | undefined;
    if (!s) throw new SessionStateError('Занятие не найдено');
    if (!['started', 'done', 'partial'].includes(s.status) || !s.started_content) throw new SessionStateError('Сначала начните занятие');
    const c = JSON.parse(s.started_content) as Content;
    const it = c.items[x.item_index];
    if (!it) throw new SessionStateError('Нет такого упражнения в занятии');
    if (x.set_index > it.sets + 2) throw new SessionStateError('Слишком много подходов');
    const now = new Date().toISOString();
    const prev = db.prepare('SELECT reps, seconds, meters, weight_kg, rpe, pain, note FROM set_results WHERE session_id=? AND item_index=? AND set_index=?').get(sessionId, x.item_index, x.set_index) as
      | { reps: number | null; seconds: number | null; meters: number | null; weight_kg: number | null; rpe: number | null; pain: number; note: string | null }
      | undefined;
    const vals = { reps: x.reps, seconds: x.seconds, meters: x.meters, weight_kg: x.weight_kg, rpe: x.rpe, pain: x.pain ? 1 : 0, note: x.note };
    if (prev) {
      if (JSON.stringify(prev) === JSON.stringify(vals)) return { saved: true, replay: true };
      db.prepare(`UPDATE set_results SET reps=?, seconds=?, meters=?, weight_kg=?, rpe=?, pain=?, note=?, updated_at=?, corrected=1 WHERE session_id=? AND item_index=? AND set_index=?`).run(
        vals.reps, vals.seconds, vals.meters, vals.weight_kg, vals.rpe, vals.pain, vals.note, now, sessionId, x.item_index, x.set_index
      );
      if (s.status !== 'started') refreshFinishedStatus(db, s);
      return { saved: true, replay: false, corrected: true };
    }
    db.prepare(
      `INSERT INTO set_results (session_id, user_id, item_index, exercise_id, set_index, reps, seconds, meters, weight_kg, rpe, pain, note, performed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, userId, x.item_index, it.exercise_id, x.set_index, vals.reps, vals.seconds, vals.meters, vals.weight_kg, vals.rpe, vals.pain, vals.note, now, now);
    if (s.status !== 'started') refreshFinishedStatus(db, s);
    return { saved: true, replay: false };
  });
}

function completion(db: DB, s: SessionRow) {
  const c = JSON.parse(s.started_content ?? s.content) as Content;
  const planned = c.items.reduce((a, it) => a + it.sets, 0);
  const rows = db.prepare('SELECT item_index, set_index FROM set_results WHERE session_id=?').all(s.id) as { item_index: number; set_index: number }[];
  const plannedDone = rows.filter((r) => c.items[r.item_index] && r.set_index < c.items[r.item_index]!.sets).length;
  return { planned, recorded: rows.length, plannedDone };
}

function refreshFinishedStatus(db: DB, s: SessionRow) {
  const k = completion(db, s);
  db.prepare('UPDATE sessions SET status=?, updated_at=? WHERE id=?').run(k.plannedDone >= k.planned ? 'done' : 'partial', new Date().toISOString(), s.id);
}

/** Завершить занятие: «выполнено», если записаны все запланированные подходы, иначе «частично». */
export function finishSession(db: DB, userId: number, sessionId: number) {
  return withTx(db, () => {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(sessionId, userId) as SessionRow | undefined;
    if (!s) throw new SessionStateError('Занятие не найдено');
    if (s.status === 'done' || s.status === 'partial') return { status: s.status, replay: true };
    if (s.status !== 'started') throw new SessionStateError('Занятие не начато');
    const k = completion(db, s);
    if (k.recorded === 0) throw new SessionStateError('Нет ни одного записанного подхода');
    const status = k.plannedDone >= k.planned ? 'done' : 'partial';
    db.prepare('UPDATE sessions SET status=?, finished_at=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), new Date().toISOString(), sessionId);
    return { status, replay: false, ...k };
  });
}

/** Выйти из начатого занятия без записей: вернуть его в план. С записями — только завершить. */
export function abandonSession(db: DB, userId: number, sessionId: number) {
  return withTx(db, () => {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(sessionId, userId) as SessionRow | undefined;
    if (!s || s.status !== 'started') throw new SessionStateError('Занятие не начато');
    if (completion(db, s).recorded > 0) throw new SessionStateError('Есть записанные подходы — завершите занятие');
    db.prepare("UPDATE sessions SET status='planned', started_content=NULL, started_at=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), sessionId);
    return { status: 'planned' };
  });
}
