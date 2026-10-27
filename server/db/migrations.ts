/**
 * Миграции применяются по порядку и только вперёд. Уже применённую миграцию
 * не меняем: новое изменение схемы — новая запись в конце списка.
 * Порядок отката описан в docs/operations.md.
 */
export const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'base',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER NOT NULL UNIQUE,
        first_name TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      -- Защита от повторного применения: каждый изменяющий запрос несёт
      -- уникальный op_id от клиента; повтор возвращает сохранённый результат.
      CREATE TABLE operations (
        op_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Тестовые записи этапа 0: проверка сохранности данных после обновлений.
      CREATE TABLE pilot_notes (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Фоновые задачи и уведомления. dedupe_key исключает дубли при перезапуске.
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        run_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','skipped')),
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX jobs_due ON jobs (status, run_at);

      -- Учёт расхода ИИ: резерв до вызова, уточнение после ответа.
      CREATE TABLE ai_usage (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('text','image')),
        status TEXT NOT NULL CHECK (status IN ('reserved','ok','error')),
        reserved_usd REAL NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        error TEXT
      );
      CREATE INDEX ai_usage_created ON ai_usage (created_at);

      CREATE TABLE backups (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        file TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        note TEXT
      );

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }
];
