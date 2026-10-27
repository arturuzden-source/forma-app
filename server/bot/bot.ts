import { Bot, InlineKeyboard } from 'grammy';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import { schemaVersion } from '../db/index.js';
import { estimateEval, formatReport, runEval, fmtUsd } from '../ai/eval.js';
import { spentThisMonth } from '../ai/openai.js';
import { listBackups } from '../backup/backup.js';
import type { Logger } from '../jobs/scheduler.js';

export type BotHandle = { bot: Bot; start: () => void; stop: () => Promise<void>; notifyOwner: (text: string) => Promise<void> };

/**
 * Бот получает обновления через long polling. Сервис с Volume не запускает два
 * развёртывания одновременно, поэтому получатель обновлений всегда один.
 */
export function createBot(cfg: Config, db: DB, log: Logger, version: string): BotHandle {
  const bot = new Bot(cfg.TELEGRAM_BOT_TOKEN!);
  const owner = cfg.OWNER_TELEGRAM_ID!;
  let evalRunning = false;

  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== owner) {
      if (ctx.chat?.type === 'private') await ctx.reply('Это закрытый пилот. Доступ есть только у владельца.');
      return;
    }
    await next();
  });

  const openButton = () => (cfg.PUBLIC_URL ? new InlineKeyboard().webApp('Открыть «Форму»', cfg.PUBLIC_URL) : undefined);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      cfg.PUBLIC_URL ? 'Привет! Нажмите кнопку, чтобы открыть приложение.' : 'Сервер работает, но адрес приложения ещё не задан (PUBLIC_URL).',
      { reply_markup: openButton() }
    );
  });

  bot.command('status', async (ctx) => {
    const backups = listBackups(cfg.DATA_DIR);
    const jobs = db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all() as { status: string; n: number }[];
    await ctx.reply(
      [
        `Версия: ${version}`,
        `Схема базы: ${schemaVersion(db)}`,
        `Последняя копия: ${backups.at(-1) ?? 'нет'} (всего ${backups.length})`,
        `Задачи: ${jobs.map((j) => `${j.status} ${j.n}`).join(', ') || 'нет'}`,
        `ИИ в этом месяце: ${fmtUsd(spentThisMonth(db))} из ${cfg.AI_MONTHLY_BUDGET_USD} $`,
        `Ключ OpenAI: ${cfg.OPENAI_API_KEY ? 'задан' : 'не задан'}`
      ].join('\n')
    );
  });

  bot.command('aieval', async (ctx) => {
    if (!cfg.OPENAI_API_KEY) return void (await ctx.reply('Ключ OpenAI не задан в переменных Railway (OPENAI_API_KEY).'));
    const models = cfg.AI_EVAL_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
    const est = estimateEval(models);
    await ctx.reply(
      [
        'Проверка моделей OpenAI',
        `Модели: ${models.join(', ')}`,
        `Запросов: ${est.calls} (4 задания × 2 повтора на модель) + 3 бесплатные проверки ошибок`,
        ...est.rows.map((r) => `  ${r.model}: не больше ${fmtUsd(r.maxUsd)}`),
        `Верхняя оценка: ${fmtUsd(est.totalMaxUsd)}. Жёсткий предел: ${fmtUsd(cfg.AI_EVAL_BUDGET_USD)}.`,
        'Деньги списываются с баланса OpenAI. Запустить?'
      ].join('\n'),
      { reply_markup: new InlineKeyboard().text('Запустить проверку', 'aieval:run').text('Отмена', 'aieval:cancel') }
    );
  });

  bot.callbackQuery('aieval:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    await ctx.reply('Проверка отменена.');
  });

  bot.callbackQuery('aieval:run', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    if (evalRunning) return void (await ctx.reply('Проверка уже идёт.'));
    evalRunning = true;
    await ctx.reply('Запускаю, это займёт 1–3 минуты.');
    const models = cfg.AI_EVAL_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
    runEval(db, { apiKey: cfg.OPENAI_API_KEY!, baseUrl: cfg.OPENAI_BASE_URL, timeoutMs: cfg.AI_TIMEOUT_MS }, models, cfg.AI_EVAL_BUDGET_USD, cfg.AI_MONTHLY_BUDGET_USD)
      .then((r) => ctx.reply(formatReport(r, cfg.AI_MODEL_CHAT, cfg.AI_MODEL_PLAN)))
      .catch((e) => ctx.reply(`Проверка не выполнена: ${(e as Error).message}`))
      .finally(() => {
        evalRunning = false;
      });
  });

  bot.catch((err) => log.error({ err: err.error instanceof Error ? err.error.message : 'unknown' }, 'ошибка бота'));

  let started = false;
  return {
    bot,
    start() {
      started = true;
      void bot.api
        .setMyCommands([
          { command: 'start', description: 'Открыть приложение' },
          { command: 'status', description: 'Состояние сервера' },
          { command: 'aieval', description: 'Проверка моделей ИИ (этап 0)' }
        ])
        .catch(() => undefined);
      if (cfg.PUBLIC_URL) {
        void bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Форма', web_app: { url: cfg.PUBLIC_URL } } }).catch(() => undefined);
      }
      bot.start({ onStart: (me) => log.info({ bot: me.username }, 'бот запущен (long polling)') }).catch((e) => log.error({ err: (e as Error).message }, 'бот остановился'));
    },
    async stop() {
      if (started) await bot.stop();
    },
    async notifyOwner(text: string) {
      await bot.api.sendMessage(owner, text, { reply_markup: openButton() });
    }
  };
}
