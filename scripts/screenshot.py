"""Load the built extension in headless Chromium and screenshot the popup on the fixture pages.

Usage: npm run build && python scripts/screenshot.py   (needs `pip install playwright`)
The popup is opened as a tab with ?tab=<id>. The test copy of the manifest gets a host
permission for 127.0.0.1, because activeTab is only granted by a real click on the toolbar icon.
Exits non-zero when a fixture shows an unexpected number of issues or the copy button fails.
"""
import functools
import hashlib
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "test" / "fixtures"
OUT = ROOT / "docs"
PORT = 41917


def extension_id(path):
    # Chrome derives an unpacked extension's id from the sha256 of its absolute path, hex mapped to a-p.
    digest = hashlib.sha256(os.path.realpath(path).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


def make_covers(browser):
    page = browser.new_page()
    for w, h in [(1200, 630), (800, 800)]:
        out = FIXTURES / f"cover-{w}x{h}.png"
        if out.exists():
            continue
        page.set_viewport_size({"width": w, "height": h})
        page.set_content(
            f"""<body style="margin:0;width:{w}px;height:{h}px;background:#14324a;color:#f4efe6;
            font:600 64px/1.15 Georgia,serif;display:flex;align-items:flex-end;padding:72px;box-sizing:border-box">
            <div>Build time notes<div style="font:400 28px system-ui;opacity:.7;margin-top:16px">{w} x {h}</div></div></body>"""
        )
        page.screenshot(path=str(out))
    page.close()


def main():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(FIXTURES))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    tmp = Path(tempfile.mkdtemp())
    ext = tmp / "ext"
    shutil.copytree(ROOT / "dist", ext)
    manifest = json.loads((ext / "manifest.json").read_text())
    manifest["host_permissions"] = [f"http://127.0.0.1:{PORT}/*"]
    (ext / "manifest.json").write_text(json.dumps(manifest))
    ext_id = extension_id(ext)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profile"),
            channel="chromium",
            headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        make_covers(ctx)
        failures = []
        for name, scheme, expected in [("good", "light", 0), ("bad", "light", 6), ("bad", "dark", 6), ("spa", "light", 2)]:
            target = ctx.new_page()
            target.goto(f"http://127.0.0.1:{PORT}/{name}.html")
            popup = ctx.new_page()
            popup.set_viewport_size({"width": 400, "height": 600})
            popup.emulate_media(color_scheme=scheme)
            popup.goto(f"chrome-extension://{ext_id}/index.html")
            tab_id = popup.evaluate(
                "async (u) => (await chrome.tabs.query({ url: u }))[0].id", target.url
            )
            popup.goto(f"chrome-extension://{ext_id}/index.html?tab={tab_id}")
            popup.wait_for_selector("section")
            popup.wait_for_load_state("networkidle")
            out = OUT / f"popup-{name}{'-dark' if scheme == 'dark' else ''}.png"
            popup.screenshot(path=str(out), full_page=True)
            count = popup.locator(".issues li").count()
            print(out, "issues:", count)
            if count != expected:
                failures.append(f"{name}: {count} issues, expected {expected}")
            if expected:
                # Every fixture with issues gets a suggested <meta> block; the button copies exactly that text.
                popup.click(".suggest button")
                popup.wait_for_selector(".suggest button:text('Copied')", timeout=2000)
                if popup.evaluate("navigator.clipboard.readText()") != popup.inner_text(".suggest pre"):
                    failures.append(f"{name}: clipboard does not match the suggested tags")
            target.close()
            popup.close()
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        sys.exit("FAIL\n" + "\n".join(failures))


if __name__ == "__main__":
    main()
