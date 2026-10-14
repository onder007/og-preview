import { useEffect, useState } from 'react';
import { buildCards, collectMeta, findIssues, imageUrl } from './meta.js';

// ?tab=<id> targets a specific tab (used by the screenshot script); otherwise the active tab.
async function readPage() {
  const param = Number(new URLSearchParams(location.search).get('tab'));
  const tabId = param || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: collectMeta });
  return result;
}

function measure(src) {
  return new Promise((done) => {
    if (!src) return done(undefined);
    const img = new Image();
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = src;
  });
}

function Thumb({ src, className }) {
  return src ? <img className={className} src={src} alt="" /> : <div className={`${className} empty`}>No image</div>;
}

function XCard({ c }) {
  if (c.large) {
    return (
      <div className="x">
        <div className="x-media">
          <Thumb className="img wide" src={c.image} />
          <span className="x-label">{c.title}</span>
        </div>
        <div className="x-from">From {c.domain}</div>
      </div>
    );
  }
  return (
    <div className="x x-summary">
      <Thumb className="img square" src={c.image} />
      <div className="x-text">
        <div className="muted">{c.domain}</div>
        <div className="clamp-1">{c.title}</div>
        <div className="muted clamp-2">{c.description}</div>
      </div>
    </div>
  );
}

function LinkedInCard({ c }) {
  return (
    <div className="li">
      <Thumb className="img wide" src={c.image} />
      <div className="li-text">
        <div className="li-title clamp-2">{c.title}</div>
        <div className="muted">{c.domain}</div>
      </div>
    </div>
  );
}

function WhatsAppCard({ c, url }) {
  return (
    <div className="wa">
      <div className="wa-preview">
        <Thumb className="img wide" src={c.image} />
        <div className="wa-text">
          <div className="wa-title clamp-2">{c.title}</div>
          <div className="clamp-2">{c.description}</div>
          <div className="muted">{c.domain}</div>
        </div>
      </div>
      <div className="wa-link">{url}</div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    readPage()
      .then(async (page) => setState({ status: 'ready', page, size: await measure(imageUrl(page)) }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  if (state.status === 'loading') return <main className="note">Reading page...</main>;
  if (state.status === 'error') {
    return (
      <main className="note">
        <strong>This page cannot be read.</strong>
        <p className="muted">Browser pages (chrome://, the Web Store) block extensions. Open a normal web page and try again.</p>
        <p className="muted small">{state.message}</p>
      </main>
    );
  }

  const { page, size } = state;
  const cards = buildCards(page);
  const issues = findIssues(page, size);

  return (
    <main>
      <header>
        <h1>OG Preview</h1>
        <div className="muted clamp-1">{page.url}</div>
      </header>

      <section>
        <h2>
          Issues <span className={`count ${issues.length ? 'bad' : 'ok'}`}>{issues.length}</span>
        </h2>
        {issues.length === 0 ? (
          <p className="ok-text">No problems found.</p>
        ) : (
          <ul className="issues">
            {issues.map((i) => (
              <li key={i.text} className={i.level}>
                <span className="tag">{i.level === 'error' ? 'Error' : 'Warning'}</span>
                {i.text}
              </li>
            ))}
          </ul>
        )}
        {size && <p className="muted small">Image: {size.width}x{size.height}</p>}
      </section>

      <section>
        <h2>X</h2>
        <XCard c={cards.x} />
      </section>
      <section>
        <h2>LinkedIn</h2>
        <LinkedInCard c={cards.linkedin} />
      </section>
      <section>
        <h2>WhatsApp</h2>
        <WhatsAppCard c={cards.whatsapp} url={page.url} />
      </section>
      <p className="muted small foot">Approximate layouts. Platforms change their cards and cache old previews.</p>
    </main>
  );
}
