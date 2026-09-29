// Xtract — side panel.
// Talks to the content script in the active tab and shows the digest.

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_RE = /^https:\/\/(www\.)?(x|twitter)\.com\//;

let tabId = null;
let phase = 'idle'; // idle | loading | summarizing
let result = null;
const prefs = { groupBy: 'topic', categories: '', language: 'English' };

// ---------- Views ----------

function show(view) {
  for (const id of ['away', 'reload', 'main']) $(`#${id}`).hidden = id !== view;
}

function setStatus(text, kind = '') {
  const el = $('.status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function updateButtons() {
  $('[data-act="run"]').disabled = phase !== 'idle';
  $('[data-act="stop"]').hidden = phase !== 'loading';
}

function applyState(s) {
  for (const slot of ['start', 'end']) {
    const el = $(`[data-slot="${slot}"]`);
    const v = s?.[slot];
    el.textContent = v ? `@${v.handle} — ${v.text}` : 'Not set';
    el.classList.toggle('set', !!v);
    el.title = v ? el.textContent : '';
  }
}

function renderPrefs() {
  document.querySelectorAll('[data-group]').forEach(b => b.classList.toggle('on', b.dataset.group === prefs.groupBy));
  const cats = $('[data-field="categories"]');
  cats.hidden = prefs.groupBy !== 'custom';
  if (cats.value !== prefs.categories) cats.value = prefs.categories;
  $('[data-field="language"]').value = prefs.language;
}

// ---------- Tab connection ----------

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  if (!tab?.url || !X_RE.test(tab.url)) { show('away'); return; }
  try {
    // The page itself decides whether it's the bookmarks view (X keeps moving it).
    const s = await chrome.tabs.sendMessage(tabId, { type: 'getState' });
    if (!s?.onBookmarks) { show('away'); return; }
    applyState(s);
    show('main');
  } catch {
    show('reload');
  }
}

chrome.tabs.onActivated.addListener(refresh);
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === tabId && (info.url || info.status === 'complete')) refresh();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || sender.tab.id !== tabId) return;
  if (msg.type === 'state') {
    if (!msg.onBookmarks) { show('away'); return; }
    show('main');
    applyState(msg);
  } else if (msg.type === 'progress' && phase === 'loading') {
    setStatus(msg.text);
  }
});

// ---------- Summarize ----------

function normalize(raw, posts) {
  const byId = new Map(posts.map(p => [p.id, p]));
  const used = new Set();
  const groups = [];
  for (const g of raw?.groups || []) {
    const items = [];
    for (const it of g.items || []) {
      const id = String(it.id ?? '').replace(/[^\d]/g, '');
      if (byId.has(id) && !used.has(id)) {
        used.add(id);
        items.push({ post: byId.get(id), summary: it.summary || '' });
      }
    }
    if (items.length) groups.push({ name: g.name || 'Untitled', overview: g.overview || '', items });
  }
  const missing = posts.filter(p => !used.has(p.id));
  if (missing.length) {
    groups.push({
      name: 'Not summarized',
      overview: 'These posts were in your range but did not come back in the summary.',
      items: missing.map(p => ({ post: p, summary: (p.text || '(no text)').slice(0, 160) }))
    });
  }
  return { groups, count: posts.length };
}

async function run() {
  if (phase !== 'idle' || tabId == null) return;
  const runTab = tabId;
  phase = 'loading';
  updateButtons();
  setStatus('Starting');
  try {
    const r = await chrome.tabs.sendMessage(runTab, { type: 'collect' });
    if (!r?.ok) throw new Error(r?.error || 'Could not load the posts.');
    const posts = r.posts;
    phase = 'summarizing';
    updateButtons();
    setStatus(`Summarizing ${posts.length} post${posts.length === 1 ? '' : 's'}`);
    const raw = await summarizePosts({ tweets: posts.map(({ url, ...rest }) => rest), ...prefs });
    result = normalize(raw, posts);
    renderResult();
    setStatus(`Done — ${posts.length} post${posts.length === 1 ? '' : 's'} summarized.`);
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    phase = 'idle';
    updateButtons();
  }
}

// ---------- Results ----------

function renderResult() {
  const box = $('.result');
  if (!result) { box.innerHTML = ''; return; }
  const pad = n => String(n).padStart(2, '0');
  box.innerHTML = `
    <div class="rhead">
      <p class="eyebrow">${result.count} posts · ${result.groups.length} group${result.groups.length === 1 ? '' : 's'}</p>
      <div class="rtools">
        <button class="text-btn" data-act="copy">Copy</button>
        <button class="text-btn" data-act="dismiss">Clear</button>
      </div>
    </div>
    ${result.groups.map((g, i) => `
      <div class="group">
        <p class="eyebrow">${pad(i + 1)} — ${g.items.length} post${g.items.length === 1 ? '' : 's'}</p>
        <h2>${esc(g.name)}</h2>
        ${g.overview ? `<p class="ov">${esc(g.overview)}</p>` : ''}
        <ul>
          ${g.items.map(({ post, summary }) => `
            <li><span class="who">${esc(post.name)} · @${esc(post.handle)}</span>
            ${esc(summary)} <a href="${esc(post.url)}" target="_blank" rel="noopener">Open →</a></li>`).join('')}
        </ul>
      </div>`).join('')}`;
}

function toMarkdown(r) {
  const lines = [`# Saved posts digest (${r.count} posts)`, ''];
  for (const g of r.groups) {
    lines.push(`## ${g.name} (${g.items.length})`);
    if (g.overview) lines.push(`_${g.overview}_`);
    lines.push('');
    for (const { post, summary } of g.items) lines.push(`- **${post.name} (@${post.handle})**: ${summary} — ${post.url}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- Events ----------

document.addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.group) {
    prefs.groupBy = btn.dataset.group;
    renderPrefs();
    chrome.storage.local.set({ prefs });
    return;
  }
  switch (btn.dataset.act) {
    case 'settings': chrome.runtime.openOptionsPage(); break;
    case 'goto': if (tabId != null) chrome.tabs.update(tabId, { url: 'https://x.com/i/bookmarks' }); break;
    case 'reload': if (tabId != null) chrome.tabs.reload(tabId); break;
    case 'clear': if (tabId != null) applyState(await chrome.tabs.sendMessage(tabId, { type: 'clear' }).catch(() => null)); break;
    case 'run': run(); break;
    case 'stop': if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'stop' }).catch(() => {}); setStatus('Stopping'); break;
    case 'dismiss': result = null; renderResult(); setStatus(''); break;
    case 'copy':
      try {
        await navigator.clipboard.writeText(toMarkdown(result));
        setStatus('Copied as Markdown.');
      } catch {
        setStatus("Couldn't copy — clipboard access was blocked.", 'error');
      }
      break;
  }
});

document.addEventListener('input', e => {
  const f = e.target.dataset?.field;
  if (!f) return;
  prefs[f] = e.target.value;
  chrome.storage.local.set({ prefs });
});

// ---------- Boot ----------

chrome.storage.local.get('prefs').then(({ prefs: saved }) => {
  if (saved) Object.assign(prefs, saved);
  renderPrefs();
});
renderPrefs();
updateButtons();
refresh();
