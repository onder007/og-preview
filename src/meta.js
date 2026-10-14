// Pure logic: turn the <meta> tags of a page into card data and an issue list.
// No chrome.* or DOM access here except collectMeta, which runs inside the page.

export const LIMITS = {
  title: 60,
  description: 160,
  minWidth: 1200,
  minHeight: 630,
  ratio: 1.91,
  ratioTolerance: 0.1,
  imageTimeout: 10, // seconds before an image that has not loaded counts as failed
};

const TWITTER_CARDS = ['summary', 'summary_large_image', 'app', 'player'];

// Injected with chrome.scripting.executeScript, so it must stay self-contained.
export function collectMeta() {
  return {
    url: location.href,
    title: document.title,
    metas: [...document.querySelectorAll('meta[property], meta[name]')].map((el) => [
      el.getAttribute('property') || el.getAttribute('name'),
      el.getAttribute('content') || '',
    ]),
  };
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

// What each platform would read. Image is '' when the tag is missing or relative,
// because crawlers cannot use a relative URL either.
export function buildCards(page) {
  const m = toMap(page.metas);
  const pick = (...keys) => keys.map((k) => m[k]).find(Boolean) || '';
  const absolute = (url) => (isAbsolute(url) ? url : '');
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

// URL to measure: the og:image (or twitter:image) resolved against the page.
export function imageUrl(page) {
  const m = toMap(page.metas);
  const raw = m['og:image'] || m['og:image:url'] || m['twitter:image'] || '';
  return raw ? resolve(raw, page.url) : '';
}

// imageSize: {width, height} once loaded, null if it failed or timed out, undefined if not checked.
export function findIssues(page, imageSize) {
  const m = toMap(page.metas);
  const issues = [];
  const error = (text) => issues.push({ level: 'error', text });
  const warn = (text) => issues.push({ level: 'warn', text });

  const ogImage = m['og:image'] || m['og:image:url'];
  if (!ogImage) error('Missing og:image. Links will be shared without a picture.');
  for (const key of ['og:image', 'og:image:url', 'twitter:image']) {
    if (m[key] && !isAbsolute(m[key])) {
      error(`${key} is a relative URL ("${m[key]}"). Crawlers need an absolute https:// URL.`);
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

  return issues;
}
