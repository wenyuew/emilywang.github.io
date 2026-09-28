// Flowy — side panel UI (runs as a normal content script).
(() => {
  const TAG = '__flowy';
  const DEFAULTS = {
    srcLang: 'en',
    tlang: 'zh-Hans',
    trMode: 'show', // show | blur | hide
    autoScroll: true,
    pauseEach: false,
    fontSize: 15,
    collapsed: false,
  };
  const PINNED_TARGETS = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'es', 'fr', 'de'];

  let settings = { ...DEFAULTS };
  let videoId = null;
  let rows = []; // {start, end, src, tr, el}
  let tracks = [];
  let targets = [];
  let active = -1;
  let loopIdx = -1;
  let pausedFor = -1;
  let userScrolledAt = 0;
  let ourSeek = false;
  let rafId = 0;
  let boundVideo = null;
  let resizeObs = null;
  let videoTitle = '';
  let srcLangCode = 'en'; // language of the track actually shown
  let bank = []; // saved words & sentences
  let popover = null; // {el, pausedVideo}
  let reqSeq = 0;
  const pendingTr = new Map();

  // ---------- settings ----------
  const storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  function loadSettings() {
    return new Promise((res) => {
      if (!storage) return res();
      storage.get('dtSettings', (d) => {
        settings = { ...DEFAULTS, ...((d && d.dtSettings) || {}) };
        res();
      });
    });
  }
  function save() { if (storage) storage.set({ dtSettings: settings }); }

  // ---------- word bank storage ----------
  function loadBank() {
    return new Promise((res) => {
      if (!storage) return res();
      storage.get('dtBank', (d) => { bank = (d && d.dtBank) || []; res(); });
    });
  }
  function saveBank() { if (storage) storage.set({ dtBank: bank }); refreshSavedUI(); }
  if (storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.dtBank) { bank = ch.dtBank.newValue || []; refreshSavedUI(); }
    });
  }
  const sentenceKey = (r) => `${videoId}@${r.start.toFixed(2)}`;
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const findSentence = (r) => bank.find((b) => b.type === 'sentence' && b.key === sentenceKey(r));
  const findWord = (text) => bank.find((b) => b.type !== 'sentence' && norm(b.text) === norm(text));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function makeItem(type, text, meaning, r) {
    return {
      id: newId(),
      type, // word | phrase | sentence
      key: type === 'sentence' ? sentenceKey(r) : undefined,
      text: text.trim(),
      meaning: (meaning || '').trim(),
      srcLang: srcLangCode,
      tLang: settings.tlang || '',
      sentence: { src: r.src, tr: r.tr || '' },
      video: { id: videoId, title: videoTitle, t: Math.floor(r.start) },
      createdAt: Date.now(),
    };
  }

  function toggleSentence(i) {
    const r = rows[i];
    const existing = findSentence(r);
    if (existing) { bank = bank.filter((b) => b !== existing); flash('Sentence removed'); }
    else { bank.unshift(makeItem('sentence', r.src, r.tr, r)); flash('Sentence saved to Word Bank'); }
    saveBank();
  }

  function refreshSavedUI() {
    if (!panel) return;
    bankBtn.textContent = `Word Bank${bank.length ? ' (' + bank.length + ')' : ''}`;
    rows.forEach((r) => {
      if (!r.star) return;
      const on = !!findSentence(r);
      r.star.classList.toggle('on', on);
      r.star.title = on ? 'Remove from Word Bank' : 'Save this sentence';
    });
  }

  // ---------- speech (generated audio) ----------
  let voices = [];
  const loadVoices = () => { voices = speechSynthesis.getVoices(); };
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  function speak(text, lang, rate = 0.9) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const l = (lang || 'en').toLowerCase();
    const base = l.split('-')[0];
    const want = l === 'zh-hant' ? ['zh-tw', 'zh-hk'] : l.startsWith('zh') ? ['zh-cn'] : [];
    const pool = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
    const pick =
      pool.find((v) => want.some((w) => v.lang.toLowerCase().replace('_', '-').startsWith(w)) && /google|natural|premium|enhanced/i.test(v.name)) ||
      pool.find((v) => want.some((w) => v.lang.toLowerCase().replace('_', '-').startsWith(w))) ||
      pool.find((v) => /google|natural|premium|enhanced/i.test(v.name)) || pool[0];
    if (pick) u.voice = pick;
    u.lang = pick ? pick.lang : lang;
    u.rate = rate;
    speechSynthesis.speak(u);
  }

  // ---------- meaning lookup (Chrome on-device translator via page.js) ----------
  function translate(text) {
    return new Promise((resolve) => {
      if (!settings.tlang) return resolve(null);
      const reqId = ++reqSeq;
      pendingTr.set(reqId, resolve);
      setTimeout(() => { if (pendingTr.has(reqId)) { pendingTr.delete(reqId); resolve(null); } }, 8000);
      window.postMessage({ [TAG]: 'req', type: 'translate', reqId, text, from: srcLangCode, to: settings.tlang, videoId }, '*');
    });
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
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
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  }
  const currentVideoId = () =>
    location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
  const getPlayer = () => document.getElementById('movie_player');
  const getVideo = () => $('#movie_player video') || $('video.html5-main-video');
  const adShowing = () => { const p = getPlayer(); return !!(p && p.classList.contains('ad-showing')); };

  // ---------- panel ----------
  let panel, list, statusEl, srcSel, tgtSel, trKnob, scrollKnob, pauseKnob, sizeKnob, resumeBtn, bankBtn;

  // thin-line icons
  const ICONS = {
    speaker: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2"/></svg>',
    loop: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5v2.8h-2.8"/></svg>',
  };
  function icon(name) { const s = document.createElement('span'); s.className = 'dt-ico'; s.innerHTML = ICONS[name]; return s; }

  // a round "knob" control with a small caps label, like a hardware dial
  function knob(label, title, onclick) {
    const dial = h('span', { class: 'dt-dial' }, h('i'));
    const state = h('span', { class: 'dt-knob-state' });
    const el = h('button', { class: 'dt-knob', title, onclick }, dial, h('span', { class: 'dt-knob-label' }, label), state);
    el.set = (deg, text, on) => { dial.style.setProperty('--deg', deg + 'deg'); state.textContent = text; el.classList.toggle('on', !!on); };
    return el;
  }

  function buildPanel() {
    srcSel = h('select', { class: 'dt-select', title: 'Language you are learning', onchange: onSrcChange });
    tgtSel = h('select', { class: 'dt-select', title: 'Translate into', onchange: onTgtChange });
    trKnob = knob('Translation', 'Show, blur or hide the translation', cycleTr);
    scrollKnob = knob('Follow', 'Auto-scroll to the current line', () => toggle('autoScroll'));
    pauseKnob = knob('Pause', 'Pause the video at the end of every line', () => toggle('pauseEach'));
    sizeKnob = knob('Size', 'Text size', cycleFont);
    resumeBtn = h('button', { class: 'dt-resume', onclick: () => { userScrolledAt = 0; scrollToActive(true); } }, 'Back to current line');
    statusEl = h('div', { class: 'dt-status' });
    bankBtn = h('button', { class: 'dt-link-caps', title: 'Open your saved words and sentences', onclick: openBank }, 'Word Bank');
    list = h('div', { class: 'dt-list', tabindex: '0' });
    list.addEventListener('mouseup', onSelectPhrase);
    // close the word card when the reader scrolls the transcript themselves (not on auto-scroll)
    ['wheel', 'touchmove'].forEach((ev) => list.addEventListener(ev, () => { if (popover) closePopover(); }, { passive: true }));
    ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((ev) =>
      list.addEventListener(ev, (e) => {
        if (ev === 'mousedown' && e.target !== list) return; // scrollbar drags only
        userScrolledAt = Date.now();
        updateResume();
      }, { passive: true })
    );

    panel = h('div', { id: 'dt-panel' },
      h('div', { class: 'dt-head' },
        h('div', { class: 'dt-title' }, 'Flowy', h('br'), h('span', { class: 'dt-sub' }, 'Dual transcript')),
        h('div', { class: 'dt-head-actions' },
          bankBtn,
          h('button', { class: 'dt-link-caps', title: 'Copy the whole transcript', onclick: copyAll }, 'Copy'),
          h('button', { class: 'dt-collapse', title: 'Collapse / expand', onclick: () => toggle('collapsed') }, h('i'))
        )
      ),
      h('div', { class: 'dt-body' },
        h('div', { class: 'dt-langs' },
          h('label', {}, h('span', {}, 'Learning'), srcSel),
          h('label', {}, h('span', {}, 'Translation'), tgtSel)
        ),
        h('div', { class: 'dt-list-wrap' }, list, resumeBtn),
        h('div', { class: 'dt-knobs' }, trKnob, scrollKnob, pauseKnob, sizeKnob),
        statusEl
      )
    );
    applySettingsUI();
    refreshSavedUI();
    document.addEventListener('mousedown', (e) => {
      if (!popover || popover.el.contains(e.target)) return;
      // clicking straight onto another word: keep the video paused
      const onText = e.target.closest && e.target.closest('#dt-panel .dt-src');
      closePopover(!!onText);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) closePopover(); }, true);
  }

  function openBank() {
    try { chrome.runtime.sendMessage({ type: 'openBank' }); }
    catch (_) { flash('Reload this tab to open the Word Bank'); }
  }

  // ---------- word / phrase popover ----------
  function hasSelection() {
    const s = window.getSelection();
    return s && !s.isCollapsed && s.toString().trim().length > 0;
  }

  function onWordClick(e, i) {
    e.stopPropagation();
    if (hasSelection()) return;
    openPopover(e.currentTarget.textContent, i, e.currentTarget);
  }

  function onSelectPhrase() {
    setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) return;
      const text = s.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return;
      const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
      const src = node && node.closest('.dt-src');
      const rowEl = src && src.closest('.dt-row');
      if (!rowEl) return;
      const rect = s.getRangeAt(0).getBoundingClientRect();
      openPopover(text, +rowEl.dataset.i, null, rect);
    }, 0);
  }

  function findTerm(sentence, text) {
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
      if (m) return m.index + m[1].length;
    } catch (_) {}
    return sentence.toLowerCase().indexOf(text.toLowerCase());
  }
  function highlightIn(sentence, text) {
    const idx = findTerm(sentence, text);
    if (idx < 0) return [sentence];
    return [sentence.slice(0, idx), h('b', {}, sentence.slice(idx, idx + text.length)), sentence.slice(idx + text.length)];
  }

  let carryPaused = false;
  function openPopover(text, i, anchorEl, anchorRect) {
    closePopover(true);
    const r = rows[i];
    if (!r) return;
    const v = getVideo();
    const pausedVideo = carryPaused || (v && !v.paused);
    carryPaused = false;
    if (v && !v.paused) v.pause();

    const isPhrase = /\s/.test(text.trim()) || text.length > 24;
    const existing = findWord(text);
    const meaning = h('input', {
      class: 'dt-pop-meaning', type: 'text',
      placeholder: settings.tlang ? 'Looking up meaning…' : 'Add a meaning',
      value: existing ? existing.meaning : '',
    });
    const saveBtn = h('button', { class: 'dt-pop-save' }, existing ? 'Saved' : isPhrase ? 'Save phrase \u2192' : 'Save word \u2192');
    if (existing) saveBtn.disabled = true;
    saveBtn.addEventListener('click', () => {
      if (findWord(text)) return;
      bank.unshift(makeItem(isPhrase ? 'phrase' : 'word', text, meaning.value, r));
      saveBank();
      saveBtn.textContent = 'Saved';
      saveBtn.disabled = true;
      setTimeout(closePopover, 500);
    });
    meaning.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); e.stopPropagation(); });

    const el = h('div', { class: 'dt-pop', role: 'dialog' },
      h('div', { class: 'dt-pop-head' },
        h('span', { class: 'dt-pop-word' }, text),
        h('button', { class: 'dt-pop-say', title: 'Listen', onclick: () => speak(text, srcLangCode) }, icon('speaker'))
      ),
      meaning,
      h('div', { class: 'dt-pop-ex' }, ...highlightIn(r.src, text)),
      r.tr ? h('div', { class: 'dt-pop-ex-tr' }, r.tr) : null,
      h('div', { class: 'dt-pop-actions' },
        h('button', { class: 'dt-pop-cancel', onclick: closePopover }, 'Close'),
        saveBtn
      )
    );
    ['keydown', 'keyup', 'keypress'].forEach((t) => el.addEventListener(t, (e) => { if (e.key !== 'Escape') e.stopPropagation(); }));
    panel.append(el);
    popover = { el, pausedVideo };

    // position under the word, inside the panel
    const pr = panel.getBoundingClientRect();
    const ar = anchorRect || anchorEl.getBoundingClientRect();
    const w = Math.min(300, pr.width - 24);
    el.style.width = w + 'px';
    let left = Math.min(Math.max(12, ar.left - pr.left - 20), pr.width - w - 12);
    let top = ar.bottom - pr.top + 6;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const eh = el.offsetHeight;
    if (top + eh > pr.height - 8) el.style.top = Math.max(8, ar.top - pr.top - eh - 6) + 'px';

    if (!existing && settings.tlang) {
      translate(text).then((t) => {
        if (!popover || popover.el !== el) return;
        if (t && !meaning.value) meaning.value = t;
        meaning.placeholder = 'Add a meaning';
      });
    }
    setTimeout(() => meaning.focus({ preventScroll: true }), 0);
  }

  function closePopover(keepPaused) {
    if (!popover) return;
    const { el, pausedVideo } = popover;
    popover = null;
    el.remove();
    if (keepPaused === true) { carryPaused = pausedVideo; setTimeout(() => { carryPaused = false; }, 400); return; }
    const s = window.getSelection();
    if (s) s.removeAllRanges();
    const v = getVideo();
    if (pausedVideo && v && v.paused) v.play().catch(() => {});
  }

  function applySettingsUI() {
    if (!panel) return;
    panel.dataset.tr = settings.trMode;
    panel.classList.toggle('dt-collapsed', settings.collapsed);
    panel.style.setProperty('--dt-font', settings.fontSize + 'px');
    const tr = { show: [45, 'Shown', true], blur: [0, 'Blurred', true], hide: [-45, 'Hidden', false] }[settings.trMode];
    trKnob.set(...tr);
    scrollKnob.set(settings.autoScroll ? 45 : -45, settings.autoScroll ? 'On' : 'Off', settings.autoScroll);
    pauseKnob.set(settings.pauseEach ? 45 : -45, settings.pauseEach ? 'On' : 'Off', settings.pauseEach);
    const fi = Math.max(0, FONT_STEPS.indexOf(settings.fontSize));
    sizeKnob.set(-60 + fi * 30, settings.fontSize + 'px', false);
  }

  function mount() {
    if (!panel) buildPanel();
    const host = $('#secondary-inner') || $('#secondary');
    if (!host) return false;
    if (panel.parentElement !== host) host.prepend(panel);
    const p = getPlayer();
    if (p && !resizeObs) {
      resizeObs = new ResizeObserver(() => sizePanel());
      resizeObs.observe(p);
    }
    sizePanel();
    return true;
  }
  function sizePanel() {
    const p = getPlayer();
    if (!panel || !p) return;
    const hgt = Math.round(p.getBoundingClientRect().height);
    panel.style.setProperty('--dt-height', Math.min(Math.max(hgt || 480, 380), 760) + 'px');
  }

  function setStatus(msg, retry) {
    statusEl.textContent = '';
    if (!msg) { statusEl.hidden = true; return; }
    statusEl.hidden = false;
    statusEl.append(msg);
    if (retry) statusEl.append(' ', h('button', { class: 'dt-link', onclick: requestLoad }, 'Retry'));
  }

  // ---------- controls ----------
  function toggle(key) {
    settings[key] = !settings[key];
    save();
    applySettingsUI();
    if (key === 'autoScroll' && settings.autoScroll) { userScrolledAt = 0; scrollToActive(true); }
    if (key === 'pauseEach') pausedFor = active; // don't pause instantly on the current line
  }
  function cycleTr() {
    const order = ['show', 'blur', 'hide'];
    settings.trMode = order[(order.indexOf(settings.trMode) + 1) % 3];
    save();
    applySettingsUI();
  }
  const FONT_STEPS = [13, 14, 15, 16, 18];
  function cycleFont() {
    const i = FONT_STEPS.indexOf(settings.fontSize);
    settings.fontSize = FONT_STEPS[(i + 1) % FONT_STEPS.length];
    save();
    applySettingsUI();
  }
  function font(d) {
    settings.fontSize = Math.min(24, Math.max(12, settings.fontSize + d));
    save();
    applySettingsUI();
  }
  function onSrcChange() {
    const t = tracks[+srcSel.value];
    if (!t) return;
    settings.srcLang = t.languageCode;
    save();
    requestLoad();
  }
  function onTgtChange() {
    settings.tlang = tgtSel.value;
    save();
    requestLoad();
  }
  function copyAll() {
    const txt = rows.map((r) => `[${fmtTime(r.start)}] ${r.src}${r.tr ? '\n' + r.tr : ''}`).join('\n\n');
    navigator.clipboard.writeText(txt).then(
      () => flash('Transcript copied'),
      () => flash('Could not copy')
    );
  }
  let flashTimer;
  function flash(msg) {
    const prev = statusEl.hidden;
    setStatus(msg);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (prev) setStatus(''); }, 1600);
  }

  // ---------- loading ----------
  function requestLoad() {
    if (!videoId) return;
    rows = []; active = -1; loopIdx = -1; pausedFor = -1;
    list.textContent = '';
    list.append(h('div', { class: 'dt-empty' }, 'Loading captions…'));
    setStatus('');
    window.postMessage({ [TAG]: 'req', type: 'load', videoId, srcLang: settings.srcLang, tlang: settings.tlang }, '*');
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== 'res') return;
    const m = e.data;
    if (m.videoId !== videoId) return;
    if (m.type === 'translated') {
      const cb = pendingTr.get(m.reqId);
      if (cb) { pendingTr.delete(m.reqId); cb(m.text); }
      return;
    }
    if (m.type === 'tracks') fillSelectors(m);
    else if (m.type === 'cues') renderCues(m);
    else if (m.type === 'error') {
      list.textContent = '';
      list.append(h('div', { class: 'dt-empty' }, m.message));
      setStatus('', false);
      if (!/no captions/.test(m.message)) setStatus('Captions didn’t load.', true);
    }
  });

  function fillSelectors(m) {
    tracks = m.tracks;
    videoTitle = m.title || '';
    srcLangCode = m.selected.languageCode;
    srcSel.textContent = '';
    tracks.forEach((t, i) => {
      const label = t.name + (t.kind === 'asr' && !/auto/i.test(t.name) ? ' (auto)' : '');
      const o = h('option', { value: String(i) }, label);
      if (t.languageCode === m.selected.languageCode && t.kind === m.selected.kind) o.selected = true;
      srcSel.append(o);
    });

    const byCode = new Map(m.translationLanguages.map((l) => [l.code, l.name]));
    targets = [];
    PINNED_TARGETS.forEach((c) => byCode.has(c) && targets.push({ code: c, name: byCode.get(c) }));
    m.translationLanguages.forEach((l) => { if (!PINNED_TARGETS.includes(l.code)) targets.push(l); });
    if (!targets.length) targets = [{ code: 'zh-Hans', name: 'Chinese (Simplified)' }];

    tgtSel.textContent = '';
    tgtSel.append(h('option', { value: '' }, 'None'));
    targets.forEach((l, i) => {
      if (i === PINNED_TARGETS.filter((c) => byCode.has(c)).length && i > 0)
        tgtSel.append(h('option', { disabled: true }, '──────'));
      tgtSel.append(h('option', { value: l.code }, l.name));
    });
    tgtSel.value = settings.tlang;
    if (tgtSel.value !== settings.tlang) tgtSel.value = '';
  }

  function alignRows(src, tr) {
    const out = src.map((c, i) => {
      const next = src[i + 1];
      const natural = c.dur > 0 ? c.start + c.dur : Infinity;
      const end = next ? Math.min(natural, next.start) : (isFinite(natural) ? natural : c.start + 4);
      return { start: c.start, end: Math.max(end, c.start + 0.3), src: c.text, tr: '' };
    });
    if (tr && tr.length) {
      let j = 0;
      for (const c of tr) {
        while (j + 1 < out.length && out[j + 1].start <= c.start + 0.05) j++;
        out[j].tr = out[j].tr ? out[j].tr + ' ' + c.text : c.text;
      }
    }
    return out;
  }

  // Split a line into clickable words (works for spaced languages and CJK).
  let segmenter = null, segLang = '';
  function tokenize(text, i) {
    if (segLang !== srcLangCode) {
      segLang = srcLangCode;
      try { segmenter = new Intl.Segmenter(srcLangCode, { granularity: 'word' }); } catch (_) { segmenter = null; }
    }
    const out = [];
    if (!segmenter) return [text];
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike) {
        out.push(h('span', { class: 'dt-w', onclick: (e) => onWordClick(e, i) }, seg.segment));
      } else out.push(seg.segment);
    }
    return out;
  }

  function renderCues(m) {
    closePopover();
    rows = alignRows(m.src, m.tr);
    list.textContent = '';
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const loopBtn = h('button', {
        class: 'dt-loop', title: 'Loop this line',
        onclick: (e) => { e.stopPropagation(); toggleLoop(i); },
      }, icon('loop'));
      r.star = h('button', {
        class: 'dt-star',
        onclick: (e) => { e.stopPropagation(); toggleSentence(i); },
      });
      r.el = h('div', { class: 'dt-row', 'data-i': String(i), onclick: () => { if (!hasSelection()) seekTo(i); } },
        h('span', { class: 'dt-time' }, fmtTime(r.start)),
        h('div', { class: 'dt-text' },
          h('div', { class: 'dt-src' }, tokenize(r.src, i)),
          r.tr ? h('div', { class: 'dt-tr' }, r.tr) : null
        ),
        h('div', { class: 'dt-actions' }, r.star, loopBtn)
      );
      frag.append(r.el);
    });
    list.append(frag);
    refreshSavedUI();
    const notes = [];
    if (m.isAuto) notes.push('Auto-generated captions — may contain mistakes.');
    if (m.note) notes.push(m.note);
    setStatus(notes.join(' '));
    active = -1;
    tick(true);
  }

  // ---------- playback sync ----------
  function findActive(t) {
    let lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function seekTo(i, keepLoop) {
    const v = getVideo();
    if (!v || !rows[i]) return;
    if (!keepLoop && loopIdx !== -1 && loopIdx !== i) setLoop(-1);
    ourSeek = true;
    v.currentTime = rows[i].start + 0.01;
    pausedFor = -1;
    userScrolledAt = 0;
    if (v.paused) v.play().catch(() => {});
  }

  function toggleLoop(i) { setLoop(loopIdx === i ? -1 : i); if (loopIdx === i) seekTo(i, true); }
  function setLoop(i) {
    if (loopIdx !== -1 && rows[loopIdx]) rows[loopIdx].el.classList.remove('looping');
    loopIdx = i;
    if (i !== -1 && rows[i]) rows[i].el.classList.add('looping');
  }

  function scrollToActive(smooth) {
    if (active < 0 || !rows[active]) return;
    const el = rows[active].el;
    const top = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }
  function updateResume() {
    const away = settings.autoScroll && Date.now() - userScrolledAt < 5000 && active >= 0;
    resumeBtn.classList.toggle('show', away);
  }

  function tick(force) {
    const v = getVideo();
    if (!v || !rows.length || adShowing()) return;
    const t = v.currentTime;

    // loop a single line
    if (loopIdx !== -1 && rows[loopIdx] && !v.paused && t >= rows[loopIdx].end - 0.03) {
      ourSeek = true;
      v.currentTime = rows[loopIdx].start + 0.01;
      return;
    }

    const i = findActive(t);

    // pause at the end of each line
    if (settings.pauseEach && loopIdx === -1 && !v.paused && i >= 0 && pausedFor !== i &&
        t >= rows[i].end - 0.06 && t < rows[i].end + 0.6) {
      pausedFor = i;
      v.pause();
    }

    if (i !== active || force) {
      if (active >= 0 && rows[active]) rows[active].el.classList.remove('active');
      active = i;
      if (active >= 0) {
        rows[active].el.classList.add('active');
        if (settings.autoScroll && Date.now() - userScrolledAt > 5000) scrollToActive(!force);
      }
    }
    updateResume();
  }

  function loop() {
    tick(false);
    const v = getVideo();
    rafId = v && !v.paused ? requestAnimationFrame(loop) : 0;
  }

  function bindVideo() {
    const v = getVideo();
    if (!v || v === boundVideo) return;
    boundVideo = v;
    v.addEventListener('play', () => { if (!rafId) rafId = requestAnimationFrame(loop); });
    v.addEventListener('seeked', () => { tick(true); });
    v.addEventListener('seeking', () => {
      if (ourSeek) { ourSeek = false; return; }
      pausedFor = -1;
      // user jumped elsewhere: stop looping if outside the looped line
      if (loopIdx !== -1 && rows[loopIdx]) {
        const t = v.currentTime, r = rows[loopIdx];
        if (t < r.start - 0.3 || t > r.end + 0.3) setLoop(-1);
      }
    });
    v.addEventListener('timeupdate', () => { if (v.paused) tick(false); });
    if (!v.paused) rafId = requestAnimationFrame(loop);
  }

  // ---------- navigation ----------
  function check() {
    const id = currentVideoId();
    if (!id) {
      if (panel) panel.remove();
      videoId = null;
      return;
    }
    if (!mount()) return;
    bindVideo();
    if (id !== videoId) {
      videoId = id;
      setLoop(-1);
      requestLoad();
    }
  }

  Promise.all([loadSettings(), loadBank()]).then(() => {
    document.addEventListener('yt-navigate-finish', () => setTimeout(check, 50));
    setInterval(check, 1000);
    check();
  });
})();
