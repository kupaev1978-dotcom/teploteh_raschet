// Расчётное ядро «ТеплоРасчёта».
// Нормативная база: СП 50.13330.2024 «СНиП 23-02-2003 Тепловая защита зданий»
// (приказ Минстроя России от 15.05.2024 № 327/пр, действует с 16.06.2024)
// и СП 131.13330.2025 «Строительная климатология» (приказ от 08.08.2025
// № 470/пр, действует с 09.09.2025). Все функции чистые.

// Категории зданий (таблица 3 СП 50.13330.2024).
// period10: ГСОП для категории 1.2 считают по периоду со среднесуточной
// температурой ≤ 10 °С (для остальных — ≤ 8 °С), см. формулу (5.2).
// phi — расчётная относительная влажность для определения точки росы
// по п. 5.7 СП (жилые и детские/медицинские — 55 %, прочие общественные — 50 %).
export const BUILDINGS = {
  residential: { label: "Жилые, гостиницы, общежития — категория 1.1", tIn: 20, phi: 55, period10: false },
  preschool: { label: "Дошкольные, общеобразовательные, медицинские, интернаты — категория 1.2", tIn: 20, phi: 55, period10: true },
  public: { label: "Общественные, административные, бытовые — категория 2", tIn: 20, phi: 50, period10: false },
  industrial: { label: "Производственные с сухим и нормальным режимом — категория 3", tIn: 18, phi: 55, period10: false },
};

// Таблица 3 СП 50.13330.2024: базовые значения Rтр.
// Для линейных рядов — коэффициенты [a, b] формулы Rтр = a·ГСОП + b;
// для категории 2 и 3 (покрытия и чердачные перекрытия) ряд нелинейный —
// задан точками [ГСОП, Rтр] с линейной интерполяцией между ними.
const PIECE_PUBLIC_ROOF = [[1000, 1.5], [2000, 2], [4000, 2.8], [6000, 3.4], [8000, 3.9], [10000, 4.4], [12000, 4.8]];
const PIECE_PUBLIC_ATTIC = [[1000, 1.2], [2000, 1.6], [4000, 2.2], [6000, 2.7], [8000, 3.1], [10000, 3.5], [12000, 3.8]];
export const RTR = {
  wall: {
    residential: [0.00035, 1.4], preschool: [0.00035, 1.4],
    public: [0.0003, 1.2], industrial: [0.0002, 1.0],
  },
  roof: { // покрытия и перекрытия над проездами
    residential: [0.0005, 2.2], preschool: [0.0005, 2.2],
    public: PIECE_PUBLIC_ROOF, industrial: PIECE_PUBLIC_ROOF,
  },
  attic: { // чердачные перекрытия; над неотапливаемыми подпольями и подвалах; полы по грунту
    residential: [0.00045, 1.9], preschool: [0.00045, 1.9],
    public: PIECE_PUBLIC_ATTIC, industrial: PIECE_PUBLIC_ATTIC,
  },
  basement: { // то же, что чердачные перекрытия (та же графа таблицы 3)
    residential: [0.00045, 1.9], preschool: [0.00045, 1.9],
    public: PIECE_PUBLIC_ATTIC, industrial: PIECE_PUBLIC_ATTIC,
  },
};

// Типы конструкций и коэффициенты теплоотдачи наружной поверхности αн
// (таблица 6 СП 50.13330.2024, зимние условия)
export const CONSTRUCTIONS = {
  wall: { label: "Стена наружная", alphaOut: 23 },
  attic: { label: "Чердачное перекрытие", alphaOut: 12 },
  roof: { label: "Покрытие / перекрытие над проездом", alphaOut: 23 },
  basement: {
    label: "Перекрытие над холодным подвалом / техподпольем",
    alphaOut: 17, // по умолчанию: подвал, сообщающийся с наружным воздухом
    alphaOutOptions: [
      [17, "сообщается с наружным воздухом (αн = 17)"],
      [12, "со световыми проёмами в стенах (αн = 12)"],
      [6, "не вентилируется наружным воздухом (αн = 6)"],
    ],
  },
};

// Таблица 5 СП 50.13330.2024 — нормируемый температурный перепад Δtн, °С
// (для расчёта по формуле (5.4): реконструкция, входные двери, внутренние
// ограждения; производственные — по точке росы, но не более нормы)
export const DTN = {
  residential: { wall: 4.0, attic: 3.0, roof: 3.0, basement: 2.0 },
  preschool: { wall: 4.0, attic: 3.0, roof: 3.0, basement: 2.0 },
  public: { wall: 4.5, attic: 4.0, roof: 4.0, basement: 2.5 },
  industrial: { wall: null, attic: null, roof: null, basement: 2.5 },
};

export const ALPHA_IN_DEFAULT = 8.7; // Вт/(м²·°С), таблица 4 СП 50.13330.2024
export const MP_DEFAULT = 1;         // коэффициент mр (формула (5.1)), в расчёте = 1
export const ALPHA_IN_WINDOW = 8.0;  // для остекления (таблица 4)

// Таблица 3, графа «Окна...» — базовые значения Rтр заполнений проёмов, м²·°С/Вт
const WINDOW_RTR = {
  residential: [[1000, 0.49], [2000, 0.49], [4000, 0.63], [6000, 0.73], [8000, 0.75], [10000, 0.77], [12000, 0.8]],
  preschool: [[1000, 0.3], [2000, 0.3], [4000, 0.45], [6000, 0.6], [8000, 0.7], [10000, 0.75], [12000, 0.8]],
  public: [[1000, 0.49], [2000, 0.49], [4000, 0.63], [6000, 0.73], [8000, 0.75], [10000, 0.77], [12000, 0.8]],
  industrial: [[1000, 0.23], [2000, 0.25], [4000, 0.3], [6000, 0.35], [8000, 0.4], [10000, 0.45], [12000, 0.5]],
};

// Таблица 8 — нормируемые R ворот: [ГСОП ≤3500, 3500–7000, >7000]
const GATE_R = { small: [0.64, 0.81, 0.93], mid: [0.69, 0.87, 0.99], big: [0.74, 0.93, 1.05] };

// Таблица 10 — нормируемая поперечная воздухопроницаемость Gн, кг/(м²·ч)
export const GHN_OPTIONS = [
  [0.5, 'Стены/перекрытия жилых и общественных зданий'],
  [1.0, 'Стены/перекрытия производственных зданий'],
  [1.5, 'Входные двери в квартиры'],
  [7.0, 'Входные двери в жилые, общественные здания'],
  [6.0, 'Окна с деревянными переплетами'],
  [5.0, 'Окна с пластмассовыми/алюминиевыми переплетами'],
  [8.0, 'Окна, двери, ворота производственных'],
  [10.0, 'Фонари производственных'],
];

// Таблица 11 — предельно допустимое приращение влажности Δw, % по массе
// (материал → Δw; отсутствующие в таблице — null)

// Приложение Л (таблица Л.1) — сопротивление воздухопроницанию слоёв, м²·ч·Па/кг
export const RI_OPTIONS = [
  [20000, 'Бетон сплошной (без швов), 100 мм'],
  [21, 'Газосиликат сплошной (без швов), 140 мм'],
  [6, 'Известняк-ракушечник, 500 мм'],
  [64, 'Картон строительный (без швов), 1,3 мм'],
  [18, 'Кирпичная кладка сплошного кирпича на ЦПС, 250 мм и более'],
  [1, 'Кирпичная кладка на цементно-шлаковом растворе, 120 мм (полкирпича)'],
  [2, 'Кладка кирпича керамического пустотного на ЦПС, полкирпича'],
  [13, 'Кладка из легкобетонных камней на ЦПС, 400 мм'],
  [200, 'Листы асбестоцементные с заделкой швов, 6 мм'],
  [20, 'Обои бумажные обычные'],
  [0.1, 'Обшивка из обрезных досок впритык/вчетверть, 20–25 мм'],
  [1.5, 'Обшивка из обрезных досок в шпунт, 20–25 мм'],
  [100, 'Обшивка досок двойная с прокладкой строительной бумаги, 50 мм'],
  [2.5, 'Обшивка из фибролита/ДВП мягких с заделкой швов, 15–70 мм'],
  [0.5, 'Обшивка из фибролита/ДВП мягких без заделки швов, 15–70 мм'],
  [3.3, 'Обшивка из жестких древесно-волокнистых листов с заделкой швов, 10 мм'],
  [20, 'Обшивка из гипсовой сухой штукатурки с заделкой швов, 10 мм'],
];

// Приложение Ж — пароизоляция: Rп, (м²·ч·Па)/мг (материалы с rvp в базе)

// Таблица 12 — комплекс f(tм.у), К²/Па (шаг 1 °С от −40 до 27)
const F_TABLE = [2539, 2322, 2126, 1947, 1785, 1638, 1504, 1382, 1271, 1170,
  1077, 992.7, 915.5, 844.8, 780.2, 721.0, 666.7, 616.9, 571.2, 529.2, 490.7,
  455.2, 422.5, 392.5, 364.8, 339.2, 315.6, 293.9, 273.8, 255.2, 238.0, 222.1,
  207.4, 193.7, 181.1, 169.3, 158.4, 148.3, 138.9, 130.2, 122.1, 114.5, 107.5,
  100.9, 94.8, 89.1, 83.8, 78.8, 74.2, 69.9, 65.8, 62.0, 58.5, 55.2, 52.1,
  49.1, 46.4, 43.9, 41.5, 39.2, 37.1, 35.1, 33.2, 31.5, 29.8, 28.3, 25.4];

function fToT(f) { // обратная интерполяция таблицы 12: f → t, −40..27 °С
  const t0 = -40;
  if (f >= F_TABLE[0]) return t0;
  for (let i = 0; i < F_TABLE.length - 1; i++) {
    if (f >= F_TABLE[i + 1]) {
      const t1 = t0 + i, t2 = t1 + 1;
      const k = (F_TABLE[i] - f) / (F_TABLE[i] - F_TABLE[i + 1]);
      return t1 + k;
    }
  }
  return 27;
}

// Парциальное давление насыщенного водяного пара, Па (формула (8.9))
export function saturationP(t) {
  return 1.84e11 * Math.exp(-5330 / (273 + t));
}

// Стандартные толщины утеплителей, мм
export const INS_STANDARD = [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 180, 200, 250, 300];

// Влажностный режим помещений (таблица 1 СП 50.13330.2024)
export function humidityMode(tin, phi) {
  if (tin <= 12) {
    if (phi <= 60) return "сухой";
    if (phi <= 75) return "нормальный";
    return "влажный";
  }
  if (tin <= 24) {
    if (phi <= 50) return "сухой";
    if (phi <= 60) return "нормальный";
    if (phi <= 75) return "влажный";
    return "мокрый";
  }
  if (phi <= 40) return "сухой";
  if (phi <= 50) return "нормальный";
  if (phi <= 60) return "влажный";
  return "мокрый";
}

// Условия эксплуатации ограждающих конструкций (таблица 2 СП 50.13330.2024)
export function operatingConditions(mode, zone) {
  const t = {
    "сухой":      { "сухая": "A", "нормальная": "A", "влажная": "B" },
    "нормальный": { "сухая": "A", "нормальная": "B", "влажная": "B" },
    "влажный":    { "сухая": "B", "нормальная": "B", "влажная": "B" },
    "мокрый":     { "сухая": "B", "нормальная": "B", "влажная": "B" },
  };
  return (t[mode] && t[mode][zone]) || "B";
}

// Точка росы, °С (формула Магнуса)
export function dewPoint(t, phi) {
  const a = 17.62, b = 243.12;
  const gamma = Math.log(Math.max(phi, 1) / 100) + (a * t) / (b + t);
  return (b * gamma) / (a - gamma);
}

// Ближайшая стандартная толщина утеплителя не меньше требуемой
export function standardInsulation(mm) {
  for (const s of INS_STANDARD) if (s >= mm - 1e-9) return s;
  return Math.ceil(mm / 10) * 10;
}

// Базовое значение Rтр по таблице 3: линейная формула или кусочно-линейные точки
function rtrValue(construction, building, gsop) {
  const spec = RTR[construction][building];
  if (typeof spec[0] === "number" && spec.length === 2) return spec[0] * gsop + spec[1];
  const pts = spec;
  if (gsop <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    if (gsop <= x2) return y1 + ((y2 - y1) * (gsop - x1)) / (x2 - x1);
  }
  return pts[pts.length - 1][1];
}

/**
 * Основной расчёт по СП 50.13330.2024.
 * input = {
 *   climate: {t5, tot, zot, tot10?, zot10?, zone}, tin, phi, building, construction,
 *   layers: [{name, d (мм), lambda, isIns}],
 *   alphaIn?, alphaOut?, cond ("A"|"B")
 * }
 * Результат включает проверки:
 *  — поэлементное требование (5.1): R₀ ≥ Rнорм = mр·Rтр (mр = 1);
 *  — санитарно-гигиеническое требование (5.7): tв.п ≥ tр;
 *  — дополнительная проверка по формуле (5.4): tв.п ≥ tв − Δtн.
 */
export function calcAll(input) {
  const { climate, tin, phi, building, construction, layers } = input;
  const alphaIn = input.alphaIn || ALPHA_IN_DEFAULT;
  const alphaOut = input.alphaOut || CONSTRUCTIONS[construction].alphaOut;
  const cond = input.cond || "A";

  // ГСОП (5.2): для категории 1.2 — по периоду ≤ 10 °С
  const bld = BUILDINGS[building];
  const tot = (bld.period10 && climate.tot10 != null) ? climate.tot10 : climate.tot;
  const zot = (bld.period10 && climate.zot10 != null) ? climate.zot10 : climate.zot;
  const gsop = (tin - tot) * zot;
  const rtr = rtrValue(construction, building, gsop);
  const rnorm = MP_DEFAULT * rtr;

  // Точка росы при расчётной влажности помещения
  const td = dewPoint(tin, phi);
  let dtn = DTN[building][construction];
  if (dtn === null) {
    if (construction === "wall") dtn = Math.min(tin - td, 7);
    else dtn = Math.min(0.8 * (tin - td), 6);
  }

  // Слои
  const layersR = layers.map(l => ({ ...l, r: (l.d / 1000) / l.lambda }));
  const rIns = layersR.filter(l => l.isIns).reduce((s, l) => s + l.r, 0);
  const rOther = layersR.filter(l => !l.isIns).reduce((s, l) => s + l.r, 0);
  const r0 = 1 / alphaIn + rIns + rOther + 1 / alphaOut;

  // Приведённое сопротивление (прил. Г): коэффициент однородности r (Г.4)
  // или поэлементный учёт неоднородностей (Г.1)
  const uni = input.uni || { mode: 'none' };
  let rpr = r0;
  let uniExtra = 0;
  if (uni.mode === 'r' && uni.r > 0 && uni.r <= 1) rpr = r0 * uni.r;
  else if (uni.mode === 'elements' && input.area > 0) {
    uniExtra = (uni.elems || []).reduce((s, e) =>
      s + (e.t === 'L' ? (e.psi || 0) * (e.L || 0) : (e.chi || 0) * (e.n || 0)), 0) / input.area;
    if (uniExtra > 0) rpr = 1 / (1 / r0 + uniExtra);
  }
  const marginPct = (rpr / rnorm - 1) * 100;
  const pass = rpr >= rnorm - 1e-9;

  // Температурный профиль от внутренней поверхности к наружной
  const tempAt = r => tin - (tin - climate.t5) * r / r0;
  let cum = 1 / alphaIn;
  const profile = [{ label: "Внутренняя поверхность", r: cum, t: tempAt(cum), kind: "surf-in" }];
  for (const l of layersR) {
    cum += l.r;
    profile.push({ label: l.name, r: cum, t: tempAt(cum), kind: "boundary" });
  }
  cum += 1 / alphaOut;
  profile.push({ label: "Наружная поверхность", r: cum, t: tempAt(cum), kind: "surf-out" });

  const tInSurf = tempAt(1 / alphaIn);

  // Подбор утеплителя (с учётом однородности: нужно условное R₀, дающее Rпр ≥ Rнорм)
  const insLayer = layersR.find(l => l.isIns);
  let ins = null;
  if (insLayer) {
    let needR0 = rnorm;
    if (uni.mode === 'r' && uni.r > 0) needR0 = rnorm / uni.r;
    else if (uni.mode === 'elements' && input.area > 0) {
      const inv = 1 / rnorm - uniExtra;
      needR0 = inv > 0 ? 1 / inv : Infinity;
    }
    const rNeeded = Math.max(0, needR0 - 1 / alphaIn - rOther - 1 / alphaOut);
    const exactMm = rNeeded * insLayer.lambda * 1000;
    ins = {
      lambda: insLayer.lambda,
      exactMm: Math.ceil(exactMm * 10) / 10,
      standardMm: standardInsulation(exactMm),
      addMm: Math.max(0, Math.ceil((exactMm - insLayer.d) * 10) / 10),
    };
  }

  // Проверки
  const condSurf = tInSurf < td;   // п. 5.7: tв.п ≥ tр
  const insideBoundaries = profile.filter(p =>
    p.kind === "boundary" && p.r < r0 - 1 / alphaOut - 1e-9);
  const condInside = insideBoundaries.filter(p => p.t < td);
  const surfDeltaOk = tInSurf >= tin - dtn; // формула (5.4) — дополнительная

  return {
    climate, tin, phi, building, construction, cond,
    alphaIn, alphaOut, mp: MP_DEFAULT,
    tot, zot, uni, area: input.area || null,
    mode: humidityMode(tin, phi),
    gsop, rtr, rnorm, r0, rpr, uniExtra, marginPct, pass,
    dtn, td, tInSurf, surfDeltaOk, condSurf, condInside,
    profile, layersR, ins,
  };
}

/* ——— Пол по грунту (прил. Г.7, формулы Г.15–Г.16) ——— */
export function groundFloorCalc({ a, b, h = 0, dIns, lambdaIns, lambdaGr = 1.6 }) {
  const w = (h || 0) / 2;          // эффективная полоса, м (h/2 при стенах в грунте)
  const L = 2 * (a + b);           // периметр, м
  const A = a * b;                 // площадь пола, м²
  const zoneR = base => (1.6 / lambdaGr) * base + (dIns > 0 ? dIns / lambdaIns : 0);
  const rect = (dx) => { const x = Math.max(a - 2 * dx, 0), y = Math.max(b - 2 * dx, 0); return x * y; };
  // зоны от контура; эффективная полоса (w) входит в зону I («2 м суммарно»)
  const AI = (rect(0) - rect(2 - w)) + L * w;
  const AII = rect(2 - w) - rect(4 - w);
  const AIII = rect(4 - w) - rect(6 - w);
  const AIV = rect(6 - w);
  const RI = zoneR(2.1), RII = zoneR(3.8), RIII = zoneR(5.2), RIV = zoneR(7.7);
  const flux = AI / RI + AII / RII + AIII / RIII + AIV / RIV;
  const rpr = flux > 0 ? A / flux : Infinity;
  return { a, b, h, w, L, A, zones: [
    { name: 'I', area: AI, r: RI }, { name: 'II', area: AII, r: RII },
    { name: 'III', area: AIII, r: RIII }, { name: 'IV', area: AIV, r: RIV },
  ], rpr, rtrContext: 'ground' };
}

/* ——— Влажностный расчёт (раздел 8 СП 50.13330.2024) ———
 * layers: [{name, d (мм), lambda, mu, dw, rho, isIns, rvp?}] отнутри наружу
 * climate.tm — месячные температуры, climate.em — месячные давления, Па
 */
export function moistureCalc({ layers, r0, climate, tin, phi, construction, alphaIn = 8.7 }) {
  const tm = climate.tm, em = climate.em;
  if (!tm || !em) return { error: 'Для этого пункта нет месячных температур/давлений — задайте климат вручную' };
  // периоды года (8.4): < −5 °С — зимний; −5..5 — весенне-осенний; > 5 — летний
  let z1 = 0, z2 = 0, z3 = 0, tW = [], tSO = [], tS = [];
  tm.forEach((t, i) => {
    if (t < -5) { z1++; tW.push({ t, e: em[i] }); }
    else if (t <= 5) { z2++; tSO.push({ t, e: em[i] }); }
    else { z3++; tS.push({ t, e: em[i] }); }
  });
  const negMonths = tm.map((t, i) => ({ t, e: em[i] })).filter(x => x.t < 0);
  const z0 = negMonths.length;
  if (!z0) return { error: 'Периода с отрицательными среднемесячными температурами нет — влажностный расчёт не требуется' };
  const tNeg = negMonths.reduce((s, x) => s + x.t, 0) / z0;                 // tн,отр
  const eNeg = negMonths.reduce((s, x) => s + x.e, 0) / z0;                 // eн,отр, Па
  const eYear = em.reduce((s, x) => s + x, 0) / 12;                         // eн, Па
  const avg = arr => arr.reduce((s, x) => s + x.t, 0) / arr.length;
  const tWavg = tW.length ? avg(tW) : tNeg;
  const tSOavg = tSO.length ? avg(tSO) : tNeg;
  const tSavg = tS.length ? avg(tS) : tNeg;

  const eIn = saturationP(tin) * phi / 100;                                 // eв, (8.3)

  // паропроницаемые слои (замкнутые прослойки — Rп = 0)
  const layersP = layers.map(l => ({
    ...l, rp: l.rvp != null ? l.rvp : (l.mu > 0 ? (l.d / 1000) / l.mu : 0),
  }));
  const rpo = layersP.reduce((s, l) => s + l.rp, 0);                        // Rп,о (8.11)

  // вентилируемая воздушная прослойка (НФС): разрывает путь влаги —
  // влага за прослойкой выносится воздухом и не накапливается
  const ventIdx = layersP.findIndex(l => l.vent);

  // плоскость максимального увлажнения: упрощение (условие после табл. 12)
  // либо полный алгоритм 8.5.1–8.5.5
  const insIdx = layersP.findIndex(l => l.isIns);
  let plane = null;
  const ins = insIdx >= 0 ? layersP[insIdx] : null;
  if (ins && ins.r > (2 / 3) * r0 && ins.mu > 2 * ins.lambda) {
    plane = { layerIdx: insIdx, atOuter: true, how: 'по упрощению 8.5 (μут > 2λут, Rут > ⅔R усл)' };
  } else {
    // полный алгоритм: tм.у по (8.7) для каждого слоя, сравнение с границами (8.12)
    let cum = 1 / alphaIn;
    const bounds = []; // границы по слоям [tx_in, tx_out]
    layersP.forEach(l => { const t1 = tin - (tin - tNeg) * (cum) / r0; cum += l.r; const t2 = tin - (tin - tNeg) * cum / r0; bounds.push([t1, t2]); });
    const found = [];
    const tmyOf = [];
    layersP.forEach((l, i) => {
      tmyOf.push(null);
      if (!(l.mu > 0)) return;
      const f = 5330 * (rpo / r0) * ((tin - tNeg) / (eIn - eNeg)) * (l.mu / l.lambda); // (8.7)
      const tmy = fToT(f);
      tmyOf[i] = tmy;
      const [t1, t2] = bounds[i]; // t1 ≥ t2 (внутрь наружу холоднее)
      if (tmy <= t1 && tmy >= t2) found.push({ layerIdx: i, tmy, atOuter: false, how: 'по 8.5.4' });
    });
    if (found.length >= 2) plane = found.find(p => layersP[p.layerIdx].isIns) || found[0];
    else if (found.length === 1) plane = found[0];
    else {
      // 8.5.5: у более холодного соседнего слоя tм.у выше его температур,
      // у более тёплого — ниже → плоскость на границе слоёв
      let boundary = null;
      for (let i = 0; i < layersP.length - 1; i++) {
        const a = tmyOf[i], b = tmyOf[i + 1];
        if (a == null || b == null) continue;
        if (a < bounds[i][1] && b > bounds[i + 1][0]) { boundary = i; break; }
      }
      if (boundary != null) plane = { layerIdx: boundary + 1, atBoundary: true, tmy: null, how: 'на границе слоёв (8.5.5)' };
      else plane = { layerIdx: layersP.length - 1, atOuter: true, how: 'плоскость в конструкции отсутствует — наружная поверхность (8.5.5)' };
    }
  }

  // сопротивления от внутренней поверхности до плоскости и от неё до наружной
  let rp = 0, rpN = 0;
  layersP.forEach((l, i) => {
    if (plane.atBoundary) {
      // плоскость на границе между слоями plane.layerIdx−1 и plane.layerIdx
      if (i < plane.layerIdx) rp += l.rp; else rpN += l.rp;
      return;
    }
    if (i < plane.layerIdx) rp += l.rp;
    else if (i > plane.layerIdx) rpN += l.rp;
    else if (!plane.atOuter) {
      // плоскость внутри слоя: доля по координате x (линейное распределение t, 8.5.4)
      const [t1, t2] = bounds[i];
      const frac = t2 > t1 ? (t1 - plane.tmy) / (t1 - t2) : 0;
      const share = Math.min(1, Math.max(0, frac));
      rp += l.rp * share; rpN += l.rp * (1 - share);
    }
  });

  // температуры в плоскости по периодам (8.12) и насыщенные давления (8.4)
  const tAt = tOut => tin - (tin - tOut) * (1 / alphaIn + rp) / r0;
  const E1 = saturationP(tAt(tWavg));
  const E2 = saturationP(tAt(tSOavg));
  const E3 = saturationP(Math.max(tAt(tSavg), tSavg)); // примечание: t не ниже t летнего периода
  const E = (E1 * z1 + E2 * z2 + E3 * z3) / 12;
  const E0 = saturationP(tAt(tNeg));

  // (8.1): при E ≤ eн годовой градиент к плоскости отсутствует — не лимитирует
  // при вентзазоре: конденсация за зазором не накапливается (влага выносится)
  const vented = ventIdx >= 0 && plane.layerIdx > ventIdx;
  if (vented) {
    return {
      vented: true, ventIdx,
      note: 'Плоскость возможной конденсации находится за вентилируемой прослойкой — влага выносится воздухом зазора и не накапливается. Дополнительно проверьте зазор по методике производителя НФС (СП 345.1325800).',
      pass: true,
      z0, tNeg, eNeg, eYear, eIn, rpo,
    };
  }

  const rp1 = (E - eYear) > 0 ? ((eIn - E) / (E - eYear)) * rpN : 0;
  const eta = (E0 - eNeg) > 0 ? 0.0024 * (E0 - eNeg) * z0 / Math.max(rpN, 1e-9) : 0; // (8.5)
  const wl = layersP[plane.layerIdx];
  let rp2 = null, dwNote = '';
  if (plane.atOuter) {
    dwNote = 'плоскость на наружной поверхности — защита от переувлажнения не требуется';
  } else if (plane.atBoundary) {
    // стык двух слоёв: ρw·δw·Δw = сумма по половинам толщин стыкующихся слоёв
    const li = layersP[plane.layerIdx - 1], lo = layersP[plane.layerIdx];
    if (li?.dw != null && lo?.dw != null) {
      const dwTot = (li.rho || 1) * (li.d / 2000) * li.dw + (lo.rho || 1) * (lo.d / 2000) * lo.dw;
      rp2 = 0.0024 * z0 * (eIn - E0) / (dwTot + eta); // (8.2)
    } else dwNote = 'материалы стыка отсутствуют в таблице 11 — проверка Rп2 не выполняется';
  } else if (wl && wl.dw != null) {
    const dwTot = (wl.rho || 1) * (wl.d / 1000) * wl.dw; // ρw·δw·Δw (δw = толщина слоя)
    rp2 = 0.0024 * z0 * (eIn - E0) / (dwTot + eta); // (8.2)
  } else dwNote = 'материал плоскости увлажнения отсутствует в таблице 11 — проверка Rп2 не выполняется';

  const rRequired = rp2 != null ? Math.max(rp1, rp2) : rp1;
  const pass = rp >= rRequired - 1e-9;

  // кривые e(x) и E(x) по толщине — для влагографики (п. 8.2-методика):
  // фактическая упругость падает линейно по сопротивлению паропроницанию
  let cumP = 0, cumR = 1 / alphaIn;
  const curve = layersP.map((l, i) => {
    cumP += l.rp;
    const e = eIn - (eIn - eNeg) * (cumP / Math.max(rpo, 1e-9)); // от eв к eн
    const tx = tin - (tin - tNeg) * cumR / r0;                    // (8.12)
    cumR += l.r;
    return { i, e, E: saturationP(tx), tx, vent: !!l.vent };
  });

  return {
    z0, z1, z2, z3, tNeg, eNeg, eYear, eIn, rpo, plane, curve,
    rp, rpN, E, E0, rp1, rp2: rp2 != null ? rp2 : null, eta, rRequired, pass, dwNote,
    atticReq: construction === 'attic' ? 0.0012 * (eIn - eNeg) : null, // (8.6)
  };
}

/* ——— Сопротивление воздухопроницанию (раздел 7, прил. Л) ——— */
export function airPermCalc({ ris, H, t5, v1 = 0, tin = 20, ghn }) {
  const gamma = t => 3463 / (273 + t);
  const dp = 0.55 * (H || 10) * (gamma(t5) - gamma(tin)) + 0.03 * gamma(t5) * (v1 || 0) ** 2; // (7.2)
  const ri = ris.reduce((s, x) => s + (x || 0), 0);
  const riTr = dp / ghn; // (7.1)
  return { dp, ri, riTr, pass: ri >= riTr - 1e-9, ghn, H };
}

/* ——— Заполнения проёмов: окна, двери, ворота (таблица 3, 8; формула (5.4)) ——— */
function piecewise(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return pts[pts.length - 1][1];
}

export function openingCalc({ kind, s, r0, building, gsop, t5, tin, dtnWall = 4, alphaIn = ALPHA_IN_DEFAULT }) {
  if (kind === 'gate') {
    const band = gsop <= 3500 ? 0 : gsop <= 7000 ? 1 : 2;
    const row = s <= 8 ? 'small' : s <= 14 ? 'mid' : 'big';
    const rtr = GATE_R[row][band];
    return { rtr, pass: r0 >= rtr - 1e-9, src: 'таблица 8 СП 50.13330.2024' };
  }
  if (kind === 'door') {
    const rWall = (tin - t5) / (dtnWall * alphaIn); // формула (5.4)
    const rtr = 0.6 * rWall;
    return { rtr, pass: r0 >= rtr - 1e-9, src: 'п. 5.4 (0,6·Rстен по (5.4))' };
  }
  // окно
  const rtr = piecewise(WINDOW_RTR[building] || WINDOW_RTR.residential, gsop);
  const tGlass = tin - (tin - t5) * (1 / ALPHA_IN_WINDOW) / Math.max(r0, 1e-9);
  const tMin = building === 'industrial' ? 0 : 3; // п. 5.7
  return { rtr, tGlass, tMin, pass: r0 >= rtr - 1e-9 && tGlass >= tMin,
    glassOk: tGlass >= tMin, src: 'таблица 3 (графа «Окна») + п. 5.7' };
}

/* ——— Комплексное требование: kоб (прил. Д) и нормируемое kтроб (5.5–5.6) ——— */
export function projectCalc({ fragments, volume, gsop }) {
  // fragments: [{name, area, rpr, nt}]
  const valid = fragments.filter(f => f.area > 0 && f.rpr > 0);
  const kOb = volume > 0 ? valid.reduce((s, f) => s + (f.nt || 1) * f.area / f.rpr, 0) / volume : null;
  let kObTr = null;
  if (volume > 0 && gsop > 0) {
    const v = volume;
    kObTr = v <= 960
      ? 4.74 / (0.00013 * gsop + 0.61) / Math.cbrt(v)
      : (0.16 + 10 / Math.sqrt(v)) / (0.00013 * gsop + 0.61);
    kObTr = Math.max(kObTr, 8.5 / Math.sqrt(gsop)); // (5.6) — нижняя граница
  }
  // Годовой расход тепловой энергии на отопление (Б.10, Б.12):
  // qот = 0,024·ГСОП·kоб, кВт·ч/(м³·год); Qот = qот·Vот, кВт·ч/год
  const qOb = kOb != null ? 0.024 * gsop * kOb : null;
  const qObTr = kObTr != null ? 0.024 * gsop * kObTr : null;
  const qYear = qOb != null ? qOb * volume : null;
  const qYearTr = qObTr != null ? qObTr * volume : null;
  return {
    kOb, kObTr, volume, gsop, qOb, qObTr, qYear, qYearTr,
    pass: kOb != null && kObTr != null ? kOb <= kObTr + 1e-9 : null,
    fragments: valid,
  };
}
