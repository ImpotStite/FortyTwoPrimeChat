"""One-off: tight square crop of FortyTwo Prime mark PNG for public assets."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Match --ft-lime (#d0ff00)
LIME = (208, 255, 0)


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: crop-brand-mark.py <src.png> <dst.png>", file=sys.stderr)
        sys.exit(2)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    im = Image.open(src).convert("RGB")
    a = np.array(im)
    gray = a.mean(axis=2)
    fg = gray < 100
    if not fg.any():
        fg = gray < 150
    ys, xs = np.where(fg)
    pad = max(4, int(0.06 * max(im.size)))
    x0, x1 = int(xs.min()) - pad, int(xs.max()) + pad
    y0, y1 = int(ys.min()) - pad, int(ys.max()) + pad
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(im.width - 1, x1), min(im.height - 1, y1)
    cropped = im.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = cropped.size
    side = max(w, h)
    sq = Image.new("RGB", (side, side), LIME)
    ox, oy = (side - w) // 2, (side - h) // 2
    sq.paste(cropped, (ox, oy))
    dst.parent.mkdir(parents=True, exist_ok=True)
    sq.save(dst, "PNG")
    print(dst, sq.size)


if __name__ == "__main__":
    main()
