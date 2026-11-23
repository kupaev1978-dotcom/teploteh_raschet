// Экспорт отчёта в настоящий PDF-файл (jsPDF + встроенный кириллический шрифт).
// Шрифт: Roboto Regular (Apache 2.0), субсет латиница+кириллица.
import { FONT_BASE64 } from './font-data.js?v=5';

const PAGE_W = 210, PAGE_H = 297, M = 15;
const CONTENT_W = PAGE_W - 2 * M;

let doc, y;

function init() {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) throw new Error('jsPDF не загружен');
  try {
    doc = new jsPDFCtor({ unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('Roboto-sub.ttf', FONT_BASE64);
    doc.addFont('Roboto-sub.ttf', 'Roboto', 'normal');
    doc.setFont('Roboto', 'normal');
  } catch (e) {
    // повтор с полным набором таблиц из изначального шрифта невозможен —
    // сообщаем шаг, на котором не поддержался шрифт
    throw new Error('init: ' + (e.message || e) + ' [шаг: ' + (doc ? 'setFont/addFont' : 'addFont') + ']');
  }
  y = M + 4;
}

function pageBreakIfNeeded(h = 6) {
  if (y + h > PAGE_H - M) { doc.addPage(); y = M + 4; }
}

function text(t, size = 9.5, opts = {}) {
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(t, CONTENT_W - (opts.indent || 0));
  for (const line of lines) {
    pageBreakIfNeeded(size / 2.8);
    doc.text(line, M + (opts.indent || 0), y);
    y += size / 2.53;
  }
  y += opts.after != null ? opts.after : 1.2;
}

function h1(t) { text(t, 14, { after: 1 }); }
function h2(t) {
  pageBreakIfNeeded(10);
  y += 1.5;
  text(t, 11.5, { after: 1 });
  doc.setDrawColor(120); doc.line(M, y, PAGE_W - M, y); y += 2.2;
}
function formula(t) { text(t, 9, { indent: 3, after: 0.8 }); }
function concl(t) {
  pageBreakIfNeeded(10);
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(t, CONTENT_W);
  doc.setFillColor(240, 240, 240);
  doc.rect(M, y - 3, CONTENT_W, lines.length * 3.9 + 6, 'F');
  doc.setTextColor(160, 0, 0);
  for (const line of lines) { doc.text(line, M + 2, y); y += 3.9; }
  doc.setTextColor(0); y += 4;
}
function kv(pairs) { // пары «параметр — значение» простыми строками
  for (const [k, v] of pairs) formula(k + ': ' + v);
}

function table(head, rows, widths) {
  pageBreakIfNeeded(8 + rows.length * 5);
  doc.setFontSize(8.5);
  const total = widths.reduce((s, x) => s + x, 0);
  const scale = CONTENT_W / total;
  const cols = widths.map(w => w * scale);
  const rowH = 5.2;
  // шапка
  doc.setFillColor(230, 230, 230); doc.rect(M, y - 3.4, CONTENT_W, rowH, 'F');
  let x = M;
  head.forEach((t, i) => {
    doc.text(String(t), x + 1.5, y);
    x += cols[i];
  });
  y += rowH - 3.4 + 1.5;
  // строки
  rows.forEach(r => {
    const cells = r.map((t, i) => doc.splitTextToSize(String(t), cols[i] - 3));
    const lines = Math.max(...cells.map(c => c.length));
    pageBreakIfNeeded(lines * 3.6 + 2);
    const h = lines * 3.6 + 1.6;
    doc.setDrawColor(160); doc.rect(M, y - 3, CONTENT_W, h);
    x = M;
    cells.forEach((c, i) => {
      c.forEach((ln, k) => doc.text(ln, x + 1.5, y + k * 3.6));
      x += cols[i];
    });
    y += h;
  });
  y += 2.5;
  doc.setFontSize(9.5);
}

const f = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');
const f0 = x => f(x, 0);

/* PDF по одной конструкции */
export function buildConsPdf(state, cons, r, res) {
  init();
  h1('Теплотехнический расчёт ограждающей конструкции');
  text(`${state.name || ''} · ${cons.name} (${KIND(cons)}) · ${state.city || 'климат вручную'} · ${new Date().toLocaleDateString('ru-RU')}`, 9, { after: 3 });

  if (cons.kind === 'layered') {
    h2('1. Исходные данные');
    kv([
      ['Район строительства', state.city || '—'],
      ['tн пятидневки 0,92 / tот / Zот', `${f(r.climate.t5, 1)} °С / ${f(r.tot, 1)} °С / ${f0(r.zot)} сут (период ≤${BUILDINGS_PERIOD(state.building)} °С)`],
      ['Зона влажности', r.climate.zone || 'не определена (условия Б)'],
      ['Категория здания', BUILDINGS_LABEL(state.building)],
      ['tв / φв / режим', `${f(r.tin, 1)} °С / ${f0(r.phi)} % / ${r.mode}`],
      ['Условия эксплуатации', r.cond],
      ['αв / αн', `${f(r.alphaIn, 1)} / ${f(r.alphaOut, 1)} Вт/(м²·°С)`],
      ['mр', f(r.mp, 1)],
    ]);

    h2('2. Состав конструкции');
    table(['№', 'Слой', 'δ, мм', 'λ, Вт/(м·°С)', 'R, м²·°С/Вт'],
      r.layersR.map((l, i) => [i + 1, l.name, f0(l.d), l.rvp != null ? 'Rп=' + f(l.rvp, 2) : f(l.lambda, 3), f(l.r, 3)]),
      [8, 96, 16, 30, 30]);

    h2('3. Нормируемое сопротивление');
    formula(`ГСОП = (${f(r.tin, 1)} − (${f(r.tot, 1)}))·${f0(r.zot)} = ${f0(r.gsop)} °С·сут (5.2)`);
    formula(`Rтр = ${f(r.rtr)}; Rнорм = mр·Rтр = ${f(r.rnorm)} м²·°С/Вт (5.1, таблица 3)`);
    formula(`R₀ усл = ${f(r.r0)}; R₀пр = ${f(r.rpr)} м²·°С/Вт (Г.1/Г.4, Г.6)`);

    h2('4. Подбор утеплителя');
    formula(r.ins ? (r.ins.exactMm <= 0.05
      ? 'Утеплитель не требуется'
      : `δтр = ${f(r.ins.exactMm, 0)} мм → стандартная ${r.ins.standardMm} мм (λ = ${f(r.ins.lambda, 3)})`)
      : 'Слой-утеплитель не выделен');

    h2('5. Санитарное (п. 5.7) и влажностное (раздел 8)');
    formula(`tв.п = ${f(r.tInSurf, 1)} °С; tр = ${f(r.td, 1)} °С; tв − Δtн = ${f(r.tin - r.dtn, 1)} °С — ${r.surfDeltaOk ? 'выполняется' : 'не выполняется'}`);
    const m = r.moisture;
    if (m && !m.error) {
      formula(m.vented ? m.note : `Плоскость увлажнения — слой ${m.plane.layerIdx + 1}; Rп = ${f(m.rp, 3)}; Rп1тр = ${f(m.rp1, 3)}; Rп2тр = ${m.rp2 != null ? f(m.rp2, 3) : 'н/д'} — ${m.pass ? 'выполняется' : 'требуется пароизоляция'}`);
    }

    h2('6. Вывод');
    concl((r.pass && !r.condSurf)
      ? `R₀пр = ${f(r.rpr)} ≥ Rнорм = ${f(r.rnorm)} м²·°С/Вт (запас ${f(r.marginPct, 0)} %). Требования СП 50.13330.2024 выполняются.`
      : `Конструкция НЕ удовлетворяет требованиям: R₀пр = ${f(r.rpr)} м²·°С/Вт против Rнорм = ${f(r.rnorm)} м²·°С/Вт${r.ins && r.ins.exactMm > 0.05 ? ` (довести утеплитель до ${r.ins.standardMm} мм)` : ''}.`);
  } else if (cons.kind === 'ground') {
    h2('1. Исходные данные');
    kv([
      ['Пол по грунту (прил. Г.7)', `a×b = ${f(cons.ground.a, 1)}×${f(cons.ground.b, 1)} м`],
      ['Стены в грунте h / полоса h/2', `${f(cons.ground.h, 1)} / ${f(cons.ground.h / 2, 1)} м`],
      ['Утеплитель', `${f0(cons.ground.dIns)} мм, λ = ${f(cons.ground.lambda, 3)} Вт/(м·°С)`],
      ['λ грунта', f(cons.ground.lambdaGr, 1)],
    ]);
    h2('2. Зоны и результат');
    table(['Зона', 'Площадь, м²', 'R, (м²·°С)/Вт'],
      r.zones.map(z => [z.name, f(z.area, 1), f(z.r, 2)]), [20, 40, 40]);
    formula(`R₀пр = ${f(r.rpr)}; Rнорм = ${f(r.rnorm)} м²·°С/Вт`);
    concl(r.pass ? `Выполняется (запас ${f(r.marginPct, 0)} %).` : 'Не выполняется — увеличить утепление пола.');
  } else {
    h2('Проём');
    kv([
      ['Тип', KIND(cons)],
      ['Площадь S, м²', f(cons.opening.s, 1)],
      ['R₀ по паспорту / Rтр', `${f(cons.opening.r0)} / ${f(r.rtr)} м²·°С/Вт`],
      ...(r.tGlass != null ? [['t остекления', `${f(r.tGlass, 1)} °С (норма ≥ ${r.tMin} °С)`]] : []),
    ]);
    concl(r.pass ? VERDICT_OK + ' Требования выполняются.' : VERDICT_BAD + ' Требования НЕ выполняются.');
  }

  y += 2;
  text('Источники: СП 50.13330.2024, СП 131.13330.2025. Расчёт выполнен программой «ТеплоРасчёт». Ключевые значения сверить с официальными изданиями СП.', 7.5);

  return doc;
}

/* PDF по объекту: сводка + kоб + Qот */
export function buildProjectPdf(state, items) {
  init();
  h1('Сводный теплотехнический расчёт объекта');
  text(`${state.name || ''} · ${state.city || 'климат вручную'} · ${new Date().toLocaleDateString('ru-RU')}`, 9, { after: 3 });
  const gsop = (state.tin - state.climate.tot) * state.climate.zot;
  h2('1. Общие данные');
  kv([
    ['Город / категория', `${state.city || '—'} / ${BUILDINGS_LABEL(state.building)}`],
    ['tн / tот / Zот', `${f(state.climate.t5, 1)} °С / ${f(state.climate.tot, 1)} °С / ${f0(state.climate.zot)} сут`],
    ['ГСОП', f0(gsop) + ' °С·сут'],
    ['tв / φв / Vот', `${f(state.tin, 1)} °С / ${f0(state.phi)} % / ${state.volume ? f0(state.volume) + ' м³' : 'не задан'}`],
  ]);

  h2('2. Конструкции (поэлементные требования)');
  table(['№', 'Конструкция', 'A, м²', 'R₀пр', 'Вердикт'],
    items.map(({ c, r }, i) => {
      const rpr = c.kind === 'layered' ? r.rpr : c.kind === 'ground' ? r.rpr : c.opening.r0;
      const ok = c.kind === 'layered' ? (r.pass && !r.condSurf) : r.pass;
      return [i + 1, c.name, f(c.area ?? 0, 1), f(rpr), ok ? '✓' : '✗'];
    }), [8, 90, 24, 30, 24]);

  h2('3. Комплексное требование и годовой расход тепла');
  const kres = res && res.kOb != null ? res : null;
  if (kres) {
    formula(`kоб = ${f(kres.kOb, 3)} Вт/(м³·°С) ≤ kобтр = ${f(kres.kObTr, 3)} Вт/(м³·°С) — ${kres.pass ? 'выполняется' : 'не выполняется'} (Д.1, 5.5–5.6)`);
    formula(`Годовой расход на отопление (Б.12, трансмиссионные потери через оболочку): Q = 0,024·ГСОП·kоб·Vот = ${f0(kres.qYear)} кВт·ч/год`);
    formula(`При kоб = kобтр было бы Qтр = ${f0(kres.qYearTr)} кВт·ч/год — эффект утепления ${f0(Math.max(kres.qYearTr - kres.qYear, 0))} кВт·ч/год`);
  } else {
    text('Для расчёта kоб и годового расхода задайте Vот и площади фрагментов.', 9.5);
  }

  y += 2;
  text('Источники: СП 50.13330.2024, СП 131.13330.2025. Расчёт выполнен программой «ТеплоРасчёт».', 7.5);
  return doc;
}

function KIND(cons) {
  return { layered: 'слоистая конструкция', ground: 'пол по грунту', window: 'окно', door: 'дверь', gate: 'ворота' }[cons.kind] || '';
}
function BUILDINGS_LABEL(b) {
  const map = {
    residential: 'Жилые, гостиницы, общежития — 1.1',
    preschool: 'Дошкольные, образовательные, медицинские — 1.2',
    public: 'Общественные, административные — 2',
    industrial: 'Производственные — 3',
  };
  return map[b] || b;
}
function BUILDINGS_PERIOD(b) { return b === 'preschool' ? '10' : '8'; }

const VERDICT_OK = '[✓]', VERDICT_BAD = '[✗]';

export function savePdf(doc, filename) {
  doc.save(filename);
}
