import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMap, buildCards, findIssues, imageUrl, isAbsolute, jsSetTags } from '../src/meta.js';

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
  assert.match(texts(issues), /JavaScript, so crawlers do not see the live value: og:title, og:image/);
  assert.equal(buildCards(spa).linkedin.title, 'App');
  assert.equal(buildCards(spa).linkedin.image, '');
  assert.equal(imageUrl(spa), '');
});

test('identical served HTML adds no issues; no served HTML falls back to the live page', () => {
  assert.deepEqual(findIssues({ ...good, served: { title: good.title, metas: good.metas } }, size), []);
  assert.deepEqual(jsSetTags(good), []);
  assert.equal(buildCards({ ...good, servedError: 'HTTP 403' }).linkedin.title, 'A good title');
});
