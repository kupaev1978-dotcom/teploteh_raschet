#!/usr/bin/env python3
"""Извлечение климатических параметров из официального текста СП 131.13330.2025
(дамп /tmp/sp131.txt официального PDF, получен через pypdfium2).

Источники данных в документе:
  — таблица 5.1 (стр. 10–43 PDF): t⁵ пятидневки 0,92; периоды ≤0/≤8/≤10 °С;
    макс. из средних скоростей ветра по румбам за январь;
  — таблица 7.1 (стр. 82–105): средние месячные температуры воздуха;
  — таблица 11.1 (стр. 169–191): средние месячные и годовое парциальные
    давления водяного пара, гПа.

Выход: /tmp/cities_full.json — все пункты документа. Зона влажности z
проставляется только для городов из прежней базы (z=null — по карте прил. А).
"""
import json
import re
import sys

NUM = re.compile(r'^-?\d+(?:[.,]\d+)?$')


def norm(s):
    return (s.replace('-', '').replace('ё', 'е').lower()
             .replace(',', '').replace(' ', '')
             .replace('(', '').replace(')', '').replace('.', '').strip())


def clean(s):
    return re.sub(r'[\x00-\x1f\u00ad]', '', s).strip(' .')


def is_region_text(text):
    """Строка без чисел — кандидат в названия региона."""
    if not (3 < len(text) < 80):
        return False
    bad = ('СП 131', '======', 'Т а б л и ц а', 'Республика, край',
           'округ, область', 'область, пункт', 'область,',
           'обеспечен', 'продолж', 'температ', 'амплитуд', 'влажност',
           'осадк', 'направл', 'скорост', '°С', 'сут', 'стью', 'тура',
           'ция', 'макс', 'средн', 'количе', 'номер', 'январь', 'декабрь',
           'пункт', ' I ', 'II ', 'IIX', 'VIII', 'XI ')
    return not any(b in text for b in bad) and not re.search(r'(?:^|\s)I{2,}', text)


def clean_region(text):
    t = ' '.join(text.split())
    if not is_region_text(t) or len(t) > 60:
        return ''
    return t


def parse_table(pages, lo, hi):
    """Парсит таблицы `название v1..vn` (числа могут прерываться буквенными
    колонками и прочерками). Возвращает dict name -> {vals (с None), region}."""
    data = {}
    region = ''  # текущий регион: последняя валидная строка без чисел
    for chunk in pages[1:]:
        pageno, _, body = chunk.partition('=====')
        try:
            p = int(pageno)
        except ValueError:
            continue
        if not (lo <= p <= hi):
            continue
        for line in body.split('\n'):
            line = line.strip()
            if not line or 'Республика, край' in line or 'Т а б л и ц а' in line:
                continue
            toks = line.split()
            first_val = len(toks)
            for i, t in enumerate(toks):
                if i == 0 and not NUM.match(t):
                    continue
                if NUM.match(t) or t in ('-', '—', '–'):
                    first_val = i
                    break
            if first_val == len(toks):
                text = clean(' '.join(toks))
                if is_region_text(text):
                    region = text
                continue
            name = clean(' '.join(toks[:first_val]))
            if len(name) < 3:
                continue
            vals = []
            for t in toks[first_val:]:
                if NUM.match(t):
                    vals.append(float(t.replace(',', '.')))
                elif t in ('-', '—', '–'):
                    vals.append(None)
                else:
                    break  # буквенные колонки (направление ветра) — конец первой серии
            # хвостовые числа после буквенной колонки (скорости ветра)
            tail = []
            for t in toks[first_val + len(vals):]:
                if NUM.match(t):
                    tail.append(float(t.replace(',', '.')))
                elif t in ('-', '—', '–'):
                    tail.append(None)
                # буквенные токены (направление ветра) пропускаем
            if len(vals) < 3:
                continue
            data[name] = {'vals': vals, 'tail': tail, 'region': region}
    return data


def main(dump):
    pages = open(dump, encoding='utf-8').read().split('===== PAGE ')

    five = parse_table(pages, 10, 43)
    monthly = parse_table(pages, 82, 105)
    vapor = parse_table(pages, 169, 191)

    # зоны влажности из прежней базы (по строкам «n: "…" … z: "…"»)
    old_zones = {}
    try:
        src = open('data/cities.js', encoding='utf-8').read()
        for line in src.split('\n'):
            if 'n: "' in line and 'z: "' in line:
                n = re.search(r'n: "([^"]+)"', line)
                z = re.search(r'z: "([^"]+)"', line)
                if n and z:
                    old_zones[norm(n.group(1))] = z.group(1)
    except FileNotFoundError:
        pass

    nf = {norm(k): k for k in five}
    nm = {norm(k): k for k in monthly}
    nv = {norm(k): k for k in vapor}

    # названия, различающиеся между таблицами из-за переносов строк в PDF:
    # ключ в базе приложения (norm) → ключ в конкретной таблице (norm)
    ALIAS = {
        'александровсксахалинский': {'monthly': 'александровск'},
        'никольское': {'monthly': 'оберинганикольское', 'vapor': 'оберинганикольское', 'five': 'оберинганикольское'},
        'великийновгород': {'vapor': 'новгород'},
    }
    def lookup(table, key):
        d = {'five': nf, 'monthly': nm, 'vapor': nv}[table]
        if key in d:
            return d[key]
        for city_k, maps in ALIAS.items():
            if key == city_k and table in maps:
                if maps[table] in d:
                    return d[maps[table]]
        return None

    # регионы: приоритет у таблиц с короткими заголовками (7.1, 11.1)
    region_of = {}
    for src_t in (monthly, vapor):
        for k, row in src_t.items():
            r = clean_region(row['region'])
            if r and norm(k) not in region_of:
                region_of[norm(k)] = r
    for k, row in five.items():
        r = clean_region(row['region'])
        if r and norm(k) not in region_of:
            region_of[norm(k)] = r

    cities = []
    for key in nf:
        f = five[nf[key]]
        v = f['vals']
        if v[3] is None or v[10] is None or v[9] is None or v[12] is None or v[11] is None:
            continue
        wind = [x for x in f['tail'] if x is not None]
        rec = {
            'n': nf[key],
            'g': region_of.get(key, ''),
            't5': v[3],
            'tot': v[10],
            'zot': int(v[9]),
            'tot10': v[12],
            'zot10': int(v[11]),
            'v1': wind[0] if wind else None,
            'v2': wind[1] if len(wind) > 1 else None,
            'z': old_zones.get(key),
        }
        mk = lookup('monthly', key)
        m = monthly.get(mk) if mk else None
        if m and all(x is not None for x in m['vals'][:12]):
            rec['tm'] = [round(x, 1) for x in m['vals'][:12]]
        vk = lookup('vapor', key)
        vp = vapor.get(vk) if vk else None
        if vp and all(x is not None for x in vp['vals'][:12]):
            rec['em'] = [round(x * 100) for x in vp['vals'][:12]]  # гПа → Па
        cities.append(rec)

    for c in cities:
        if c['n'] == 'АлександровскСахалинский':
            c['n'] = 'Александровск-Сахалинский'
        elif c['n'] == '(Никольское)':
            c['n'] = 'о. Беринга (Никольское)'
    cities.sort(key=lambda r: (r['g'], r['n']))
    wm = sum(1 for c in cities if 'tm' in c)
    wv = sum(1 for c in cities if 'em' in c)
    wv1 = sum(1 for c in cities if c['v1'])
    print(f'пунктов: {len(cities)} | с месячными t: {wm} | с давлениями: {wv} | с ветром: {wv1}')
    for probe in ['Санкт-Петербург', 'Москва', 'Якутск', 'Сочи', 'Абакан', 'Орел']:
        c = next((x for x in cities if norm(x['n']) == norm(probe)), None)
        if c:
            print(probe, {k: c[k] for k in ('t5', 'tot', 'zot', 'g', 'z', 'v1')},
                  'tm:', c.get('tm', [])[:3], 'em:', c.get('em', [])[:3])
    json.dump(cities, open('/tmp/cities_full.json', 'w', encoding='utf-8'),
              ensure_ascii=False)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/sp131.txt'))
