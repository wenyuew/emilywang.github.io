// Word Bank page: lists saved words, phrases and sentences.
(() => {
  const store = chrome.storage.local;
  let bank = [];
  let filter = 'all';
  let query = '';
  let slow = false;
  let lastDeleted = null;

  const $ = (s) => document.querySelector(s);
  const listEl = $('#list');

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k);
    return el;
  }
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  };
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const videoUrl = (v) => `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}&t=${Math.max(0, (v.t || 0) - 1)}s`;

  // ---------- speech ----------
  let voices = [];
  const loadVoices = () => { voices = speechSynthesis.getVoices(); };
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  function speak(text, lang) {
    if (!text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const l = (lang || 'en').toLowerCase();
    const base = l.split('-')[0];
    const want = l === 'zh-hant' ? ['zh-tw', 'zh-hk'] : l.startsWith('zh') ? ['zh-cn'] : [];
    const norm = (v) => v.lang.toLowerCase().replace('_', '-');
    const pool = voices.filter((v) => norm(v).startsWith(base));
    const nice = /google|natural|premium|enhanced/i;
    const pick =
      pool.find((v) => want.some((w) => norm(v).startsWith(w)) && nice.test(v.name)) ||
      pool.find((v) => want.some((w) => norm(v).startsWith(w))) ||
      pool.find((v) => nice.test(v.name)) || pool[0];
    if (pick) u.voice = pick;
    u.lang = pick ? pick.lang : lang;
    u.rate = slow ? 0.7 : 0.95;
    speechSynthesis.speak(u);
  }

  const SPEAKER = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2"/></svg>';
  function sayBtn(text, lang) {
    const b = h('button', { class: 'say', title: 'Listen', onclick: () => speak(text, lang) });
    b.innerHTML = SPEAKER;
    return b;
  }

  // ---------- data ----------
  function load() {
    store.get('dtBank', (d) => { bank = (d && d.dtBank) || []; render(); });
  }
  function persist() { store.set({ dtBank: bank }); }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.dtBank) {
      bank = ch.dtBank.newValue || [];
      if (!document.activeElement || !document.activeElement.classList && document.activeElement.classList.contains('meaning')) render();
    }
  });

  function findTerm(sentence, text) {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
      if (m) return m.index + m[1].length;
    } catch (_) {}
    return sentence.toLowerCase().indexOf(text.toLowerCase());
  }
  function highlight(sentence, term) {
    const i = term && sentence ? findTerm(sentence, term) : -1;
    if (!term || i < 0) return [sentence];
    return [sentence.slice(0, i), h('b', {}, sentence.slice(i, i + term.length)), sentence.slice(i + term.length)];
  }

  function matches(item) {
    if (filter === 'word' && item.type === 'sentence') return false;
    if (filter === 'sentence' && item.type !== 'sentence') return false;
    if (!query) return true;
    const hay = [item.text, item.meaning, item.sentence && item.sentence.src, item.sentence && item.sentence.tr, item.video && item.video.title]
      .join(' ').toLowerCase();
    return hay.includes(query);
  }

  function card(item, no) {
    const isSentence = item.type === 'sentence';
    const src = item.srcLang || 'en';
    const tl = item.tLang || 'zh-Hans';
    const kind = isSentence ? 'Sentence' : item.type === 'phrase' ? 'Phrase' : 'Word';

    const source = h('div', { class: 'source' },
      item.video && item.video.title ? h('div', { class: 'vt', title: item.video.title }, item.video.title) : null,
      h('div', { class: 'source-row' },
        item.video && item.video.id
          ? h('a', { class: 'caps', href: videoUrl(item.video), target: '_blank', rel: 'noopener' }, `Watch at ${fmtTime(item.video.t)} →`)
          : h('span', { class: 'caps muted' }, fmtDate(item.createdAt)),
        h('button', { class: 'del caps', onclick: () => remove(item.id) }, 'Remove')
      )
    );

    const label = h('div', { class: 'label caps' }, `No.${String(no).padStart(2, '0')} · ${kind}`);

    if (isSentence) {
      return h('article', { class: 'item sentence' },
        label,
        h('div', { class: 'ex-line' }, h('p', { class: 'term' }, item.text), sayBtn(item.text, src)),
        item.meaning
          ? h('div', { class: 'ex-line tr-line' }, h('p', { class: 'ex-tr' }, item.meaning), sayBtn(item.meaning, tl))
          : null,
        source
      );
    }

    const meaning = h('div', { class: 'meaning', contenteditable: 'plaintext-only', spellcheck: 'false' }, item.meaning || '');
    meaning.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); meaning.blur(); } });
    meaning.addEventListener('blur', () => {
      const v = meaning.textContent.trim();
      const it = bank.find((b) => b.id === item.id);
      if (it && it.meaning !== v) { it.meaning = v; persist(); }
    });

    const s = item.sentence || {};
    return h('article', { class: 'item' },
      label,
      h('div', { class: 'ex-line term-line' }, h('div', { class: 'term' }, item.text), sayBtn(item.text, src)),
      meaning,
      s.src
        ? h('div', { class: 'example' },
            h('div', { class: 'ex-line' }, h('p', { class: 'ex-src' }, ...highlight(s.src, item.text)), sayBtn(s.src, src)),
            s.tr ? h('div', { class: 'ex-line' }, h('p', { class: 'ex-tr' }, s.tr), sayBtn(s.tr, tl)) : null)
        : null,
      source
    );
  }

  function render() {
    const words = bank.filter((b) => b.type !== 'sentence').length;
    const sents = bank.length - words;
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    $('#summary').textContent = bank.length ? `${pl(words, 'word')} \u00b7 ${pl(sents, 'sentence')}` : '';
    listEl.textContent = '';
    const total = bank.length;
    bank.forEach((it, i) => { if (matches(it)) listEl.append(card(it, total - i)); });
    const emptyEl = $('#empty');
    emptyEl.hidden = listEl.children.length > 0;
    if (bank.length && !listEl.children.length) emptyEl.textContent = 'No matches.';
  }

  function remove(id) {
    const idx = bank.findIndex((b) => b.id === id);
    if (idx < 0) return;
    lastDeleted = { item: bank[idx], idx };
    bank.splice(idx, 1);
    persist();
    render();
    toast('Removed', () => {
      if (!lastDeleted) return;
      bank.splice(Math.min(lastDeleted.idx, bank.length), 0, lastDeleted.item);
      lastDeleted = null;
      persist();
      render();
    });
  }

  let toastTimer;
  function toast(msg, undo) {
    const t = $('#toast');
    t.textContent = '';
    t.append(msg);
    if (undo) t.append(h('button', { onclick: () => { undo(); t.hidden = true; } }, 'Undo'));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function exportCsv() {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['type', 'text', 'meaning', 'example', 'example_translation', 'video_title', 'video_link', 'saved'];
    const lines = [head.join(',')].concat(bank.map((b) => [
      b.type, b.text, b.meaning,
      b.type === 'sentence' ? '' : (b.sentence && b.sentence.src),
      b.type === 'sentence' ? '' : (b.sentence && b.sentence.tr),
      b.video && b.video.title, b.video && b.video.id ? videoUrl(b.video) : '',
      new Date(b.createdAt).toISOString().slice(0, 10),
    ].map(esc).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `word-bank-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- controls ----------
  $('#search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#filter button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  $('#hideMeaning').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('on', document.body.classList.toggle('testing'));
  });
  $('#slow').addEventListener('click', (e) => { slow = !slow; e.currentTarget.classList.toggle('on', slow); });
  $('#export').addEventListener('click', exportCsv);

  load();
})();
