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
  },
  {
    version: 2,
    name: 'profile_onboarding_catalog',
    sql: `
      -- Профиль: структурированные данные (проверяются схемой на сервере),
      -- версия для защиты от одновременных правок и отметка подтверждения.
      CREATE TABLE profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        data TEXT NOT NULL DEFAULT '{}',
        unknown TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
        version INTEGER NOT NULL DEFAULT 1,
        confirmed_at TEXT,
        updated_at TEXT NOT NULL
      );

      -- История изменений профиля: откуда пришло значение и что было раньше.
      CREATE TABLE profile_changes (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('chat','edit','system')),
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT
      );
      CREATE INDEX profile_changes_user ON profile_changes (user_id, at);

      -- Состояние беседы-знакомства: можно закрыть и продолжить.
      CREATE TABLE onboarding (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        topic TEXT,
        done_topics TEXT NOT NULL DEFAULT '[]',
        transcript TEXT NOT NULL DEFAULT '[]',
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      -- Цели создаются при подтверждении профиля; история значений — в goal_results.
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        metric TEXT,
        unit TEXT,
        baseline REAL,
        target REAL,
        deadline TEXT,
        priority INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','paused','dropped')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX goals_user ON goals (user_id, status);

      -- Каталог упражнений. В рабочий план попадают только опубликованные карточки;
      -- демонстрационные помечены is_demo и показываются с предупреждением.
      CREATE TABLE exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        pattern TEXT NOT NULL,
        places TEXT NOT NULL,
        equipment TEXT NOT NULL,
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
        measure TEXT NOT NULL CHECK (measure IN ('reps','time','distance')),
        tags TEXT NOT NULL DEFAULT '[]',
        card TEXT NOT NULL,
        source TEXT NOT NULL,
        license TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','review','published','withdrawn')),
        is_demo INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX exercises_status ON exercises (status);
    `
  },
  {
    version: 3,
    name: 'plans_sessions_results',
    sql: `
      -- Версии недельного плана. Действующая версия на неделю — одна (status='active').
      CREATE TABLE plans (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        week_start TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','superseded')),
        source TEXT NOT NULL CHECK (source IN ('ai','rules')),
        model TEXT,
        explanation TEXT NOT NULL,
        basis TEXT NOT NULL DEFAULT '{}',
        timezone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, week_start, version)
      );
      CREATE UNIQUE INDEX plans_one_active ON plans (user_id, week_start) WHERE status = 'active';

      -- Занятия. content — текущее содержание; started_content — версия, по которой занятие начато.
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        local_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        start_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        title TEXT NOT NULL,
        purpose TEXT NOT NULL,
        duration_min INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_version INTEGER NOT NULL DEFAULT 1,
        started_content TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','started','done','partial','skipped','moved','cancelled')),
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user_date ON sessions (user_id, local_date);
      CREATE INDEX sessions_plan ON sessions (plan_id);

      CREATE TABLE checkins (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        answers TEXT NOT NULL,
        options TEXT NOT NULL,
        chosen TEXT,
        created_at TEXT NOT NULL
      );

      -- Фактические результаты. План хранится отдельно в sessions.content; здесь только факт.
      CREATE TABLE set_results (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_index INTEGER NOT NULL,
        exercise_id TEXT NOT NULL,
        set_index INTEGER NOT NULL,
        reps INTEGER,
        seconds INTEGER,
        meters INTEGER,
        weight_kg REAL,
        rpe INTEGER,
        pain INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        performed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        corrected INTEGER NOT NULL DEFAULT 0,
        UNIQUE (session_id, item_index, set_index)
      );
      CREATE INDEX set_results_user ON set_results (user_id, exercise_id, performed_at);
    `
  }
];
