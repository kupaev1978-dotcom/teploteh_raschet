// UI «ТеплоРасчёта»: объект с несколькими конструкциями, расчёты, отчёты.
import { CITIES } from '../data/cities.js?v=5';
import { MATERIALS, MATERIAL_GROUPS } from '../data/materials.js?v=5';
import {
  calcAll, groundFloorCalc, moistureCalc, airPermCalc, openingCalc, projectCalc,
  CONSTRUCTIONS, BUILDINGS, ALPHA_IN_DEFAULT, ALPHA_IN_WINDOW, GHN_OPTIONS, RI_OPTIONS,
  humidityMode, operatingConditions, dewPoint,
} from './calc.js?v=5';
import { buildReport, buildProjectReport, reportAsHtml } from './report.js?v=5';
import { drawLayeredSVG, drawGroundSVG, drawOpeningSVG } from './draw.js?v=5';
import { buildConsPdf, buildProjectPdf, savePdf } from './pdf.js?v=5';

const $ = sel => document.querySelector(sel);
const el = id => document.getElementById(id);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state, hooks = {}, currentId = null;

const KIND_LABEL = {
  layered: 'Слоистая конструкция', ground: 'Пол по грунту',
  window: 'Окно', door: 'Дверь', gate: 'Ворота',
};
const DEFAULT_THICK = {
  'Утеплители': [50, 100, 150, 200], 'Кладка и камень': [120, 250, 380, 510, 640],
  'Бетоны и блоки': [200, 250, 300, 375, 400], 'Бетоны и растворы': [10, 15, 20, 30],
  'Дерево и плиты': [25, 50, 100, 200], 'Металлы и стекло': [1, 2, 3, 5, 10],
  'Пароизоляция и листовые': [], 'Засыпки': [100, 200, 300], 'Кровельные и изоляционные': [10, 20, 50],
};
const NODE_LIB = [
  { t: 'L', name: 'Межэтажный пояс в панельной стене', psi: 0.45 },
  { t: 'L', name: 'Перемычка ж/б над окном', psi: 0.4 },
  { t: 'L', name: 'Стык наружных панелей', psi: 0.3 },
  { t: 'L', name: 'Примыкание оконного блока (на 1 м периметра)', psi: 0.07 },
  { t: 'L', name: 'Железобетонный ригель/торец перекрытия на фасаде', psi: 0.35 },
  { t: 'L', name: 'Кладка с армированием сетками (каждый 3-й шов)', psi: 0.15 },
  { t: 'L', name: 'Опирание плит на стену (пояс)', psi: 0.3 },
  { t: 'P', name: 'Тарельчатый дюбель с полимерным анкером', chi: 0.02 },
  { t: 'P', name: 'Тарельчатый дюбель со стальным гвоздём', chi: 0.08 },
  { t: 'P', name: 'Крепление кронштейна НФС', chi: 0.1 },
];

const DEF_THICK_ONE = {
  'Утеплители': 100, 'Растворы и штукатурки': 20, 'Кладка и камень': 250,
  'Бетоны и блоки': 200, 'Дерево и плиты': 100, 'Бетоны и растворы': 20,
  'Металлы и стекло': 2, 'Пароизоляция и листовые': 0, 'Засыпки': 200,
  'Кровельные и изоляционные': 20,
};

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function openModal(html) {
  const m = el('modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
  return m.querySelector('.sheet');
}
function closeModal() { el('modal').classList.add('hidden'); el('modal').innerHTML = ''; }

function allMaterials() { return [...MATERIALS, ...hooks.getCustom()]; }
function allCities() { return [...CITIES, ...hooks.getCities()]; }

const cur = () => state.constructions.find(c => c.id === currentId) || state.constructions[0];

/* λ/R-характеристики слоя с учётом условий и переопределений */
function matOf(layer) { return layer.matId ? allMaterials().find(m => m.id === layer.matId) : null; }
function effLambda(layer, cond) {
  const m = matOf(layer);
  if (m && m.rvp != null) return null;      // пароизоляция: тепловое сопротивление не учитываем
  if (m) {
    const base = m.rvp != null ? null : (cond === 'A' ? m.la : m.lb);
    const ov = cond === 'A' ? layer.ovA : layer.ovB;
    return ov != null ? ov : base;
  }
  return cond === 'A' ? layer.la : layer.lb; // пользовательский материал
}
function effMu(layer) {
  const m = matOf(layer);
  if (layer.ovMu != null) return layer.ovMu;
  if (m) return m.mu ?? null;
  return layer.mu ?? null;
}
function effDw(layer) { const m = matOf(layer); return m ? m.dw ?? null : null; }
function effRvp(layer) { const m = matOf(layer); return m && m.rvp != null ? m.rvp : (layer.rvp ?? null); }

function autoCond() {
  const mode = humidityMode(state.tin, state.phi);
  return operatingConditions(mode, state.climate.zone);
}
function activeCond() { return state.climate?.zone == null && state.advCondAuto?.() ? 'B' : null; }

function gsopProject() {
  const b = BUILDINGS[state.building];
  const tot = b.period10 && state.climate.tot10 != null ? state.climate.tot10 : state.climate.tot;
  const zot = b.period10 && state.climate.zot10 != null ? state.climate.zot10 : state.climate.zot;
  return (state.tin - tot) * zot;
}

/* расчёт одной конструкции (без кеширования — дёшево) */
function computeC(cons) {
  const cond = cons.adv.cond === 'auto' ? autoCond() : cons.adv.cond;
  if (cons.kind === 'layered') {
    const layersCalc = cons.layers.map(l => {
      const lam = effLambda(l, cond);
      const m = matOf(l);
      return {
        name: l.name, d: (l.rvp != null || m?.vent) ? 0 : Number(l.d),
        lambda: lam || 0.0001, isIns: !!l.isIns, group: l.group || m?.g,
        mu: effMu(l), dw: effDw(l), rho: m?.rhoNum ?? m?.rho ?? l.rho, rvp: effRvp(l),
        vent: !!m?.vent, ri: l.ri || 0,
      };
    });
    const res = calcAll({
      climate: state.climate, tin: state.tin, phi: state.phi,
      building: state.building, construction: cons.construction,
      layers: layersCalc,
      alphaIn: Number(cons.adv.alphaIn) || ALPHA_IN_DEFAULT,
      alphaOut: cons.adv.alphaOut ? Number(cons.adv.alphaOut) : null,
      cond, uni: cons.uni, area: cons.area,
    });
    // влажностный расчёт и воздухопроницание
    res.moisture = moistureCalc({
      layers: layersCalc, r0: res.r0, climate: state.climate,
      tin: state.tin, phi: state.phi, construction: cons.construction,
      alphaIn: Number(cons.adv.alphaIn) || ALPHA_IN_DEFAULT,
    });
    res.air = airPermCalc({
      ris: layersCalc.map(l => l.ri), H: state.height,
      t5: state.climate.t5, v1: state.climate.v1, tin: state.tin,
      ghn: cons.airGhn ?? 0.5,
    });
    return res;
  }
  if (cons.kind === 'ground') {
    const g = cons.ground;
    const res = groundFloorCalc({ a: g.a, b: g.b, h: g.h, dIns: (g.dIns || 0) / 1000, lambdaIns: g.lambda, lambdaGr: g.lambdaGr });
    // нормируемое Rтр для полов по грунту — графа чердачных перекрытий (таблица 3)
    const norm = calcAll({
      climate: state.climate, tin: state.tin, phi: state.phi,
      building: state.building, construction: 'attic',
      layers: [], cond,
    });
    res.rnorm = norm.rnorm; res.gsop = norm.gsop;
    res.pass = res.rpr >= res.rnorm - 1e-9;
    res.marginPct = (res.rpr / res.rnorm - 1) * 100;
    return res;
  }
  // opening: window | door | gate
  const o = cons.opening;
  return openingCalc({
    kind: cons.kind, s: o.s, r0: o.r0, building: state.building,
    gsop: gsopProject(), t5: state.climate.t5, tin: state.tin,
    dtnWall: BUILDINGS[state.building]?.dtn?.wall ?? 4,
    alphaIn: Number(cons.adv?.alphaIn) || ALPHA_IN_DEFAULT,
  });
}

/* ——— навигация ——— */
function showProject() {
  currentId = null;
  el('view-project').classList.remove('hidden');
  el('view-construction').classList.add('hidden');
  el('btn-back').classList.add('hidden');
  el('hdr-title').textContent = 'ТеплоРасчёт';
  renderProject();
  renderConstrList();
  renderKob();
  hooks.save();
}
function showConstruction(id) {
  currentId = id;
  el('view-project').classList.add('hidden');
  el('view-construction').classList.remove('hidden');
  el('btn-back').classList.remove('hidden');
  const c = cur();
  el('hdr-title').textContent = c.name || KIND_LABEL[c.kind];
  renderConstruction();
  hooks.save();
}

/* ——— экран объекта ——— */
function setVal(id, v) { // не затираем значение поля под курсором пользователя
  const x = el(id);
  if (x && document.activeElement !== x) x.value = v;
}
function renderProject() {
  setVal('p-name', state.name);
  setVal('city-input', state.city || '');
  renderCityHint();
  setVal('t5', state.climate.t5);
  setVal('tot', state.climate.tot);
  setVal('zot', state.climate.zot);
  setVal('tot10', state.climate.tot10 ?? '');
  setVal('zot10', state.climate.zot10 ?? '');
  el('zone').value = state.climate.zone ?? '';
  el('building').value = state.building;
  setVal('tin', state.tin);
  setVal('phi', state.phi);
  setVal('p-volume', state.volume ?? '');
  setVal('p-height', state.height ?? '');
  el('phi-hint').textContent = 'Расчётная влажность для точки росы (п. 5.7): жилые, детские, образовательные и медицинские — 55 %; прочие общественные — 50 %.';
}

function renderCityHint() {
  const h = el('city-hint');
  if (!state.city) { h.classList.add('hidden'); return; }
  const c = state.climate;
  h.classList.remove('hidden');
  h.innerHTML = `<b>${esc(state.city)}</b> · t⁵ = ${fmt(c.t5, 1)} °С · tот/Zот (≤8 °С) = ${fmt(c.tot, 1)} °С / ${fmt(c.zot, 0)} сут` +
    (c.tot10 != null ? ` · ≤10 °С: ${fmt(c.tot10, 1)} °С / ${fmt(c.zot10, 0)} сут` : '') +
    ` · зона: <b>${c.zone ? esc(c.zone) : 'не определена → условия Б'}</b>` +
    (c.tm ? ' · влажностный расчёт доступен' : ' · <i>месячные данные отсутствуют</i>') +
    (state.climateManual ? ' · <i>изменено вручную</i>' : '') +
    ` <br><span style="opacity:.7">СП 131.13330.2025, табл. 5.1 · зона — прил. А СП 50.13330.2024 (приближение)</span>`;
}

function renderConstrList() {
  const ul = el('constr-list');
  ul.innerHTML = state.constructions.map(c => {
    let badge = '—', sub = '';
    try {
      const r = computeC(c);
      if (c.kind === 'layered') {
        badge = (r.pass && !r.condSurf) ? '✓' : '✗';
        sub = `R₀пр = ${fmt(r.rpr)} / Rнорм = ${fmt(r.rnorm)} м²·°С/Вт`;
      } else if (c.kind === 'ground') {
        badge = r.pass ? '✓' : '✗';
        sub = `Rпр = ${fmt(r.rpr)} / Rнорм = ${fmt(r.rnorm)} м²·°С/Вт`;
      } else {
        badge = r.pass ? '✓' : '✗';
        sub = `R₀ = ${fmt(r0of(c))} / Rтр = ${fmt(r.rtr)} м²·°С/Вт`;
      }
    } catch { badge = '?'; }
    return `<li class="layer ${badge === '✓' ? '' : badge === '✗' ? 'fail-card' : ''}" data-id="${c.id}">
      <div class="layer-top">
        <div class="layer-main" data-open="${c.id}" style="cursor:pointer">
          <div class="layer-name">${badge} ${esc(c.name)}</div>
          <div class="layer-sub">${esc(KIND_LABEL[c.kind])} · ${esc(sub)}</div>
        </div>
        <div class="layer-actions"><button data-del="${c.id}" title="Удалить">✕</button></div>
      </div>
    </li>`;
  }).join('');
}
function r0of(c) { return c.opening?.r0 ?? 0; }

function renderKob() {
  const box = el('kob-box');
  const gsop = gsopProject();
  const frs = state.constructions.filter(c => c.area > 0).map(c => {
    const r = computeC(c);
    const rpr = c.kind === 'layered' || c.kind === 'ground' ? r.rpr : (r.rtr !== undefined ? r0of(c) : null);
    return { name: c.name, area: c.area, rpr, nt: c.nt || 1, ok: rpr != null && rpr > 0 };
  }).filter(f => f.ok);
  if (!state.volume || !frs.length) {
    box.innerHTML = `<div class="box">Укажите отапливаемый объём Vот и площади фрагментов в карточках конструкций — здесь появится расчёт kоб по прил. Д и сравнение с нормируемой по (5.5)–(5.6).<br><small>Фрагменты с заданной площадью: ${frs.length} из ${state.constructions.length}</small></div>`;
    return;
  }
  const res = projectCalc({ fragments: frs, volume: Number(state.volume), gsop });
  const rows = res.fragments.map((f, i) =>
    `<tr><td>${i + 1}</td><td>${esc(f.name)}</td><td style="text-align:right">${fmt(f.area, 1)}</td><td style="text-align:right">${fmt(f.rpr)}</td><td style="text-align:right">${fmt((f.nt || 1) * f.area / f.rpr, 1)}</td></tr>`).join('');
  box.innerHTML = `<div class="box ${res.pass ? 'ins' : 'warn'}">
    <b>${res.pass ? '✓ kоб = ' : '✗ kоб = '}${fmt(res.kOb, 3)} Вт/(м³·°С)</b>
    · нормируемая kтроб = ${fmt(res.kObTr, 3)} Вт/(м³·°С) — ${res.pass ? 'комплексное требование выполняется' : 'не выполняется'}
    <br>Годовой расход тепла на отопление (Б.12, оболочка): <b>${fmt(res.qYear, 0)} кВт·ч/год</b>; при kоб = kобтр было бы ${fmt(res.qYearTr, 0)} кВт·ч/год (эффект утепления ${fmt(Math.max(res.qYearTr - res.qYear, 0), 0)} кВт·ч/год)
    <table class="mini-table" style="margin-top:8px">
      <tr><th>№</th><th>Фрагмент</th><th>A, м²</th><th>R₀пр</th><th>n·A/R, Вт/°С·10⁻³</th></tr>${rows}
    </table>
    <small>ГСОП = ${fmt(gsop, 0)} °С·сут · Vот = ${fmt(res.volume, 0)} м³ · формулы Д.1 и (5.5)–(5.6)</small>
  </div>`;
}

/* ——— экран конструкции ——— */
function renderConstruction() {
  const c = cur();
  setVal('c-name', c.name);
  setVal('c-area', c.area ?? '');
  el('c-area-wrap').classList.toggle('hidden', c.kind !== 'layered' && c.kind !== 'ground');
  const sig = c.kind + '|' + c.construction;
  if (renderConstruction._sig !== sig) {
    renderKindFields();
    renderConstruction._sig = sig;
  }
  const isLayered = c.kind === 'layered';
  el('c-layers-card').classList.toggle('hidden', !isLayered);
  el('c-uni-card').classList.toggle('hidden', !isLayered);
  if (isLayered) { renderLayers(); renderUni(); }
  renderResults();
}

function renderKindFields() {
  const c = cur();
  const wrap = el('c-kind-fields');
  if (c.kind === 'layered') {
    wrap.innerHTML = `
      <div class="field"><span class="field-label">Тип конструкции</span>
        <div class="seg" id="c-seg">${Object.entries(CONSTRUCTIONS).map(([k, v]) =>
          `<button data-construction="${k}" class="${c.construction === k ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
      </div>
      <details class="sub" ${'' /* открыт по клику */}>
        <summary>Дополнительные параметры (α, условия эксплуатации)</summary>
        <div class="row2">
          <label>αв, Вт/(м²·°С) <input id="c-alphaIn" type="number" step="0.1"></label>
          <label>αн, Вт/(м²·°С), табл. 6
            <select id="c-alphaOut">
              <option value="auto">авто</option>
              <option value="23">23 — стены, покрытия</option>
              <option value="17">17 — подвал с наружным воздухом</option>
              <option value="12">12 — чердачные, подвал со свет. проёмами</option>
              <option value="6">6 — подвал без вентилирования</option>
            </select>
          </label>
          <label>Условия экспл.
            <select id="c-cond">
              <option value="auto">авто (А/Б)</option>
              <option value="A">А</option>
              <option value="B">Б</option>
            </select>
          </label>
        </div>
      </details>`;
    wrap.querySelector('#c-alphaIn').value = c.adv.alphaIn;
    wrap.querySelector('#c-alphaOut').value = c.adv.alphaOut || 'auto';
    wrap.querySelector('#c-cond').value = c.adv.cond;
  } else if (c.kind === 'ground') {
    const g = c.ground;
    wrap.innerHTML = `
      <div class="row2">
        <label>Длина пола a, м <input id="g-a" type="number" step="0.5"></label>
        <label>Ширина пола b, м <input id="g-b" type="number" step="0.5"></label>
        <label>Глубина стен в грунте h, м <input id="g-h" type="number" step="0.1"></label>
        <label>Толщина утеплителя под полом δ, мм <input id="g-d" type="number" step="10"></label>
        <label>λ утеплителя, Вт/(м·°С) <input id="g-lam" type="number" step="0.005"></label>
        <label>λ грунта, Вт/(м·°С) <input id="g-lgr" type="number" step="0.1"></label>
      </div>
      <p class="hint" style="margin:0">Зоны 2 м по прил. Г.7 (таблица Г.3: R базовые 2,1 / 3,8 / 5,2 / 7,7); при стенах в грунте отсчёт от эффективной полосы шириной h/2. λ грунта по умолчанию 1,6 Вт/(м·°С).</p>`;
    wrap.querySelector('#g-a').value = g.a;
    wrap.querySelector('#g-b').value = g.b;
    wrap.querySelector('#g-h').value = g.h;
    wrap.querySelector('#g-d').value = g.dIns;
    wrap.querySelector('#g-lam').value = g.lambda;
    wrap.querySelector('#g-lgr').value = g.lambdaGr;
  } else {
    const o = c.opening;
    wrap.innerHTML = `
      <div class="row2">
        <label>Площадь проёма S, м² <input id="o-s" type="number" step="0.1"></label>
        <label>Приведённое R₀ по паспорту, м²·°С/Вт <input id="o-r0" type="number" step="0.01"></label>
      </div>
      <p class="hint" style="margin:0">${c.kind === 'window'
        ? 'Нормируемое Rтр — таблица 3 (графа «Окна»); дополнительно проверяется температура остекления ≥ 3 °С (п. 5.7).'
        : c.kind === 'door' ? 'Нормируемое Rтр — п. 5.4: не менее 0,6·Rстен, где Rстен = (tв − tн)/(Δtн·αв).'
        : 'Нормируемое Rтр — таблица 8 (по площади S и ГСОП).'}</p>`;
    wrap.querySelector('#o-s').value = o.s;
    wrap.querySelector('#o-r0').value = o.r0;
  }
}

function renderLayers() {
  const c = cur();
  const ul = el('layers');
  const cond = c.adv.cond === 'auto' ? autoCond() : c.adv.cond;
  if (!c.layers.length) { ul.innerHTML = '<li class="layer"><div class="layer-sub">Слоёв пока нет.</div></li>'; return; }
  ul.innerHTML = c.layers.map((l, i) => {
    const rvp = effRvp(l);
    const lam = effLambda(l, cond);
    const mu = effMu(l);
    const isVent = matOf(l)?.vent;
    const r = rvp != null ? null : (lam ? (l.d / 1000) / lam : null);
    const bits = [];
    if (isVent) bits.push('вентилируемая прослойка (R = 0)');
    else if (rvp != null) bits.push(`Rп = ${fmt(rvp, 2)} (пароизоляция)`);
    else {
      bits.push(`δ = ${fmt(l.d, 0)} мм · λ = ${fmt(lam, 3)} (${cond})`);
      if (r != null) bits.push(`R = ${fmt(r, 3)}`);
      if (mu != null) bits.push(`μ = ${fmt(mu, 3)}`);
      if (l.ri) bits.push(`Rи = ${fmt(l.ri, 1)}`);
    }
    return `<li class="layer ${l.isIns ? 'ins' : ''}" data-i="${i}">
      <div class="layer-top">
        <div class="layer-main">
          <div class="layer-name">${esc(l.name)}${l.isIns ? ' <span style="color:var(--accent)">· утеплитель</span>' : ''}</div>
          <div class="layer-sub">${bits.join(' · ')}</div>
        </div>
        <div class="layer-actions">
          <button data-act="up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" ${i === c.layers.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-act="edit">✎</button>
          <button data-act="del">✕</button>
        </div>
      </div>
    </li>`;
  }).join('');
}

function uniElemsHtml(u) {
  return (u.elems || []).map((e, i) =>
    `<div class="saved-item"><div class="s-main"><div class="s-name">${esc(e.name || (e.t === 'L' ? 'Линейное' : 'Точечное'))}</div>
    <div class="s-sub">${e.t === 'L' ? `Ψ = ${fmt(e.psi, 3)} Вт/(м·°С) · L = ${fmt(e.L, 1)} м` : `χ = ${fmt(e.chi, 2)} Вт/°С · N = ${fmt(e.n, 0)} шт`}</div></div>
    <button class="btn danger" data-uni-del="${i}" style="padding:6px 10px">Удалить</button></div>`).join('');
}

function renderUni() {
  const c = cur();
  const u = c.uni;
  const box = el('uni-box');
  const focusIn = box.contains(document.activeElement);
  if (renderUni._mode === u.mode && focusIn) {
    const listEl = box.querySelector('#uni-elems');
    if (listEl) listEl.innerHTML = uniElemsHtml(u);
    return;
  }
  renderUni._mode = u.mode;
  const elemsHtml = uniElemsHtml(u);
  box.innerHTML = `
    <label class="field"><span class="field-label">Учёт неоднородностей</span>
      <select id="uni-mode">
        <option value="none" ${u.mode === 'none' ? 'selected' : ''}>не учитывать (однородная, по глади)</option>
        <option value="r" ${u.mode === 'r' ? 'selected' : ''}>коэффициент однородности r (Г.4)</option>
        <option value="elements" ${u.mode === 'elements' ? 'selected' : ''}>поэлементно: Ψ и χ (Г.1)</option>
      </select>
    </label>
    ${u.mode === 'r' ? `<label class="field"><span class="field-label">Коэффициент теплотехнической однородности r</span>
      <input id="uni-r" type="number" step="0.01" min="0.3" max="1" value="${u.r}"></label>` : ''}
    ${u.mode === 'elements' ? `
      ${c.area > 0 ? '' : '<div class="box warn" style="margin-bottom:8px">Укажите площадь фрагмента выше — протяжённости L и количества N задаются на весь фрагмент.</div>'}
      <div id="uni-elems">${elemsHtml || '<div class="mat-group">Неоднородности не добавлены</div>'}</div>
      <div class="btn-row" style="grid-template-columns:1fr 1fr 1fr">
        <button id="uni-add-l" class="btn">+ Линейное</button>
        <button id="uni-add-p" class="btn">+ Точечное</button>
        <button id="uni-add-lib" class="btn">+ Узел из СП</button>
      </div>` : ''}
    <p class="hint" style="margin:8px 0 0">R₀пр = r·R₀ усл (Г.4) либо R₀пр = 1/(1/R₀ усл + ΣΨ·l + Σχ·n) (Г.1). Типовые значения: межэтажный пояс панельной стены Ψ ≈ 0,2–0,5 Вт/(м·°С); стыки плит Ψ ≈ 0,1–0,3; кронштейны НФС χ ≈ 0,3–0,8 Вт/°С на 1 м².</p>`;
}

/* ——— результаты конструкции ——— */
function renderResults() {
  const c = cur();
  const r = computeC(c);
  const pre = [];
  if (c.kind === 'layered') {
    if (!c.layers.length) pre.push('Добавьте хотя бы один слой.');
    c.layers.forEach(l => { if (!(Number(l.d) > 0) && effRvp(l) == null) pre.push(`Задайте толщину слоя «${l.name}».`); });
  }

  const v = el('verdict');
  if (c.kind === 'ground') {
    // ——— пол по грунту ———
    v.className = 'verdict ' + (r.pass ? 'pass' : 'fail');
    v.innerHTML = `<div class="v-title">${r.pass ? '✓ Требования выполняются' : '✗ Требования НЕ выполняются'}</div>
      <div class="v-sub">R₀пр = ${fmt(r.rpr)} ${r.pass ? '≥' : '&lt;'} Rнорм = ${fmt(r.rnorm)} м²·°С/Вт · запас ${fmt(r.marginPct, 0)}%</div>`;
    el('metrics').innerHTML = [
      { v: fmt(r.gsop, 0), l: 'ГСОП, °С·сут' },
      { v: fmt(r.rnorm), l: 'Rнорм (графа «полов по грунту»)' },
      { v: fmt(r.rpr), l: 'R₀пр (Г.15)', cls: r.pass ? 'ok' : 'bad' },
      { v: fmt(r.marginPct, 0) + '<small> %</small>', l: 'запас', cls: r.pass ? 'ok' : 'bad' },
      { v: fmt(r.zones[0].r, 2), l: 'R зоны I' },
      { v: fmt(r.w, 2) + '<small> м</small>', l: 'эффективная полоса h/2' },
    ].map(t => `<div class="metric ${t.cls || ''}"><div class="m-v">${t.v}</div><div class="m-l">${t.l}</div></div>`).join('');
    el('insulation').innerHTML = `<div class="box ins">🧊 Зоны (прил. Г.7): ${r.zones.map(z =>
      `${z.name}: ${fmt(z.area, 1)} м² · R = ${fmt(z.r, 2)}`).join(' · ')} · периметр ${fmt(r.L, 1)} м</div>`;
    el('warnings').innerHTML = '';
    el('moisture').innerHTML = '';
    el('airperm').innerHTML = '';
    el('chart').innerHTML = '';
    return;
  }
  if (c.kind !== 'layered') {
    // ——— проём (окно/дверь/ворота) ———
    el('draw').innerHTML = drawOpeningSVG(c, r);
    v.className = 'verdict ' + (r.pass ? 'pass' : 'fail');
    v.innerHTML = `<div class="v-title">${r.pass ? '✓ Требования выполняются' : '✗ Требования НЕ выполняются'}</div>
      <div class="v-sub">${esc(KIND_LABEL[c.kind])}: R₀ = ${fmt(r0of(c))} ${r.pass ? '≥' : '&lt;'} Rтр = ${fmt(r.rtr)} м²·°С/Вт · ${esc(r.src)}${r.tGlass != null ? `<br>Температура внутренней поверхности остекления: ${fmt(r.tGlass, 1)} °С (норма ≥ ${r.tMin} °С, п. 5.7)` : ''}</div>`;
    el('metrics').innerHTML = [
      { v: fmt(gsopProject(), 0), l: 'ГСОП, °С·сут' },
      { v: fmt(r.rtr), l: 'Rтр проёма' },
      { v: fmt(r0of(c)), l: 'R₀ по паспорту', cls: r.pass ? 'ok' : 'bad' },
      ...(r.tGlass != null ? [{ v: fmt(r.tGlass, 1) + '<small> °С</small>', l: 't остекления (норма ≥ ' + r.tMin + ')', cls: r.glassOk ? 'ok' : 'bad' }] : []),
    ].map(t => `<div class="metric ${t.cls || ''}"><div class="m-v">${t.v}</div><div class="m-l">${t.l}</div></div>`).join('');
    el('insulation').innerHTML = '';
    el('warnings').innerHTML = '';
    el('moisture').innerHTML = '';
    el('airperm').innerHTML = '';
    el('chart').innerHTML = '';
    return;
  }
  // ——— слоистая конструкция ———
  {
    if (pre.length) {
      v.className = 'verdict fail';
      v.innerHTML = `<div class="v-title">✗ Расчёт невозможен</div><div class="v-sub">${pre.map(esc).join(' ')}</div>`;
    } else {
      const allOk = c.kind === 'layered' ? (r.pass && !r.condSurf) : r.pass;
      v.className = 'verdict ' + (allOk ? 'pass' : 'fail');
      const rLine = c.kind === 'layered'
        ? `R₀пр = ${fmt(r.rpr)} ${r.pass ? '≥' : '&lt;'} Rнорм = ${fmt(r.rnorm)} м²·°С/Вт (mр = 1) · запас ${fmt(r.marginPct, 0)}%`
        : `R₀пр = ${fmt(r.rpr)} ${r.pass ? '≥' : '&lt;'} Rнорм = ${fmt(r.rnorm)} м²·°С/Вт · запас ${fmt(r.marginPct, 0)}%`;
      const san = c.kind === 'layered'
        ? `<div class="v-sub">Санитарное (5.7): tв.п = ${fmt(r.tInSurf, 1)} ${r.condSurf ? '&lt;' : '≥'} tр = ${fmt(r.td, 1)} °С — ${r.condSurf ? 'конденсат' : 'выполняется'}</div>` : '';
      v.innerHTML = `<div class="v-title">${allOk ? '✓ Требования выполняются' : '✗ Требования НЕ выполняются'}</div>
        <div class="v-sub">${rLine}</div>${san}`;
    }
    el('draw').innerHTML = c.kind === 'ground' ? drawGroundSVG(c, r) : drawLayeredSVG(c, r);
    // метрики
    const tiles = pre.length ? [] : [
      { v: fmt(r.gsop, 0), l: `ГСОП, °С·сут (≤${BUILDINGS[state.building].period10 ? '10' : '8'} °С)` },
      { v: fmt(r.rtr), l: 'Rтр (таблица 3)' },
      { v: fmt(r.rnorm), l: 'Rнорм = mр·Rтр' },
      { v: fmt(c.kind === 'layered' ? r.r0 : r.rpr), l: c.kind === 'layered' ? 'R₀ усл (по глади)' : 'R₀пр' },
      { v: fmt(r.rpr), l: 'R₀пр (приведённое)', cls: r.pass ? 'ok' : 'bad' },
      { v: fmt(r.marginPct, 0) + '<small> %</small>', l: 'запас к Rнорм', cls: r.pass ? 'ok' : 'bad' },
      ...(c.kind === 'layered' ? [
        { v: fmt(r.tInSurf, 1) + '<small> °С</small>', l: 't внутр. поверхности', cls: r.condSurf ? 'bad' : 'ok' },
        { v: fmt(r.td, 1) + '<small> °С</small>', l: 'точка росы' },
        { v: fmt(r.tin - r.dtn, 1) + '<small> °С</small>', l: 'tв − Δtн (5.4)', cls: r.surfDeltaOk ? 'ok' : 'bad' },
      ] : []),
    ];
    el('metrics').innerHTML = tiles.map(t =>
      `<div class="metric ${t.cls || ''}"><div class="m-v">${t.v}</div><div class="m-l">${t.l}</div></div>`).join('');

    // утеплитель
    if (c.kind === 'layered') {
      const box = el('insulation');
      if (!pre.length && r.ins) {
        let txt;
        if (r.ins.exactMm <= 0.05) txt = `Конструкция проходит <b>без учёта утеплителя</b>.`;
        else {
          txt = `Требуемая толщина утеплителя (λ = ${fmt(r.ins.lambda, 3)}): <b>${fmt(r.ins.exactMm, 0)} мм</b> → стандартная <b>${r.ins.standardMm} мм</b>.`;
          const curD = r.layersR.find(x => x.isIns).d;
          txt += r.ins.addMm > 0 ? `<br>Принято ${fmt(curD, 0)} мм — не хватает ${fmt(r.ins.addMm, 0)} мм.` : `<br>Принятая толщина достаточна.`;
        }
        box.innerHTML = `<div class="box ins">🧊 ${txt}</div>`;
      } else if (!pre.length && !r.pass) {
        const lam = r.cond === 'A' ? 0.040 : 0.044;
        const need = (r.rnorm / (r.uni.mode === 'r' ? r.uni.r : 1) - r.r0) * lam * 1000;
        box.innerHTML = `<div class="box ins">🧊 Добавьте слой-утеплитель: потребуется <b>≈ ${fmt(Math.max(need, 0), 0)} мм</b> минваты (λ = ${fmt(lam, 3)} при усл. ${r.cond}).</div>`;
      } else box.innerHTML = '';
    } else el('insulation').innerHTML = '';

    // предупреждения
    const warns = [];
    if (r.condSurf) warns.push(`П. 5.7: tв.п = ${fmt(r.tInSurf, 1)} °С ниже точки росы ${fmt(r.td, 1)} °С — конденсат.`);
    for (const b of r.condInside) warns.push(`Конденсация в толще на границе «${esc(b.label)}»: t = ${fmt(b.t, 1)} °С &lt; tр.`);
    if (!r.surfDeltaOk) warns.push(`Формула (5.4): tв.п = ${fmt(r.tInSurf, 1)} °С &lt; tв − Δtн = ${fmt(r.tin - r.dtn, 1)} °С.`);
    if (r.uni.mode === 'r' && r.uni.r >= 1) warns.push('Коэффициент однородности r ≥ 1 — проверьте значение (обычно 0,6–0,95).');
    el('warnings').innerHTML = warns.length ? `<div class="box warn">⚠<ul>${warns.map(w => `<li>${w}</li>`).join('')}</ul></div>` : '';

    // влажностный расчёт
    el('moisture').innerHTML = moistureBox(r, c);
    // воздухопроницание
    el('airperm').innerHTML = airBox(r, c);
    // график
    renderChart(r);
  }
}

function moistureBox(r, c) {
  const m = r.moisture;
  if (!m || m.error) {
    return `<div class="box">💧 <b>Влажностный расчёт (раздел 8)</b>: ${m?.error || 'недоступен'}.</div>`;
  }
  const pl = m.plane;
  const planeTxt = pl.atOuter
    ? 'наружная поверхность'
    : `слой ${pl.layerIdx + 1} «${esc(r.layersR[pl.layerIdx]?.name || '')}»`;
  const rows = [
    `Rп (внутр. слои до плоскости) = ${fmt(m.rp, 3)} · Rп.н = ${fmt(m.rpN, 3)} (м²·ч·Па)/мг`,
    `Периоды: зима ${m.z1} мес · весенне-осенний ${m.z2} мес · лето ${m.z3} мес · влагонакопление Z₀ = ${m.z0} сут`,
    `tн,отр = ${fmt(m.tNeg, 1)} °С · eн,отр = ${fmt(m.eNeg, 0)} Па · eн = ${fmt(m.eYear, 0)} Па · eв = ${fmt(m.eIn, 0)} Па`,
    `E = ${fmt(m.E, 0)} Па · E₀ = ${fmt(m.E0, 0)} Па · η = ${fmt(m.eta, 4)}`,
    `Rп1тр (8.1) = ${fmt(m.rp1, 3)}` + (m.rp2 != null ? ` · Rп2тр (8.2) = ${fmt(m.rp2, 3)}` : '') + (m.dwNote ? ` — ${m.dwNote}` : ''),
    m.atticReq != null ? `Для чердачного перекрытия также Rптр (8.6) = ${fmt(m.atticReq, 3)} (м²·ч·Па)/мг` : null,
  ].filter(Boolean).map(x => `<li>${x}</li>`).join('');
  return `<div class="box ${m.pass ? 'ins' : 'warn'}">💧 <b>Влажностный расчёт (раздел 8): ${m.pass ? '✓ Rп = ' + fmt(m.rp, 3) + ' ≥ Rп.тр = ' + fmt(m.rRequired, 3) : '✗ Rп = ' + fmt(m.rp, 3) + ' &lt; Rп.тр = ' + fmt(m.rRequired, 3) + ' — требуется пароизоляция'}</b>
    <br><small>Плоскость максимального увлажнения: ${planeTxt}${pl.how ? ' (' + esc(pl.how) + ')' : ''}</small>
    <ul style="font-size:12.5px;color:var(--muted);margin:6px 0 0;padding-left:16px">${rows}</ul></div>`
    + vaporChartSVG(m);
}

/* ——— влагографика: e и E по толщине ——— */
function vaporChartSVG(m) {
  if (!m.curve || !m.curve.length) return '';
  const W = 340, H = 170, pad = 18;
  const eMax = Math.max(m.eIn, m.eNeg, ...m.curve.map(p => Math.max(p.e, p.E))) * 1.08;
  const y = v => pad + (1 - v / eMax) * (H - 2 * pad);
  const N = m.curve.length;
  const x = i => pad + (i / Math.max(N - 1, 1)) * (W - 2 * pad);
  const ptsE = m.curve.map((p, i) => `${x(i).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
  const ptsSat = m.curve.map((p, i) => `${x(i).toFixed(1)},${y(p.E).toFixed(1)}`).join(' ');
  // зона конденсации: e выше кривой насыщения
  let zones = '';
  m.curve.forEach((p, i) => {
    if (p.e > p.E && i > 0) {
      const prev = m.curve[i - 1];
      zones += `<rect x="${x(i - 1).toFixed(1)}" y="${pad}" width="${(x(i) - x(i - 1)).toFixed(1)}" height="${H - 2 * pad}" fill="var(--bad)" opacity="0.12"/>`;
      void prev;
    }
  });
  const dots = m.curve.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.e).toFixed(1)}" r="2" fill="var(--accent)"><title>e = ${fmt(p.e, 0)} Па</title></circle>` +
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.E).toFixed(1)}" r="2" fill="var(--bad)"><title>E = ${fmt(p.E, 0)} Па при ${fmt(p.tx, 1)} °С</title></circle>`).join('');
  return `<div class="chart-title">Влагографика: упругость пара e (синяя) и давление насыщения E(t) (красная) по толщине; красная заливка — зона возможной конденсации</div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Влагографика">
    <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="var(--border)"/>
    ${zones}
    <polyline points="${ptsSat}" fill="none" stroke="var(--bad)" stroke-width="1.6"/>
    <polyline points="${ptsE}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    ${dots}
    <text x="${pad + 2}" y="${pad + 10}" font-size="9" fill="var(--accent)">e — фактическая</text>
    <text x="${W - pad - 2}" y="${pad + 10}" font-size="9" text-anchor="end" fill="var(--bad)">E(t) — насыщение</text>
    <text x="${pad}" y="${H - 4}" font-size="9" fill="var(--muted)">внутри</text>
    <text x="${W - pad}" y="${H - 4}" font-size="9" text-anchor="end" fill="var(--muted)">наружу →</text>
  </svg>`;
}

function airBox(r, c) {
  const a = r.air;
  if (!a) return '';
  return `<div class="box ${a.pass ? 'ins' : 'warn'}">💨 <b>Воздухопроницание (раздел 7): ${a.pass ? '✓' : '✗'} Rи = ${fmt(a.ri, 1)} ${a.pass ? '≥' : '&lt;'} Rитр = ${fmt(a.riTr, 1)} (м²·ч·Па)/кг</b>
    <br><small>Δp = ${fmt(a.dp, 0)} Па (7.2: H = ${fmt(a.H ?? 0, 0)} м, tн = ${fmt(r.climate.t5, 1)} °С, v = ${fmt(r.climate.v1 ?? 0, 1)} м/с) · Gн = ${fmt(a.ghn, 1)} кг/(м²·ч) (таблица 10)</small>
    <br><small>Задайте Rи слоёв в редакторе слоёв (прил. Л) и нормируемую Gн:</small>
    <select id="c-ghn" style="margin-top:6px">${GHN_OPTIONS.map(([v, l]) =>
      `<option value="${v}" ${(c.airGhn ?? 0.5) === v ? 'selected' : ''}>${v} — ${esc(l)}</option>`).join('')}</select></div>`;
}

/* ——— график температур ——— */
function renderChart(r) {
  if (r.kind !== undefined && r.moisture === undefined) { el('chart').innerHTML = ''; return; }
  const W = 340, H = 175, pad = 16;
  const tMax = r.tin + 1;
  const tMin = Math.min(r.climate.t5, r.td) - 1;
  const y = t => pad + (tMax - t) / (tMax - tMin) * (H - 2 * pad);
  const x = rr => pad + rr / r.r0 * (W - 2 * pad);
  const pts = r.profile.map(p => `${x(p.r).toFixed(1)},${y(p.t).toFixed(1)}`).join(' ');
  const dots = r.profile.filter(p => p.kind === 'boundary')
    .map(p => `<circle cx="${x(p.r).toFixed(1)}" cy="${y(p.t).toFixed(1)}" r="2.6" fill="var(--accent)"><title>${esc(p.label)}: ${fmt(p.t, 1)} °С</title></circle>`).join('');
  el('chart').innerHTML = `
    <div class="chart-title">Распределение температуры по толщине конструкции</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График температур">
      <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="var(--border)"/>
      <line x1="${pad}" x2="${W - pad}" y1="${y(r.tin)}" y2="${y(r.tin)}" stroke="var(--accent)" stroke-dasharray="4 3"/>
      <text x="${W - pad - 2}" y="${y(r.tin) - 3}" font-size="9" text-anchor="end" fill="var(--accent)">tв ${fmt(r.tin, 1)}°С</text>
      <line x1="${pad}" x2="${W - pad}" y1="${y(r.td)}" y2="${y(r.td)}" stroke="var(--bad)" stroke-dasharray="4 3"/>
      <text x="${pad + 2}" y="${y(r.td) + 9}" font-size="9" fill="var(--bad)">tр ${fmt(r.td, 1)}°С</text>
      <line x1="${pad}" x2="${W - pad}" y1="${y(r.climate.t5)}" y2="${y(r.climate.t5)}" stroke="var(--muted)" stroke-dasharray="4 3"/>
      <text x="${W - pad - 2}" y="${y(r.climate.t5) - 3}" font-size="9" text-anchor="end" fill="var(--muted)">tн ${fmt(r.climate.t5, 1)}°С</text>
      <polyline points="${pts}" fill="none" stroke="var(--text)" stroke-width="1.6"/>
      ${dots}
      <text x="${pad}" y="${H - 3}" font-size="9" fill="var(--muted)">внутри</text>
      <text x="${W - pad}" y="${H - 3}" font-size="9" text-anchor="end" fill="var(--muted)">наружу →</text>
    </svg>`;
}

/* ——— подбор материала ——— */
function materialPickerModal() {
  const sheet = openModal(`
    <h3>Добавить слой</h3>
    <input id="mat-search" type="text" placeholder="Поиск материала…" autocomplete="off">
    <div id="mat-list" class="mat-list" style="margin-top:10px"></div>
    <div class="sheet-actions">
      <button class="btn" id="btn-custom">＋ Свой материал</button>
      <button class="btn" id="btn-mat-close">Закрыть</button>
    </div>`);
  const renderList = q => {
    const ql = q.trim().toLowerCase().replace(/ё/g, 'е');
    const mats = allMaterials().filter(m => !ql || m.n.toLowerCase().replace(/ё/g, 'е').includes(ql));
    if (!mats.length) { el('mat-list').innerHTML = '<div class="mat-group">Ничего не найдено</div>'; return; }
    let html = '';
    for (const g of MATERIAL_GROUPS) {
      const inG = mats.filter(m => m.g === g);
      if (!inG.length) continue;
      html += `<div class="mat-group">${esc(g)}</div>` + inG.map(m =>
        `<button class="mat-item" data-mat="${esc(m.id)}">${esc(m.n)}<small>` +
        (m.rvp != null ? `Rп = ${fmt(m.rvp, 2)} (м²·ч·Па)/мг` :
          `ρ = ${fmt(m.rho, 0)} кг/м³ · λ = ${fmt(m.la, 3)}/${fmt(m.lb, 3)}` +
          (m.mu != null ? ` · μ = ${fmt(m.mu, 3)}` : '')) + `</small></button>`).join('');
    }
    el('mat-list').innerHTML = html;
  };
  renderList('');
  el('mat-search').addEventListener('input', e => renderList(e.target.value));
  el('btn-mat-close').onclick = closeModal;
  el('btn-custom').onclick = () => customMaterialModal();
  sheet.querySelector('#mat-list').addEventListener('click', e => {
    const b = e.target.closest('.mat-item');
    if (!b) return;
    const c = cur();
    const m = allMaterials().find(x => x.id === b.dataset.mat);
    c.layers.push({
      id: hooks.uid(), matId: m.id, name: m.n, group: m.g,
      d: m.rvp != null ? 0 : (DEF_THICK_ONE[m.g] ?? 100),
      isIns: m.g === 'Утеплители' && m.rvp == null,
      ovA: null, ovB: null,
    });
    closeModal(); changed();
    toast('Слой добавлен');
  });
}

function customMaterialModal() {
  openModal(`
    <h3>Свой материал</h3>
    <label class="field"><span class="field-label">Наименование</span><input id="cm-name" type="text"></label>
    <div class="row2">
      <label>λ при А <input id="cm-la" type="number" step="0.001"></label>
      <label>λ при Б <input id="cm-lb" type="number" step="0.001"></label>
    </div>
    <div class="row2">
      <label>μ, мг/(м·ч·Па) <input id="cm-mu" type="number" step="0.001" placeholder="необязательно"></label>
      <label>ρ, кг/м³ <input id="cm-rho" type="number" step="1" placeholder="необязательно"></label>
    </div>
    <label class="field"><span class="field-label">Группа</span>
      <select id="cm-g">${MATERIAL_GROUPS.map(g => `<option>${esc(g)}</option>`).join('')}</select>
    </label>
    <div class="sheet-actions">
      <button class="btn primary" id="cm-save">Добавить</button>
      <button class="btn" id="cm-cancel">Отмена</button>
    </div>`);
  el('cm-cancel').onclick = materialPickerModal;
  el('cm-save').onclick = () => {
    const n = el('cm-name').value.trim();
    const la = Number(el('cm-la').value), lb = Number(el('cm-lb').value);
    const mu = el('cm-mu').value === '' ? null : Number(el('cm-mu').value);
    const rho = el('cm-rho').value === '' ? null : Number(el('cm-rho').value);
    if (!n || !(la > 0) || !(lb > 0)) { toast('Укажите наименование и λ > 0'); return; }
    const custom = hooks.getCustom();
    custom.push({ id: 'custom-' + hooks.uid(), n, g: el('cm-g').value, rho: rho || 0, la, lb, mu, custom: true });
    hooks.setCustom(custom);
    materialPickerModal();
  };
}

/* ——— библиотека типовых узлов ——— */
function nodeLibModal() {
  const c = cur();
  const sheet = openModal(`
    <h3>Типовые узлы (справочные Ψ/χ)</h3>
    <div class="mat-group">Значения типовые — уточняйте расчётом узла для вашего случая</div>
    <div id="nlib" class="mat-list">${NODE_LIB.map((n, i) =>
      `<button class="mat-item" data-nlib="${i}">${esc(n.name)}<small>${n.t === 'L'
        ? `Ψ ≈ ${fmt(n.psi, 2)} Вт/(м·°С) — линейный` : `χ ≈ ${fmt(n.chi, 2)} Вт/°С — точечный`}</small></button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn" id="nlib-close">Закрыть</button></div>`);
  el('nlib-close').onclick = closeModal;
  sheet.querySelector('#nlib').addEventListener('click', e => {
    const b = e.target.closest('[data-nlib]');
    if (!b) return;
    const n = NODE_LIB[Number(b.dataset.nlib)];
    c.uni.elems.push(n.t === 'L'
      ? { t: 'L', name: n.name, psi: n.psi, L: 10 }
      : { t: 'P', name: n.name, chi: n.chi, n: 8 });
    if (c.uni.mode !== 'elements') c.uni.mode = 'elements';
    closeModal(); changed(); toast('Неоднородность добавлена');
  });
}

/* ——— редактор слоя ——— */
function editLayerModal(i) {
  const c = cur();
  const l = c.layers[i];
  const cond = c.adv.cond === 'auto' ? autoCond() : c.adv.cond;
  const m = matOf(l);
  const rvp = effRvp(l);
  const ovA = l.ovA ?? (m && m.rvp == null ? m.la : l.la);
  const ovB = l.ovB ?? (m && m.rvp == null ? m.lb : l.lb);
  const chips = (DEFAULT_THICK[l.group] || []).map(x =>
    `<button type="button" class="chip" data-thick="${x}">${x}</button>`).join(' ');
  const riOpts = [`<option value="">Rи не задано</option>`].concat(RI_OPTIONS.map(([v, n]) =>
    `<option value="${v}" ${l.ri === v ? 'selected' : ''}>${v} — ${esc(n)}</option>`)).join('');
  openModal(`
    <h3>Слой</h3>
    <label class="field"><span class="field-label">Наименование</span><input id="le-name" type="text" value="${esc(l.name)}"></label>
    ${rvp == null ? `
    <label class="field"><span class="field-label">Толщина δ, мм ${chips ? '· типовые: ' + chips : ''}</span>
      <input id="le-d" type="number" step="1" min="0" value="${l.d}"></label>` : ''}
    <label class="field" style="${rvp != null ? 'display:none' : ''}"><span class="ins-label"><input id="le-ins" type="checkbox" ${l.isIns ? 'checked' : ''}> слой — утеплитель</span></label>
    ${rvp == null ? `
    <div class="row2">
      <label>λ при А <input id="le-la" type="number" step="0.001" value="${ovA ?? ''}"></label>
      <label>λ при Б <input id="le-lb" type="number" step="0.001" value="${ovB ?? ''}"></label>
    </div>
    <label class="field"><span class="field-label">Сопротивление воздухопроницанию Rи (прил. Л), (м²·ч·Па)/кг</span>
      <select id="le-ri">${riOpts}</select></label>` : `
    <p class="hint">Пароизоляция (прил. Ж): Rп = ${fmt(rvp, 2)} (м²·ч·Па)/мг — в тепловом расчёте сопротивление слоя не учитывается.</p>`}
    <div class="sheet-actions">
      <button class="btn primary" id="le-save">Сохранить</button>
      <button class="btn danger" id="le-del">Удалить слой</button>
    </div>`);
  el('le-del').onclick = () => { c.layers.splice(i, 1); closeModal(); changed(); };
  document.querySelectorAll('#le-d ~ button.chip, button.chip[data-thick]').forEach(b => {
    b.onclick = () => { const d = el('le-d'); if (d) d.value = b.dataset.thick; };
  });
  el('le-save').onclick = () => {
    if (rvp == null) {
      const d = Number(el('le-d').value);
      if (!(d > 0)) { toast('Толщина должна быть больше 0'); return; }
      l.d = d;
      l.isIns = el('le-ins').checked;
      l.ovA = el('le-la').value === '' ? null : Number(el('le-la').value);
      l.ovB = el('le-lb').value === '' ? null : Number(el('le-lb').value);
      l.ri = el('le-ri').value === '' ? 0 : Number(el('le-ri').value);
    }
    l.name = el('le-name').value.trim() || l.name;
    closeModal(); changed();
  };
}

/* ——— город: поиск, свой город ——— */
function bindCityInput() {
  const ci = el('city-input');
  ci.addEventListener('input', () => {
    const q = ci.value.trim().toLowerCase().replace(/ё/g, 'е');
    const list = el('city-list');
    if (!q) { list.classList.add('hidden'); return; }
    const found = allCities().filter(c => c.n.toLowerCase().replace(/ё/g, 'е').includes(q)).slice(0, 14);
    list.innerHTML = found.map(c =>
      `<button type="button" data-city="${esc(c.n)}"><b>${esc(c.n)}</b><small>${esc(c.g || '')} · t⁵ ${fmt(c.t5, 1)} °С · tот/Zот (≤8) ${fmt(c.tot, 1)} °С / ${fmt(c.zot, 0)} сут${c.z ? ' · зона: ' + esc(c.z) : ''}</small></button>`).join('') +
      `<button type="button" id="city-custom" style="color:var(--accent)"><b>＋ Свой пункт «${esc(ci.value.trim())}»…</b></button>`;
    list.classList.remove('hidden');
  });
  ci.addEventListener('blur', () => setTimeout(() => el('city-list').classList.add('hidden'), 150));
  el('city-list').addEventListener('pointerdown', e => {
    if (e.target.closest('#city-custom')) { customCityModal(ci.value.trim()); return; }
    const b = e.target.closest('[data-city]');
    if (!b) return;
    const city = allCities().find(c => c.n === b.dataset.city);
    state.city = city.n;
    state.climateManual = false;
    state.climate = {
      t5: city.t5, tot: city.tot, zot: city.zot,
      tot10: city.tot10 ?? null, zot10: city.zot10 ?? null,
      zone: city.z ?? null,
      tm: city.tm ?? null, em: city.em ?? null,
    };
    changed(); toast(city.custom ? 'Свой пункт выбран' : 'Город выбран');
  });
}

function customCityModal(name) {
  openModal(`
    <h3>Свой пункт: ${esc(name || '')}</h3>
    <label class="field"><span class="field-label">Наименование</span><input id="cc-n" type="text" value="${esc(name)}"></label>
    <div class="row2">
      <label>t пятидневки (0,92), °С <input id="cc-t5" type="number" step="0.5"></label>
      <label>t отп. периода (≤8), °С <input id="cc-tot" type="number" step="0.1"></label>
      <label>Период ≤8, сут <input id="cc-zot" type="number" step="1"></label>
      <label>Зона влажности
        <select id="cc-z"><option value="">не определена (Б)</option><option value="сухая">сухая</option><option value="нормальная">нормальная</option><option value="влажная">влажная</option></select>
      </label>
    </div>
    <div class="row2">
      <label>t отп. периода (≤10), °С <input id="cc-tot10" type="number" step="0.1"></label>
      <label>Период ≤10, сут <input id="cc-zot10" type="number" step="1"></label>
    </div>
    <p class="hint" style="margin:0">Месячные данные для влажностного расчёта ввести нельзя — для него выберите ближайший пункт из базы СП.</p>
    <div class="sheet-actions">
      <button class="btn primary" id="cc-save">Сохранить и выбрать</button>
      <button class="btn" id="cc-cancel">Отмена</button>
    </div>`);
  el('cc-cancel').onclick = closeModal;
  el('cc-save').onclick = () => {
    const n = el('cc-n').value.trim();
    const t5 = Number(el('cc-t5').value), tot = Number(el('cc-tot').value), zot = Number(el('cc-zot').value);
    if (!n || !Number.isFinite(t5) || !Number.isFinite(tot) || !(zot > 0)) { toast('Заполните название и климат'); return; }
    const list = hooks.getCities();
    const rec = {
      n, g: 'Свой пункт', t5, tot, zot,
      tot10: el('cc-tot10').value === '' ? null : Number(el('cc-tot10').value),
      zot10: el('cc-zot10').value === '' ? null : Number(el('cc-zot10').value),
      z: el('cc-z').value || null, custom: true,
    };
    const ix = list.findIndex(c => c.n === n);
    if (ix >= 0) list[ix] = rec; else list.push(rec);
    hooks.setCities(list);
    state.city = n; state.climateManual = false;
    state.climate = { t5, tot, zot, tot10: rec.tot10, zot10: rec.zot10, zone: rec.z, tm: null, em: null };
    closeModal(); changed();
  };
}

/* ——— сохранённые объекты ——— */
function saveModal() {
  openModal(`
    <h3>Сохранить объект</h3>
    <label class="field"><span class="field-label">Название</span><input id="sv-name" type="text" value="${esc(state.name)}"></label>
    <div class="sheet-actions">
      <button class="btn primary" id="sv-ok">Сохранить</button>
      <button class="btn" id="sv-cancel">Отмена</button>
    </div>`);
  el('sv-cancel').onclick = closeModal;
  el('sv-ok').onclick = () => {
    state.name = el('sv-name').value.trim() || state.name;
    const list = hooks.getSaved();
    list.unshift({ id: hooks.uid(), name: state.name, date: new Date().toLocaleDateString('ru-RU'), state: snapshot() });
    hooks.setSaved(list);
    closeModal(); changed(); toast('Объект сохранён');
  };
}

function savedListModal() {
  const list = hooks.getSaved();
  const sheet = openModal(`
    <h3>Сохранённые объекты</h3>
    <div id="saved-list">${list.length ? '' : '<div class="mat-group">Пока ничего не сохранено</div>'}</div>
    <div class="sheet-actions"><button class="btn" id="sl-close">Закрыть</button></div>`);
  const wrap = sheet.querySelector('#saved-list');
  wrap.innerHTML = list.map((s, i) => `
    <div class="saved-item">
      <div class="s-main" data-open="${i}">
        <div class="s-name">${esc(s.name)}</div>
        <div class="s-sub">${esc(s.date)} · конструкций: ${s.state?.constructions?.length ?? '?'}</div>
      </div>
      <button class="btn danger" data-del="${i}" style="padding:6px 10px">Удалить</button>
    </div>`).join('');
  el('sl-close').onclick = closeModal;
  wrap.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    if (open) {
      const loaded = JSON.parse(JSON.stringify(list[Number(open.dataset.open)].state));
      Object.assign(state, loaded);
      currentId = state.constructions[0]?.id ?? null;
      closeModal(); showProject(); toast('Объект открыт');
    } else if (del) {
      const l = hooks.getSaved();
      l.splice(Number(del.dataset.del), 1);
      hooks.setSaved(l);
      savedListModal();
    }
  });
}

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

/* ——— сравнение A/B ——— */
function compareModal() {
  const layered = state.constructions.filter(c => c.kind === 'layered' || c.kind === 'ground');
  if (layered.length < 2) { toast('Нужно минимум две конструкции для сравнения'); return; }
  const opts = layered.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  openModal(`
    <h3>Сравнение вариантов</h3>
    <div class="row2">
      <label>Вариант А <select id="cmp-a">${opts}</select></label>
      <label>Вариант Б <select id="cmp-b">${opts}</select></label>
    </div>
    <div id="cmp-out"></div>
    <div class="sheet-actions"><button class="btn" id="cmp-close">Закрыть</button></div>`);
  const a = layered[0].id, b = layered[1].id;
  el('cmp-a').value = a; el('cmp-b').value = b;
  el('cmp-close').onclick = closeModal;
  const render = () => {
    const ca = layered.find(c => c.id === el('cmp-a').value);
    const cb = layered.find(c => c.id === el('cmp-b').value);
    const ra = computeC(ca), rb = computeC(cb);
    const insA = ra.ins?.standardMm, insB = rb.ins?.standardMm;
    const rows = [
      ['R₀ усл (по глади)', fmt(ra.r0 ?? ra.rpr), fmt(rb.r0 ?? rb.rpr)],
      ['R₀пр / фактическое', fmt(ra.rpr), fmt(rb.rpr)],
      ['Rнорм', fmt(ra.rnorm ?? ra.rnorm), fmt(rb.rnorm ?? rb.rnorm)],
      ['Запас', fmt(ra.marginPct, 0) + ' %', fmt(rb.marginPct, 0) + ' %'],
      ...(ra.tInSurf != null ? [['tв.п / tр', fmt(ra.tInSurf, 1) + ' / ' + fmt(ra.td, 1), fmt(rb.tInSurf, 1) + ' / ' + fmt(rb.td, 1)]] : []),
      ['Утеплитель, стандартная δ', insA != null ? insA + ' мм' : '—', insB != null ? insB + ' мм' : '—'],
      ['Вердикт', ra.pass && !ra.condSurf ? '✓' : '✗', rb.pass && !rb.condSurf ? '✓' : '✗'],
    ].map(([l, x, y]) => `<tr><td>${l}</td><td style="text-align:right">${x}</td><td style="text-align:right">${y}</td></tr>`).join('');
    el('cmp-out').innerHTML = `<table class="mini-table" style="width:100%">
      <tr><th>Показатель</th><th>${esc(ca.name)}</th><th>${esc(cb.name)}</th></tr>${rows}</table>`;
  };
  el('cmp-a').onchange = render;
  el('cmp-b').onchange = render;
  render();
}

/* ——— отчёты ——— */
function downloadReport(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ——— изменения и перерисовка ——— */
function changed() {
  hooks.save();
  if (currentId) { renderConstruction(); renderConstrList(); renderKob(); }
  else { renderProject(); renderConstrList(); renderKob(); }
}

function bindProject() {
  el('p-name').addEventListener('change', e => { state.name = e.target.value; changed(); });
  bindCityInput();
  for (const [id, fn] of [
    ['t5', v => state.climate.t5 = Number(v)],
    ['tot', v => state.climate.tot = Number(v)],
    ['zot', v => state.climate.zot = Number(v)],
    ['tot10', v => state.climate.tot10 = v === '' ? null : Number(v)],
    ['zot10', v => state.climate.zot10 = v === '' ? null : Number(v)],
    ['zone', v => state.climate.zone = v || null],
    ['tin', v => state.tin = Math.min(40, Math.max(5, Number(v) || 20))],
    ['phi', v => state.phi = Math.min(100, Math.max(1, Number(v) || 55))],
    ['p-volume', v => state.volume = v === '' ? null : Number(v)],
    ['p-height', v => state.height = v === '' ? null : Number(v)],
  ]) {
    const onEvt = e => {
      fn(e.target.value);
      if (['t5', 'tot', 'zot', 'tot10', 'zot10', 'zone'].includes(id)) { state.city = null; state.climateManual = true; }
      changed();
    };
    el(id).addEventListener('input', onEvt);
    el(id).addEventListener('change', onEvt);
  }
  el('building').innerHTML = Object.entries(BUILDINGS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  el('building').addEventListener('change', e => {
    state.building = e.target.value;
    const b = BUILDINGS[state.building];
    state.tin = b?.tIn ?? 20; state.phi = b?.phi ?? 55;
    changed();
  });

  el('btn-add-layered').onclick = () => {
    const c = { ...hooks.newConstruction('Конструкция ' + (state.constructions.length + 1)), id: hooks.uid() };
    state.constructions.push(c);
    showConstruction(c.id);
  };
  el('btn-add-opening').onclick = () => {
    const c = { ...hooks.newConstruction('Проём'), id: hooks.uid(), kind: 'window', layers: [] };
    state.constructions.push(c);
    showConstruction(c.id);
  };
  el('btn-add-ground').onclick = () => {
    const c = { ...hooks.newConstruction('Пол по грунту'), id: hooks.uid(), kind: 'ground', layers: [] };
    state.constructions.push(c);
    showConstruction(c.id);
  };
  el('btn-compare').onclick = compareModal;
  el('btn-report').onclick = () => {
    el('report').innerHTML = buildProjectReport(state, state.constructions.map(c => ({ c, r: computeC(c) })));
    window.print();
  };
  el('btn-pdf-proj').onclick = () => {
    const items = state.constructions.map(c => ({ c, r: computeC(c) }));
    const kres = state.volume ? projectCalc({
      fragments: items.filter(({ c }) => c.area > 0).map(({ c, r }) => ({
        name: c.name, area: c.area,
        rpr: c.kind === 'layered' || c.kind === 'ground' ? r.rpr : c.opening.r0, nt: c.nt || 1,
      })).filter(f => f.rpr > 0), volume: Number(state.volume), gsop: gsopProject(),
    }) : null;
    savePdf(buildProjectPdf(state, items, kres), (state.name || 'объект').replace(/[\\/:*?"<>|]/g, '_') + '.pdf');
    toast('PDF сохранён');
  };
  el('btn-reset').onclick = () => {
    if (confirm('Сбросить объект к исходному состоянию?')) {
      Object.assign(state, JSON.parse(JSON.stringify(hooks.defaults())));
      currentId = null;
      showProject();
    }
  };
  el('btn-saved').onclick = savedListModal;
  el('btn-back').onclick = showProject;
  el('btn-help').onclick = showHelp;
  el('btn-theme').onclick = () => {
    const curT = document.body.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = curT === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('teplo.theme', next);
    el('ic-moon').classList.toggle('hidden', next === 'light');
    el('ic-sun').classList.toggle('hidden', next !== 'light');
  };
  const savedTheme = localStorage.getItem('teplo.theme');
  if (savedTheme) {
    document.body.dataset.theme = savedTheme;
    el('ic-moon').classList.toggle('hidden', savedTheme === 'light');
    el('ic-sun').classList.toggle('hidden', savedTheme !== 'light');
  }

  el('constr-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      if (state.constructions.length > 1) {
        state.constructions = state.constructions.filter(c => c.id !== del.dataset.del);
        changed();
      } else toast('Нельзя удалить последнюю конструкцию');
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) showConstruction(open.dataset.open);
  });
}

function bindConstruction() {
  el('c-name').addEventListener('input', e => { cur().name = e.target.value; el('hdr-title').textContent = cur().name; changed(); });
  const onArea = e => { cur().area = e.target.value === '' ? null : Number(e.target.value); changed(); };
  el('c-area').addEventListener('input', onArea);
  el('c-area').addEventListener('change', onArea);

  const onKindField = e => {
    const c = cur();
    const id = e.target.id;
    if (id === 'c-alphaIn') c.adv.alphaIn = Number(e.target.value) || 8.7;
    else if (id === 'c-alphaOut') c.adv.alphaOut = e.target.value === 'auto' ? null : Number(e.target.value);
    else if (id === 'c-cond') c.adv.cond = e.target.value;
    else if (id === 'g-a') c.ground.a = Number(e.target.value) || 1;
    else if (id === 'g-b') c.ground.b = Number(e.target.value) || 1;
    else if (id === 'g-h') c.ground.h = Number(e.target.value) || 0;
    else if (id === 'g-d') c.ground.dIns = Number(e.target.value) || 0;
    else if (id === 'g-lam') c.ground.lambda = Number(e.target.value) || 0.04;
    else if (id === 'g-lgr') c.ground.lambdaGr = Number(e.target.value) || 1.6;
    else if (id === 'o-s') c.opening.s = Number(e.target.value) || 1;
    else if (id === 'o-r0') c.opening.r0 = Number(e.target.value) || 0.1;
    else return;
    changed();
  };
  el('c-kind-fields').addEventListener('input', onKindField);
  el('c-kind-fields').addEventListener('change', onKindField);
  el('c-kind-fields').addEventListener('click', e => {
    const b = e.target.closest('[data-construction]');
    if (!b) return;
    cur().construction = b.dataset.construction;
    cur().adv.alphaOut = null;
    changed();
  });

  el('layers').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    const li = e.target.closest('li[data-i]');
    if (!btn || !li) return;
    const c = cur();
    const i = Number(li.dataset.i);
    const act = btn.dataset.act;
    if (act === 'up' && i > 0) [c.layers[i - 1], c.layers[i]] = [c.layers[i], c.layers[i - 1]];
    else if (act === 'down' && i < c.layers.length - 1) [c.layers[i + 1], c.layers[i]] = [c.layers[i], c.layers[i + 1]];
    else if (act === 'del') c.layers.splice(i, 1);
    else if (act === 'edit') return editLayerModal(i);
    changed();
  });
  el('add-layer').onclick = materialPickerModal;

  el('uni-box').addEventListener('change', e => {
    const c = cur();
    if (e.target.id === 'uni-mode') { c.uni.mode = e.target.value; changed(); }
    else if (e.target.id === 'uni-r') { c.uni.r = Math.min(1, Math.max(0.3, Number(e.target.value) || 1)); changed(); }
  });
  el('uni-box').addEventListener('click', e => {
    const c = cur();
    const del = e.target.closest('[data-uni-del]');
    if (del) { c.uni.elems.splice(Number(del.dataset.uniDel), 1); changed(); return; }
    if (e.target.id === 'uni-add-l') {
      c.uni.elems.push({ t: 'L', name: 'Линейная неоднородность', psi: 0.2, L: 10 });
      changed(); return;
    }
    if (e.target.id === 'uni-add-p') {
      c.uni.elems.push({ t: 'P', name: 'Точечная неоднородность', chi: 0.5, n: 4 });
      changed(); return;
    }
    if (e.target.id === 'uni-add-lib') nodeLibModal();
  });
  // удаление неоднородностей обработано в общем слушателе выше

  el('airperm').addEventListener('change', e => {
    if (e.target.id === 'c-ghn') { cur().airGhn = Number(e.target.value) || 0.5; changed(); }
  });

  el('btn-report-c').onclick = () => {
    const c = cur();
    el('report').innerHTML = buildReport(state, c, computeC(c));
    window.print();
  };
  el('btn-pdf').onclick = () => {
    const c = cur();
    savePdf(buildConsPdf(state, c, computeC(c)), (c.name || 'конструкция').replace(/[\\/:*?"<>|]/g, '_') + '.pdf');
    toast('PDF сохранён');
  };
  el('btn-download').onclick = () => {
    const c = cur();
    if (currentId) {
      downloadReport(reportAsHtml(buildReport(state, c, computeC(c))),
        (c.name || 'конструкция').replace(/[\\/:*?"<>|]/g, '_') + '.html');
    } else {
      downloadReport(reportAsHtml(buildProjectReport(state, state.constructions.map(x => ({ c: x, r: computeC(x) })))),
        (state.name || 'объект') + '.html');
    }
  };
}

/* ——— инициализация ——— */
export function init(initialState, hooksArg) {
  state = initialState;
  hooks = {
    save: () => {},
    getCustom: () => [], setCustom: () => {},
    getSaved: () => [], setSaved: () => {},
    getCities: () => [], setCities: () => {},
    defaults: () => initialState,
    newConstruction: null, uid: () => Math.random().toString(36).slice(2),
    ...hooksArg,
  };
  bindProject();
  bindConstruction();
  showProject();
  // диагностический хук (отладка через консоль/автоматизацию)
  window.__teplo = {
    state: () => JSON.stringify(state),
    current: () => currentId,
    err: () => window.__teploLastErr || '',
    pdfCons: () => {
      try {
        const c = state.constructions[0];
        const doc = buildConsPdf(state, c, computeC(c));
        const b64 = doc.output('datauristring').split(',')[1];
        window.__teploPdfB64 = b64;
        return 'размер=' + Math.round(b64.length * 0.75) + ' байт (base64 ' + b64.length + ')';
      } catch (e) { return 'ERR: ' + e.message; }
    },
  };
  window.addEventListener('error', e => {
    window.__teploLastErr = (e.message || '?') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '?');
  });
}

/* ——— встроенная справка ——— */
const HELP_HTML = `
  <h2>Как работает расчёт</h2>
  <p class="hint">Методики: СП 50.13330.2024 «Тепловая защита зданий» и СП 131.13330.2025 «Строительная климатология». Ниже — навигация по формулам. Ответственность за расчёт остаётся за инженером.</p>
  <h2 style="font-size:14px">Поэлементное требование (п. 5.2)</h2>
  <p>ГСОП = (tв − tот)·Zот (5.2). Rтр = a·ГСОП + b (таблица 3); для общественных/производственных покрытий и чердачных перекрытий — интерполяция между табличными точками. Rнорм = mр·Rтр (5.1), в расчёте mр = 1.</p>
  <p>R₀ усл = 1/αв + Σδ/λ + 1/αн (Г.6). λ материалов — прил. М при условиях эксплуатации А/Б (таблицы 1, 2; зоны влажности — прил. А).</p>
  <p><b>Неоднородности:</b> R₀пр = r·R₀ усл (Г.4) либо R₀пр = 1/(1/R₀ усл + ΣΨ·l + Σχ·n) (Г.1), где Ψ — линейные, χ — точечные включения.</p>
  <h2 style="font-size:14px">Санитарно-гигиеническое требование (п. 5.7)</h2>
  <p>tв.п ≥ точки росы: tв.п = tв − (tв − tн)·(1/αв)/R₀. Расчётная влажность: жилые, детские, образовательные, медицинские — 55 %; прочие общественные — 50 %.</p>
  <p>Дополнительно по (5.4): tв.п ≥ tв − Δtн (таблица 5) — для реконструкции, входных дверей (0,6·Rстен), внутренних ограждений.</p>
  <h2 style="font-size:14px">Полы по грунту (прил. Г.7)</h2>
  <p>Зоны 2 м от контура: базовые R 2,1 / 3,8 / 5,2 / 7,7 (Г.3). R зоны = 1,6/λгр·Rбаз + δут/λут (Г.16); при стенах в грунте — от эффективной полосы h/2. R₀пр = A/Σ(Aᵢ/Rᵢ) (Г.15).</p>
  <h2 style="font-size:14px">Влажностный расчёт (раздел 8)</h2>
  <p>Плоскость максимального увлажнения — комплекс f(tм.у) (8.7, таблица 12), упрощение для НФС-подобных конструкций (μут &gt; 2λут, Rут &gt; ⅔R усл), случай границы слоёв (8.5.5). Rп1тр = (eв − E)/(E − eн)·Rп.н (8.1); Rп2тр = 0,0024·Z₀·(eв − E₀)/(ρw·δw·Δw + η) (8.2); η (8.5); E по периодам года (8.4); E(t) — (8.9). Для чердачных перекрытий и вентилируемых покрытий: Rптр = 0,0012(eв − eн,отр) (8.6). Rп слоёв = δ/μ (8.10), листовые — прил. Ж.</p>
  <p><b>Вентфасады:</b> методика проверки вентилируемой прослойки в СП 50.13330.2024 не детализирована (п. 8.4 → СП 345.1325800 / методика производителя). В программе слой «вентилируемая прослойка» исключает накопление влаги за собой; зазор проверяйте по методике производителя НФС.</p>
  <h2 style="font-size:14px">Воздухопроницание (раздел 7)</h2>
  <p>Δp = 0,55·H·(γн − γв) + 0,03·γн·v² (7.2), γ = 3463/(273+t); v — максимальная скорость ветра за январь. Rитр = Δp/Gн (7.1), Gн — таблица 10; Rи — сумма слоёв (7.4, прил. Л). Для окон: Rитр = (Δp/10)²/Gн (7.5).</p>
  <h2 style="font-size:14px">Проёмы</h2>
  <p>Окна: Rтр — таблица 3, tост ≥ 3 °С (п. 5.7, αв = 8,0). Двери: ≥ 0,6·Rстен по (5.4). Ворота: таблица 8.</p>
  <h2 style="font-size:14px">Комплексное требование (п. 5.5, прил. Д)</h2>
  <p>kоб = Σ(n_t·Aф/R₀пр)/Vот (Д.1) ≤ kобтр: Vот ≤ 960 м³ → kобтр = 4,74/(0,00013·ГСОП + 0,61)/∛Vот; Vот &gt; 960 → (0,16 + 10/√Vот)/(0,00013·ГСОП + 0,61); снизу ограничено 8,5/√ГСОП (5.6). Фрагменты должны полностью замыкать оболочку здания.</p>
  <h2 style="font-size:14px">Источники данных</h2>
  <p>Климат — все 549 пунктов таблиц 5.1, 7.1, 11.1 СП 131.13330.2025 (извлечены из официального PDF автоматически). Материалы — таблица М.1 СП 50.13330.2024 (254 позиции). Зоны влажности — карта прил. А. Ключевые значения перед применением сверяйте с официальными изданиями СП.</p>`;

function showHelp() {
  el('view-project').classList.add('hidden');
  el('view-construction').classList.add('hidden');
  el('view-help').classList.remove('hidden');
  el('btn-back').classList.remove('hidden');
  el('hdr-title').textContent = 'Справка';
  el('help-content').innerHTML = HELP_HTML;
}
