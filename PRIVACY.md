# Privacy policy

OG Preview is a Chrome extension. It collects no personal data and has no server of its own.

## What it reads

The extension does nothing until you click its icon. Then it reads the address and the `<meta>` tags of the current tab. It requests the same address once more from inside the tab, like a reload, to read the HTML the server sends (at most 1 MB, 8 second timeout). It loads the page's preview image to measure its size, unless the image is on `localhost`, a private IP or another local-only name while the page is public.

These requests go only to the site in the tab and to the host of its preview image. The results stay in the popup and disappear when you close it.

## What it does not do

- It stores nothing on your device or anywhere else.
- It sends nothing to the developer or to third parties.
- It has no analytics, no ads and no background script.

## Permissions

- `activeTab`: access to the current tab only, granted when you click the icon.
- `scripting`: runs the read-only function described above in that tab.

## Contact

Questions or problems: https://github.com/onder007/og-preview/issues

Last updated: 2 November 2026
