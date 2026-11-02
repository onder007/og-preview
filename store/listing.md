# Chrome Web Store listing kit (0.1.0)

Paste these fields into the Chrome Web Store Developer Dashboard. Upload package: `og-preview-0.1.0.zip`, built with

```bash
npm run build && (cd dist && zip -r ../og-preview-0.1.0.zip .)
```

Images: `python store/render.py` writes the icons to `public/icons/` and the store images to `store/out/`.

## Store listing

**Name** (from manifest): `OG Preview`

**Summary** (from `description` in `manifest.json`, max 132):
```text
See which Open Graph tags need fixing and how the current page looks when shared on X, LinkedIn and WhatsApp.
```

**Category:** Developer Tools · **Language:** English

### Description
```text
OG Preview shows how the page in your current tab will look when its link is shared. It also lists the Open Graph and Twitter Card tags that need fixing.

It reads the tags from the open tab, so it works on staging and localhost too. You do not need a public URL or a separate debugger for each platform.

WHAT IT CHECKS
- og:image: missing, a relative URL, or on localhost or a private IP while the page is public
- The image: fails to load, smaller than 1200x630 or far from the 1.91:1 ratio
- og:title: missing or longer than 60 characters
- og:description: missing or longer than 160 characters
- twitter:card: missing or not a valid card type
- Tags that differ between the served HTML and the live page

THE HTML CRAWLERS READ
Social crawlers usually do not run JavaScript. OG Preview requests the page again from inside the tab and checks the HTML the server sends. A tag that only a client-side router adds shows up as a warning instead of passing.

COPY THE FIX
When a tag is missing, broken or set only by JavaScript, the popup shows a ready <meta> block with a Copy button. It takes the values from the live page.

CARD PREVIEWS
Approximate X, LinkedIn and WhatsApp cards that follow the fallbacks of each platform. Platforms change their designs and cache old previews, so check their own debuggers before a big launch.

PRIVATE BY DESIGN
Two permissions: activeTab and scripting. The extension runs only when you click its icon. It contacts no server apart from the page in the tab and its preview image. It stores nothing and has no analytics.

Open source, MIT license: https://github.com/onder007/og-preview
Privacy policy: https://github.com/onder007/og-preview/blob/main/PRIVACY.md
```

### Graphics
- Store icon 128x128: `public/icons/icon128.png`
- Screenshots 1280x800: `store/out/screenshot-1.png` … `screenshot-4.png`
- Small promo tile 440x280: `store/out/promo-small-440x280.png`

### Additional fields
- Homepage URL: `https://github.com/onder007/og-preview`
- Support URL: `https://github.com/onder007/og-preview/issues`

## Privacy practices tab

**Single purpose:**
```text
OG Preview shows how the current page will look when its link is shared on social platforms and lists the Open Graph and Twitter Card tags that need fixing.
```

**Permission justifications:**
- `activeTab`
  ```text
  Gives the popup access to the current tab only, after the user clicks the toolbar icon, to read the page address and its <meta> tags. The extension never runs on other tabs or without a click.
  ```
- `scripting`
  ```text
  Injects one read-only function into the current tab after the user clicks the icon. It reads the <meta> tags of the live page and requests the page's own URL once more from inside the tab (at most 1 MB, 8 second timeout) to read the HTML the server sends, which is what social crawlers see.
  ```

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Website content** (the meta tags and HTML of the current tab are processed in the popup and never leave the device). Do not tick the others.
Then tick all three certifications (not sold to third parties, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** `https://github.com/onder007/og-preview/blob/main/PRIVACY.md`

## Distribution
- Visibility: Public. Regions: all.
