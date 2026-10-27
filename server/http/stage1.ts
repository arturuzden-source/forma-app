import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { AiService } from '../ai/service.js';
import { spentThisMonth } from '../ai/openai.js';
import { answerText, chooseQuick, goBack, restartOnboarding, skipTopic, startOrResume } from '../onboarding/engine.js';
import { activeGoals, confirmProfile, getProfile, patchProfile, VersionConflict } from '../profile/store.js';
import { missingRequired } from '../profile/schema.js';
import { getExercise, listExercises } from '../catalog/store.js';

type Ctx = { cfg: Config; db: DB; ai: AiService };

function validTz(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || tz.length > 60) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** Один запрос к ИИ на пользователя одновременно: повторное нажатие не создаёт второй вызов. */
const inFlight = new Set<number>();

export function registerStage1(api: FastifyInstance, ctx: Ctx) {
  const { db, ai, cfg } = ctx;

  // ——— Беседа-знакомство ———
  api.get('/api/onboarding', async (req) => {
    const tz = validTz((req.query as { tz?: string }).tz);
    return startOrResume(db, req.userId!, { tz }, ai);
  });

  const answerBody = z.object({ text: z.string().trim().min(1).max(1000), tz: z.string().optional() });
  api.post('/api/onboarding/answer', async (req, reply) => {
    const b = answerBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const uid = req.userId!;
    if (inFlight.has(uid)) return reply.code(409).send({ error: 'busy' });
    inFlight.add(uid);
    try {
      return await answerText(db, uid, b.data.text, { tz: validTz(b.data.tz), today: new Date().toISOString().slice(0, 10), model: cfg.AI_MODEL_CHAT }, ai);
    } finally {
      inFlight.delete(uid);
    }
  });

  const quickBody = z.object({ id: z.string().max(20), tz: z.string().optional() });
  api.post('/api/onboarding/quick', async (req, reply) => {
    const b = quickBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    const tz = validTz(b.data.tz);
    if (b.data.id === 'later') return skipTopic(db, req.userId!, { tz }, ai);
    return chooseQuick(db, req.userId!, b.data.id, { tz }, ai);
  });

  api.post('/api/onboarding/back', async (req) => goBack(db, req.userId!, { tz: validTz((req.body as { tz?: string } | null)?.tz) }, ai));

  api.post('/api/onboarding/restart', async (req) => {
    restartOnboarding(db, req.userId!);
    return startOrResume(db, req.userId!, { tz: validTz((req.body as { tz?: string } | null)?.tz) }, ai);
  });

  // ——— Профиль ———
  api.get('/api/profile', async (req) => {
    const p = getProfile(db, req.userId!);
    return { ...p, missing: missingRequired(p.data, p.unknown), goals: activeGoals(db, req.userId!) };
  });

  const patchBody = z.object({ version: z.number().int(), patch: z.record(z.unknown()), unknown: z.array(z.string()).optional() });
  api.patch('/api/profile', async (req, reply) => {
    const b = patchBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const r = patchProfile(db, req.userId!, b.data.patch, { source: 'edit', expectedVersion: b.data.version, markUnknown: b.data.unknown });
      if (r.rejected.length) return reply.code(422).send({ error: 'invalid_fields', fields: r.rejected });
      const p = r.profile;
      return { ...p, missing: missingRequired(p.data, p.unknown), changed: r.changed };
    } catch (e) {
      if (e instanceof VersionConflict) return reply.code(409).send({ error: 'version_conflict', message: e.message });
      throw e;
    }
  });

  api.post('/api/profile/confirm', async (req, reply) => {
    const b = z.object({ version: z.number().int() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const r = confirmProfile(db, req.userId!, b.data.version);
      if (!r.ok) return reply.code(422).send({ error: 'missing_required', fields: r.missing });
      return { ...r.profile, goals: activeGoals(db, req.userId!) };
    } catch (e) {
      if (e instanceof VersionConflict) return reply.code(409).send({ error: 'version_conflict', message: e.message });
      throw e;
    }
  });

  // ——— Каталог упражнений ———
  api.get('/api/catalog', async () => ({
    exercises: listExercises(db).map((e) => ({
      id: e.id, name: e.name, category: e.category, pattern: e.pattern, level: e.level, places: e.places, equipment: e.equipment,
      measure: e.measure, short: e.card.short, status: e.status, isDemo: e.isDemo, pose: e.card.media[0]?.pose ?? null
    }))
  }));

  api.get('/api/catalog/:id', async (req, reply) => {
    const e = getExercise(db, (req.params as { id: string }).id);
    if (!e || e.status === 'withdrawn') return reply.code(404).send({ error: 'not_found' });
    const names = (ids: string[]) =>
      ids.map((id) => getExercise(db, id)).filter((x): x is NonNullable<typeof x> => Boolean(x) && x!.status !== 'withdrawn').map((x) => ({ id: x.id, name: x.name }));
    return { ...e, easierList: names(e.card.easier), alternativeList: names(e.card.alternatives) };
  });

  // ——— Главная ———
  api.get('/api/home', async (req) => {
    const uid = req.userId!;
    const p = getProfile(db, uid);
    const onb = db.prepare('SELECT finished_at FROM onboarding WHERE user_id=?').get(uid) as { finished_at: string | null } | undefined;
    return {
      profile: { status: p.status, name: p.data.name ?? null, avatar: p.data.avatar ?? null, timezone: p.data.timezone ?? null },
      onboarding: { started: Boolean(onb), finished: Boolean(onb?.finished_at) },
      goals: activeGoals(db, uid),
      ai: { spentUsd: spentThisMonth(db), budgetUsd: cfg.AI_MONTHLY_BUDGET_USD, available: ai.available() }
    };
  });
}
