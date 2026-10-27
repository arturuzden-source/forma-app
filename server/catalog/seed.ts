/**
 * Стартовый каталог упражнений. ВСЕ карточки — демонстрационные: тексты подготовлены
 * для технической проверки и не проверены специалистом. Статус 'review' = «ожидает проверки».
 * Публикация (status 'published', is_demo 0) — только после проверки специалистом,
 * с указанием проверяющего (reviewed_by) и даты.
 *
 * Изображения: позы рисуются интерфейсом из схемы (web/src/poses.ts) — собственная
 * схематическая графика проекта, лицензия: собственность проекта.
 */

export type Card = {
  short: string;
  steps: string[];
  breathing: string | null;
  mistakes: string[];
  stop: string[];
  easier: string[];
  alternatives: string[];
  media: { pose: string; caption: string }[];
  scheme?: { label: string; minutes?: number; meters?: number; intensity: 'easy' | 'moderate' | 'hard' | 'rest' }[];
};

export type SeedExercise = {
  id: string;
  name: string;
  category: 'warmup' | 'mobility' | 'strength' | 'core' | 'cardio';
  pattern: 'squat' | 'hinge' | 'lunge' | 'push_h' | 'push_v' | 'pull_h' | 'pull_v' | 'core' | 'carry' | 'run' | 'mobility' | 'full';
  places: ('home' | 'outdoor' | 'gym')[];
  equipment: string[];
  level: 1 | 2 | 3;
  measure: 'reps' | 'time' | 'distance';
  tags?: string[];
  card: Card;
};

export const CATALOG_VERSION = 1;

const STOP_COMMON = ['Острая или нарастающая боль', 'Головокружение, тошнота, боль в груди'];

export const SEED: SeedExercise[] = [
  // ——— Разминка и подвижность ———
  {
    id: 'warmup-joint',
    name: 'Суставная разминка',
    category: 'warmup',
    pattern: 'mobility',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'time',
    card: {
      short: 'Плавные круги без рывков, сверху вниз',
      steps: ['Круги головой — медленно, по 5 в каждую сторону.', 'Круги плечами и руками вперёд и назад.', 'Наклоны и повороты корпуса.', 'Круги тазом, коленями и стопами.'],
      breathing: 'Дыхание свободное, не задерживайте.',
      mistakes: ['Резкие рывки', 'Слишком большая амплитуда в первые повторы'],
      stop: STOP_COMMON,
      easier: [],
      alternatives: ['cat-cow'],
      media: [
        { pose: 'stand', caption: 'Исходное' },
        { pose: 'arm-circles', caption: 'Круги руками' }
      ]
    }
  },
  {
    id: 'cat-cow',
    name: 'Кошка-корова',
    category: 'mobility',
    pattern: 'mobility',
    places: ['home', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Плавно прогибайте и округляйте спину',
      steps: ['Встаньте на четвереньки: ладони под плечами, колени под тазом.', 'На вдохе прогните спину вниз, взгляд вперёд.', 'На выдохе округлите спину вверх, подбородок к груди.'],
      breathing: 'Вдох — прогиб, выдох — округление.',
      mistakes: ['Сгибание рук в локтях', 'Резкое движение в пояснице'],
      stop: ['Боль в пояснице или шее', ...STOP_COMMON],
      easier: [],
      alternatives: ['warmup-joint'],
      media: [
        { pose: 'quad-cow', caption: 'Прогиб' },
        { pose: 'quad-cat', caption: 'Округление' }
      ]
    }
  },
  {
    id: 'stretch-hamstring',
    name: 'Растяжка задней поверхности бедра',
    category: 'mobility',
    pattern: 'mobility',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'time',
    card: {
      short: 'Наклон с прямой спиной, без пружинящих движений',
      steps: ['Встаньте прямо, колени слегка согнуты.', 'Отведите таз назад и наклонитесь вперёд с прямой спиной.', 'Остановитесь при лёгком натяжении и удерживайте 20–30 секунд.'],
      breathing: 'Спокойное дыхание, на выдохе можно чуть углубиться.',
      mistakes: ['Округление спины', 'Пружинящие движения'],
      stop: ['Простреливающая боль в ноге или пояснице', ...STOP_COMMON],
      easier: [],
      alternatives: [],
      media: [
        { pose: 'stand', caption: 'Исходное' },
        { pose: 'fold', caption: 'Наклон' }
      ]
    }
  },

  // ——— Дом, собственный вес ———
  {
    id: 'squat-bw',
    name: 'Приседание с собственным весом',
    category: 'strength',
    pattern: 'squat',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Колени по направлению носков, пятки на полу',
      steps: ['Ноги на ширине плеч, носки слегка врозь.', 'Отведите таз назад и опуститесь до параллели бёдер с полом или до комфортной глубины.', 'Поднимитесь, отталкиваясь всей стопой.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Колени заваливаются внутрь', 'Пятки отрываются от пола', 'Сильное округление спины внизу'],
      stop: ['Острая боль в колене или пояснице', ...STOP_COMMON],
      easier: ['squat-chair'],
      alternatives: ['lunge-back', 'db-goblet-squat'],
      media: [
        { pose: 'stand', caption: 'Исходное' },
        { pose: 'squat', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'squat-chair',
    name: 'Присед к стулу',
    category: 'strength',
    pattern: 'squat',
    places: ['home'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Коснитесь стула и встаньте без рывка',
      steps: ['Встаньте спиной к устойчивому стулу.', 'Отведите таз назад и опуститесь до лёгкого касания сиденья.', 'Не садясь полностью, поднимитесь.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Падение на стул', 'Рывок корпусом вперёд при подъёме'],
      stop: ['Боль в колене', ...STOP_COMMON],
      easier: [],
      alternatives: ['squat-bw'],
      media: [
        { pose: 'stand-chair', caption: 'Исходное' },
        { pose: 'squat-chair', caption: 'Касание стула' }
      ]
    }
  },
  {
    id: 'lunge-back',
    name: 'Выпады назад',
    category: 'strength',
    pattern: 'lunge',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Шаг назад, колено передней ноги над стопой',
      steps: ['Встаньте прямо, ноги на ширине таза.', 'Сделайте шаг назад и опуститесь, пока заднее колено почти не коснётся пола.', 'Оттолкнитесь передней ногой и вернитесь. Повторите на другую ногу.'],
      breathing: 'Вдох вниз, выдох при подъёме.',
      mistakes: ['Колено передней ноги уходит внутрь', 'Слишком короткий шаг', 'Наклон корпуса вперёд'],
      stop: ['Боль в колене', ...STOP_COMMON],
      easier: ['squat-chair'],
      alternatives: ['squat-bw'],
      media: [
        { pose: 'stand', caption: 'Исходное' },
        { pose: 'lunge', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'pushup',
    name: 'Отжимания',
    category: 'strength',
    pattern: 'push_h',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Тело — прямая линия от головы до пяток',
      steps: ['Упор лёжа: ладони чуть шире плеч, тело прямое.', 'Согните руки, опуская грудь к полу; локти под углом около 45° к корпусу.', 'Выжмите себя вверх, сохраняя прямую линию тела.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Провисание таза', 'Локти разведены в стороны под 90°', 'Неполная амплитуда'],
      stop: ['Боль в плече или запястье', ...STOP_COMMON],
      easier: ['pushup-incline', 'pushup-knee'],
      alternatives: ['db-press'],
      media: [
        { pose: 'plank-high', caption: 'Верхняя точка' },
        { pose: 'pushup-bottom', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'pushup-incline',
    name: 'Отжимания от опоры',
    category: 'strength',
    pattern: 'push_h',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Чем выше опора, тем легче',
      steps: ['Упритесь ладонями в устойчивую опору: стол, скамью, подоконник.', 'Отойдите ногами назад, тело прямое.', 'Опустите грудь к опоре и выжмите себя обратно.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Неустойчивая опора', 'Провисание таза'],
      stop: ['Боль в плече или запястье', ...STOP_COMMON],
      easier: [],
      alternatives: ['pushup-knee'],
      media: [
        { pose: 'incline-top', caption: 'Верхняя точка' },
        { pose: 'incline-bottom', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'pushup-knee',
    name: 'Отжимания с колен',
    category: 'strength',
    pattern: 'push_h',
    places: ['home', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Прямая линия от головы до колен',
      steps: ['Упор на ладони и колени, таз не поднят.', 'Опустите грудь к полу.', 'Выжмите себя вверх.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Таз поднят вверх', 'Голова опущена'],
      stop: ['Боль в плече или запястье', ...STOP_COMMON],
      easier: ['pushup-incline'],
      alternatives: [],
      media: [
        { pose: 'knee-top', caption: 'Верхняя точка' },
        { pose: 'knee-bottom', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'plank',
    name: 'Планка на предплечьях',
    category: 'core',
    pattern: 'core',
    places: ['home', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'time',
    card: {
      short: 'Живот подтянут, таз не провисает',
      steps: ['Локти под плечами, предплечья на полу.', 'Выпрямите ноги, тело в одну линию.', 'Удерживайте положение, напрягая живот и ягодицы.'],
      breathing: 'Дышите ровно, не задерживайте дыхание.',
      mistakes: ['Провисание поясницы', 'Таз задран вверх'],
      stop: ['Боль в пояснице', ...STOP_COMMON],
      easier: [],
      alternatives: ['dead-bug'],
      media: [{ pose: 'plank-forearm', caption: 'Удержание' }]
    }
  },
  {
    id: 'glute-bridge',
    name: 'Ягодичный мост',
    category: 'strength',
    pattern: 'hinge',
    places: ['home', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Поднимайте таз ягодицами, не поясницей',
      steps: ['Лягте на спину, стопы на полу на ширине таза.', 'Поднимите таз до прямой линии от плеч до колен.', 'Задержитесь на секунду и опуститесь.'],
      breathing: 'Выдох при подъёме.',
      mistakes: ['Переразгибание в пояснице', 'Стопы слишком далеко'],
      stop: ['Боль в пояснице', ...STOP_COMMON],
      easier: [],
      alternatives: ['db-rdl'],
      media: [
        { pose: 'bridge-down', caption: 'Исходное' },
        { pose: 'bridge-up', caption: 'Верхняя точка' }
      ]
    }
  },
  {
    id: 'dead-bug',
    name: 'Мёртвый жук',
    category: 'core',
    pattern: 'core',
    places: ['home', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Поясница прижата к полу всё время',
      steps: ['Лёжа на спине, руки вверх, колени над тазом под 90°.', 'Медленно опустите противоположные руку и ногу.', 'Вернитесь и повторите в другую сторону.'],
      breathing: 'Выдох при опускании.',
      mistakes: ['Поясница отрывается от пола', 'Быстрые движения'],
      stop: ['Боль в пояснице', ...STOP_COMMON],
      easier: [],
      alternatives: ['plank'],
      media: [
        { pose: 'deadbug-a', caption: 'Исходное' },
        { pose: 'deadbug-b', caption: 'Рука и нога опущены' }
      ]
    }
  },
  {
    id: 'jump-squat',
    name: 'Приседание с выпрыгиванием',
    category: 'strength',
    pattern: 'squat',
    places: ['home', 'outdoor', 'gym'],
    equipment: ['none'],
    level: 2,
    measure: 'reps',
    tags: ['jumps', 'impact'],
    card: {
      short: 'Мягкое приземление на всю стопу',
      steps: ['Присядьте до комфортной глубины.', 'Мощно выпрыгните вверх.', 'Приземлитесь мягко, сразу уходя в присед.'],
      breathing: 'Выдох при прыжке.',
      mistakes: ['Жёсткое приземление на прямые ноги', 'Колени внутрь при приземлении'],
      stop: ['Боль в колене или стопе', ...STOP_COMMON],
      easier: ['squat-bw'],
      alternatives: ['lunge-back'],
      media: [
        { pose: 'squat', caption: 'Присед' },
        { pose: 'jump', caption: 'Прыжок' }
      ]
    }
  },

  // ——— Турник и уличная площадка ———
  {
    id: 'pullup',
    name: 'Подтягивания',
    category: 'strength',
    pattern: 'pull_v',
    places: ['outdoor', 'home', 'gym'],
    equipment: ['pullup_bar'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Из виса на прямых руках до подбородка над перекладиной',
      steps: ['Хват сверху чуть шире плеч, вис на прямых руках.', 'Сведите лопатки и подтянитесь, пока подбородок не окажется над перекладиной.', 'Опуститесь подконтрольно до прямых рук.'],
      breathing: 'Выдох при подъёме, вдох при опускании.',
      mistakes: ['Раскачка и рывки ногами', 'Неполная амплитуда внизу', 'Плечи поднимаются к ушам'],
      stop: ['Боль в плече или локте', ...STOP_COMMON],
      easier: ['pullup-negative', 'australian-row'],
      alternatives: ['lat-pulldown'],
      media: [
        { pose: 'hang', caption: 'Вис' },
        { pose: 'pullup-top', caption: 'Верхняя точка' }
      ]
    }
  },
  {
    id: 'pullup-negative',
    name: 'Негативные подтягивания',
    category: 'strength',
    pattern: 'pull_v',
    places: ['outdoor', 'home', 'gym'],
    equipment: ['pullup_bar'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Медленное опускание за 3–5 секунд',
      steps: ['Займите верхнюю точку подтягивания с опоры или прыжком.', 'Медленно опускайтесь 3–5 секунд до прямых рук.', 'Встаньте на опору и повторите.'],
      breathing: 'Ровное дыхание во время опускания.',
      mistakes: ['Слишком быстрое опускание', 'Резкий сброс в нижней точке'],
      stop: ['Боль в плече или локте', ...STOP_COMMON],
      easier: ['australian-row'],
      alternatives: ['pullup'],
      media: [
        { pose: 'pullup-top', caption: 'Старт сверху' },
        { pose: 'hang', caption: 'Медленно вниз' }
      ]
    }
  },
  {
    id: 'bar-hang',
    name: 'Вис на турнике',
    category: 'strength',
    pattern: 'pull_v',
    places: ['outdoor', 'home', 'gym'],
    equipment: ['pullup_bar'],
    level: 1,
    measure: 'time',
    card: {
      short: 'Активные плечи: не «висите на связках»',
      steps: ['Возьмитесь за перекладину хватом сверху.', 'Повисните, слегка опустив плечи от ушей.', 'Удерживайте положение заданное время.'],
      breathing: 'Ровное дыхание.',
      mistakes: ['Плечи у ушей', 'Раскачка'],
      stop: ['Боль в плече', ...STOP_COMMON],
      easier: [],
      alternatives: [],
      media: [{ pose: 'hang', caption: 'Вис' }]
    }
  },
  {
    id: 'australian-row',
    name: 'Австралийские подтягивания',
    category: 'strength',
    pattern: 'pull_h',
    places: ['outdoor', 'gym'],
    equipment: ['pullup_bar'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Низкая перекладина, тело прямое',
      steps: ['Перекладина на уровне пояса. Возьмитесь хватом сверху и отклонитесь назад под неё.', 'Тело прямое, пятки на земле.', 'Подтяните грудь к перекладине, сводя лопатки, и опуститесь.'],
      breathing: 'Выдох при подтягивании.',
      mistakes: ['Провисание таза', 'Тяга одними руками без лопаток'],
      stop: ['Боль в плече или локте', ...STOP_COMMON],
      easier: [],
      alternatives: ['db-row'],
      media: [
        { pose: 'row-low-bottom', caption: 'Исходное' },
        { pose: 'row-low-top', caption: 'Грудь у перекладины' }
      ]
    }
  },
  {
    id: 'dips',
    name: 'Отжимания на брусьях',
    category: 'strength',
    pattern: 'push_v',
    places: ['outdoor', 'gym'],
    equipment: ['parallel_bars'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Опускайтесь до комфортной глубины, без боли в плечах',
      steps: ['Упор на брусьях на прямых руках.', 'Согните руки, слегка наклоняя корпус вперёд.', 'Выжмите себя вверх до прямых рук.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Слишком глубокое опускание', 'Плечи уходят вперёд и вверх'],
      stop: ['Боль в плече или груди', ...STOP_COMMON],
      easier: ['pushup'],
      alternatives: ['pushup'],
      media: [
        { pose: 'dip-top', caption: 'Верхняя точка' },
        { pose: 'dip-bottom', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'hanging-knee-raise',
    name: 'Подъём коленей в висе',
    category: 'core',
    pattern: 'core',
    places: ['outdoor', 'home', 'gym'],
    equipment: ['pullup_bar'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Без раскачки, колени к груди',
      steps: ['Вис на прямых руках.', 'Подтяните колени к груди, слегка округляя таз.', 'Медленно опустите ноги без раскачки.'],
      breathing: 'Выдох при подъёме.',
      mistakes: ['Раскачка корпусом', 'Бросание ног вниз'],
      stop: ['Боль в пояснице или плече', ...STOP_COMMON],
      easier: ['dead-bug'],
      alternatives: ['plank'],
      media: [
        { pose: 'hang', caption: 'Вис' },
        { pose: 'hang-knees', caption: 'Колени вверх' }
      ]
    }
  },

  // ——— Гантели ———
  {
    id: 'db-row',
    name: 'Тяга гантели в наклоне',
    category: 'strength',
    pattern: 'pull_h',
    places: ['home', 'gym'],
    equipment: ['dumbbells'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Тяните локтем назад, спина ровная',
      steps: ['Упритесь рукой и коленом в скамью или стул, спина параллельна полу.', 'Гантель в свободной руке, рука прямая.', 'Подтяните гантель к поясу, ведя локоть назад, и опустите.'],
      breathing: 'Выдох при подъёме.',
      mistakes: ['Скручивание корпуса', 'Рывок гантели', 'Округлённая спина'],
      stop: ['Боль в пояснице или плече', ...STOP_COMMON],
      easier: [],
      alternatives: ['australian-row'],
      media: [
        { pose: 'row-hinge', caption: 'Исходное' },
        { pose: 'row-hinge-pull', caption: 'Гантель у пояса' }
      ]
    }
  },
  {
    id: 'db-goblet-squat',
    name: 'Гоблет-присед',
    category: 'strength',
    pattern: 'squat',
    places: ['home', 'gym'],
    equipment: ['dumbbells'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Гантель у груди, корпус вертикально',
      steps: ['Держите гантель вертикально у груди.', 'Присядьте, отводя таз назад и вниз, локти между коленями.', 'Поднимитесь, отталкиваясь всей стопой.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Колени внутрь', 'Наклон корпуса вперёд', 'Пятки отрываются'],
      stop: ['Боль в колене или пояснице', ...STOP_COMMON],
      easier: ['squat-bw'],
      alternatives: ['leg-press'],
      media: [
        { pose: 'stand-goblet', caption: 'Исходное' },
        { pose: 'squat-goblet', caption: 'Нижняя точка' }
      ]
    }
  },
  {
    id: 'db-press',
    name: 'Жим гантелей стоя',
    category: 'strength',
    pattern: 'push_v',
    places: ['home', 'gym'],
    equipment: ['dumbbells'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Живот и ягодицы напряжены, без прогиба',
      steps: ['Встаньте прямо, гантели у плеч.', 'Выжмите гантели вверх до почти прямых рук.', 'Опустите к плечам подконтрольно.'],
      breathing: 'Выдох при жиме.',
      mistakes: ['Прогиб в пояснице', 'Рывок ногами', 'Локти уходят далеко назад'],
      stop: ['Боль в плече', ...STOP_COMMON],
      easier: [],
      alternatives: ['pushup'],
      media: [
        { pose: 'press-bottom', caption: 'Исходное' },
        { pose: 'press-top', caption: 'Верхняя точка' }
      ]
    }
  },
  {
    id: 'db-rdl',
    name: 'Румынская тяга с гантелями',
    category: 'strength',
    pattern: 'hinge',
    places: ['home', 'gym'],
    equipment: ['dumbbells'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Таз назад, спина прямая, гантели скользят вдоль ног',
      steps: ['Встаньте прямо, гантели перед бёдрами, колени слегка согнуты.', 'Отведите таз назад, наклоняясь с прямой спиной, до натяжения сзади бедра.', 'Вернитесь в исходное, выводя таз вперёд.'],
      breathing: 'Вдох вниз, выдох вверх.',
      mistakes: ['Округление спины', 'Присед вместо наклона', 'Гантели уходят далеко от ног'],
      stop: ['Боль в пояснице', ...STOP_COMMON],
      easier: ['glute-bridge'],
      alternatives: ['glute-bridge'],
      media: [
        { pose: 'stand-db', caption: 'Исходное' },
        { pose: 'hinge', caption: 'Наклон' }
      ]
    }
  },

  // ——— Зал ———
  {
    id: 'bench-press',
    name: 'Жим штанги лёжа',
    category: 'strength',
    pattern: 'push_h',
    places: ['gym'],
    equipment: ['barbell', 'bench'],
    level: 2,
    measure: 'reps',
    card: {
      short: 'Лопатки сведены, стопы на полу; с весом — со страхующим',
      steps: ['Лягте на скамью, глаза под грифом, лопатки сведены, стопы на полу.', 'Снимите штангу и опустите её к нижней части груди.', 'Выжмите штангу вверх над плечами.'],
      breathing: 'Вдох вниз, выдох при жиме.',
      mistakes: ['Отрыв таза от скамьи', 'Отбив штанги от груди', 'Локти под 90° к корпусу'],
      stop: ['Боль в плече или груди', ...STOP_COMMON],
      easier: ['pushup'],
      alternatives: ['pushup', 'db-press'],
      media: [
        { pose: 'bench-top', caption: 'Верхняя точка' },
        { pose: 'bench-bottom', caption: 'Штанга у груди' }
      ]
    }
  },
  {
    id: 'lat-pulldown',
    name: 'Тяга верхнего блока',
    category: 'strength',
    pattern: 'pull_v',
    places: ['gym'],
    equipment: ['machines'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Тяните к верху груди, без раскачки корпусом',
      steps: ['Сядьте, зафиксируйте бёдра валиками, хват чуть шире плеч.', 'Сведите лопатки и потяните рукоять к верху груди.', 'Подконтрольно верните руки вверх.'],
      breathing: 'Выдох при тяге.',
      mistakes: ['Тяга за голову', 'Сильный отклон назад', 'Рывки'],
      stop: ['Боль в плече', ...STOP_COMMON],
      easier: [],
      alternatives: ['pullup', 'australian-row'],
      media: [
        { pose: 'pulldown-top', caption: 'Руки вверху' },
        { pose: 'pulldown-bottom', caption: 'Рукоять у груди' }
      ]
    }
  },
  {
    id: 'leg-press',
    name: 'Жим ногами',
    category: 'strength',
    pattern: 'squat',
    places: ['gym'],
    equipment: ['machines'],
    level: 1,
    measure: 'reps',
    card: {
      short: 'Поясница прижата, колени не выпрямлять в замок',
      steps: ['Сядьте в тренажёр, стопы на платформе на ширине плеч.', 'Опустите платформу, сгибая колени до комфортной глубины.', 'Выжмите платформу, не выпрямляя колени до конца.'],
      breathing: 'Вдох вниз, выдох при жиме.',
      mistakes: ['Отрыв таза от сиденья', 'Выпрямление коленей в замок', 'Колени внутрь'],
      stop: ['Боль в колене или пояснице', ...STOP_COMMON],
      easier: [],
      alternatives: ['db-goblet-squat'],
      media: [
        { pose: 'legpress-top', caption: 'Ноги выпрямлены' },
        { pose: 'legpress-bottom', caption: 'Нижняя точка' }
      ]
    }
  },

  // ——— Бег ———
  {
    id: 'run-easy',
    name: 'Лёгкий бег',
    category: 'cardio',
    pattern: 'run',
    places: ['outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'distance',
    card: {
      short: 'Темп, в котором можно говорить полными фразами',
      steps: ['5 минут быстрой ходьбы для разогрева.', 'Бег в разговорном темпе заданное время или дистанцию.', '5 минут ходьбы в конце.'],
      breathing: 'Ритмичное дыхание; если не можете говорить — замедлитесь.',
      mistakes: ['Слишком быстрый старт', 'Длинный шаг с приземлением на пятку далеко впереди'],
      stop: ['Боль в груди, сильная одышка, головокружение', 'Острая боль в суставах'],
      easier: ['run-walk'],
      alternatives: ['run-walk'],
      media: [{ pose: 'run', caption: 'Бег' }],
      scheme: [
        { label: 'Ходьба', minutes: 5, intensity: 'easy' },
        { label: 'Лёгкий бег', minutes: 20, intensity: 'moderate' },
        { label: 'Ходьба', minutes: 5, intensity: 'easy' }
      ]
    }
  },
  {
    id: 'run-intervals',
    name: 'Бег: интервалы 400 м',
    category: 'cardio',
    pattern: 'run',
    places: ['outdoor', 'gym'],
    equipment: ['none'],
    level: 2,
    measure: 'distance',
    card: {
      short: 'Быстро, но так, чтобы выдержать все отрезки одинаково',
      steps: ['Разминка: 10 минут лёгкого бега.', 'Отрезки по 400 м в быстром темпе, между ними 2 минуты ходьбы или трусцы.', 'Заминка: 5–10 минут лёгкого бега или ходьбы.'],
      breathing: 'На отрезках дыхание частое, но под контролем.',
      mistakes: ['Первый отрезок слишком быстрый', 'Слишком короткий отдых'],
      stop: ['Боль в груди, головокружение', 'Острая боль в ноге'],
      easier: ['run-easy'],
      alternatives: ['run-easy'],
      media: [{ pose: 'run', caption: 'Бег' }],
      scheme: [
        { label: 'Разминка', minutes: 10, intensity: 'easy' },
        { label: '400 м быстро', meters: 400, intensity: 'hard' },
        { label: 'Отдых', minutes: 2, intensity: 'rest' },
        { label: '400 м быстро', meters: 400, intensity: 'hard' },
        { label: 'Отдых', minutes: 2, intensity: 'rest' },
        { label: 'Заминка', minutes: 8, intensity: 'easy' }
      ]
    }
  },
  {
    id: 'run-walk',
    name: 'Бег с ходьбой',
    category: 'cardio',
    pattern: 'run',
    places: ['outdoor', 'gym'],
    equipment: ['none'],
    level: 1,
    measure: 'time',
    card: {
      short: 'Чередуйте бег и ходьбу — для возвращения после перерыва',
      steps: ['5 минут ходьбы.', 'Чередуйте 1–2 минуты лёгкого бега и 2 минуты ходьбы.', '5 минут ходьбы в конце.'],
      breathing: 'Свободное дыхание, разговорный темп.',
      mistakes: ['Ускорение на беговых отрезках'],
      stop: ['Боль в груди, головокружение', 'Острая боль в суставах'],
      easier: [],
      alternatives: ['run-easy'],
      media: [{ pose: 'run', caption: 'Бег' }],
      scheme: [
        { label: 'Ходьба', minutes: 5, intensity: 'easy' },
        { label: 'Бег', minutes: 2, intensity: 'moderate' },
        { label: 'Ходьба', minutes: 2, intensity: 'rest' },
        { label: 'Бег', minutes: 2, intensity: 'moderate' },
        { label: 'Ходьба', minutes: 5, intensity: 'easy' }
      ]
    }
  }
];
