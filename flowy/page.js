// Runs in YouTube's own page context (MAIN world).
// Job: find the caption tracks for the current video, capture the caption URL
// YouTube's player uses (it carries a token newer YouTube requires), and fetch
// the original + translated captions. Results go to content.js via postMessage.
(() => {
  if (window.__flowyPage) return;
  window.__flowyPage = true;

  const TAG = '__flowy';
  const captured = new Map(); // videoId -> latest timedtext URL seen
  const waiters = new Map(); // videoId -> [resolve]
  const nativeFetch = window.fetch.bind(window);

  // ---- 1. Watch the player's own caption requests -------------------------
  function noteUrl(raw) {
    try {
      if (!raw || typeof raw !== 'string' && !(raw instanceof URL)) {
        if (raw && raw.url) raw = raw.url; else return;
      }
      const s = String(raw);
      if (!s.includes('/api/timedtext')) return;
      const u = new URL(s, location.origin);
      const v = u.searchParams.get('v');
      if (!v) return;
      captured.set(v, u.href);
      (waiters.get(v) || []).forEach((r) => r(u.href));
      waiters.delete(v);
    } catch (_) {}
  }

  window.fetch = function (input, init) {
    noteUrl(input);
    return nativeFetch(input, init);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    noteUrl(url);
    return origOpen.apply(this, arguments);
  };

  function waitForCapture(videoId, ms) {
    if (captured.has(videoId)) return Promise.resolve(captured.get(videoId));
    return new Promise((resolve) => {
      const list = waiters.get(videoId) || [];
      list.push(resolve);
      waiters.set(videoId, list);
      setTimeout(() => resolve(null), ms);
    });
  }

  // ---- 2. Helpers ----------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = () => document.getElementById('movie_player');

  function textOf(n) {
    if (!n) return '';
    if (n.simpleText) return n.simpleText;
    if (n.runs) return n.runs.map((r) => r.text).join('');
    return '';
  }

  async function getPlayerResponse(videoId) {
    for (let i = 0; i < 40; i++) {
      const p = player();
      let pr = null;
      try { pr = p && p.getPlayerResponse && p.getPlayerResponse(); } catch (_) {}
      if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) return pr;
      await sleep(250);
    }
    return null;
  }

  function pickTrack(tracks, wantLang) {
    const base = (l) => (l || '').toLowerCase().split('-')[0];
    const want = base(wantLang);
    const manual = tracks.filter((t) => t.kind !== 'asr');
    const auto = tracks.filter((t) => t.kind === 'asr');
    return (
      manual.find((t) => t.languageCode.toLowerCase() === (wantLang || '').toLowerCase()) ||
      manual.find((t) => base(t.languageCode) === want) ||
      auto.find((t) => base(t.languageCode) === want) ||
      manual[0] || auto[0] || null
    );
  }

  // Briefly switch on YouTube's CC so the player makes its own (tokenised) caption request.
  async function triggerCaptionRequest(videoId) {
    const btn = document.querySelector('.ytp-subtitles-button');
    if (!btn) return null;
    const wasOn = btn.getAttribute('aria-pressed') === 'true';
    const wait = waitForCapture(videoId, 6000);
    if (wasOn) { btn.click(); await sleep(150); btn.click(); }
    else btn.click();
    const url = await wait;
    if (!wasOn && btn.getAttribute('aria-pressed') === 'true') btn.click(); // restore
    return url;
  }

  function buildUrl(baseHref, track, tlang) {
    const u = new URL(baseHref, location.origin);
    u.searchParams.set('lang', track.languageCode);
    if (track.kind === 'asr') u.searchParams.set('kind', 'asr');
    else u.searchParams.delete('kind');
    u.searchParams.delete('name');
    u.searchParams.delete('tlang');
    if (tlang) u.searchParams.set('tlang', tlang);
    u.searchParams.set('fmt', 'json3');
    return u.href;
  }

  function parseJson3(data) {
    const out = [];
    for (const ev of (data && data.events) || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s*\n\s*/g, ' ').trim();
      if (!text) continue;
      out.push({ start: (ev.tStartMs || 0) / 1000, dur: (ev.dDurationMs || 0) / 1000, text });
    }
    return out;
  }

  async function fetchCues(url) {
    const res = await nativeFetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.text();
    if (!body.trim()) return [];
    return parseJson3(JSON.parse(body));
  }

  // ---- 3. Main load routine ----------------------------------------------
  let currentJob = 0;

  async function load({ videoId, srcLang, tlang }) {
    const job = ++currentJob;
    const post = (msg) => { if (job === currentJob) window.postMessage({ [TAG]: 'res', videoId, ...msg }, '*'); };

    const pr = await getPlayerResponse(videoId);
    if (job !== currentJob) return;
    if (!pr) return post({ type: 'error', message: 'Could not read this video. Try reloading the page.' });

    const r = pr.captions && pr.captions.playerCaptionsTracklistRenderer;
    const raw = (r && r.captionTracks) || [];
    if (!raw.length) return post({ type: 'error', message: 'This video has no captions.' });

    const tracks = raw.map((t) => ({
      languageCode: t.languageCode,
      kind: t.kind || '',
      name: textOf(t.name) || t.languageCode,
      baseUrl: t.baseUrl,
      translatable: t.isTranslatable !== false,
    }));
    const translationLanguages = ((r && r.translationLanguages) || []).map((l) => ({
      code: l.languageCode,
      name: textOf(l.languageName) || l.languageCode,
    }));
    const track = pickTrack(tracks, srcLang);
    post({
      type: 'tracks',
      tracks: tracks.map(({ baseUrl, ...t }) => t),
      translationLanguages,
      selected: { languageCode: track.languageCode, kind: track.kind },
      title: (pr.videoDetails && pr.videoDetails.title) || document.title.replace(/ - YouTube$/, ''),
    });

    // Get a working base URL: the player's own request first, then the plain baseUrl.
    let baseHref = captured.get(videoId) || (await triggerCaptionRequest(videoId));
    if (job !== currentJob) return;

    const candidates = [];
    if (baseHref) candidates.push(baseHref);
    candidates.push(track.baseUrl);

    let src = [];
    let usedBase = null;
    for (const b of candidates) {
      try {
        src = await fetchCues(buildUrl(b, track, null));
        if (src.length) { usedBase = b; break; }
      } catch (_) {}
    }
    if (job !== currentJob) return;
    if (!src.length) {
      return post({ type: 'error', message: 'YouTube didn’t return captions. Press play for a second, then click Retry.' });
    }

    let tr = null;
    const sameLang = tlang && tlang.split('-')[0].toLowerCase() === track.languageCode.split('-')[0].toLowerCase();
    if (tlang && !sameLang && track.translatable) {
      try { tr = await fetchCues(buildUrl(usedBase, track, tlang)); } catch (_) { tr = null; }
    }
    if (job !== currentJob) return;
    post({
      type: 'cues',
      src,
      tr,
      isAuto: track.kind === 'asr',
      note: tlang && !sameLang && !tr ? 'Translation unavailable for this track.' : '',
    });
  }

  // ---- 4. Word meanings via Chrome's built-in, on-device Translator ------
  // (Chrome 138+. Free, no key. Falls back to null if unsupported.)
  const translators = new Map();
  const chromeCode = (c) => {
    c = (c || '').toLowerCase();
    if (c === 'zh-hans' || c === 'zh-cn' || c === 'zh-sg') return 'zh';
    if (c === 'zh-hant' || c === 'zh-tw' || c === 'zh-hk') return 'zh-Hant';
    return c.split('-')[0];
  };
  async function translateText(text, from, to) {
    const T = window.Translator;
    if (!T || !text || !to) return null;
    const src = chromeCode(from), tgt = chromeCode(to);
    if (src === tgt) return null;
    const key = src + '>' + tgt;
    try {
      if (!translators.has(key)) {
        const avail = await T.availability({ sourceLanguage: src, targetLanguage: tgt });
        if (avail === 'unavailable') return null;
        translators.set(key, T.create({ sourceLanguage: src, targetLanguage: tgt }));
      }
      const tr = await translators.get(key);
      return await tr.translate(text);
    } catch (_) {
      translators.delete(key);
      return null;
    }
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== 'req') return;
    const d = e.data;
    if (d.type === 'load') load(d);
    else if (d.type === 'translate') {
      const text = await translateText(d.text, d.from, d.to);
      window.postMessage({ [TAG]: 'res', type: 'translated', reqId: d.reqId, text, videoId: d.videoId }, '*');
    }
  });
})();
