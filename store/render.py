"""Render the toolbar icons and the Chrome Web Store images.

Usage: python store/render.py [icons|store]   (needs `pip install playwright`, default: both)
icons: store/icon.svg -> public/icons/icon{16,32,48,128}.png. Run `npm run build` afterwards.
store: needs a built dist/ and network access. Loads the extension like scripts/screenshot.py and
captures the real popup at 2x on the live https://onderbakir.com and on two local copies of it with
typical mistakes (store/pages, served on localhost:3000 and localhost:5173). Writes
store/out/screenshot-1..4.png (1280x800) and store/out/promo-small-440x280.png.
"""
import base64
import functools
import http.server
import json
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from screenshot import extension_id  # noqa: E402

STORE = ROOT / "store"
OUT = STORE / "out"
PAGES = STORE / "pages"
ICONS = ROOT / "public" / "icons"
# Local pages: port -> directory. Both stand in for unpublished builds of onderbakir.com.
SERVERS = {3000: PAGES / "staging", 5173: PAGES / "spa"}
ICON = (STORE / "icon.svg").read_text()
FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

LIGHT = {"bg": "#f3f3f1", "text": "#1a1a1a", "muted": "#5f6368", "line": "#e3e3e3"}
DARK = {"bg": "#121212", "text": "#ececec", "muted": "#a5a8ad", "line": "#3a3a3a"}

# (page URL, color scheme, first element shown or None for the top, popup scale, headline, sub)
SHOTS = [
    ("http://localhost:3000/", "light", None, 1.15, "See which tags break your link preview",
     "Errors and warnings for og:image, title, description and twitter:card, checked on the HTML your server sends."),
    ("https://onderbakir.com/", "light", "section:nth-of-type(2) h2", 0.85, "Preview the card on X, LinkedIn and WhatsApp",
     "Each preview uses the fallbacks of its platform. X reads twitter:* first. LinkedIn and WhatsApp read og:*."),
    ("http://localhost:5173/", "light", None, 1.15, "Catch tags that only JavaScript sets",
     "Social crawlers read the HTML your server sends. OG Preview compares it with the live page."),
    ("http://localhost:3000/", "dark", ".suggest", 1.15, "Copy a ready &lt;meta&gt; block",
     "It takes the values from the live page and resolves a relative image URL. Dark mode follows your system."),
]
CARD_H = 688


def icon_svg(size, padded=False):
    # The 128 store icon keeps the 16px transparent padding Chrome expects; smaller icons use the tile only.
    box = "0 0 128 128" if padded else "16 16 96 96"
    return ICON.replace('width="128" height="128" viewBox="0 0 128 128"', f'width="{size}" height="{size}" viewBox="{box}"')


def render(page, html, out, w, h, transparent=False):
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(html)
    page.wait_for_timeout(150)
    out.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out), omit_background=transparent, clip={"x": 0, "y": 0, "width": w, "height": h})
    print("wrote", out.relative_to(ROOT), f"{w}x{h}")


def icons(page):
    for size in (16, 32, 48, 128):
        html = f"<body style='margin:0;background:transparent'>{icon_svg(size, padded=size == 128)}</body>"
        render(page, html, ICONS / f"icon{size}.png", size, size, transparent=True)


def make_square_image(ctx):
    # The staging page's og:image: a square 800x800 version of the live 1200x630 card, which trips the size and ratio checks.
    out = SERVERS[3000] / "og-square.png"
    if out.exists():
        return
    page = ctx.new_page()
    page.set_viewport_size({"width": 800, "height": 800})
    page.set_content(
        """<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
        <body style="margin:0;width:800px;height:800px;background:#0b0b0c;color:#f2f1ed;font-family:'Inter Tight';
        padding:64px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between">
        <div style="font-size:30px;font-weight:600">Önder Bakır</div>
        <div style="font-size:120px;font-weight:700;line-height:.95;letter-spacing:-0.04em">Software<br><span style="color:#7d7d7d">Developer</span></div>
        <div style="font:20px 'JetBrains Mono';letter-spacing:.12em;color:#9a9a9a;border-top:1px solid #333;padding-top:24px">ONDERBAKIR.COM</div></body>"""
    )
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(out), scale="css")
    page.close()


def capture_popups():
    """Return [(png bytes, offset in CSS px)] for SHOTS, taken from the built extension at 2x."""
    quiet = type("Quiet", (http.server.SimpleHTTPRequestHandler,), {"log_message": lambda *a: None})
    servers = [http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(quiet, directory=str(path)))
               for port, path in SERVERS.items()]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    tmp = Path(tempfile.mkdtemp())
    ext = tmp / "ext"
    shutil.copytree(ROOT / "dist", ext)
    manifest = json.loads((ext / "manifest.json").read_text())
    # activeTab is only granted by a real click on the toolbar icon, so the test copy gets host permissions instead.
    manifest["host_permissions"] = [f"http://localhost:{port}/*" for port in SERVERS] + ["https://onderbakir.com/*"]
    (ext / "manifest.json").write_text(json.dumps(manifest))
    ext_id = extension_id(ext)
    crops = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profile"), channel="chromium", headless=True, device_scale_factor=2,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        make_square_image(ctx)
        for url, scheme, start, *_ in SHOTS:
            target = ctx.new_page()
            target.goto(url)
            popup = ctx.new_page()
            popup.set_viewport_size({"width": 400, "height": 600})
            popup.emulate_media(color_scheme=scheme)
            popup.goto(f"chrome-extension://{ext_id}/index.html")
            tab_id = popup.evaluate("async (u) => (await chrome.tabs.query({ url: u }))[0].id", target.url)
            popup.goto(f"chrome-extension://{ext_id}/index.html?tab={tab_id}")
            popup.wait_for_selector("section")
            popup.wait_for_load_state("networkidle")
            print(url, scheme, "issues:", popup.locator(".issues li").count())
            offset = 0
            if start:
                offset = popup.evaluate("(s) => document.querySelector(s).getBoundingClientRect().top + scrollY - 10", start)
            crops.append((popup.screenshot(full_page=True), offset))
            target.close()
            popup.close()
        ctx.close()
    for server in servers:
        server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    return crops


def screenshot_html(png, offset, scale, dark, headline, sub):
    c = DARK if dark else LIGHT
    width = round(400 * scale)
    left = 1280 - 96 - width
    src = "data:image/png;base64," + base64.b64encode(png).decode()
    return f"""<body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative;background:{c['bg']};
      font-family:{FONT};color:{c['text']}">
      <div style="position:absolute;left:96px;top:72px;display:flex;align-items:center;gap:12px;font-size:18px;font-weight:600">
        {icon_svg(36)}OG Preview</div>
      <div style="position:absolute;left:96px;top:0;bottom:0;width:{left - 96 - 72}px;display:flex;flex-direction:column;justify-content:center">
        <div style="font-size:46px;font-weight:650;letter-spacing:-0.02em;line-height:1.1">{headline}</div>
        <div style="font-size:21px;line-height:1.5;color:{c['muted']};margin-top:20px">{sub}</div>
      </div>
      <div style="position:absolute;left:{left}px;top:{(800 - CARD_H) // 2}px;width:{width}px;height:{CARD_H}px;overflow:hidden;
        border:1px solid {c['line']};border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,{'.5' if dark else '.12'})">
        <img src="{src}" style="display:block;width:{width}px;margin-top:{-round(offset * scale)}px">
      </div></body>"""


def promo_small_html():
    return f"""<body style="margin:0;width:440px;height:280px;background:#1a1a1a;font-family:{FONT};color:#ececec;
      display:flex;align-items:center;gap:22px;padding:0 34px;box-sizing:border-box">
      {icon_svg(96)}
      <div><div style="font-size:32px;font-weight:700;letter-spacing:-0.02em;line-height:1.1">OG Preview</div>
      <div style="font-size:17px;color:#a5a8ad;margin-top:8px;line-height:1.35">Check your link card<br>before you share it</div></div></body>"""


def store(page, crops):
    for n, ((png, offset), (_, scheme, _, scale, headline, sub)) in enumerate(zip(crops, SHOTS), 1):
        render(page, screenshot_html(png, offset, scale, scheme == "dark", headline, sub), OUT / f"screenshot-{n}.png", 1280, 800)
    render(page, promo_small_html(), OUT / "promo-small-440x280.png", 440, 280)


if __name__ == "__main__":
    jobs = sys.argv[1:] or ["icons", "store"]
    # capture_popups runs its own Playwright session. Sync sessions cannot nest.
    crops = capture_popups() if "store" in jobs else None
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        if "icons" in jobs:
            icons(page)
        if crops:
            store(page, crops)
        browser.close()
