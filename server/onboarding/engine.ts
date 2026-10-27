import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';
import type { AiService } from '../ai/service.js';
import { aiErrorMessage } from '../ai/service.js';
import { getProfile, patchProfile } from '../profile/store.js';
import type { Profile, ProfileField } from '../profile/schema.js';
import { missingRequired } from '../profile/schema.js';
import { TOPICS, topicQuestion, topicQuick, topicSatisfied, type Topic } from './topics.js';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM } from './extract.js';

export type Msg = { role: 'bot' | 'user'; text: string; at: string; why?: string };
type State = { topic: string | null; done: string[]; transcript: Msg[]; finishedAt: string | null };

export type View = {
  messages: Msg[];
  topic: string | null;
  quick: { id: string; label: string }[];
  progress: { step: number; total: number };
  finished: boolean;
  canGoBack: boolean;
  missingRequired: ProfileField[];
  aiAvailable: boolean;
};

const MAX_TRANSCRIPT = 120;

function load(db: DB, userId: number): State {
  const r = db.prepare('SELECT topic, done_topics, transcript, finished_at FROM onboarding WHERE user_id=?').get(userId) as
    | { topic: string | null; done_topics: string; transcript: string; finished_at: string | null }
    | undefined;
  if (!r) return { topic: null, done: [], transcript: [], finishedAt: null };
  return { topic: r.topic, done: JSON.parse(r.done_topics), transcript: JSON.parse(r.transcript), finishedAt: r.finished_at };
}

function save(db: DB, userId: number, s: State) {
  db.prepare(
    `INSERT INTO onboarding (user_id, topic, done_topics, transcript, finished_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET topic=excluded.topic, done_topics=excluded.done_topics, transcript=excluded.transcript,
       finished_at=excluded.finished_at, updated_at=excluded.updated_at`
  ).run(userId, s.topic, JSON.stringify(s.done), JSON.stringify(s.transcript.slice(-MAX_TRANSCRIPT)), s.finishedAt, new Date().toISOString());
}

function activeTopics(p: Profile) {
  return TOPICS.filter((t) => !t.when || t.when(p));
}

/** Следующая тема: первая не закрытая. Уже отвеченное повторно не спрашиваем. */
function nextTopic(p: Profile, unknown: string[], done: string[]): Topic | null {
  return activeTopics(p).find((t) => !done.includes(t.id) && !topicSatisfied(t, p, unknown)) ?? null;
}

function ask(s: State, t: Topic, p: Profile, ctx: { tz?: string }) {
  s.topic = t.id;
  s.transcript.push({ role: 'bot', text: topicQuestion(t, p, ctx), at: new Date().toISOString(), why: t.why });
}

function view(db: DB, userId: number, s: State, ctx: { tz?: string }, ai: AiService): View {
  const prof = getProfile(db, userId);
  const topics = activeTopics(prof.data);
  const t = TOPICS.find((x) => x.id === s.topic);
  return {
    messages: s.transcript,
    topic: s.topic,
    quick: t ? topicQuick(t, prof.data, ctx).map((q) => ({ id: q.id, label: q.label })) : [],
    progress: { step: Math.min(s.done.length + (s.topic ? 1 : 0), topics.length), total: topics.length },
    finished: Boolean(s.finishedAt),
    canGoBack: s.done.length > 0 && !s.finishedAt,
    missingRequired: missingRequired(prof.data, prof.unknown),
    aiAvailable: ai.available()
  };
}

function advance(db: DB, userId: number, s: State, ctx: { tz?: string }) {
  const prof = getProfile(db, userId);
  // Закрыть все темы, которые уже заполнены (в том числе попутными ответами).
  for (const t of activeTopics(prof.data)) if (!s.done.includes(t.id) && topicSatisfied(t, prof.data, prof.unknown)) s.done.push(t.id);
  const nt = nextTopic(prof.data, prof.unknown, s.done);
  if (nt) ask(s, nt, prof.data, ctx);
  else {
    s.topic = null;
    if (!s.finishedAt) {
      s.finishedAt = new Date().toISOString();
      s.transcript.push({ role: 'bot', text: 'Спасибо, это всё. Проверьте резюме: всё ли я понял верно. Исправить можно любое поле.', at: s.finishedAt });
    }
  }
}

export function startOrResume(db: DB, userId: number, ctx: { tz?: string }, ai: AiService): View {
  return withTx(db, () => {
    const s = load(db, userId);
    if (!s.topic && !s.finishedAt) advance(db, userId, s, ctx);
    save(db, userId, s);
    return view(db, userId, s, ctx, ai);
  });
}

export function chooseQuick(db: DB, userId: number, quickId: string, ctx: { tz?: string }, ai: AiService): View {
  return withTx(db, () => {
    const s = load(db, userId);
    const t = TOPICS.find((x) => x.id === s.topic);
    if (!t) return view(db, userId, s, ctx, ai);
    const prof = getProfile(db, userId);
    const q = topicQuick(t, prof.data, ctx).find((x) => x.id === quickId);
    if (!q) return view(db, userId, s, ctx, ai);
    s.transcript.push({ role: 'user', text: q.label, at: new Date().toISOString() });
    if (q.patch) patchProfile(db, userId, q.patch, { source: 'chat' });
    if (q.unknown) patchProfile(db, userId, {}, { source: 'chat', markUnknown: q.unknown });
    if (!s.done.includes(t.id)) s.done.push(t.id);
    advance(db, userId, s, ctx);
    save(db, userId, s);
    return view(db, userId, s, ctx, ai);
  });
}

export function goBack(db: DB, userId: number, ctx: { tz?: string }, ai: AiService): View {
  return withTx(db, () => {
    const s = load(db, userId);
    const prev = s.done.pop();
    if (prev) {
      const t = TOPICS.find((x) => x.id === prev)!;
      const prof = getProfile(db, userId);
      s.transcript.push({ role: 'bot', text: `Хорошо, вернёмся. ${topicQuestion(t, prof.data, ctx)}`, at: new Date().toISOString(), why: t.why });
      s.topic = t.id;
      s.finishedAt = null;
      // Сброс «не знаю» по теме, чтобы ответ можно было дать заново. Значения остаются до нового ответа.
      patchProfile(db, userId, {}, { source: 'chat', clearUnknown: t.fields });
    }
    save(db, userId, s);
    return view(db, userId, s, ctx, ai);
  });
}

/**
 * Свободный ответ: ИИ предлагает обновления, сервер проверяет их схемой и сохраняет.
 * При недоступном ИИ ответ сохраняется в беседе, а пользователь получает понятное сообщение.
 */
export async function answerText(db: DB, userId: number, text: string, ctx: { tz?: string; today: string; model: string }, ai: AiService): Promise<View> {
  const clean = text.trim().slice(0, 1000);
  const s0 = withTx(db, () => {
    const s = load(db, userId);
    s.transcript.push({ role: 'user', text: clean, at: new Date().toISOString() });
    save(db, userId, s);
    return s;
  });
  const t = TOPICS.find((x) => x.id === s0.topic);
  const prof = getProfile(db, userId);

  // Простые ответы без ИИ: имя.
  if (t?.id === 'name' && clean.length <= 40 && !/\d/.test(clean)) {
    return withTx(db, () => {
      const s = load(db, userId);
      const name = clean.replace(/^(меня зовут|я|зовите меня|можно)\s+/i, '').replace(/[.!]+$/, '').trim();
      patchProfile(db, userId, { name: name.charAt(0).toUpperCase() + name.slice(1) }, { source: 'chat' });
      advance(db, userId, s, ctx);
      save(db, userId, s);
      return view(db, userId, s, ctx, ai);
    });
  }

  type Extracted = { updates: Record<string, unknown>; dont_know: string[]; clarify: string | null; reply: string };
  let result: Extracted | null = null;
  let errorText: string | null = null;
  try {
    result = (await ai.structured({
      purpose: 'onboarding',
      model: ctx.model,
      system: EXTRACT_SYSTEM,
      user: JSON.stringify({
        today: ctx.today,
        current_question: t ? topicQuestion(t, prof.data, ctx) : null,
        already_known: Object.keys(prof.data),
        answer: clean
      }),
      schema: EXTRACT_SCHEMA,
      maxOutput: 2500,
      estInput: 1800
    })) as Extracted;
  } catch (e) {
    errorText = aiErrorMessage(e);
  }

  const extracted = result as Extracted | null;
  return withTx(db, () => {
    const s = load(db, userId);
    const result = extracted;
    if (!result) {
      s.transcript.push({ role: 'bot', text: errorText!, at: new Date().toISOString() });
      save(db, userId, s);
      return view(db, userId, s, ctx, ai);
    }
    const { rejected } = patchProfile(db, userId, result.updates ?? {}, {
      source: 'chat',
      markUnknown: (result.dont_know ?? []).filter((f) => t?.fields.includes(f as ProfileField))
    });
    const reply = result.reply?.trim();
    const p2 = getProfile(db, userId);
    const satisfied = t ? topicSatisfied(t, p2.data, p2.unknown) : true;
    if (result.clarify && !satisfied) {
      s.transcript.push({ role: 'bot', text: [reply, result.clarify].filter(Boolean).join(' '), at: new Date().toISOString() });
    } else if (!satisfied && t) {
      const missing = t.required.filter((f) => p2.data[f] === undefined && !p2.unknown.includes(f));
      s.transcript.push({
        role: 'bot',
        text: `${reply ? reply + ' ' : ''}Не удалось понять ${missing.length ? 'часть ответа' : 'ответ'}. Попробуйте сформулировать иначе или нажмите «Заполню позже».`,
        at: new Date().toISOString()
      });
    } else {
      if (reply) s.transcript.push({ role: 'bot', text: reply, at: new Date().toISOString() });
      if (t && !s.done.includes(t.id)) s.done.push(t.id);
      advance(db, userId, s, ctx);
    }
    if (rejected.length) s.transcript.push({ role: 'bot', text: 'Часть значений выглядит неправдоподобно, я их не сохранил — проверьте в резюме.', at: new Date().toISOString() });
    save(db, userId, s);
    return view(db, userId, s, ctx, ai);
  });
}

/** «Заполню позже» на обязательной теме: отметить её пройденной, поля останутся пустыми и будут видны в резюме. */
export function skipTopic(db: DB, userId: number, ctx: { tz?: string }, ai: AiService): View {
  return withTx(db, () => {
    const s = load(db, userId);
    if (s.topic && !s.done.includes(s.topic)) s.done.push(s.topic);
    s.transcript.push({ role: 'user', text: 'Заполню позже', at: new Date().toISOString() });
    advance(db, userId, s, ctx);
    save(db, userId, s);
    return view(db, userId, s, ctx, ai);
  });
}

export function restartOnboarding(db: DB, userId: number) {
  db.prepare('DELETE FROM onboarding WHERE user_id=?').run(userId);
}
