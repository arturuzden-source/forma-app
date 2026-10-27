import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { AiService } from '../ai/service.js';
import { generateWeek, getSession, sessionDetail, weekView } from '../plan/store.js';
import { abandonSession, checkinOptions, checkinSchema, chooseOption, finishSession, recordSet, saveCheckin, SessionStateError, setSchema, ALARM_RU } from '../plan/workout.js';
import { allowedExercises } from '../plan/planner.js';
import { plannableExercises } from '../catalog/store.js';
import { getProfile } from '../profile/store.js';
import type { Content } from '../plan/content.js';

type Ctx = { cfg: Config; db: DB; ai: AiService };

const generating = new Set<number>();

export function registerStage2(api: FastifyInstance, ctx: Ctx) {
  const { db, ai, cfg } = ctx;
  const sid = (req: { params: unknown }) => Number((req.params as { id: string }).id);

  api.get('/api/plan', async (req) => weekView(db, req.userId!));

  api.post('/api/plan/generate', async (req, reply) => {
    const uid = req.userId!;
    if (generating.has(uid)) return reply.code(409).send({ error: 'busy', message: 'План уже составляется' });
    const reason = z.object({ reason: z.string().max(200).default('по запросу') }).safeParse(req.body ?? {});
    generating.add(uid);
    try {
      const r = await generateWeek({ db, ai, planModel: cfg.AI_MODEL_PLAN, allowDemo: cfg.PLAN_ALLOW_DEMO }, uid, reason.success ? reason.data.reason : 'по запросу');
      return { ...r, week: weekView(db, uid) };
    } catch (e) {
      // Ошибка генерации не трогает действующий план.
      return reply.code(422).send({ error: 'plan_failed', message: (e as Error).message });
    } finally {
      generating.delete(uid);
    }
  });

  api.get('/api/sessions/:id', async (req, reply) => {
    const s = getSession(db, req.userId!, sid(req));
    if (!s) return reply.code(404).send({ error: 'not_found' });
    return sessionDetail(db, s);
  });

  api.get('/api/checkin/symptoms', async () => ({ symptoms: ALARM_RU }));

  api.post('/api/sessions/:id/checkin', async (req, reply) => {
    const uid = req.userId!;
    const s = getSession(db, uid, sid(req));
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (s.status !== 'planned') return reply.code(409).send({ error: 'state', message: 'Занятие уже начато или завершено' });
    const a = checkinSchema.safeParse(req.body);
    if (!a.success) return reply.code(400).send({ error: 'bad_request' });
    const allowed = allowedExercises(plannableExercises(db, cfg.PLAN_ALLOW_DEMO), getProfile(db, uid).data);
    const r = checkinOptions(a.data, JSON.parse(s.content) as Content, allowed);
    const checkinId = saveCheckin(db, s, uid, a.data, r);
    return { checkinId, contentVersion: s.content_version, message: r.message, options: r.options.map(({ content: _c, ...o }) => o) };
  });

  const chooseBody = z.object({ checkinId: z.number().int(), optionId: z.string().max(20), contentVersion: z.number().int() });
  api.post('/api/sessions/:id/choose', async (req, reply) => {
    const b = chooseBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const r = chooseOption(db, req.userId!, sid(req), b.data.checkinId, b.data.optionId, b.data.contentVersion);
      return { ...r, session: sessionDetail(db, getSession(db, req.userId!, sid(req))!) };
    } catch (e) {
      if (e instanceof SessionStateError) return reply.code(409).send({ error: 'state', message: e.message });
      throw e;
    }
  });

  api.post('/api/sessions/:id/sets', async (req, reply) => {
    const b = setSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      return recordSet(db, req.userId!, sid(req), b.data);
    } catch (e) {
      if (e instanceof SessionStateError) return reply.code(409).send({ error: 'state', message: e.message });
      throw e;
    }
  });

  api.post('/api/sessions/:id/finish', async (req, reply) => {
    try {
      return { ...finishSession(db, req.userId!, sid(req)), session: sessionDetail(db, getSession(db, req.userId!, sid(req))!) };
    } catch (e) {
      if (e instanceof SessionStateError) return reply.code(409).send({ error: 'state', message: e.message });
      throw e;
    }
  });

  api.post('/api/sessions/:id/abandon', async (req, reply) => {
    try {
      return abandonSession(db, req.userId!, sid(req));
    } catch (e) {
      if (e instanceof SessionStateError) return reply.code(409).send({ error: 'state', message: e.message });
      throw e;
    }
  });
}
