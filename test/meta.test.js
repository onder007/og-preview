import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMap, buildCards, findIssues, imageUrl, isAbsolute, isPrivateHost, jsSetTags, suggestTags } from '../src/meta.js';

const good = {
  url: 'https://www.example.com/post/1',
  title: 'Page title',
  metas: [
    ['og:title', 'A good title'],
    ['og:description', 'A short description.'],
    ['og:image', 'https://cdn.example.com/cover.png'],
    ['twitter:card', 'summary_large_image'],
  ],
};
const size = { width: 1200, height: 630 };
const texts = (issues) => issues.map((i) => i.text).join('\n');

test('toMap lowercases keys, trims, keeps the first non-empty value', () => {
  const m = toMap([['OG:Title', '  first '], ['og:title', 'second'], ['og:image', ''], ['og:image', 'x.png'], [null, 'y']]);
  assert.deepEqual(m, { 'og:title': 'first', 'og:image': 'x.png' });
});

test('isAbsolute accepts only http(s)', () => {
  assert.ok(isAbsolute('https://a.com/x.png'));
  assert.ok(isAbsolute('HTTP://a.com/x.png'));
  assert.ok(!isAbsolute('/x.png'));
  assert.ok(!isAbsolute('//cdn.a.com/x.png'));
  assert.ok(!isAbsolute('data:image/png;base64,AAAA'));
});

test('a complete page has no issues', () => {
  assert.deepEqual(findIssues(good, size), []);
});

test('missing og:image is an error', () => {
  const page = { ...good, metas: good.metas.filter(([k]) => k !== 'og:image') };
  const issues = findIssues(page, undefined);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'error');
  assert.match(issues[0].text, /Missing og:image/);
});

test('relative image URLs are errors and are not shown in cards', () => {
  const page = { ...good, metas: [['og:image', '/img/cover.png'], ['twitter:image', 'cover.png'], ...good.metas] };
  const out = texts(findIssues(page, size));
  assert.match(out, /og:image is a relative URL/);
  assert.match(out, /twitter:image is a relative URL/);
  const cards = buildCards(page);
  assert.equal(cards.linkedin.image, '');
  assert.equal(cards.x.image, '');
  assert.equal(imageUrl(page), 'https://www.example.com/img/cover.png');
});

test('small image and wrong ratio are flagged', () => {
  const out = texts(findIssues(good, { width: 800, height: 800 }));
  assert.match(out, /800x800, smaller than 1200x630/);
  assert.match(out, /ratio is 1.00:1/);
});

test('large image with the right ratio passes, 2:1 is within tolerance', () => {
  assert.deepEqual(findIssues(good, { width: 2400, height: 1260 }), []);
  assert.deepEqual(findIssues(good, { width: 1260, height: 630 }), []);
});

test('an image that fails to load is an error', () => {
  assert.match(texts(findIssues(good, null)), /failed to load or took longer than 10 seconds/);
});

test('long title and description are warned', () => {
  const page = {
    ...good,
    metas: [['og:title', 'T'.repeat(61)], ['og:description', 'D'.repeat(161)], ...good.metas],
  };
  const out = texts(findIssues(page, size));
  assert.match(out, /Title is 61 characters/);
  assert.match(out, /Description is 161 characters/);
});

test('missing og:title falls back to <title>, missing both is an error', () => {
  const noTitle = { ...good, metas: good.metas.filter(([k]) => k !== 'og:title') };
  assert.match(texts(findIssues(noTitle, size)), /fall back to the <title>/);
  assert.equal(buildCards(noTitle).linkedin.title, 'Page title');
  const issues = findIssues({ ...noTitle, title: '' }, size);
  assert.ok(issues.some((i) => i.level === 'error' && /no headline/.test(i.text)));
});

test('twitter:card missing or invalid', () => {
  const noCard = { ...good, metas: good.metas.filter(([k]) => k !== 'twitter:card') };
  assert.match(texts(findIssues(noCard, size)), /Missing twitter:card/);
  assert.equal(buildCards(noCard).x.large, false);
  const bad = { ...good, metas: [['twitter:card', 'big'], ...good.metas] };
  assert.match(texts(findIssues(bad, size)), /"big" is not a valid card type/);
});

test('buildCards prefers twitter:* for X and og:* elsewhere', () => {
  const page = {
    ...good,
    metas: [['twitter:title', 'X title'], ['twitter:image', 'https://cdn.example.com/x.png'], ['og:url', 'https://blog.example.org/p'], ...good.metas],
  };
  const cards = buildCards(page);
  assert.equal(cards.x.title, 'X title');
  assert.equal(cards.x.image, 'https://cdn.example.com/x.png');
  assert.equal(cards.x.large, true);
  assert.equal(cards.linkedin.title, 'A good title');
  assert.equal(cards.whatsapp.image, 'https://cdn.example.com/cover.png');
  assert.equal(cards.linkedin.domain, 'blog.example.org');
});

test('description falls back to meta name="description"', () => {
  const page = { url: 'https://a.com/', title: 't', metas: [['description', 'Plain description']] };
  assert.equal(buildCards(page).linkedin.description, 'Plain description');
});

test('served HTML is what gets checked; tags set by JavaScript are warned', () => {
  // Live DOM is complete, but the server sends a generic title and no image (a typical SPA).
  const spa = {
    ...good,
    served: { title: 'App', metas: [['og:title', 'App'], ['og:description', 'A short description.'], ['twitter:card', 'summary_large_image']] },
  };
  assert.deepEqual(jsSetTags(spa), ['og:title', 'og:image']);
  const issues = findIssues(spa, undefined);
  assert.match(texts(issues), /Missing og:image/);
  assert.match(texts(issues), /Differs from the served HTML, usually because JavaScript set it: og:title, og:image\./);
  assert.equal(buildCards(spa).linkedin.title, 'App');
  assert.equal(buildCards(spa).linkedin.image, '');
  assert.equal(imageUrl(spa), '');
});

test('identical served HTML adds no issues; no served HTML falls back to the live page', () => {
  assert.deepEqual(findIssues({ ...good, served: { title: good.title, metas: good.metas } }, size), []);
  assert.deepEqual(jsSetTags(good), []);
  assert.equal(buildCards({ ...good, servedError: 'HTTP 403' }).linkedin.title, 'A good title');
});

test('isPrivateHost catches localhost and private, loopback, link-local literals', () => {
  for (const h of ['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1', '169.254.169.254', '0.0.0.0', '[::1]', '[::]', '[fd00::1]', '[fe80::1]', new URL('http://[::ffff:127.0.0.1]/').hostname]) {
    assert.ok(isPrivateHost(h), h);
  }
  for (const h of ['example.com', '172.32.0.1', '8.8.8.8', 'fd-cdn.example.com', '[2606:4700::1]', '0.gravatar.com', '10.cdn.example.com', '192.168.example.com', '172.16.images.example.com']) {
    assert.ok(!isPrivateHost(h), h);
  }
  // Names crawlers cannot resolve: single-label hosts (Docker services, hosts-file entries) and reserved suffixes.
  for (const h of ['web', 'nginx', 'api.local', 'my-app.test', 'cms.internal', 'nas.home.arpa', '100.64.0.1', '100.127.255.254']) {
    assert.ok(isPrivateHost(h), h);
  }
  for (const h of ['', 'localhost.example.com', 'local.example.com', 'test.com', 'internal.co', '100.63.0.1', '100.128.0.1']) {
    assert.ok(!isPrivateHost(h), h);
  }
  // new URL normalises other IPv4 spellings before the check.
  assert.equal(new URL('http://0x7f.1/').hostname, '127.0.0.1');
});

test('an og:image on localhost is an error on a public page and is never loaded', () => {
  const page = { ...good, metas: [['og:image', 'http://localhost:3000/og.png'], ...good.metas] };
  assert.match(texts(findIssues(page, undefined)), /og:image points to a local or private address/);
  assert.equal(imageUrl(page), '');
  assert.equal(buildCards(page).linkedin.image, '');
  // Local development: page and image both on localhost is fine.
  const local = { ...page, url: 'http://localhost:3000/post/1' };
  assert.equal(imageUrl(local), 'http://localhost:3000/og.png');
  assert.deepEqual(findIssues(local, size), []);
});

test('an og:image on a Docker service name or a .test domain is an error on a public page', () => {
  for (const url of ['http://web:3000/og.png', 'http://my-app.test/og.png']) {
    const page = { ...good, metas: [['og:image', url], ...good.metas] };
    assert.match(texts(findIssues(page, undefined)), /og:image points to a local or private address/);
    assert.equal(imageUrl(page), '');
  }
});

test('suggestTags is empty for a complete page', () => {
  assert.equal(suggestTags(good), '');
});

test('suggestTags fills missing tags from the page, resolves relative images, escapes values', () => {
  const page = { url: 'https://a.com/post', title: 'Tom & "Jerry" <3', metas: [['description', 'Plain'], ['og:image', '/c.png'], ['twitter:card', 'big']] };
  assert.equal(
    suggestTags(page),
    [
      '<meta property="og:title" content="Tom &amp; &quot;Jerry&quot; &lt;3">',
      '<meta property="og:description" content="Plain">',
      '<meta property="og:image" content="https://a.com/c.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n'),
  );
});

test('suggestTags asks for an image when there is none or it is on a private address', () => {
  const noImage = { ...good, metas: good.metas.filter(([k]) => k !== 'og:image') };
  assert.equal(suggestTags(noImage), '<!-- Fill in og:image: an absolute https:// URL of a 1200x630 image. -->\n<meta property="og:image" content="">');
  const local = { ...good, metas: [['og:image', 'http://localhost:3000/og.png'], ...good.metas] };
  assert.match(suggestTags(local), /<meta property="og:image" content="">/);
});

test('suggestTags moves tags set by JavaScript into the served HTML with their live values', () => {
  const spa = {
    ...good,
    metas: [['twitter:title', 'Live X title'], ...good.metas],
    served: { title: 'App', metas: [['og:title', 'App'], ['og:description', 'A short description.'], ['twitter:card', 'summary_large_image']] },
  };
  assert.equal(
    suggestTags(spa),
    [
      '<meta property="og:title" content="A good title">',
      '<meta property="og:image" content="https://cdn.example.com/cover.png">',
      '<meta name="twitter:title" content="Live X title">',
    ].join('\n'),
  );
});
