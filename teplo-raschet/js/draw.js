// Рисунки конструкций: разрезы со штриховкой слоёв, толщинами,
// отметками тёплой/холодной стороны, точкой росы и плоскостью увлажнения.
// Используется на экране результатов и в отчёте (SVG печатается в PDF).

const HATCH = {
  'Утеплители': { p: 'h-ut', fill: '#fde68a', line: '#d97706', label: 'утеплитель' },
  'Засыпки': { p: 'h-stip', fill: '#fef3c7', line: '#a16207' },
  'Бетоны и блоки': { p: 'h-conc', fill: '#e5e7eb', line: '#6b7280' },
  'Бетоны и растворы': { p: 'h-conc', fill: '#d1d5db', line: '#4b5563' },
  'Кладка и камень': { p: 'h-brick', fill: '#fecaca', line: '#b91c1c' },
  'Дерево и плиты': { p: 'h-wood', fill: '#fde8d7', line: '#92400e' },
  'Кровельные и изоляционные': { p: 'h-roof', fill: '#dbeafe', line: '#1d4ed8' },
  'Металлы и стекло': { p: 'h-metal', fill: '#bfdbfe', line: '#1e3a8a' },
  'Пароизоляция и листовые': { p: 'h-vp', fill: '#e0f2fe', line: '#0369a1' },
  'Прочее': { p: 'h-conc', fill: '#e5e7eb', line: '#6b7280' },
};

const DEFS = `
  <defs>
    <pattern id="h-ut" width="10" height="8" patternUnits="userSpaceOnUse">
      <rect width="10" height="8" fill="#fde68a"/>
      <path d="M0,6 Q2.5,2 5,6 T10,6" fill="none" stroke="#d97706" stroke-width="0.9"/>
    </pattern>
    <pattern id="h-stip" width="9" height="9" patternUnits="userSpaceOnUse">
      <rect width="9" height="9" fill="#fef3c7"/>
      <circle cx="2" cy="2" r="0.9" fill="#a16207"/><circle cx="6.5" cy="6" r="0.9" fill="#a16207"/>
    </pattern>
    <pattern id="h-conc" width="7" height="7" patternUnits="userSpaceOnUse">
      <rect width="7" height="7" fill="#e5e7eb"/>
      <path d="M0,7 L7,0 M-1,1 L1,-1 M6,8 L8,6" stroke="#6b7280" stroke-width="0.6"/>
    </pattern>
    <pattern id="h-brick" width="12" height="6" patternUnits="userSpaceOnUse">
      <rect width="12" height="6" fill="#fecaca"/>
      <path d="M0,0 H12 M0,3 H12 M0,6 H12 M6,0 V3 M3,3 V6 M9,3 V6" stroke="#b91c1c" stroke-width="0.5" fill="none"/>
    </pattern>
    <pattern id="h-wood" width="9" height="9" patternUnits="userSpaceOnUse">
      <rect width="9" height="9" fill="#fde8d7"/>
      <path d="M0,2 H9 M0,5 H9 M0,8 H9" stroke="#92400e" stroke-width="0.5"/>
      <circle cx="4" cy="3.5" r="1.3" fill="none" stroke="#92400e" stroke-width="0.5"/>
    </pattern>
    <pattern id="h-roof" width="8" height="5" patternUnits="userSpaceOnUse">
      <rect width="8" height="5" fill="#dbeafe"/>
      <path d="M0,5 L4,0 L8,5" fill="none" stroke="#1d4ed8" stroke-width="0.7"/>
    </pattern>
    <pattern id="h-metal" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#bfdbfe"/>
      <path d="M0,8 L8,0" stroke="#1e3a8a" stroke-width="0.8"/>
    </pattern>
    <pattern id="h-vp" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#e0f2fe"/>
      <path d="M0,3 H6" stroke="#0369a1" stroke-width="0.7" stroke-dasharray="2 1.5"/>
    </pattern>
  </defs>`;

function shortName(name, max = 26) {
  const n = String(name);
  return n.length > max ? n.slice(0, max - 1) + '…' : n;
}

/* Разрез слоистой конструкции: внутри (+) слева, наружу (−) справа */
export function drawLayeredSVG(cons, r) {
  const W = 380, H = 150, top = 34, body = 52, labelY = top + body + 14;
  const layers = r.layersR.filter(l => (l.d > 0) || l.rvp != null);
  if (!layers.length) return '';
  const totalD = layers.reduce((s, l) => s + Math.max(l.d, 12), 0);
  const drawW = W - 90;
  // ширины пропорциональны толщине, но не менее 14 px
  let widths = layers.map(l => Math.max(l.d, 12) / totalD * drawW);
  // дожимаем до drawW
  const k = drawW / widths.reduce((s, x) => s + x, 0);
  widths = widths.map(x => x * k);
  const x0 = 45;

  // отметка tр и плоскости увлажнения по накопленному сопротивлению
  let cum = r.alphaIn ? 1 / r.alphaIn : 0.115;
  const marks = [];
  let tdX = null, planeX = null;
  layers.forEach((l, i) => {
    const tAtBoundary = r.profile[i + 1] ? r.profile[i + 1].t : null;
    if (tdX == null && tAtBoundary != null && tAtBoundary < r.td) tdX = x0 + widths.slice(0, i + 1).reduce((s, x) => s + x, 0);
    if (r.moisture && !r.moisture.vented && r.moisture.plane &&
        r.moisture.plane.layerIdx === i && !r.moisture.plane.atOuter) {
      planeX = x0 + widths.slice(0, i + 1).reduce((s, x) => s + x, 0) - widths[i] / 2;
    }
  });
  if (tdX == null) tdX = x0; // точка росы уже на внутренней поверхности

  let bands = '', labels = '', ticks = '';
  let x = x0;
  layers.forEach((l, i) => {
    const w = widths[i];
    const hkey = HATCH[l.group] ? l.group : 'Прочее';
    const h = HATCH[hkey];
    const vp = l.rvp != null;
    const fill = vp ? 'url(#h-vp)' : (l.vent ? 'none' : `url(#${h.p})`);
    bands += `<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${body}" fill="${fill}" stroke="#374151" stroke-width="0.7"/>`;
    if (l.vent) {
      bands += `<path d="M${(x + 4).toFixed(1)},${top + 14} h${Math.max(w - 8, 6)} M${(x + 4).toFixed(1)},${top + 26} h${Math.max(w - 8, 6)}" stroke="#0891b2" stroke-width="1" marker-end="url(#arr)"/>`;
    }
    // толщина: сверху или снизу попеременно, узкие — выноска
    const dTxt = l.rvp != null ? 'Rп' : `${Math.round(l.d)}`;
    const above = i % 2 === 0;
    const cx = x + w / 2;
    if (w >= 30) {
      labels += `<text x="${cx.toFixed(1)}" y="${above ? top - 5 : labelY + 10}" font-size="9.5" text-anchor="middle" fill="var(--text)">${dTxt}</text>`;
    } else {
      const y2 = above ? top - 6 : labelY + 12;
      labels += `<path d="M${cx.toFixed(1)},${above ? top : top + body} V${y2}" stroke="var(--muted)" stroke-width="0.5"/>` +
        `<text x="${cx.toFixed(1)}" y="${above ? y2 - 2 : y2 + 8}" font-size="8.5" text-anchor="middle" fill="var(--muted)">${dTxt}</text>`;
    }
    ticks += `<title>${esc(l.name)}</title>`;
    x += w;
  });

  const svg = `<svg viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="Разрез конструкции" style="width:100%;height:auto">
    ${DEFS}
    <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L8,4 L0,8 z" fill="#0891b2"/></marker>
    <text x="${x0 - 6}" y="${top - 16}" font-size="10" text-anchor="start" fill="var(--accent)" font-weight="600">внутри +${Math.round(r.tin)} °С</text>
    <text x="${W - 40}" y="${top - 16}" font-size="10" text-anchor="end" fill="var(--muted)" font-weight="600">наружу ${Math.round(r.climate.t5)} °С</text>
    ${bands}
    <text x="${x0 - 6}" y="${top + body / 2 + 3}" font-size="10" fill="var(--accent)" font-weight="700">+</text>
    <text x="${x0 + widths.reduce((s, x) => s + x, 0) + 6}" y="${top + body / 2 + 3}" font-size="10" fill="var(--muted)" font-weight="700">−</text>
    ${labels}
    ${ticks}
    ${tdX != null ? `<line x1="${tdX.toFixed(1)}" x2="${tdX.toFixed(1)}" y1="${top - 3}" y2="${top + body + 3}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3 2"/>
    <text x="${tdX.toFixed(1)}" y="${top + body + 24}" font-size="8.5" text-anchor="middle" fill="#dc2626">tр ${fmt0(r.td)}°С</text>` : ''}
    ${planeX != null ? `<circle cx="${planeX.toFixed(1)}" cy="${top + body / 2}" r="5" fill="#0891b2" opacity="0.85"/>
    <text x="${planeX.toFixed(1)}" y="${top + body + 24}" font-size="8.5" text-anchor="middle" fill="#0891b2">пл. увлажнения</text>` : ''}
    <text x="${x0 - 6}" y="${top + body + 24}" font-size="8" fill="var(--muted)">δ, мм</text>
  </svg>`;
  return `<div class="box" style="overflow-x:auto">${svg}</div>`;
}
const fmt0 = (x) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—');
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* Пол по грунту: разрез со стеной в грунте и зонами */
export function drawGroundSVG(cons, r) {
  const g = cons.ground;
  const W = 380, H = 150;
  const groundY = 60, wallH = (g.h || 0) * 1.2;
  const zones = r.zones;
  const totalZ = zones.reduce((s, z) => s + z.area, 0) || 1;
  // ширины зон пропорционально «удельным» расстояниям (наглядно)
  const wEff = (g.h || 0) / 2 * 20;
  const zw = [Math.max(20 * (2 - wEff / 20), 14), 30, 30, Math.max(30, 40)];
  const scale = (W - 130) / zw.reduce((s, x) => s + x, 0);
  const widths = zw.map(x => x * scale);
  const x0 = 70;
  let bands = '', labels = '';
  let x = x0;
  const zoneFills = ['#fecaca', '#fca5a5', '#fda4af', '#fbbf24'];
  zones.forEach((z, i) => {
    const w = widths[i];
    bands += `<rect x="${x.toFixed(1)}" y="${groundY}" width="${w.toFixed(1)}" height="26" fill="${zoneFills[i]}" stroke="#374151" stroke-width="0.6"/>`;
    labels += `<text x="${(x + w / 2).toFixed(1)}" y="${groundY + 16}" font-size="9.5" text-anchor="middle" fill="#000">зона ${z.name}</text>`;
    labels += `<text x="${(x + w / 2).toFixed(1)}" y="${groundY + 40}" font-size="8.5" text-anchor="middle" fill="var(--muted)">R=${fmt0(z.r)}</text>`;
    x += w;
  });
  // стена и грунт
  const wall = `<rect x="${x0 - 34}" y="${groundY - wallH - 26}" width="22" height="${wallH + 26}" fill="url(#h-conc)" stroke="#374151"/>
    <rect x="${x0 - 12}" y="${groundY}" width="12" height="26" fill="url(#h-conc)" stroke="#374151"/>`;
  const ground = `<rect x="10" y="${groundY + 26}" width="${W - 20}" height="30" fill="#d1d5db" opacity="0.5"/>
    <text x="${W / 2}" y="${groundY + 46}" font-size="9" text-anchor="middle" fill="var(--muted)">грунт (λ = ${fmt0(g.lambdaGr)} Вт/(м·°С))</text>
    <text x="${x0 - 46}" y="${groundY - wallH - 16}" font-size="8.5" fill="var(--muted)">стена в грунте</text>
    <text x="${x0 - 8}" y="${groundY - wallH / 2}" font-size="8.5" fill="var(--muted)" transform="rotate(-90 ${x0 - 8} ${groundY - wallH / 2})">h/2</text>`;
  return `<div class="box" style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Пол по грунту" style="width:100%;height:auto">
    ${DEFS}${wall}${ground}${bands}${labels}
    <text x="10" y="20" font-size="10" fill="var(--accent)" font-weight="600">внутри +${Math.round(20)} °С</text>
    <text x="10" y="${groundY - 8}" font-size="9" fill="var(--muted)">пол: утеплитель ${Math.round(g.dIns)} мм</text>
  </svg></div>`;
}

/* Проём: схема с R₀ */
export function drawOpeningSVG(cons, r) {
  const kind = cons.kind;
  const W = 380, H = 120;
  const s = cons.opening.s || 1;
  const frame = `<rect x="130" y="18" width="120" height="76" fill="none" stroke="var(--text)" stroke-width="2.5" rx="3"/>
    <rect x="142" y="30" width="96" height="52" fill="#dbeafe" stroke="var(--muted)" stroke-width="1"/>
    ${kind === 'window' ? '<path d="M190,30 V82 M142,56 H238" stroke="var(--muted)" stroke-width="1"/>' : ''}
    <text x="190" y="105" font-size="10" text-anchor="middle" fill="var(--muted)">${kind === 'gate' ? 'ворота' : kind === 'door' ? 'дверь' : 'окно'} · S = ${Math.round(s)} м²</text>
    <text x="190" y="12" font-size="10" text-anchor="middle" fill="var(--accent)" font-weight="600">R₀ = ${Math.round(cons.opening.r0 * 100) / 100} / Rтр = ${Math.round(r.rtr * 100) / 100} м²·°С/Вт</text>
    <text x="100" y="58" font-size="10" text-anchor="end" fill="var(--accent)" font-weight="600">+ внутри</text>
    <text x="280" y="58" font-size="10" fill="var(--muted)" font-weight="600">− наружу</text>`;
  return `<div class="box"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${frame}</svg></div>`;
}
