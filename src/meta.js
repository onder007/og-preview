// Pure logic: turn the <meta> tags of a page into card data and an issue list.
// No chrome.* or DOM access here except collectMeta, which runs inside the page.
// buildCards, imageUrl and findIssues take the collected page and use what crawlers see.

export const LIMITS = {
  title: 60,
  description: 160,
  minWidth: 1200,
  minHeight: 630,
  ratio: 1.91,
  ratioTolerance: 0.1,
  imageTimeout: 10, // seconds before an image that has not loaded counts as failed
  htmlTimeout: 8, // seconds to fetch the served HTML
  htmlBytes: 1_000_000, // read at most this much of the served HTML
};

const TWITTER_CARDS = ['summary', 'summary_large_image', 'app', 'player'];

// Injected with chrome.scripting.executeScript, so it must stay self-contained (limits come in as args).
// Reads the live DOM, then re-requests the page from inside it (same origin, like a reload) to read the
// HTML the server sends. Social crawlers read that HTML and usually do not run JavaScript.
export async function collectMeta(maxBytes, timeoutMs) {
  const read = (doc) => ({
    title: doc.title,
    metas: [...doc.querySelectorAll('meta[property], meta[name]')].map((el) => [
      el.getAttribute('property') || el.getAttribute('name'),
      el.getAttribute('content') || '',
    ]),
  });
  const page = { url: location.href, ...read(document) };
  try {
    const res = await fetch(location.href, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/html/i.test(res.headers.get('content-type') || '')) throw new Error('not an HTML response');
    const reader = res.body.getReader();
    const decoder = new TextDecoder(document.characterSet);
    let html = '';
    for (let bytes = 0; bytes < maxBytes; ) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel();
    page.served = read(new DOMParser().parseFromString(html, 'text/html'));
  } catch (err) {
    page.servedError = err.message;
  }
  return page;
}

// What crawlers read: the served HTML when it could be fetched, otherwise the live DOM.
export function crawlerView(page) {
  return page.served ? { url: page.url, ...page.served } : page;
}

// Share tags whose live value differs from the served HTML. Usually JavaScript set them after load, but a
// value that changes per request (a signed or cache-busting image URL) shows up here as well.
export function jsSetTags(page) {
  if (!page.served) return [];
  const live = toMap(page.metas);
  const served = toMap(page.served.metas);
  return Object.keys(live).filter((k) => /^(og:|twitter:|description$)/.test(k) && live[k] !== served[k]);
}

// First non-empty value wins, keys are case-insensitive.
export function toMap(metas) {
  const map = {};
  for (const [key, content] of metas) {
    const k = (key || '').trim().toLowerCase();
    const v = (content || '').trim();
    if (k && v && !(k in map)) map[k] = v;
  }
  return map;
}

export const isAbsolute = (url) => /^https?:\/\//i.test(url);

function resolve(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// localhost, names that never resolve publicly and loopback, private, shared or link-local IP literals
// (new URL already normalises 0x7f.1 and the like).
// ponytail: names that only resolve to a private IP (router.lan) are not caught; that needs a DNS lookup.
export function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  // Suffixes reserved for local use, not public domains: .local (mDNS), .internal, .test, .home.arpa.
  if (/(^|\.)(localhost|local|internal|test|home\.arpa)$/.test(h)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped, new URL rewrites it to hex) reaches the IPv4 address, so it counts as private too.
  if (h.includes(':')) return h === '::1' || h === '::' || h.startsWith('::ffff:') || /^(f[cd]|fe[89ab])/.test(h);
  // A single-label name is a Docker service or hosts-file entry (http://web:3000); '' is a page without a host.
  if (!h.includes('.')) return h !== '';
  // Only IPv4 literals: 0.gravatar.com and 10.cdn.example.com are public names.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return /^(0|10|127)\./.test(h) || /^(192\.168|169\.254)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h); // 100.64.0.0/10: carrier-grade NAT, Tailscale
}

// An image on a private address while the page itself is public: crawlers cannot fetch it (a typical
// leftover of a build-time base URL like http://localhost:3000). The popup does not load it either,
// so a page cannot use the extension to send requests into the local network.
export function isPrivateImage(url, pageUrl) {
  return isPrivateHost(hostOf(url)) && !isPrivateHost(hostOf(pageUrl));
}

// What each platform would read. Image is '' when the tag is missing, relative or on a private
// address, because crawlers cannot use those either.
export function buildCards(collected) {
  const page = crawlerView(collected);
  const m = toMap(page.metas);
  const pick = (...keys) => keys.map((k) => m[k]).find(Boolean) || '';
  const absolute = (url) => (isAbsolute(url) && !isPrivateImage(url, page.url) ? url : '');
  const domain = hostOf(pick('og:url') || page.url) || hostOf(page.url);

  const og = {
    title: pick('og:title') || page.title || '',
    description: pick('og:description', 'description'),
    image: absolute(pick('og:image', 'og:image:url', 'og:image:secure_url')),
    domain,
  };
  return {
    x: {
      large: m['twitter:card'] === 'summary_large_image',
      title: pick('twitter:title', 'og:title') || page.title || '',
      description: pick('twitter:description', 'og:description', 'description'),
      image: absolute(pick('twitter:image', 'twitter:image:src')) || og.image,
      domain,
    },
    linkedin: og,
    whatsapp: og,
  };
}

// URL to measure: the og:image (or twitter:image) resolved against the page, '' if it is on a private address.
export function imageUrl(collected) {
  const page = crawlerView(collected);
  const m = toMap(page.metas);
  const raw = m['og:image'] || m['og:image:url'] || m['twitter:image'] || '';
  const url = raw ? resolve(raw, page.url) : '';
  return isPrivateImage(url, page.url) ? '' : url;
}

// imageSize: {width, height} once loaded, null if it failed or timed out, undefined if not checked.
export function findIssues(collected, imageSize) {
  const page = crawlerView(collected);
  const m = toMap(page.metas);
  const issues = [];
  const error = (text) => issues.push({ level: 'error', text });
  const warn = (text) => issues.push({ level: 'warn', text });

  const ogImage = m['og:image'] || m['og:image:url'];
  if (!ogImage) error('Missing og:image. Links will be shared without a picture.');
  for (const key of ['og:image', 'og:image:url', 'twitter:image']) {
    if (m[key] && !isAbsolute(m[key])) {
      error(`${key} is a relative URL ("${m[key]}"). Crawlers need an absolute https:// URL.`);
    } else if (m[key] && isPrivateImage(m[key], page.url)) {
      error(`${key} points to a local or private address ("${m[key]}"). Crawlers cannot reach it.`);
    }
  }

  if (imageSize === null && (ogImage || m['twitter:image'])) {
    error(`The image failed to load or took longer than ${LIMITS.imageTimeout} seconds.`);
  } else if (imageSize) {
    const { width, height } = imageSize;
    if (width < LIMITS.minWidth || height < LIMITS.minHeight) {
      warn(`Image is ${width}x${height}, smaller than ${LIMITS.minWidth}x${LIMITS.minHeight}. It may look blurry or show as a small thumbnail.`);
    }
    const ratio = width / height;
    if (Math.abs(ratio - LIMITS.ratio) > LIMITS.ratioTolerance) {
      warn(`Image ratio is ${ratio.toFixed(2)}:1, not about ${LIMITS.ratio}:1. Platforms will crop it.`);
    }
  }

  const title = m['og:title'];
  if (!title) {
    if (page.title) warn('Missing og:title. Platforms fall back to the <title> tag.');
    else error('Missing og:title and <title>. The card will have no headline.');
  }
  const shownTitle = title || page.title || '';
  if (shownTitle.length > LIMITS.title) {
    warn(`Title is ${shownTitle.length} characters. Keep it under ${LIMITS.title} so it is not cut off.`);
  }

  const description = m['og:description'];
  if (!description) warn('Missing og:description.');
  else if (description.length > LIMITS.description) {
    warn(`Description is ${description.length} characters. Keep it under ${LIMITS.description}.`);
  }

  const card = m['twitter:card'];
  if (!card) warn('Missing twitter:card. Add summary_large_image to get a large image card on X.');
  else if (!TWITTER_CARDS.includes(card)) warn(`twitter:card "${card}" is not a valid card type.`);

  const jsTags = jsSetTags(collected);
  if (jsTags.length) {
    warn(`Differs from the served HTML, usually because JavaScript set it: ${jsTags.join(', ')}. Crawlers only see the served value.`);
  }

  return issues;
}

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A <meta> block to paste into the served HTML for the tags that are missing, broken or only set by
// JavaScript. Values come from the live page where it has them; '' when nothing is known.
export function suggestTags(collected) {
  const page = crawlerView(collected);
  const served = toMap(page.metas);
  const live = toMap(collected.metas);
  const fromJs = jsSetTags(collected);
  const needed = (key) => !served[key] || fromJs.includes(key);
  const tags = {};

  if (needed('og:title')) tags['og:title'] = live['og:title'] || page.title || collected.title || '';
  if (needed('og:description')) tags['og:description'] = live['og:description'] || live.description || served.description || '';
  const image = fromJs.includes('og:image') ? live['og:image'] : served['og:image'] || served['og:image:url'];
  if (!image || isPrivateImage(resolve(image, page.url), page.url)) tags['og:image'] = '';
  else if (!isAbsolute(image) || fromJs.includes('og:image')) tags['og:image'] = resolve(image, page.url);
  const card = served['twitter:card'];
  if (!card || !TWITTER_CARDS.includes(card) || fromJs.includes('twitter:card')) {
    tags['twitter:card'] = TWITTER_CARDS.includes(live['twitter:card']) ? live['twitter:card'] : 'summary_large_image';
  }
  for (const key of fromJs) if (!(key in tags)) tags[key] = live[key];

  const lines = Object.entries(tags).map(([key, value]) => {
    const attr = key.startsWith('og:') ? 'property' : 'name';
    return `<meta ${attr}="${key}" content="${escapeAttr(value)}">`;
  });
  if (tags['og:image'] === '') lines.unshift('<!-- Fill in og:image: an absolute https:// URL of a 1200x630 image. -->');
  return lines.join('\n');
}
