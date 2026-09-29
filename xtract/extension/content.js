// Xtract — content script.
// Runs on x.com. On the bookmarks page it adds Start / End markers to each post,
// and when the side panel asks, loads every post in the range (scrolling at a human pace).

(() => {
  if (window.__tbsLoaded) return;
  window.__tbsLoaded = true;

  const TWEET_SEL = 'article[data-testid="tweet"]';
  const MAX_TWEETS = 300;

  const state = {
    order: [],          // post ids in page order (top → bottom)
    tweets: new Map(),  // id → parsed post
    startId: null,
    endId: null,
    running: false,
    stopRequested: false
  };

  // X has moved bookmarks around (e.g. /i/bookmarks, or a "Bookmarks" tab inside History),
  // so recognise the page by its address OR by a selected "Bookmarks" tab.
  const BOOKMARK_WORDS = /^(bookmarks|书签|ブックマーク|signets|lesezeichen|marcadores|segnalibri|bladwijzers)$/i;
  function onBookmarks() {
    const p = location.pathname.toLowerCase();
    if (p.startsWith('/i/bookmarks') || p.includes('/bookmarks')) return true;
    return [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .some(t => BOOKMARK_WORDS.test((t.innerText || t.textContent || '').trim()));
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = (min, max) => min + Math.random() * (max - min);
  const send = msg => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* panel closed or extension reloaded */ } };

  // ---------- Reading posts from the page ----------

  function topLevelArticles() {
    return [...document.querySelectorAll(TWEET_SEL)].filter(a => !a.parentElement?.closest(TWEET_SEL));
  }

  function parseTweet(article) {
    const timeEl = article.querySelector('a[href*="/status/"] time');
    const link = timeEl ? timeEl.closest('a') : article.querySelector('a[href*="/status/"]');
    const m = link?.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const [, handle, id] = m;
    const nameBox = article.querySelector('[data-testid="User-Name"]');
    const name = ((nameBox?.querySelector('a') || nameBox)?.innerText || '').split('\n')[0].trim() || handle;
    const texts = article.querySelectorAll('[data-testid="tweetText"]');
    const card = article.querySelector('[data-testid="card.wrapper"]');
    return {
      id,
      handle,
      name,
      text: texts[0]?.innerText.trim() || '',
      quoted: texts[1]?.innerText.trim() || '',
      time: timeEl?.getAttribute('datetime') || null,
      hasMedia: !!article.querySelector('[data-testid="tweetPhoto"], video'),
      cardText: card ? card.innerText.trim().replace(/\s+/g, ' ').slice(0, 200) : '',
      url: `https://x.com/${handle}/status/${id}`
    };
  }

  function scan() {
    if (!onBookmarks()) return;
    const parsed = topLevelArticles().map(a => [a, parseTweet(a)]).filter(([, t]) => t);
    let prevId = null;
    parsed.forEach(([a, t], i) => {
      a.dataset.tbsId = t.id;
      const known = state.tweets.get(t.id);
      if (!known) {
        let idx;
        if (prevId) {
          idx = state.order.indexOf(prevId) + 1;
        } else {
          const next = parsed.slice(i + 1).find(([, n]) => state.tweets.has(n.id));
          idx = next ? state.order.indexOf(next[1].id) : state.order.length;
        }
        state.order.splice(idx, 0, t.id);
        state.tweets.set(t.id, t);
      } else if (t.text.length > known.text.length) {
        state.tweets.set(t.id, t);
      }
      prevId = t.id;
      decorate(a, t.id);
    });
  }

  const elFor = id => document.querySelector(`${TWEET_SEL}[data-tbs-id="${id}"]`);

  // ---------- Start / End markers on each post ----------

  function decorate(article, id) {
    if (!article.querySelector(':scope > .tbs-pins')) {
      const bar = document.createElement('div');
      bar.className = 'tbs-pins';
      bar.innerHTML = '<button type="button" data-act="start">Start here</button><button type="button" data-act="end">End here</button>';
      bar.addEventListener('mousedown', e => e.stopPropagation());
      bar.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const btn = e.target.closest('button');
        if (btn) setMark(btn.dataset.act, article.dataset.tbsId);
      });
      if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
      article.appendChild(bar);
    }
    article.classList.toggle('tbs-is-start', id === state.startId);
    article.classList.toggle('tbs-is-end', id === state.endId);
  }

  function redecorate() {
    topLevelArticles().forEach(a => a.dataset.tbsId && decorate(a, a.dataset.tbsId));
  }

  function publicState() {
    const brief = id => {
      const t = id && state.tweets.get(id);
      return t ? { handle: t.handle, text: t.text || (t.hasMedia ? '(image/video)' : '(no text)') } : null;
    };
    return { type: 'state', onBookmarks: onBookmarks(), start: brief(state.startId), end: brief(state.endId), running: state.running };
  }

  function setMark(kind, id) {
    if (!id) return;
    const key = kind === 'start' ? 'startId' : 'endId';
    state[key] = state[key] === id ? null : id; // click again to unset
    redecorate();
    send({ type: 'openPanel' }); // opens the side panel if it isn't open yet
    send(publicState());
  }

  function clearMarks() {
    state.startId = state.endId = null;
    redecorate();
    send(publicState());
  }

  // ---------- Loading the range (human-paced scrolling) ----------

  const progress = text => send({ type: 'progress', text });

  async function bringIntoView(id) {
    for (let i = 0; i < 200 && !state.stopRequested; i++) {
      scan();
      const el = elFor(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        window.scrollBy(0, -70); // clear X's sticky header
        await sleep(800);
        scan();
        return true;
      }
      const target = state.order.indexOf(id);
      const visible = topLevelArticles().map(a => state.order.indexOf(a.dataset.tbsId)).filter(x => x >= 0);
      if (target < 0 || !visible.length) return false;
      window.scrollBy(0, (target < Math.min(...visible) ? -1 : 1) * innerHeight * 0.85);
      await sleep(jitter(700, 1200));
    }
    return false;
  }

  async function sweepTo(bottomId, topId) {
    let stuck = 0;
    let lastY = -1;
    for (let i = 0; i < 800 && !state.stopRequested; i++) {
      scan();
      if (elFor(bottomId)) return 'ok';
      const loaded = state.order.length - state.order.indexOf(topId);
      if (loaded > MAX_TWEETS) return 'too-many';
      progress(`Loading posts in your range — ${loaded} so far`);
      window.scrollBy(0, innerHeight * 0.85);
      await sleep(jitter(1000, 1800));
      if (Math.abs(scrollY - lastY) < 5) {
        if (++stuck >= 4) return 'end-of-list';
      } else {
        stuck = 0;
      }
      lastY = scrollY;
    }
    return state.stopRequested ? 'stopped' : 'end-of-list';
  }

  async function collect() {
    if (!onBookmarks()) throw new Error('Open your bookmarks page on X first.');
    if (state.running) throw new Error('Already loading posts.');
    if (!state.startId || !state.endId) throw new Error('Mark a start and an end post first — hover any saved post to see the markers.');
    state.running = true;
    state.stopRequested = false;
    send(publicState());
    try {
      let [top, bottom] = [state.startId, state.endId];
      if (state.order.indexOf(top) > state.order.indexOf(bottom)) [top, bottom] = [bottom, top];

      progress('Finding your start post');
      if (!(await bringIntoView(top))) {
        throw new Error(state.stopRequested ? 'Stopped.' : "Couldn't find the start post. Scroll to it and mark it again.");
      }
      const outcome = await sweepTo(bottom, top);
      if (outcome === 'stopped' || state.stopRequested) throw new Error('Stopped.');
      if (outcome === 'too-many') throw new Error(`That range has more than ${MAX_TWEETS} posts. Pick a smaller range.`);
      if (outcome === 'end-of-list') throw new Error('Reached the end of your saved posts before the end marker. Try marking the end again.');

      const i = state.order.indexOf(top);
      const j = state.order.indexOf(bottom);
      const posts = state.order.slice(i, j + 1).map(id => state.tweets.get(id)).filter(Boolean);
      if (posts.length > MAX_TWEETS) throw new Error(`That range has ${posts.length} posts (max ${MAX_TWEETS}). Pick a smaller range.`);
      return posts;
    } finally {
      state.running = false;
      send(publicState());
    }
  }

  // ---------- Messages from the side panel ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'getState':
        scan();
        sendResponse(publicState());
        return false;
      case 'clear':
        clearMarks();
        sendResponse(publicState());
        return false;
      case 'stop':
        state.stopRequested = true;
        sendResponse({ ok: true });
        return false;
      case 'collect':
        collect()
          .then(posts => sendResponse({ ok: true, posts }))
          .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
        return true;
    }
    return false;
  });

  // ---------- Boot ----------

  let scanTimer = null;
  new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // X is a single-page app — tell the panel when we arrive at or leave the bookmarks page
  // (by address change, or by switching between the Bookmarks / Likes tabs).
  let lastKey = null;
  setInterval(() => {
    const key = `${location.pathname}|${onBookmarks()}`;
    if (key !== lastKey) {
      lastKey = key;
      scan();
      send(publicState());
    }
  }, 700);
})();
