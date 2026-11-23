#!/usr/bin/env python3
"""Генерация PNG-иконок для PWA «ТеплоРасчёт».
Только stdlib (zlib + struct): рисуем термометр на градиенте,
рендер 2x со сглаживанием через box-даунскейл.
Запуск: python3 tools/gen_icons.py  (из корня проекта)
"""
import math
import os
import struct
import zlib

SS = 2  # суперсэмплинг


def make_canvas(w, h):
    return [[(0, 0, 0)] * (w * SS) for _ in range(h * SS)]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_bg(c, w, h, top, bottom):
    for y in range(h):
        color = lerp(top, bottom, y / (h - 1))
        row = c[y]
        for x in range(w):
            row[x] = color


def fill_circle(c, cx, cy, r, color, w, h):
    r2 = r * r
    x0, x1 = max(0, int(cx - r)), min(w, int(cx + r) + 1)
    y0, y1 = max(0, int(cy - r)), min(h, int(cy + r) + 1)
    for y in range(y0, y1):
        row = c[y]
        for x in range(x0, x1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                row[x] = color


def fill_rounded_rect(c, x0, y0, x1, y1, r, color, w, h):
    for y in range(max(0, y0), min(h, y1)):
        row = c[y]
        for x in range(max(0, x0), min(w, x1)):
            # расстояние до скруглённого прямоугольника
            dx = max(x0 + r - x, x - (x1 - r), 0)
            dy = max(y0 + r - y, y - (y1 - r), 0)
            if dx * dx + dy * dy <= r * r:
                row[x] = color


def draw_icon(size):
    w = h = size * SS
    c = make_canvas(size, size)
    gradient_bg(c, w, h, (14, 96, 145), (30, 58, 138))  # синий градиент

    # геометрия в координатах 512, масштабируем
    k = w / 512
    cx = 256 * k
    # трубка термометра (белая)
    tube_w = 56 * k
    tube_top = 96 * k
    tube_bot = 336 * k
    fill_rounded_rect(c, int(cx - tube_w / 2), int(tube_top), int(cx + tube_w / 2),
                      int(tube_bot), int(tube_w / 2), (245, 248, 252), w, h)
    # колба (белая)
    bulb_r = 78 * k
    bulb_cy = 392 * k
    fill_circle(c, int(cx), int(bulb_cy), int(bulb_r), (245, 248, 252), w, h)
    # ртуть: оранжевая
    mg_r = 30 * k
    fill_rounded_rect(c, int(cx - mg_r / 2), int(168 * k), int(cx + mg_r / 2),
                      int(tube_bot), int(mg_r / 2), (249, 115, 22), w, h)
    fill_circle(c, int(cx), int(bulb_cy), int(54 * k), (249, 115, 22), w, h)
    # риски справа
    tick_r = 5 * k
    for ty in (192, 256, 320):
        fill_rounded_rect(c, int(cx + tube_w / 2 + 18 * k), int(ty * k - tick_r),
                          int(cx + tube_w / 2 + 74 * k), int(ty * k + tick_r),
                          int(tick_r), (245, 248, 252), w, h)
    return c


def box_downscale(c, w, h, target):
    box = w // target
    out = []
    for ty in range(target):
        row = []
        for tx in range(target):
            r = g = b = 0
            for y in range(ty * box, (ty + 1) * box):
                src = c[y]
                for x in range(tx * box, (tx + 1) * box):
                    pr, pg, pb = src[x]
                    r += pr
                    g += pg
                    b += pb
            n = box * box
            row.append((r // n, g // n, b // n))
        out.append(row)
    return out


def png_bytes(c, w, h):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in c)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    for size in (180, 192, 512):
        canvas = draw_icon(size)
        small = box_downscale(canvas, size * SS, size * SS, size)
        path = os.path.join(out_dir, f"icon-{size}.png")
        with open(path, "wb") as f:
            f.write(png_bytes(small, size, size))
        print("OK", path)
    # favicon 48
    canvas = draw_icon(48)
    small = box_downscale(canvas, 48 * SS, 48 * SS, 48)
    with open(os.path.join(out_dir, "favicon-48.png"), "wb") as f:
        f.write(png_bytes(small, 48, 48))
    print("OK favicon-48.png")


if __name__ == "__main__":
    main()
