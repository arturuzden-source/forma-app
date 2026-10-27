import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';
import type { AiService } from '../ai/service.js';
import { getProfile } from '../profile/store.js';
import { plannableExercises, getExercise, type Exercise } from '../catalog/store.js';
import { durationMinutes, type Content } from './content.js';
import { allowedExercises, candidateWindows, rulesPlan, validatePlan, type Proposed } from './planner.js';
import { PLAN_SCHEMA, PLAN_SYSTEM, planPrompt, toProposed } from './ai-plan.js';
import { localParts, weekStartOf, zonedToUtc, addDays } from './time.js';

export type SessionRow = {
  id: number; plan_id: number; local_date: string; start_time: string; start_at: string; timezone: string; title: string; purpose: string;
  duration_min: number; content: string; content_version: number; started_content: string | null; status: string; started_at: string | null; finished_at: string | null;
};

export type PlanCtx = { db: DB; ai: AiService; planModel: string; allowDemo: boolean; now?: Date };

const DONE_LIKE = "('started','done','partial','skipped')";

export function nowLocal(tz: string, now = new Date()) {
  return localParts(now, tz);
}

/** История для ИИ: лучшие результаты по упражнениям за 4 недели и выполнение занятий. */
export function recentHistory(db: DB, userId: number, sinceIso: string) {
  const results = db
    .prepare(
      `SELECT exercise_id, MAX(reps) AS best_reps, MAX(seconds) AS best_seconds, MAX(weight_kg) AS best_weight, MAX(rpe) AS max_rpe, SUM(pain) AS pain_sets, COUNT(*) AS sets
       FROM set_results WHERE user_id=? AND performed_at >= ? GROUP BY exercise_id`
    )
    .all(userId, sinceIso);
  const sessions = db
    .prepare(`SELECT s.status, COUNT(*) AS n FROM sessions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id=? AND s.start_at >= ? AND p.status='active' GROUP BY s.status`)
    .all(userId, sinceIso);
  return { results, sessions, note: results.length ? 'фактические результаты за 4 недели' : 'записанных результатов пока нет' };
}

export type GenerateResult = { planId: number; source: 'ai' | 'rules'; explanation: string; warnings: string[] };

/**
 * Составить план на текущую неделю. ИИ предлагает → сервер проверяет → при нарушениях
 * один повтор с замечаниями → иначе план по базовым правилам. Существующий план меняется
 * только после успешной проверки нового. Начатые и выполненные занятия сохраняются.
 */
export async function generateWeek(ctx: PlanCtx, userId: number, reason: string): Promise<GenerateResult> {
  const { db, ai } = ctx;
  const prof = getProfile(db, userId);
  if (prof.status !== 'confirmed') throw new Error('Профиль не подтверждён');
  const p = prof.data;
  const tz = p.timezone ?? 'Europe/Moscow';
  const now = ctx.now ?? new Date();
  const loc = nowLocal(tz, now);
  const weekStart = weekStartOf(loc.date);

  const busy = new Set(
    (db
      .prepare(`SELECT s.local_date FROM sessions s JOIN plans pl ON pl.id=s.plan_id WHERE s.user_id=? AND pl.week_start=? AND pl.status='active' AND s.status IN ${DONE_LIKE}`)
      .all(userId, weekStart) as { local_date: string }[]).map((r) => r.local_date)
  );
  const windows = candidateWindows(p, weekStart, loc.date, loc.time, busy);
  const allowed = allowedExercises(plannableExercises(db, ctx.allowDemo), p);
  const warnings: string[] = [];

  let proposed: Proposed[] | null = null;
  let explanation = '';
  let source: 'ai' | 'rules' = 'ai';

  if (windows.length === 0) {
    proposed = [];
    source = 'rules';
    explanation = 'На оставшиеся дни недели нет свободных окон в вашем расписании. Следующий план охватит полную неделю.';
  } else if (ai.available()) {
    const history = recentHistory(db, userId, new Date(now.getTime() - 28 * 86400_000).toISOString());
    const user = planPrompt(p, windows, [...allowed.values()], history, loc.date);
    let feedback: string[] = [];
    for (let attempt = 0; attempt < 2 && !proposed; attempt++) {
      try {
        const json = await ai.structured({
          purpose: 'plan',
          model: ctx.planModel,
          system: PLAN_SYSTEM,
          user: feedback.length ? `${user}\n\nПредыдущий вариант отклонён проверкой сервера:\n- ${feedback.join('\n- ')}\nИсправь эти нарушения.` : user,
          schema: PLAN_SCHEMA,
          maxOutput: 8000,
          estInput: 4000,
          timeoutMs: 90_000
        });
        const cand = toProposed(json);
        const errs = validatePlan(cand, p, allowed, windows);
        if (errs.length === 0) {
          proposed = cand;
          explanation = String((json as { explanation?: string }).explanation ?? '').trim();
        } else feedback = errs.slice(0, 12);
      } catch (e) {
        warnings.push(`ИИ: ${(e as { code?: string }).code ?? 'ошибка'}`);
        break;
      }
    }
    if (!proposed && feedback.length) warnings.push(`План ИИ не прошёл проверку: ${feedback.slice(0, 3).join(' ')}`);
  }

  if (!proposed) {
    source = 'rules';
    proposed = rulesPlan(p, allowed, windows);
    const errs = validatePlan(proposed, p, allowed, windows);
    if (errs.length) throw new Error(`Не удалось составить допустимый план: ${errs.join(' ')}`);
    explanation =
      'План составлен по базовым правилам: умеренная стартовая нагрузка с запасом, дни через один, всё укладывается в ваши окна и лимит времени.' +
      (warnings.length ? ' ИИ сейчас недоступен или его вариант не прошёл проверку.' : '');
  }
  if (!explanation) explanation = 'План составлен по вашему расписанию, целям и ограничениям.';

  const planId = savePlan(db, userId, weekStart, tz, proposed, { source, model: source === 'ai' ? ctx.planModel : null, explanation, basis: { reason, windows: windows.length, warnings } });
  return { planId, source, explanation, warnings };
}

export function savePlan(
  db: DB,
  userId: number,
  weekStart: string,
  tz: string,
  sessions: Proposed[],
  meta: { source: 'ai' | 'rules'; model: string | null; explanation: string; basis: unknown }
): number {
  return withTx(db, () => {
    const now = new Date().toISOString();
    const prev = db.prepare("SELECT id, version FROM plans WHERE user_id=? AND week_start=? AND status='active'").get(userId, weekStart) as { id: number; version: number } | undefined;
    const maxV = (db.prepare('SELECT MAX(version) AS v FROM plans WHERE user_id=? AND week_start=?').get(userId, weekStart) as { v: number | null }).v ?? 0;
    if (prev) db.prepare("UPDATE plans SET status='superseded' WHERE id=?").run(prev.id);
    const planId = Number(
      db
        .prepare('INSERT INTO plans (user_id, week_start, version, status, source, model, explanation, basis, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(userId, weekStart, maxV + 1, 'active', meta.source, meta.model, meta.explanation, JSON.stringify(meta.basis), tz, now).lastInsertRowid
    );
    if (prev) {
      // Начатые и завершённые занятия переходят в новую версию без изменений.
      db.prepare(`UPDATE sessions SET plan_id=? WHERE plan_id=? AND status IN ${DONE_LIKE}`).run(planId, prev.id);
    }
    const ins = db.prepare(
      `INSERT INTO sessions (plan_id, user_id, local_date, start_time, start_at, timezone, title, purpose, duration_min, content, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of sessions) {
      ins.run(planId, userId, s.date, s.start_time, zonedToUtc(s.date, s.start_time, tz), tz, s.title, s.purpose, durationMinutes(s.content), JSON.stringify(s.content), now);
    }
    return planId;
  });
}

export function weekView(db: DB, userId: number, now = new Date()) {
  const prof = getProfile(db, userId);
  const tz = prof.data.timezone ?? 'Europe/Moscow';
  const loc = nowLocal(tz, now);
  const weekStart = weekStartOf(loc.date);
  const plan = db
    .prepare("SELECT id, version, source, model, explanation, created_at FROM plans WHERE user_id=? AND week_start=? AND status='active'")
    .get(userId, weekStart) as { id: number; version: number; source: string; model: string | null; explanation: string; created_at: string } | undefined;
  const sessions = plan
    ? (db.prepare('SELECT * FROM sessions WHERE plan_id=? ORDER BY local_date, start_time').all(plan.id) as SessionRow[]).map((s) => sessionBrief(db, s))
    : [];
  return { today: loc.date, weekStart, weekEnd: addDays(weekStart, 6), timezone: tz, plan: plan ?? null, sessions, profileConfirmed: prof.status === 'confirmed' };
}

function names(db: DB, c: Content) {
  return c.items.map((it) => getExercise(db, it.exercise_id)?.name ?? it.exercise_id);
}

export function sessionBrief(db: DB, s: SessionRow) {
  const c = JSON.parse(s.started_content ?? s.content) as Content;
  const done = (db.prepare('SELECT COUNT(*) AS n FROM set_results WHERE session_id=?').get(s.id) as { n: number }).n;
  const planned = c.items.reduce((a, it) => a + it.sets, 0);
  return {
    id: s.id, date: s.local_date, startTime: s.start_time, startAt: s.start_at, title: s.title, purpose: s.purpose, durationMin: s.duration_min,
    status: s.status, exercises: names(db, c), setsDone: done, setsPlanned: planned
  };
}

export function getSession(db: DB, userId: number, id: number): SessionRow | null {
  return (db.prepare('SELECT * FROM sessions WHERE id=? AND user_id=?').get(id, userId) as SessionRow | undefined) ?? null;
}

export function sessionDetail(db: DB, s: SessionRow) {
  const c = JSON.parse(s.started_content ?? s.content) as Content;
  const results = db
    .prepare('SELECT item_index, set_index, reps, seconds, meters, weight_kg, rpe, pain, note, corrected FROM set_results WHERE session_id=? ORDER BY item_index, set_index')
    .all(s.id);
  const items = c.items.map((it) => {
    const e = getExercise(db, it.exercise_id) as Exercise | null;
    return { ...it, name: e?.name ?? it.exercise_id, equipment: e?.equipment ?? [], measure: e?.measure ?? 'reps', short: e?.card.short ?? '', pose: e?.card.media[0]?.pose ?? null, isDemo: e?.isDemo ?? true };
  });
  return {
    ...sessionBrief(db, s),
    warmupMin: c.warmup_min,
    cooldownMin: c.cooldown_min,
    contentVersion: s.content_version,
    startedVersionLocked: Boolean(s.started_content),
    items,
    results
  };
}
