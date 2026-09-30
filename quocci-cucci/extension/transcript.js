// Runs inside the YouTube page (MAIN world) via chrome.scripting.executeScript.
// Must be fully self-contained: no references to anything outside this function.
// Returns { videoId, title, author, segments: [{ s: seconds, t: text }] } or { error }.
async function quoteyReadTranscript() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const url = new URL(location.href);
  const videoId =
    url.searchParams.get('v') ||
    (url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/) || [])[1] ||
    null;
  if (!videoId) return { error: 'No video on this page.' };

  // Current player response (ytInitialPlayerResponse goes stale after in-app navigation).
  const player = document.querySelector('#movie_player');
  let pr = null;
  try { pr = player && player.getPlayerResponse ? player.getPlayerResponse() : null; } catch (e) {}
  if (!pr || (pr.videoDetails && pr.videoDetails.videoId !== videoId)) {
    const init = window.ytInitialPlayerResponse;
    if (init && init.videoDetails && init.videoDetails.videoId === videoId) pr = init;
  }
  const details = (pr && pr.videoDetails) || {};
  const title = details.title || document.title.replace(/\s*-\s*YouTube\s*$/, '');
  const author = details.author || '';
  const tracks =
    (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];

  const clean = (s) =>
    String(s || '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  const parse = (text) => {
    if (!text) return null;
    try {
      const j = JSON.parse(text);
      const segs = (j.events || [])
        .filter((e) => e.segs)
        .map((e) => ({ s: (e.tStartMs || 0) / 1000, t: clean(e.segs.map((x) => x.utf8).join('')) }))
        .filter((x) => x.t && x.t !== '\n');
      return segs.length ? segs : null;
    } catch (e) {}
    // XML fallback
    const out = [];
    const re = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(text))) out.push({ s: parseFloat(m[1]), t: clean(m[2].replace(/<[^>]+>/g, '')) });
    const p = [];
    const re2 = /<p[^>]*t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    while ((m = re2.exec(text))) p.push({ s: parseInt(m[1], 10) / 1000, t: clean(m[2].replace(/<[^>]+>/g, '')) });
    const best = out.length >= p.length ? out : p;
    const f = best.filter((x) => x.t);
    return f.length ? f : null;
  };

  const tryUrl = async (u, keepLang) => {
    try {
      const x = new URL(u, location.origin);
      if (!keepLang) x.searchParams.delete('tlang'); // original language, not a translation
      x.searchParams.set('fmt', 'json3');
      const r = await fetch(x.toString(), { credentials: 'include' });
      if (!r.ok) return null;
      return parse(await r.text());
    } catch (e) {
      return null;
    }
  };

  const done = (segments, source) => ({ videoId, title, author, segments, source });

  // 1) Reuse the caption request the player already made (it carries YouTube's token).
  const playerRequests = () =>
    performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/api/timedtext') && n.includes(videoId))
      .reverse();
  for (const u of playerRequests()) {
    const s = (await tryUrl(u, false)) || (await tryUrl(u, true));
    if (s) return done(s, 'player');
  }

  // 2) Caption track list (prefer human-made captions over auto-generated).
  const sorted = [...tracks].sort((a, b) => (a.kind === 'asr') - (b.kind === 'asr'));
  for (const tr of sorted) {
    const s = await tryUrl(tr.baseUrl, true);
    if (s) return done(s, 'track');
  }

  // 3) Briefly switch captions on so the player fetches them, then read that request.
  const ccBtn = document.querySelector('.ytp-subtitles-button');
  if (ccBtn && tracks.length && ccBtn.getAttribute('aria-pressed') !== 'true') {
    ccBtn.click();
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      if (playerRequests().length) break;
    }
    ccBtn.click(); // restore
    for (const u of playerRequests()) {
      const s = (await tryUrl(u, false)) || (await tryUrl(u, true));
      if (s) return done(s, 'player-cc');
    }
  }

  // 4) Open YouTube's own "Show transcript" panel and read it from the page.
  const toSec = (ts) => ts.split(':').reduce((acc, n) => acc * 60 + parseInt(n, 10), 0);
  const readPanel = () => {
    const rows = document.querySelectorAll(
      'ytd-transcript-segment-renderer, transcript-segment-view-model, ytd-transcript-segment-list-renderer [role="button"]'
    );
    const out = [];
    rows.forEach((row) => {
      const tsEl =
        row.querySelector('.segment-timestamp') ||
        [...row.querySelectorAll('div, span')].find((el) => /^\s*\d{1,2}(:\d{2}){1,2}\s*$/.test(el.textContent));
      const txEl = row.querySelector('.segment-text, yt-formatted-string, span.yt-core-attributed-string');
      if (!tsEl) return;
      const ts = tsEl.textContent.trim();
      let t = txEl ? txEl.textContent : row.textContent.replace(ts, '');
      t = clean(t);
      if (/^\d{1,2}(:\d{2}){1,2}$/.test(ts) && t) out.push({ s: toSec(ts), t });
    });
    return out.length ? out : null;
  };

  let segs = readPanel();
  if (!segs) {
    const expand = document.querySelector('ytd-watch-metadata #description-inline-expander #expand, tp-yt-paper-button#expand');
    if (expand) { expand.click(); await sleep(300); }
    const btn =
      document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      [...document.querySelectorAll('button, yt-button-shape button')].find((b) =>
        /transcript|文字记录|转写|字幕/i.test(b.getAttribute('aria-label') || b.textContent || '')
      );
    if (btn) {
      btn.click();
      for (let i = 0; i < 40 && !segs; i++) {
        await sleep(250);
        segs = readPanel();
      }
      const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');
      const close = panel && panel.querySelector('#visibility-button button, button[aria-label*="Close"]');
      if (close) close.click();
    }
  }
  if (segs) return done(segs, 'panel');

  return {
    error: tracks.length
      ? "Couldn't read this video's transcript. Try turning captions on (CC) for a second, then try again."
      : "This video has no captions or transcript, so there's nothing to quote from.",
  };
}

// Also runs in the page: jump the video to a moment.
function quoteySeek(t) {
  const p = document.querySelector('#movie_player');
  if (p && p.seekTo) {
    p.seekTo(t, true);
    if (p.playVideo) p.playVideo();
  } else {
    const v = document.querySelector('video');
    if (v) { v.currentTime = t; v.play(); }
  }
}
