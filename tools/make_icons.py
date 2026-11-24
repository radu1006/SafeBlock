#!/usr/bin/env python3
"""Generate the SafeBlock toolbar icons.

This repository has no image tooling and no build step, so the four PNGs in
``icons/`` are produced by this script and committed next to it.  It uses the
Python standard library only (``zlib``/``struct``/``math``) and writes 8-bit
RGBA PNGs with a transparent background:

    python3 tools/make_icons.py

The artwork is a brand-green shield with a darker rim and a white "block" mark
(a disc with a diagonal bar through it).  Everything is drawn from normalised
coordinates, so all four sizes share one design, and each pixel is sampled
4x4 times for anti-aliasing.  The output is deterministic: two consecutive
runs produce byte-identical files.
"""

import math
import os
import struct
import zlib

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(REPO_ROOT, "icons")

# Palette.  The brand green stays the shield fill so the icon is recognisably
# SafeBlock; the darker green rim keeps the silhouette readable on a dark
# toolbar, and the mark is plain white for contrast at every size.
GREEN = (0x1B, 0x5E, 0x20)
GREEN_DARK = (0x0F, 0x3D, 0x14)
WHITE = (0xFF, 0xFF, 0xFF)

# Shield geometry, in canvas units (the canvas is 1.0 by 1.0).
MARGIN = 0.055         # gap between the shield and the canvas edge
TOP = 0.035            # y of the shield's top edge
BOTTOM = 0.975         # y of the shield's tip
CORNER = 0.11          # radius of the rounded top corners
SHOULDER = 0.58        # where the straight sides start tapering, as a
                       # fraction of the shield height
TAPER = 1.35           # exponent of the bottom taper: higher is narrower
RIM = 0.035            # width of the darker outline

# White "block" mark: a disc with a diagonal bar cut through it.
DISC_DY = 0.43         # disc centre, as a fraction of the shield height
DISC_R = 0.30          # disc radius
BAR_HALF = 0.40        # half length of the diagonal bar
BAR_HALF_WIDTH = 0.06  # half thickness of the diagonal bar (about 2 px at 16)


def shield_half_width(y, grow=0.0):
    """Return the shield's half width at height *y*, or -1.0 outside it.

    *grow* inflates the silhouette, which is how the rim is drawn: the outline
    is the same shape, shifted outwards by ``RIM``.
    """
    top = TOP - grow
    bottom = BOTTOM + grow
    half = 0.5 - MARGIN + grow
    corner = CORNER + grow
    if y < top or y > bottom:
        return -1.0
    if y < top + corner:
        # Rounded top corner: a quarter circle centred on the corner axis.
        dy = top + corner - y
        return (half - corner) + math.sqrt(max(corner * corner - dy * dy, 0.0))
    shoulder = top + SHOULDER * (bottom - top)
    if y <= shoulder:
        return half
    # Taper to the tip.  The power keeps the sides wide for most of the drop
    # and then closes them quickly, which reads as a shield at 16 px too.
    t = (y - shoulder) / (bottom - shoulder)
    return half * (1.0 - t ** TAPER) ** 0.9


def inside_shield(x, y, grow=0.0):
    return abs(x - 0.5) <= shield_half_width(y, grow)


def inside_disc(x, y):
    dy = y - (TOP + DISC_DY * (BOTTOM - TOP))
    dx = x - 0.5
    return dx * dx + dy * dy <= DISC_R * DISC_R


def inside_bar(x, y):
    """True inside the thick diagonal bar that cuts through the disc."""
    # Distance to a line segment through the disc centre at 45 degrees.
    dx = x - 0.5
    dy = y - (TOP + DISC_DY * (BOTTOM - TOP))
    u = math.sqrt(0.5)                 # unit direction (1, -1) / sqrt(2)
    along = (dx - dy) * u              # projection onto the bar's axis
    if not -BAR_HALF <= along <= BAR_HALF:
        return False
    across = (dx + dy) * u             # distance from the bar's axis
    return abs(across) <= BAR_HALF_WIDTH


def sample_colour(x, y):
    """Return the RGB colour of one sample point, or None if transparent."""
    if not inside_shield(x, y, RIM):
        return None
    if inside_shield(x, y):
        if inside_disc(x, y) and not inside_bar(x, y):
            return WHITE
        return GREEN
    return GREEN_DARK


def render(size):
    """Return *size* x *size* RGBA pixels, 4-tuple per pixel, row by row."""
    step = 1.0 / (size * SUPERSAMPLE)
    total = SUPERSAMPLE * SUPERSAMPLE
    pixels = []
    for py in range(size):
        for px in range(size):
            r = g = b = 0.0
            covered = 0
            for sy in range(SUPERSAMPLE):
                y = (py * SUPERSAMPLE + sy + 0.5) * step
                for sx in range(SUPERSAMPLE):
                    x = (px * SUPERSAMPLE + sx + 0.5) * step
                    colour = sample_colour(x, y)
                    if colour is None:
                        continue
                    covered += 1
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
            if not covered:
                pixels.append((0, 0, 0, 0))
                continue
            pixels.append((
                int(round(r / covered)),
                int(round(g / covered)),
                int(round(b / covered)),
                int(round(255 * covered / total)),
            ))
    return pixels


def png_chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def encode_png(size, pixels):
    """Encode RGBA pixels as an 8-bit, colour type 6 PNG (no interlacing)."""
    raw = bytearray()
    for row in range(size):
        raw.append(0)                       # filter type 0: none
        for col in range(size):
            raw.extend(pixels[row * size + col])
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", header)
            + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + png_chunk(b"IEND", b""))


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(ICON_DIR, "icon%d.png" % size)
        data = encode_png(size, render(size))
        with open(path, "wb") as handle:
            handle.write(data)
        print("wrote %s (%d bytes)" % (os.path.relpath(path, REPO_ROOT),
                                       len(data)))


if __name__ == "__main__":
    main()
