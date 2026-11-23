// Отчёты для печати / PDF и экспорта в HTML-файл.
// Нормативная база: СП 50.13330.2024, СП 131.13330.2025.
import { CONSTRUCTIONS, BUILDINGS, RTR, ALPHA_IN_DEFAULT, MP_DEFAULT } from './calc.js?v=5';
import { drawLayeredSVG, drawGroundSVG, drawOpeningSVG } from './draw.js?v=5';

const KINDS = { layered: 'Слоистая конструкция', ground: 'Пол по грунту', window: 'Окно', door: 'Дверь', gate: 'Ворота' };

const f = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function isLinearRtr(construction, building) {
  const spec = RTR[construction][building];
  return typeof spec[0] === 'number' && spec.length === 2;
}

const VERDICT_OK = '<span style="color:#16a34a">✓</span>';
const VERDICT_BAD = '<span style="color:#dc2626">✗</span>';

/* Отчёт по одной конструкции */
export function buildReport(state, cons, r) {
  const date = new Date().toLocaleDateString('ru-RU');
  const city = state.city || '— (климатические параметры введены вручную)';

  const head = `
  <h1>Теплотехнический расчёт ограждающей конструкции</h1>
  <div class="r-sub">${esc(state.name || '')} · ${esc(cons.name)} (${esc(KINDS[cons.kind] || '')}) · ${esc(city)} · дата: ${date}</div>`;

  if (cons.kind === 'ground') {
    return `${head}
    <h2>1. Методика</h2>
    <div class="formula">Пол по грунту — прил. Г.7 СП 50.13330.2024: зоны шириной 2 м от контура (таблица Г.3: R = 2,1 / 3,8 / 5,2 / 7,7 (м²·°С)/Вт); при стенах в грунте отсчёт от эффективной полосы шириной h/2. R зоны = 1,6/λгр · Rбаз + δут/λут (формула Г.16).</div>
    <h2>2. Исходные данные</h2>
    <table>
      <tr><th>Параметр</th><th>Значение</th></tr>
      <tr><td>Район строительства</td><td>${esc(city)}</td></tr>
      <tr><td>tн (пятидневка 0,92) / tот / Zот</td><td>${f(r.climate.t5, 1)} °С / ${f(r.climate.tot, 1)} °С / ${f(r.climate.zot, 0)} сут</td></tr>
      <tr><td>Размеры пола a × b</td><td>${f(cons.ground.a, 1)} × ${f(cons.ground.b, 1)} м (S = ${f(cons.ground.a * cons.ground.b, 1)} м²)</td></tr>
      <tr><td>Глубина стен в грунте h / эффективная полоса h/2</td><td>${f(cons.ground.h, 1)} м / ${f(cons.ground.h / 2, 1)} м</td></tr>
      <tr><td>Утеплитель под полом</td><td>δ = ${f(cons.ground.dIns, 0)} мм, λ = ${f(cons.ground.lambda, 3)} Вт/(м·°С)</td></tr>
      <tr><td>λ грунта</td><td>${f(cons.ground.lambdaGr, 1)} Вт/(м·°С)</td></tr>
      <tr><td>Категория здания</td><td>${esc(BUILDINGS[state.building].label)}</td></tr>
    </table>
    <h2>3. Зоны</h2>
    <table>
      <tr><th>Зона</th><th>Площадь, м²</th><th>R, (м²·°С)/Вт</th></tr>
      ${r.zones.map(z => `<tr><td>${z.name}</td><td style="text-align:right">${f(z.area, 1)}</td><td style="text-align:right">${f(z.r, 2)}</td></tr>`).join('')}
    </table>
    ${drawGroundSVG(cons, r)}
    <div class="formula">R₀пр = A / Σ(Aᵢ/Rᵢ) = <b>${f(r.rpr)}</b> м²·°С/Вт (формула Г.15)</div>
    <div class="formula">ГСОП = ${f(r.gsop, 0)} °С·сут; Rнорм (таблица 3, графа «полов по грунту») = <b>${f(r.rnorm)}</b> м²·°С/Вт</div>
    <div class="concl">${r.pass
      ? `R₀пр = ${f(r.rpr)} ≥ Rнорм = ${f(r.rnorm)} — требование выполняется (запас ${f(r.marginPct, 0)} %).`
      : `R₀пр = ${f(r.rpr)} &lt; Rнорм = ${f(r.rnorm)} — требуется увеличить утепление пола.`}</div>
    ${SRC}`;
  }

  if (cons.kind !== 'layered') {
    const kindName = KINDS[cons.kind];
    return `${head}
    <h2>1. Исходные данные</h2>
    <table>
      <tr><th>Параметр</th><th>Значение</th></tr>
      <tr><td>Район строительства</td><td>${esc(city)}</td></tr>
      <tr><td>tн (пятидневка 0,92) / tв</td><td>${f(r.climate.t5, 1)} °С / ${f(state.tin, 1)} °С</td></tr>
      <tr><td>ГСОП</td><td>${f(state._gsop ?? (state.tin - r.climate.tot) * r.climate.zot, 0)} °С·сут</td></tr>
      <tr><td>Тип заполнения</td><td>${esc(kindName)}</td></tr>
      <tr><td>Площадь проёма S, м²</td><td>${f(cons.opening.s, 1)}</td></tr>
      <tr><td>Приведённое R₀ по паспорту</td><td>${f(cons.opening.r0)} м²·°С/Вт</td></tr>
    </table>
    ${drawOpeningSVG(cons, r)}
    <h2>2. Нормируемое сопротивление и вывод</h2>
    <div class="formula">Rтр = <b>${f(r.rtr)}</b> м²·°С/Вт — ${esc(r.src)}</div>
    <div class="formula">${r.tGlass != null ? `Температура внутренней поверхности остекления: tост = tв − (tв − tн)/R₀ · (1/αв.ок) = <b>${f(r.tGlass, 1)} °С</b> (норма ≥ ${r.tMin} °С, п. 5.7)` : ''}</div>
    <div class="concl">${r.pass ? VERDICT_OK + ' Требования выполняются.' : VERDICT_BAD + ' Требования НЕ выполняются — выбрать заполнение с большим R₀.'}</div>
    ${SRC}`;
  }

  // ——— слоистая конструкция ———
  const [a, b] = isLinearRtr(cons.construction, state.building)
    ? RTR[cons.construction][state.building] : [null, null];
  const alphaIn = r.alphaIn, alphaOut = r.alphaOut;
  const sumLayers = r.layersR.reduce((s, l) => s + l.r, 0);
  const periodLabel = BUILDINGS[state.building].period10 ? '≤ 10 °С' : '≤ 8 °С';

  const layerRows = r.layersR.map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(l.name)}</td><td style="text-align:right">${f(l.d, 0)}</td>
    <td style="text-align:right">${l.rvp != null ? 'Rп = ' + f(l.rvp, 2) : f(l.lambda, 3)}${l.isIns ? ' (утеплитель)' : ''}</td>
    <td style="text-align:right">${f(l.r, 3)}</td></tr>`).join('');

  const uniRow = r.uni.mode === 'r'
    ? `<div class="formula">Учёт неоднородностей: r = ${f(r.uni.r, 2)} (Г.4) → R₀пр = r·R₀ усл = <b>${f(r.rpr)}</b> м²·°С/Вт</div>`
    : r.uni.mode === 'elements' && r.uni.elems?.length
      ? `<div class="formula">Учёт неоднородностей по Г.1: ΣΨ·l + Σχ·n = ${f(r.uniExtra, 4)} Вт/(м²·°С) → R₀пр = 1/(1/R₀ усл + Σ) = <b>${f(r.rpr)}</b> м²·°С/Вт</div>`
      : '';

  const rtrLine = a != null
    ? `Rтр = a·ГСОП + b = ${a} · ${f(r.gsop, 0)} + ${b} = <b>${f(r.rtr)}</b> м²·°С/Вт (таблица 3 СП 50.13330.2024)`
    : `Rтр — по таблице 3 СП 50.13330.2024 при ГСОП = ${f(r.gsop, 0)} °С·сут (линейная интерполяция) = <b>${f(r.rtr)}</b> м²·°С/Вт`;

  const m = r.moisture;
  const moisturePart = m && !m.error ? `
  <h2>6. Влажностный расчёт (раздел 8 СП 50.13330.2024)</h2>
  <div class="formula">Периоды года по средним месячным температурам (СП 131.13330.2025, табл. 7.1): зима — ${m.z1} мес (&lt; −5 °С), весенне-осенний — ${m.z2} мес, лето — ${m.z3} мес; период влагонакопления Z₀ = ${m.z0} сут (t &lt; 0 °С); tн,отр = ${f(m.tNeg, 1)} °С</div>
  <div class="formula">eв = (φв/100)·E(tв) = ${f(m.eIn, 0)} Па; eн = ${f(m.eYear, 0)} Па; eн,отр = ${f(m.eNeg, 0)} Па (табл. 11.1)</div>
  <div class="formula">Плоскость максимального увлажнения: ${m.plane.atOuter ? 'наружная поверхность' : 'слой ' + (m.plane.layerIdx + 1)}; Rп (от внутр. поверхности) = ${f(m.rp, 3)}; Rп.н = ${f(m.rpN, 3)} (м²·ч·Па)/мг</div>
  <div class="formula">E = (E₁z₁ + E₂z₂ + E₃z₃)/12 = ${f(m.E, 0)} Па; E₀ = ${f(m.E0, 0)} Па; η = ${f(m.eta, 4)} (формулы (8.4), (8.5))</div>
  <div class="formula">Rп1тр = (eв − E)/(E − eн)·Rп.н = <b>${f(m.rp1, 3)}</b> (8.1)${m.rp2 != null ? `; Rп2тр = 0,0024·Z₀·(eв − E₀)/(ρw·δw·Δw + η) = <b>${f(m.rp2, 3)}</b> (8.2)` : ''}</div>
  ${m.dwNote ? `<div class="formula">Примечание: ${esc(m.dwNote)}</div>` : ''}
  <div class="formula">Rп ≥ max(Rп1тр; Rп2тр) → <b>${m.pass ? 'выполняется' : 'НЕ выполняется — требуется пароизоляция'}</b></div>
  ${m.curve && m.curve.length ? vaporChartSvgStatic(m) : ''}` : `
  <h2>6. Влажностный расчёт</h2>
  <div class="formula">${esc(m?.error || 'Недоступен для этого пункта (нет месячных данных).')}</div>`;

  const air = r.air;
  const airPart = `
  <h2>7. Воздухопроницание (раздел 7 СП 50.13330.2024)</h2>
  <div class="formula">Δp = 0,55·H·(γн − γв) + 0,03·γн·v² = ${f(air.dp, 0)} Па (7.2); H = ${f(air.H ?? 0, 0)} м; v = ${f(r.climate.v1 ?? 0, 1)} м/с (январь, СП 131.13330.2025)</div>
  <div class="formula">Rитр = Δp/Gн = ${f(air.dp, 0)}/${f(air.ghn, 1)} = <b>${f(air.riTr, 1)}</b> (м²·ч·Па)/кг (7.1, таблица 10); Rи = ΣRи слоёв (прил. Л) = <b>${f(air.ri, 1)}</b></div>
  <div class="formula">${air.pass ? 'Выполняется' : 'НЕ выполняется — увеличить сопротивление воздухопроницанию'}</div>`;

  return `${head}
  <h2>1. Исходные данные</h2>
  <table>
    <tr><th>Параметр</th><th>Значение</th></tr>
    <tr><td>Район строительства</td><td>${esc(city)}</td></tr>
    <tr><td>Температура наиболее холодной пятидневки (обесп. 0,92), tн</td><td>${f(r.climate.t5, 1)} °С</td></tr>
    <tr><td>Средняя температура отопительного периода (период ${esc(periodLabel)}), tот</td><td>${f(r.tot, 1)} °С</td></tr>
    <tr><td>Продолжительность отопительного периода, Zот</td><td>${f(r.zot, 0)} сут</td></tr>
    <tr><td>Зона влажности (прил. А СП 50.13330.2024)</td><td>${esc(r.climate.zone || 'не определена (приняты условия Б)')}</td></tr>
    <tr><td>Категория здания (таблица 3)</td><td>${esc(BUILDINGS[state.building].label)}</td></tr>
    <tr><td>Температура / влажность внутреннего воздуха</td><td>${f(r.tin, 1)} °С / ${f(r.phi, 0)} %</td></tr>
    <tr><td>Влажностный режим помещения (таблица 1)</td><td>${esc(r.mode)}</td></tr>
    <tr><td>Условия эксплуатации (таблица 2)</td><td>${esc(r.cond)}${cons.adv.cond === 'auto' ? ' (автоматически)' : ' (вручную)'}</td></tr>
    <tr><td>αв (таблица 4) / αн (таблица 6)</td><td>${f(alphaIn, 1)} / ${f(alphaOut, 1)} Вт/(м²·°С)</td></tr>
    <tr><td>mр (формула (5.1))</td><td>${f(r.mp, 1)}</td></tr>
  </table>

  <h2>2. Состав конструкции (от внутренней поверхности к наружной)</h2>
  <table>
    <tr><th>№</th><th>Слой</th><th>δ, мм</th><th>λ, Вт/(м·°С)</th><th>R = δ/λ, м²·°С/Вт</th></tr>
    ${layerRows}
    <tr><td colspan="4"><b>Суммарное сопротивление слоёв ΣR</b></td><td style="text-align:right"><b>${f(sumLayers, 3)}</b></td></tr>
  </table>

  <h2>3. Нормируемое сопротивление теплопередаче (п. 5.2)</h2>
  <div class="formula">ГСОП = (tв − tот) · Zот = (${f(r.tin, 1)} − (${f(r.tot, 1)})) · ${f(r.zot, 0)} = ${f(r.gsop, 0)} °С·сут (формула (5.2))</div>
  <div class="formula">${rtrLine}</div>
  <div class="formula">Rнорм = mр · Rтр = ${f(r.mp, 1)} · ${f(r.rtr)} = <b>${f(r.rnorm)}</b> м²·°С/Вт (формула (5.1), mр = 1)</div>

  <h2>4. Фактическое сопротивление теплопередаче</h2>
  <div class="formula">R₀ усл = 1/αв + ΣR + 1/αн = ${f(1 / alphaIn, 3)} + ${f(sumLayers, 3)} + ${f(1 / alphaOut, 3)} = <b>${f(r.r0)}</b> м²·°С/Вт (Г.6)</div>
  ${uniRow || '<div class="formula">Неоднородности не учитывались: R₀пр = R₀ усл.</div>'}

  <h2>5. Подбор утеплителя</h2>
  ${r.ins
    ? (r.ins.exactMm <= 0.05
      ? '<div class="formula">Утеплитель не требуется: конструкция удовлетворяет Rнорм без слоя утеплителя.</div>'
      : `<div class="formula">δтр = <b>${f(r.ins.exactMm, 0)} мм</b> (λ = ${f(r.ins.lambda, 3)} Вт/(м·°С)); ближайшая стандартная толщина — <b>${r.ins.standardMm} мм</b>.</div>`)
    : '<div class="formula">Слой-утеплитель не выделен.</div>'}

  ${moisturePart}

  ${airPart}

  <h2>8. Вывод</h2>
  <div class="concl">${(r.pass && !r.condSurf)
    ? `R₀пр = ${f(r.rpr)} м²·°С/Вт удовлетворяет Rнорм = ${f(r.rnorm)} м²·°С/Вт (запас ${f(r.marginPct, 0)} %); температура внутренней поверхности не ниже точки росы. Поэлементные требования СП 50.13330.2024 выполняются${m && !m.error && !m.pass ? '; требуется пароизоляция по результатам влажностного расчёта (п. 6)' : ''}.`
    : `Конструкция НЕ удовлетворяет требованиям СП 50.13330.2024${!r.pass ? `: R₀пр = ${f(r.rpr)} &lt; Rнорм = ${f(r.rnorm)} м²·°С/Вт${r.ins && r.ins.exactMm > 0.05 ? ` (довести утеплитель до ${r.ins.standardMm} мм)` : ''}` : ''}${r.condSurf ? `; температура внутренней поверхности ниже точки росы (п. 5.7)` : ''}.`}
  </div>

  ${SRC}`;
}

/* Сводный отчёт по объекту (таблица Д.1 + kоб) */
export function buildProjectReport(state, items) {
  const date = new Date().toLocaleDateString('ru-RU');
  const city = state.city || '— (климат введён вручную)';
  const gsop = (state.tin - state.climate.tot) * state.climate.zot;

  const rows = items.map(({ c, r }, i) => {
    const name = esc(c.name);
    let rpr = null, verdict = '—';
    if (c.kind === 'layered') { rpr = r.rpr; verdict = r.pass && !r.condSurf ? VERDICT_OK : VERDICT_BAD; }
    else if (c.kind === 'ground') { rpr = r.rpr; verdict = r.pass ? VERDICT_OK : VERDICT_BAD; }
    else { rpr = r.rtr != null ? c.opening.r0 : null; verdict = r.pass ? VERDICT_OK : VERDICT_BAD; }
    return `<tr><td>${i + 1}</td><td>${name} (${esc(KINDS[c.kind] || '')})</td>
      <td style="text-align:right">${f(c.area, 1)}</td>
      <td style="text-align:right">${f(rpr)}</td>
      <td style="text-align:center">${verdict}</td></tr>`;
  }).join('');

  const frs = items.filter(({ c }) => c.area > 0).map(({ c, r }) => {
    const rpr = c.kind === 'layered' || c.kind === 'ground' ? r.rpr : c.opening.r0;
    return { name: c.name, area: c.area, rpr, nt: c.nt || 1 };
  }).filter(x => x.rpr > 0);
  const kob = frs.length && state.volume
    ? projectCalcSafe({ fragments: frs, volume: state.volume, gsop })
    : null;

  return `
  <h1>Сводный теплотехнический расчёт объекта</h1>
  <div class="r-sub">${esc(state.name || '')} · ${esc(city)} · дата: ${date}</div>

  <h2>1. Общие данные</h2>
  <table>
    <tr><th>Параметр</th><th>Значение</th></tr>
    <tr><td>Район строительства</td><td>${esc(city)}</td></tr>
    <tr><td>tн (пятидневка 0,92) / tот / Zот</td><td>${f(state.climate.t5, 1)} °С / ${f(state.climate.tot, 1)} °С / ${f(state.climate.zot, 0)} сут</td></tr>
    <tr><td>ГСОП</td><td>${f(gsop, 0)} °С·сут</td></tr>
    <tr><td>Категория здания</td><td>${esc(BUILDINGS[state.building].label)}</td></tr>
    <tr><td>tв / φв</td><td>${f(state.tin, 1)} °С / ${f(state.phi, 0)} %</td></tr>
  </table>

  <h2>2. Ограждающие конструкции (поэлементные требования)</h2>
  <table>
    <tr><th>№</th><th>Конструкция</th><th>A, м²</th><th>R₀пр, (м²·°С)/Вт</th><th>Вердикт</th></tr>
    ${rows}
  </table>

  <h2>3. Комплексное требование — удельная теплозащитная характеристика (прил. Д, п. 5.5)</h2>
  ${kob ? `
  <table>
    <tr><th>№</th><th>Фрагмент</th><th>Aф, м²</th><th>R₀пр, (м²·°С)/Вт</th><th>n·A/R, Вт/°С</th></tr>
    ${kob.fragments.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td style="text-align:right">${f(x.area, 1)}</td><td style="text-align:right">${f(x.rpr)}</td><td style="text-align:right">${f((x.nt || 1) * x.area / x.rpr, 1)}</td></tr>`).join('')}
  </table>
  <div class="formula">kоб = Σ(n_t·Aф/R₀пр)/Vот = ${f(kob.kOb, 3)} Вт/(м³·°С) (формула Д.1)</div>
  <div class="formula">kобтр = ${f(kob.kObTr, 3)} Вт/(м³·°С) (формулы (5.5)–(5.6) при Vот = ${f(kob.volume, 0)} м³, ГСОП = ${f(gsop, 0)})</div>
  <div class="concl">${kob.pass ? VERDICT_OK + ' Комплексное требование выполняется.' : VERDICT_BAD + ' Комплексное требование НЕ выполняется.'}</div>
  ${frs.length < state.constructions.length ? '<div class="formula">Примечание: у части конструкций не задана площадь — они не вошли в расчёт kоб.</div>' : ''}`
    : '<div class="formula">Для расчёта kоб задайте отапливаемый объём Vот и площади фрагментов. Совокупность фрагментов должна полностью замыкать оболочку здания (прил. Д).</div>'}

  <div class="src">Источники: СП 50.13330.2024 «СНиП 23-02-2003 Тепловая защита зданий» (таблицы 1–8; прил. А, Г, Д, Ж, Л, М); СП 131.13330.2025 «Строительная климатология» (таблицы 5.1, 7.1, 11.1). Расчёт выполнен программой «ТеплоРасчёт». Ключевые нормативные значения перед применением сверить с актуальными редакциями СП.</div>`;
}

function projectCalcSafe(input) {
  try {
    // избегаем циклического импорта: локальная реализация (5.5)–(5.6)
    const gsop = input.gsop, v = input.volume;
    const valid = input.fragments.filter(x => x.area > 0 && x.rpr > 0);
    const kOb = valid.reduce((s, x) => s + (x.nt || 1) * x.area / x.rpr, 0) / v;
    let kObTr = v <= 960
      ? 4.74 / (0.00013 * gsop + 0.61) / Math.cbrt(v)
      : (0.16 + 10 / Math.sqrt(v)) / (0.00013 * gsop + 0.61);
    kObTr = Math.max(kObTr, 8.5 / Math.sqrt(gsop));
    return { kOb, kObTr, volume: v, gsop, pass: kOb <= kObTr + 1e-9, fragments: valid };
  } catch {
    return null;
  }
}

/* Обёртка: самодостаточный HTML-документ для скачивания */
export function reportAsHtml(inner) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>Отчёт «ТеплоРасчёт»</title>
<style>
  body { font: 12.5px/1.5 "Times New Roman", Georgia, serif; color: #000; margin: 20px; }
  h1 { font-size: 17px; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 14px 0 6px; }
  .r-sub { text-align: center; color: #333; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  th, td { border: 1px solid #666; padding: 4px 6px; font-size: 12px; text-align: left; }
  th { background: #eee; }
  .formula { margin: 4px 0 8px; font-size: 12.5px; }
  .concl { font-weight: bold; margin-top: 8px; }
  .src { font-size: 11px; color: #444; margin-top: 14px; }
  @page { size: A4; margin: 14mm; }
</style></head><body>${inner}
<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
</body></html>`;
}

const SRC = '<div class="src">Источники: СП 50.13330.2024 «СНиП 23-02-2003 Тепловая защита зданий» (таблицы 1–8; прил. А, Г, Д, Ж, Л, М); СП 131.13330.2025 «Строительная климатология». Расчёт выполнен программой «ТеплоРасчёт». Ключевые значения перед применением сверить с актуальными редакциями СП.</div>';

/* Влагографика для печатной версии */
function vaporChartSvgStatic(m) {
  if (!m.curve || !m.curve.length) return '';
  const W = 380, H = 170, pad = 18;
  const eMax = Math.max(m.eIn, m.eNeg, ...m.curve.map(p => Math.max(p.e, p.E))) * 1.08;
  const y = v => pad + (1 - v / eMax) * (H - 2 * pad);
  const N = m.curve.length;
  const x = i => pad + (i / Math.max(N - 1, 1)) * (W - 2 * pad);
  const ptsE = m.curve.map((p, i) => `${x(i).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
  const ptsSat = m.curve.map((p, i) => `${x(i).toFixed(1)},${y(p.E).toFixed(1)}`).join(' ');
  let zone = '';
  m.curve.forEach((p, i) => {
    if (p.e > p.E && i > 0) zone += `<rect x="${x(i - 1).toFixed(1)}" y="${pad}" width="${(x(i) - x(i - 1)).toFixed(1)}" height="${H - 2 * pad}" fill="#eee"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${zone}
    <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#666"/>
    <polyline points="${ptsSat}" fill="none" stroke="#000" stroke-width="1.6"/>
    <polyline points="${ptsE}" fill="none" stroke="#666" stroke-width="1.6" stroke-dasharray="5 3"/>
    <text x="${pad + 2}" y="${pad + 10}" font-size="9">e — фактическая</text>
    <text x="${W - pad - 2}" y="${pad + 10}" font-size="9" text-anchor="end">E(t) — насыщение</text>
    <text x="${pad}" y="${H - 4}" font-size="9">внутри</text>
    <text x="${W - pad}" y="${H - 4}" font-size="9" text-anchor="end">наружу →</text>
  </svg>`;
}
