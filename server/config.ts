import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Служебный порт: доступен только внутри контейнера (127.0.0.1). */
  ADMIN_PORT: z.coerce.number().int().positive().default(3001),
  /** Каталог постоянного хранилища (Railway Volume). */
  DATA_DIR: z.string().default('./data'),
  /** Публичный HTTPS-адрес сервиса, например https://forma.up.railway.app */
  PUBLIC_URL: z.string().url().optional(),

  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  /** Telegram ID владельца. Только он получает доступ в личном пилоте. */
  OWNER_TELEGRAM_ID: z.coerce.number().int().positive().optional(),
  /** Максимальный возраст initData в секундах. */
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().positive().default(86400),
  BOT_ENABLED: bool,

  OPENAI_API_KEY: z.string().min(10).optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_MODEL_CHAT: z.string().default('gpt-6-luna'),
  AI_MODEL_PLAN: z.string().default('gpt-6.1-terra'),
  AI_MODEL_VISION: z.string().default('gpt-6-luna'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  AI_DAILY_TEXT_LIMIT: z.coerce.number().int().nonnegative().default(30),
  AI_DAILY_IMAGE_LIMIT: z.coerce.number().int().nonnegative().default(5),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  /** Модели для сравнения на этапе 0 и предел расходов на всю проверку. */
  AI_EVAL_MODELS: z.string().default('gpt-6-luna,gpt-6.1-terra,gpt-6.1-sol'),
  AI_EVAL_BUDGET_USD: z.coerce.number().nonnegative().default(0.5),

  /** Разрешить демонстрационные карточки (ещё не проверенные специалистом) в плане пилота. */
  PLAN_ALLOW_DEMO: z.string().optional().transform((v) => v === undefined || v === '1' || v === 'true'),

  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Время ежедневной резервной копии, ЧЧ:ММ по UTC. */
  BACKUP_TIME_UTC: z.string().regex(/^\d{2}:\d{2}$/).default('01:10')
});

export type Config = z.infer<typeof schema> & { botEnabled: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Показываем только имена полей, никогда не значения: там могут быть секреты.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Неверная конфигурация: ${fields}`);
  }
  const c = parsed.data;
  const botEnabled = Boolean(c.TELEGRAM_BOT_TOKEN && c.OWNER_TELEGRAM_ID) && (env.BOT_ENABLED === undefined || c.BOT_ENABLED);
  return { ...c, botEnabled };
}

/** Что из конфигурации можно показывать: только наличие секретов, не значения. */
export function describeConfig(c: Config) {
  return {
    nodeEnv: c.NODE_ENV,
    publicUrl: c.PUBLIC_URL ?? null,
    dataDir: c.DATA_DIR,
    botEnabled: c.botEnabled,
    hasBotToken: Boolean(c.TELEGRAM_BOT_TOKEN),
    hasOwnerId: Boolean(c.OWNER_TELEGRAM_ID),
    hasOpenAiKey: Boolean(c.OPENAI_API_KEY),
    models: { chat: c.AI_MODEL_CHAT, plan: c.AI_MODEL_PLAN, vision: c.AI_MODEL_VISION },
    aiMonthlyBudgetUsd: c.AI_MONTHLY_BUDGET_USD
  };
}
