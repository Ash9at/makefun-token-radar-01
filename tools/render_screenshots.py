#!/usr/bin/env python3
"""Render the dashboard's four screenshots with a headless Chromium.

Usage:
    python3 tools/render_screenshots.py <dashboard-index-url> <out-dir>

Captures, at 1440 wide:
    1-board.jpg     the board, unfiltered (1440 tall: the judge meets the
                    entry as a thumbnail, so the board capture shows as
                    many ranked rows as the 1440 long-side limit allows)
    2-accuracy.jpg  the model-accuracy section (hash state, 1200 tall)
    3-detail.jpg    the detail view of one protocol (hash state, 1400 tall)
    4-filtered.jpg  the board filtered to one category (hash state, 1440 tall)

Each capture is converted to JPEG with the highest quality whose size stays
under ~260 KB. The ceiling is set by the dossier, not by taste: the dossier
inlines the images as base64 (x1.37) under a 1.5 MiB cap alongside the
dashboard text, so four captures at ~260 KB leave it ~150 KB of headroom.
(Three captures could afford ~340 KB each; four cannot.) No capture's long
side exceeds 1440 px. Requires a Chromium binary (CHROME env var or
/opt/meta-chromium/chrome) and Pillow.
"""
import glob
import io
import os
import subprocess
import sys
import urllib.parse

from PIL import Image


def find_chrome() -> str:
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    shells = sorted(glob.glob("/tmp/shots-env/browsers/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell"))
    if shells:
        return shells[-1]
    return "/opt/meta-chromium/chrome"


CHROME = find_chrome()
WIDTH, HEIGHT = 1440, 1100
BOARD_HEIGHT = 1440
TARGET_MAX = 260_000


def capture(url: str, png_path: str, height: int) -> None:
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--virtual-time-budget=6000",
            f"--window-size={WIDTH},{height}",
            f"--screenshot={png_path}",
            url,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def to_jpeg(png_path: str, jpg_path: str) -> int:
    img = Image.open(png_path).convert("RGB")
    best = None
    for quality in (95, 92, 89, 86, 83, 80, 76, 72):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        size = buf.tell()
        best = (buf, size)
        if size <= TARGET_MAX:
            break
    buf, size = best
    with open(jpg_path, "wb") as f:
        f.write(buf.getvalue())
    return size


def main() -> int:
    base_url, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    # The detail and filter targets are read from the generated data by the
    # caller through environment variables, with sensible defaults.
    detail_slug = os.environ.get("SHOT_DETAIL_SLUG", "")
    filter_cat = os.environ.get("SHOT_FILTER_CAT", "RWA")
    views = [
        ("1-board.jpg", base_url, BOARD_HEIGHT),
        ("2-accuracy.jpg", f"{base_url}#view=accuracy", 1200),
        ("3-detail.jpg", f"{base_url}#detail={urllib.parse.quote(detail_slug)}", 1400),
        ("4-filtered.jpg", f"{base_url}#cat={urllib.parse.quote(filter_cat)}", BOARD_HEIGHT),
    ]
    for name, url, height in views:
        png_path = os.path.join(out_dir, name.replace(".jpg", ".png"))
        jpg_path = os.path.join(out_dir, name)
        capture(url, png_path, height)
        size = to_jpeg(png_path, jpg_path)
        os.remove(png_path)
        print(f"{name}: {size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
