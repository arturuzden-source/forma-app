import type { DB } from '../db/index.js';
import { withTx } from '../db/index.js';
import { CATALOG_VERSION, SEED, type Card } from './seed.js';

export type Exercise = {
  id: string;
  name: string;
  category: string;
  pattern: string;
  places: string[];
  equipment: string[];
  level: number;
  measure: 'reps' | 'time' | 'distance';
  tags: string[];
  card: Card;
  source: string;
  license: string;
  status: 'draft' | 'review' | 'published' | 'withdrawn';
  isDemo: boolean;
  version: number;
  reviewedBy: string | null;
};

/**
 * Загрузить стартовый каталог. Карточки, уже проверенные специалистом
 * (is_demo = 0), не перезаписываются демонстрационными текстами.
 */
export function seedCatalog(db: DB) {
  const cur = db.prepare("SELECT value FROM meta WHERE key='catalog_version'").get() as { value: string } | undefined;
  if (cur && Number(cur.value) >= CATALOG_VERSION) return 0;
  return withTx(db, () => {
    const now = new Date().toISOString();
    const up = db.prepare(
      `INSERT INTO exercises (id, name, category, pattern, places, equipment, level, measure, tags, card, source, license, status, is_demo, version, updated_at)
       VALUES (@id, @name, @category, @pattern, @places, @equipment, @level, @measure, @tags, @card, @source, @license, 'review', 1, @version, @now)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, pattern=excluded.pattern, places=excluded.places,
         equipment=excluded.equipment, level=excluded.level, measure=excluded.measure, tags=excluded.tags, card=excluded.card,
         version=excluded.version, updated_at=excluded.updated_at
       WHERE exercises.is_demo = 1`
    );
    for (const e of SEED) {
      up.run({
        id: e.id,
        name: e.name,
        category: e.category,
        pattern: e.pattern,
        places: JSON.stringify(e.places),
        equipment: JSON.stringify(e.equipment),
        level: e.level,
        measure: e.measure,
        tags: JSON.stringify(e.tags ?? []),
        card: JSON.stringify(e.card),
        source: 'Демонстрационный текст и схематичная графика проекта «Форма»',
        license: 'собственность проекта',
        version: CATALOG_VERSION,
        now
      });
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('catalog_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(CATALOG_VERSION));
    return SEED.length;
  });
}

type Row = {
  id: string; name: string; category: string; pattern: string; places: string; equipment: string; level: number; measure: Exercise['measure'];
  tags: string; card: string; source: string; license: string; status: Exercise['status']; is_demo: number; version: number; reviewed_by: string | null;
};

function toExercise(r: Row): Exercise {
  return {
    id: r.id, name: r.name, category: r.category, pattern: r.pattern, places: JSON.parse(r.places), equipment: JSON.parse(r.equipment),
    level: r.level, measure: r.measure, tags: JSON.parse(r.tags), card: JSON.parse(r.card), source: r.source, license: r.license,
    status: r.status, isDemo: r.is_demo === 1, version: r.version, reviewedBy: r.reviewed_by
  };
}

/** Каталог для показа: снятые с публикации карточки не выдаются. */
export function listExercises(db: DB): Exercise[] {
  return (db.prepare("SELECT * FROM exercises WHERE status != 'withdrawn' ORDER BY category, level, name").all() as Row[]).map(toExercise);
}

export function getExercise(db: DB, id: string): Exercise | null {
  const r = db.prepare('SELECT * FROM exercises WHERE id=?').get(id) as Row | undefined;
  return r ? toExercise(r) : null;
}

/**
 * Упражнения, допустимые в плане. В рабочем режиме — только опубликованные.
 * allowDemo включает карточки «ожидает проверки» для технической проверки пилота.
 */
export function plannableExercises(db: DB, allowDemo: boolean): Exercise[] {
  const sql = allowDemo ? "SELECT * FROM exercises WHERE status IN ('published','review')" : "SELECT * FROM exercises WHERE status = 'published'";
  return (db.prepare(sql).all() as Row[]).map(toExercise);
}
