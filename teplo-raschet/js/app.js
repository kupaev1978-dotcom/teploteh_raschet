// Точка входа: состояние проекта, миграция версий, service worker.
import { init } from './ui.js?v=5';
import { CITIES } from '../data/cities.js?v=5';

const LS = {
  proj: 'teplo.project.v1',
  old: 'teplo.state.v1',
  custom: 'teplo.custom.v1',
  saved: 'teplo.saved.v1',
  cities: 'teplo.cities.v1',
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

function defaultLayers() {
  return [
    { id: uid(), matId: 'cps1800', name: 'Раствор цементно-песчаный 1800 кг/м³', group: 'Бетоны и растворы', d: 20, isIns: false, ovA: null, ovB: null },
    { id: uid(), matId: 'kladka_glinyanyi_cps', name: 'Кладка из глиняного обыкновенного кирпича на цементно-песчаном растворе, 1800 кг/м³', group: 'Кладка и камень', d: 380, isIns: false, ovA: null, ovB: null },
    { id: uid(), matId: 'mv_stone_40', name: 'Минераловатные изделия из каменного волокна 40–60 кг/м³', group: 'Утеплители', d: 50, isIns: true, ovA: null, ovB: null },
    { id: uid(), matId: 'kladka_ker_pust_1000', name: 'Кладка из керамического пустотного кирпича 1000 кг/м³ (брутто) на ЦПС, 1200 кг/м³', group: 'Кладка и камень', d: 120, isIns: false, ovA: null, ovB: null },
  ];
}

function defaultConstruction(name) {
  return {
    id: uid(), kind: 'layered', name,
    construction: 'wall',
    area: null, nt: 1,
    layers: defaultLayers(),
    adv: { alphaIn: 8.7, alphaOut: null, cond: 'auto' },
    uni: { mode: 'none', r: 1, elems: [] },
    ground: { a: 8, b: 10, h: 0, dIns: 100, lambda: 0.04, lambdaGr: 1.6 },
    opening: { s: 3, r0: 0.7 },
  };
}

function defaults() {
  return {
    name: 'Новый объект',
    city: 'Москва',
    climateManual: false,
    climate: { t5: -23, tot: -1.7, zot: 202, tot10: -0.8, zot10: 220, zone: 'сухая', tm: [-7, -6.4, -1, 6.5, 13.3, 17.2, 19.2, 17.2, 11.4, 5.4, -0.7, -4.8], em: [350, 340, 430, 590, 820, 1170, 1440, 1390, 970, 640, 480, 400] },
    building: 'residential',
    tin: 20,
    phi: 55,
    volume: null,
    height: 10,
    constructions: [defaultConstruction('Стена 1')],
  };
}

// ——— Миграция материалов из версии по СП 2012 ———
const OLD_TO_NEW = {
  cps1800: 'cps1800', izvest1600: 'izvest1600', slozhny1700: 'slozhny1700',
  zhelezobeton: 'zhelezobeton', betonGraviy: 'beton_graviy',
  minvata30: 'mv_stone_25', minvata70: 'mv_stone_60', minvata110: 'mv_stone_80', minvata160: 'mv_stone_160',
  steklovata: 'mv_glass_17', eps20: 'eps_17', eps35: 'eps_25', xps: 'xps_35',
  ppu: 'ppu_40', penosteklo: 'foamglass_100',
  keramzit300: 'keramzit_300', keramzit550: 'keramzit_500',
  gazobeton400: 'avtoklav_400', gazobeton600: 'avtoklav_600', gazobeton800: 'avtoklav_800',
  kb400: 'kb_bespes_400', kb500: 'kb_500', kb600: 'kb_600', kb800: 'kb_800',
  kb1000: 'kb_1000', kb1200: 'kb_1200', kb1400: 'kb_1400', kb1600: 'kb_1600', kb1800: 'kb_1800',
  polistbeton400: 'polistbeton_400', arbolit600: 'arbolit_500',
  kirpichPoln1800: 'kladka_glinyanyi_cps', kirpichPoln1600: 'kladka_glinyanyi_cps',
  kirpichPust1400: 'kladka_ker_pust_1400', kirpichOblic: 'kladka_ker_pust_1000',
  kirpichSil1800: 'kladka_silikat_cps', kbBloki: 'kb_1000',
  granit: 'granit', izvestnyak: 'izvestnyak_1400',
  sosnaPoperek: 'sosna_poperek', sosnaVdol: 'sosna_vdol', dubPoperek: 'dub_poperek',
  fanera: 'fanera', dvp200: 'dvp_dsp_200', dsp800: 'dvp_dsp_800', gkl: 'gkl_1050',
  stal: 'stal', chugun: 'chugun', aluminiy: 'aluminiy', med: 'med',
  steklo: 'steklo', ruberoid: 'ruberoid', bitum: 'bitum_1200',
};
const OLD_LAMBDA = {
  ecovata: [0.038, 0.041], len: [0.045, 0.05], probka: [0.045, 0.05],
  osb: [0.13, 0.16], csp1150: [0.26, 0.30], gips1050: [0.35, 0.40],
  plitka: [1.05, 1.16], kirpichKlinker: [1.0, 1.05], kirpichSilPust: [0.70, 0.81],
  gazobeton300: [0.08, 0.09], gazobeton500: [0.12, 0.14], gazobeton700: [0.17, 0.19],
  penobeton550: [0.16, 0.19], shlak: [0.21, 0.24],
};

function migrateLayers(s) {
  for (const l of (s.layers || [])) {
    if (l.matId && OLD_TO_NEW[l.matId]) l.matId = OLD_TO_NEW[l.matId];
    else if (l.matId && OLD_LAMBDA[l.matId]) {
      l.matId = null;
      l.la = OLD_LAMBDA[l.matId][0];
      l.lb = OLD_LAMBDA[l.matId][1];
    }
    l.ovA = l.ovA ?? null;
    l.ovB = l.ovB ?? null;
    l.isIns = !!l.isIns;
  }
}

function migrateClimate(s) {
  if (!s.city || s.climateManual) {
    if (s.climate) {
      s.climate.tot10 = s.climate.tot10 ?? null;
      s.climate.zot10 = s.climate.zot10 ?? null;
      s.climate.zone = ['сухая', 'нормальная', 'влажная'].includes(s.climate.zone) ? s.climate.zone : null;
    }
    return;
  }
  const c = CITIES.find(x => x.n === s.city);
  if (c && s.climate) {
    s.climate.tot10 = c.tot10 ?? null;
    s.climate.zot10 = c.zot10 ?? null;
    s.climate.tm = c.tm ?? null;
    s.climate.em = c.em ?? null;
    s.climate.zone = c.z ?? s.climate.zone ?? null;
  }
}

function migrate(s) {
  if (!s) return null;
  if (s.constructions) {           // уже проектная модель — мигрируем слои и климат
    (s.constructions || []).forEach(migrateLayers);
    migrateClimate(s);
    if (s.adv) delete s.adv.n;
    return s;
  }
  // старая одиночная версия (teplo.state.v1) → проект с одной конструкцией
  const proj = {
    name: 'Объект (из сохранённого расчёта)',
    city: s.city ?? 'Москва',
    climateManual: !!s.climateManual,
    climate: s.climate ?? defaults().climate,
    building: s.building ?? 'residential',
    tin: s.tin ?? 20,
    phi: s.phi ?? 55,
    volume: null,
    height: null,
    constructions: [{
      id: uid(), kind: 'layered', name: 'Конструкция 1',
      construction: s.construction ?? 'wall',
      area: null, nt: 1,
      layers: s.layers ?? defaultLayers(),
      adv: s.adv && s.adv.n === undefined ? s.adv : { ...(s.adv || {}), n: undefined },
      uni: { mode: 'none', r: 1, elems: [] },
      area2: undefined,
      ground: defaultConstruction('').ground,
      opening: defaultConstruction('').opening,
    }],
  };
  delete proj.constructions[0].adv.n;
  migrateLayers(proj.constructions[0]);
  migrateClimate(proj);
  return proj;
}

function loadLS(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

let state = loadLS(LS.proj, null) || migrate(loadLS(LS.old, null)) || defaults();
const def = defaults();
for (const k of Object.keys(def)) if (state[k] === undefined) state[k] = def[k];
if (!state.constructions?.length) state.constructions = [defaultConstruction('Конструкция 1')];

init(state, {
  save: () => { try { localStorage.setItem(LS.proj, JSON.stringify(state)); } catch {} },
  getCustom: () => loadLS(LS.custom, []),
  setCustom: v => { try { localStorage.setItem(LS.custom, JSON.stringify(v)); } catch {} },
  getSaved: () => loadLS(LS.saved, []),
  setSaved: v => { try { localStorage.setItem(LS.saved, JSON.stringify(v)); } catch {} },
  getCities: () => loadLS(LS.cities, []),
  setCities: v => { try { localStorage.setItem(LS.cities, JSON.stringify(v)); } catch {} },
  defaults,
  newConstruction: defaultConstruction,
  uid,
});

// Service worker — только на http(s) и не на localhost (чтобы при локальной
// разработке правки подхватывались без сброса кеша)
const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !isLocalhost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('update-banner')?.classList.remove('hidden');
          }
        });
      });
    }).catch(() => {});
    document.getElementById('btn-update')?.addEventListener('click', () => {
      navigator.serviceWorker.controller?.postMessage('SKIP_WAITING');
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  });
}
