/* Quocci Cucci side panel */
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => chrome.storage.local.get(k),
  set: (o) => chrome.storage.local.set(o),
};

let state = {
  tabId: null,
  videoId: null,
  count: 10,
  running: false,
  result: null,
  tab: 'quotes',
  transcripts: {}, // videoId -> { title, author, segments }
  asking: false,
  answers: [],
};

// ---------- helpers ----------
function videoIdFrom(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}
const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
};
const show = (id) => ['vEmpty', 'vSettings', 'vVideo'].forEach((v) => ($(v).hidden = v !== id));
function setStatus(text, isErr) {
  const el = $('status');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'status' + (isErr ? ' err' : '');
  el.innerHTML = isErr ? '' : '<span class="dot"></span>';
  el.appendChild(document.createTextNode(text));
}

// ---------- settings ----------
async function openSettings(msg) {
  const { apiKey } = await store.get('apiKey');
  $('keyInput').value = apiKey || '';
  $('keyMsg').textContent = msg || '';
  $('cancelKey').hidden = !apiKey;
  show('vSettings');
  $('keyInput').focus();
}
$('settingsBtn').onclick = () => openSettings();
$('cancelKey').onclick = () => refresh(true);
$('saveKey').onclick = async () => {
  const k = $('keyInput').value.trim();
  if (!k) { $('keyMsg').textContent = 'Paste a key first.'; return; }
  await store.set({ apiKey: k });
  await chrome.storage.local.remove('model');
  refresh(true);
};
$('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveKey').click(); });

// ---------- quote count ----------
const MAX_QUOTES = 100;
function paintCount() {
  const preset = [5, 10, 20].includes(state.count);
  document.querySelectorAll('.seg button').forEach((b) =>
    b.setAttribute('aria-checked', String(+b.dataset.n === state.count))
  );
  const c = $('customN');
  c.classList.toggle('on', !preset);
  if (!preset && document.activeElement !== c) c.value = state.count;
  if (preset && document.activeElement !== c) c.value = '';
}
function setCount(n) {
  state.count = n;
  store.set({ count: n });
  paintCount();
}
$('customN').addEventListener('input', () => {
  const n = Math.round(Number($('customN').value));
  if (n >= 1) setCount(Math.min(n, MAX_QUOTES));
});
$('customN').addEventListener('blur', () => {
  const n = Math.round(Number($('customN').value));
  if (n > MAX_QUOTES) $('customN').value = MAX_QUOTES;
  paintCount();
});
$('customN').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
document.querySelectorAll('.seg button').forEach((b) => {
  b.setAttribute('role', 'radio');
  b.onclick = () => setCount(+b.dataset.n);
});

// ---------- which video is open ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh(force) {
  if (force !== true && !$('vSettings').hidden) return; // don't yank the user out of settings
  const tab = await activeTab();
  const vid = tab ? videoIdFrom(tab.url || '') : null;
  if (!vid) { state.videoId = null; show('vEmpty'); return; }

  const changed = vid !== state.videoId;
  state.tabId = tab.id;
  state.videoId = vid;
  show('vVideo');
  if (changed) loadAnswers(vid);
  if (!changed && state.result) return;
  $('title').textContent = (tab.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '') || 'YouTube video';
  $('channel').textContent = 'Now watching';

  if (!changed && (state.running || state.result)) return;
  state.result = null;
  if (state.running) return;

  const cached = (await store.get('q:' + vid))['q:' + vid];
  if (cached) render(cached);
  else { $('start').hidden = false; $('result').hidden = true; setStatus(''); }
}

chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (tab.active && (info.url || info.title || info.status === 'complete')) refresh();
});

// ---------- Claude ----------
const API = 'https://api.anthropic.com/v1';
const headers = (key) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
});

async function pickModel(key, force) {
  if (!force) {
    const { model } = await store.get('model');
    if (model) return model;
  }
  const r = await fetch(`${API}/models?limit=100`, { headers: headers(key) });
  if (r.status === 401) throw new Error('BADKEY');
  if (!r.ok) throw new Error(`Couldn't reach Anthropic (${r.status}).`);
  const { data = [] } = await r.json();
  // Newest first. Prefer Sonnet (fast, strong), then Opus, then anything.
  const pick =
    data.find((m) => /sonnet/i.test(m.id)) ||
    data.find((m) => /opus/i.test(m.id)) ||
    data[0];
  if (!pick) throw new Error('No models available on this key.');
  await store.set({ model: pick.id });
  return pick.id;
}

function transcriptForPrompt(segments) {
  // Merge tiny caption fragments into lines of ~20s so the prompt stays compact.
  const lines = [];
  let cur = null;
  for (const seg of segments) {
    if (!cur || seg.s - cur.s > 20 || cur.t.length > 300) {
      cur = { s: seg.s, t: seg.t };
      lines.push(cur);
    } else cur.t += ' ' + seg.t;
  }
  let text = lines.map((l) => `[${Math.floor(l.s)}] ${l.t}`).join('\n');
  const MAX = 450000; // stay well inside the context window
  if (text.length > MAX) text = text.slice(0, MAX) + '\n[transcript truncated]';
  return text;
}

async function callClaude(key, body) {
  const call = (model) =>
    fetch(`${API}/messages`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({ model, ...body }),
    });
  let r = await call(await pickModel(key));
  if (r.status === 404 || r.status === 400) {
    // Stored model may be retired — pick again once.
    const err = await r.clone().json().catch(() => ({}));
    if (r.status === 404 || /model/i.test(err?.error?.message || '')) r = await call(await pickModel(key, true));
  }
  if (r.status === 401) throw new Error('BADKEY');
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic returned ${r.status}.`);
  }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    throw new Error('Unexpected reply from Claude. Try again.');
  }
}

async function askClaude(key, video, count) {
  const system =
    'You pick the most memorable, quotable lines from video transcripts. ' +
    'Quotes must be VERBATIM from the transcript (you may trim filler words like "um", "you know", and fix obvious caption errors, but never paraphrase). ' +
    'Choose lines that stand on their own: insights, strong opinions, vivid images, turning points, funny or moving moments. ' +
    'Avoid greetings, sponsor reads, and lines that only make sense with context. Spread picks across the whole video. ' +
    'Keep each quote 1–3 sentences. Write the quotes and summary in the language the video is spoken in. ' +
    'Reply with JSON only, no prose, in this shape: ' +
    '{"summary": "two short sentences on what the video is about", "quotes": [{"text": "…", "t": <start second from the [n] marker of the line where the quote begins>}]}';
  const user =
    `Video: ${video.title}${video.author ? ' — ' + video.author : ''}\n` +
    `Pick the ${count} best quotes, in the order they appear. Return exactly ${count}, unless the transcript is too short to have that many distinct lines.\n\n` +
    `Transcript (each line starts with its start time in seconds):\n${transcriptForPrompt(video.segments)}`;
  const parsed = await callClaude(key, { max_tokens: Math.min(16000, 1500 + count * 150), system, messages: [{ role: 'user', content: user }] });
  if (!Array.isArray(parsed.quotes)) throw new Error('Unexpected reply from Claude.');
  return parsed;
}

// Snap each quote to the exact caption where its words begin (fixes rough timestamps).
function snapTimes(quotes, segments) {
  const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const words = [];
  segments.forEach((seg) => norm(seg.t).forEach((w) => words.push({ w, s: seg.s })));
  return quotes.map((q) => {
    const t0 = Number(q.t) || 0;
    const qw = norm(q.text || '');
    for (const n of [5, 4, 3]) {
      if (qw.length < n) continue;
      const probe = qw.slice(0, n);
      let best = null;
      for (let i = 0; i + n <= words.length; i++) {
        let ok = true;
        for (let j = 0; j < n; j++) if (words[i + j].w !== probe[j]) { ok = false; break; }
        if (ok && (!best || Math.abs(words[i].s - t0) < Math.abs(best - t0))) best = words[i].s;
      }
      if (best !== null && Math.abs(best - t0) < 600) return { text: q.text, t: best };
    }
    return { text: q.text, t: t0 };
  });
}

// ---------- transcript (fetched once per video) ----------
async function getVideo(vid, tabId) {
  if (state.transcripts[vid]) return state.transcripts[vid];
  const [{ result: video } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: quoteyReadTranscript,
  });
  if (!video) throw new Error("Couldn't read this page. Try reloading the video.");
  if (video.error) throw new Error(video.error);
  if (video.videoId !== vid) throw new Error('The video changed — try again.');
  state.transcripts = { [vid]: video }; // keep only the current one in memory
  return video;
}

// ---------- main action ----------
async function run() {
  if (state.running) return;
  const { apiKey } = await store.get('apiKey');
  if (!apiKey) { openSettings('Add a key to get started.'); return; }

  const vid = state.videoId, tabId = state.tabId;
  state.running = true;
  $('start').hidden = true;
  $('result').hidden = true;
  setStatus('Reading the transcript…');

  try {
    const video = await getVideo(vid, tabId);

    setStatus('Choosing the best lines…');
    const out = await askClaude(apiKey, video, state.count);
    const result = {
      videoId: vid,
      title: video.title,
      author: video.author,
      summary: out.summary || '',
      quotes: snapTimes(out.quotes, video.segments).sort((a, b) => a.t - b.t),
      count: state.count,
      at: Date.now(),
    };
    await store.set({ ['q:' + vid]: result });
    if (state.videoId === vid) render(result);
  } catch (e) {
    if (state.videoId !== vid) return;
    if (e.message === 'BADKEY') { openSettings('That key was rejected. Check it and try again.'); }
    else {
      $('start').hidden = false;
      setStatus(e.message || 'Something went wrong.', true);
    }
  } finally {
    state.running = false;
  }
}
$('goBtn').onclick = run;
$('redo').onclick = async () => {
  await chrome.storage.local.remove('q:' + state.videoId);
  state.result = null;
  run();
};

// ---------- render ----------
function render(result) {
  state.result = result;
  setStatus('');
  $('start').hidden = true;
  $('result').hidden = false;
  if (result.title) $('title').textContent = result.title;
  $('channel').textContent = result.author || 'Now watching';
  $('summary').textContent = result.summary;
  $('summary').hidden = !result.summary;

  const ol = $('quotes');
  ol.innerHTML = '';
  result.quotes.forEach((q, i) => ol.appendChild(quoteItem(q, i)));
}

function quoteItem(q, i, plain) {
  const li = document.createElement('li');
  li.className = 'quote' + (plain ? ' plain' : '');
  li.tabIndex = 0;
  li.innerHTML = `
    ${plain ? '' : `<span class="num">${String(i + 1).padStart(2, '0')}</span>`}
    <p class="qtext"></p>
    <div class="meta"><span class="ts">${fmt(q.t)}</span><button class="copy">Copy</button></div>`;
  li.querySelector('.qtext').textContent = q.text;
  const jump = () => {
    document.querySelectorAll('.quote.active').forEach((x) => x.classList.remove('active'));
    li.classList.add('active');
    chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      world: 'MAIN',
      func: quoteySeek,
      args: [Math.max(0, q.t - 1)],
    });
  };
  li.onclick = jump;
  li.onkeydown = (e) => { if (e.key === 'Enter' && e.target === li) jump(); };
  li.querySelector('.copy').onclick = (e) => {
    e.stopPropagation();
    copy(`“${q.text}” (${fmt(q.t)}) ${link(q.t)}`, e.target);
  };
  return li;
}

const link = (t) => `https://youtu.be/${state.videoId}?t=${Math.floor(t)}`;
async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {}
}
$('copyAll').onclick = (e) => {
  const r = state.result;
  if (!r) return;
  const body = r.quotes.map((q) => `“${q.text}”\n${fmt(q.t)} · ${link(q.t)}`).join('\n\n');
  copy(`${r.title}${r.author ? ' — ' + r.author : ''}\n\n${body}`, e.target);
};

// ---------- tabs ----------
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $('paneQuotes').hidden = t !== 'quotes';
  $('paneAsk').hidden = t !== 'ask';
  if (t === 'ask') $('askInput').focus();
  store.set({ tab: t });
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

// ---------- ask ----------
async function loadAnswers(vid) {
  const saved = (await store.get('a:' + vid))['a:' + vid];
  if (state.videoId !== vid) return;
  state.answers = saved || [];
  $('askStatus').hidden = true;
  paintAnswers();
}

function paintAnswers() {
  const box = $('answers');
  box.innerHTML = '';
  // Newest first, right under the question box.
  [...state.answers].reverse().forEach((qa) => box.appendChild(answerItem(qa)));
}

function answerItem(qa) {
  const el = document.createElement('article');
  el.className = 'qa';
  const q = document.createElement('p');
  q.className = 'q';
  q.textContent = qa.q;
  el.appendChild(q);

  const a = document.createElement('div');
  a.className = 'a';
  String(qa.answer || '').split(/\n{2,}/).filter(Boolean).forEach((para) => {
    const p = document.createElement('p');
    p.textContent = para.trim();
    a.appendChild(p);
  });
  el.appendChild(a);

  if (qa.quotes && qa.quotes.length) {
    const lab = document.createElement('p');
    lab.className = 'eyebrow from';
    lab.textContent = 'From the video';
    el.appendChild(lab);
    const ol = document.createElement('ol');
    ol.className = 'quotes';
    qa.quotes.forEach((x, i) => ol.appendChild(quoteItem(x, i, true)));
    el.appendChild(ol);
  }

  if (qa.beyond) {
    const b = document.createElement('div');
    b.className = 'beyond';
    b.innerHTML = '<p class="eyebrow">Beyond the video</p><p></p>';
    b.lastChild.textContent = qa.beyond;
    el.appendChild(b);
  }
  return el;
}

function setAskStatus(text, isErr) {
  const el = $('askStatus');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'status' + (isErr ? ' err' : '');
  el.innerHTML = isErr ? '' : '<span class="dot"></span>';
  el.appendChild(document.createTextNode(text));
}

async function currentTime(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const p = document.querySelector('#movie_player');
        const v = document.querySelector('video');
        return (p && p.getCurrentTime && p.getCurrentTime()) || (v && v.currentTime) || 0;
      },
    });
    return result || 0;
  } catch { return 0; }
}

async function ask(question) {
  question = question.trim();
  if (!question || state.asking) return;
  const { apiKey } = await store.get('apiKey');
  if (!apiKey) { openSettings('Add a key to get started.'); return; }

  const vid = state.videoId, tabId = state.tabId;
  state.asking = true;
  $('sendBtn').disabled = true;
  setAskStatus('Reading the transcript…');

  try {
    const video = await getVideo(vid, tabId);
    const now = await currentTime(tabId);
    setAskStatus('Thinking…');

    const system = [
      {
        type: 'text',
        text:
          'You answer questions about a YouTube video using its transcript. ' +
          'Base the answer on what is said in the video. Be clear and concise: a few short sentences, or a short paragraph or two for bigger questions. ' +
          'Answer in the language the question is asked in. ' +
          'Back the answer with 1–3 supporting quotes that are VERBATIM from the transcript (trim filler words and fix obvious caption errors, never paraphrase), in the video\'s language. Use no quotes only if nothing in the video relates. ' +
          'If the video does not cover the question, or only partly, say so plainly in "answer", and put a short, clearly general-knowledge addition in "beyond" (1–3 sentences). Otherwise leave "beyond" empty. ' +
          'Questions like "what did they just say" refer to the viewer\'s current position. ' +
          'Reply with JSON only, in this shape: ' +
          '{"answer": "…", "quotes": [{"text": "…", "t": <start second from the [n] marker of the line where the quote begins>}], "beyond": ""}',
      },
      {
        type: 'text',
        text:
          `Video: ${video.title}${video.author ? ' — ' + video.author : ''}\n\n` +
          `Transcript (each line starts with its start time in seconds):\n${transcriptForPrompt(video.segments)}`,
        cache_control: { type: 'ephemeral' }, // follow-up questions reuse the transcript cheaply
      },
    ];

    // A little conversation memory so follow-ups make sense.
    const messages = [];
    state.answers.slice(-4).forEach((qa) => {
      messages.push({ role: 'user', content: qa.q });
      messages.push({ role: 'assistant', content: JSON.stringify({ answer: qa.answer, quotes: qa.quotes, beyond: qa.beyond || '' }) });
    });
    messages.push({ role: 'user', content: `[The viewer is at ${Math.floor(now)} seconds (${fmt(now)}).]\n${question}` });

    const out = await callClaude(apiKey, { max_tokens: 2000, system, messages });
    const qa = {
      q: question,
      answer: out.answer || '',
      quotes: snapTimes(Array.isArray(out.quotes) ? out.quotes : [], video.segments),
      beyond: out.beyond || '',
      at: Date.now(),
    };
    if (state.videoId !== vid) return;
    state.answers.push(qa);
    store.set({ ['a:' + vid]: state.answers.slice(-30) });
    setAskStatus('');
    $('askInput').value = '';
    autosize();
    paintAnswers();
  } catch (e) {
    if (state.videoId !== vid) return;
    if (e.message === 'BADKEY') openSettings('That key was rejected. Check it and try again.');
    else setAskStatus(e.message || 'Something went wrong.', true);
  } finally {
    state.asking = false;
    $('sendBtn').disabled = false;
  }
}

function autosize() {
  const t = $('askInput');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 160) + 'px';
}
$('askInput').addEventListener('input', autosize);
$('askInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('askInput').value); }
});
$('askForm').onsubmit = (e) => { e.preventDefault(); ask($('askInput').value); };

// ---------- voice ----------
const LANGS = [
  { code: 'en-US', label: 'EN' },
  { code: 'zh-CN', label: '中文' },
];
let micLang = /^zh/i.test(navigator.language) ? 'zh-CN' : 'en-US';
let rec = null;

function paintLang() { $('langBtn').textContent = LANGS.find((l) => l.code === micLang).label; }
$('langBtn').onclick = () => {
  const i = LANGS.findIndex((l) => l.code === micLang);
  micLang = LANGS[(i + 1) % LANGS.length].code;
  store.set({ micLang });
  paintLang();
};

async function micAllowed() {
  try {
    const s = await navigator.permissions.query({ name: 'microphone' });
    return s.state === 'granted';
  } catch { return false; }
}

$('micBtn').onclick = async () => {
  if (rec) { rec.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('micMsg').textContent = "Voice input isn't available in this browser."; return; }
  if (!(await micAllowed())) {
    // Side panels can't show the permission prompt, so ask once in a tab.
    $('micMsg').textContent = 'Allow the microphone in the tab that just opened, then tap the mic again.';
    chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
    return;
  }
  $('micMsg').textContent = '';
  const before = $('askInput').value.trim();
  rec = new SR();
  rec.lang = micLang;
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    finalText = '';
    for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
    $('askInput').value = [before, finalText || interim].filter(Boolean).join(' ');
    autosize();
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed') {
      $('micMsg').textContent = 'Allow the microphone in the tab that just opened, then tap the mic again.';
      chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
    } else if (e.error === 'no-speech') {
      $('micMsg').textContent = "Didn't catch that. Tap the mic and try again.";
    } else if (e.error !== 'aborted') {
      $('micMsg').textContent = 'Voice input stopped (' + e.error + ').';
    }
  };
  rec.onend = () => {
    rec = null;
    $('micBtn').classList.remove('on');
    const text = $('askInput').value.trim();
    if (finalText && text) ask(text); // send as soon as you stop talking
  };
  $('micBtn').classList.add('on');
  rec.start();
};

// ---------- boot ----------
(async () => {
  const { count } = await store.get('count');
  if (Number.isInteger(count) && count >= 1 && count <= MAX_QUOTES) state.count = count;
  paintCount();
  const saved = await store.get(['tab', 'micLang']);
  if (saved.micLang) micLang = saved.micLang;
  paintLang();
  setTab(saved.tab === 'ask' ? 'ask' : 'quotes');
  const { apiKey } = await store.get('apiKey');
  if (!apiKey) openSettings();
  else refresh(true);
})();
