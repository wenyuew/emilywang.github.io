// Xtract — asks Claude to summarize and group the collected posts.
// Loaded by the side panel.

const DEFAULT_MODEL = 'claude-sonnet-4-5';

function groupingInstruction(groupBy, categories) {
  if (groupBy === 'person') {
    return 'by author: one group per author, named "Display Name (@handle)". The overview says what this person was talking about across their posts.';
  }
  if (groupBy === 'custom') {
    const list = (categories || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (list.length) {
      return `into these categories chosen by the user, using the names exactly: ${list.map(c => `"${c}"`).join(', ')}. Put posts that fit none of them into a group named "Other". Leave out categories that end up empty.`;
    }
  }
  return 'by topic: define 3–10 clear topic categories that fit what these posts are actually about (e.g. "AI agents", "Career advice"). Prefer fewer, meaningful groups over many tiny ones.';
}

function formatPost(t) {
  const lines = [`[${t.id}] ${t.name} (@${t.handle})${t.time ? ' · ' + t.time.slice(0, 10) : ''}`];
  lines.push(t.text ? t.text.slice(0, 800) : '(no text)');
  if (t.quoted) lines.push(`Quoted post: ${t.quoted.slice(0, 400)}`);
  if (t.cardText) lines.push(`Link card: ${t.cardText}`);
  if (t.hasMedia) lines.push('(has image/video)');
  return lines.join('\n');
}

async function summarizePosts({ tweets, groupBy, categories, language }) {
  const { apiKey, model } = await chrome.storage.local.get(['apiKey', 'model']);
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  if (!tweets?.length) throw new Error('No posts in the selected range.');

  const prompt = `Here are ${tweets.length} posts a user saved (bookmarked) on X. Group them ${groupingInstruction(groupBy, categories)}

Rules:
- Every post id must appear in exactly one group.
- Write every summary and overview in ${language || 'English'}.
- Each summary is one sentence (max ~30 words) with the actual point, idea, tip or resource. Don't start with "This post" or "The author".
- If a post has little text (image, video or link only), summarize from what is available and say what it shares.
- Each group gets a short name and a 1–2 sentence overview of the common thread.
- Order groups from largest to smallest. Keep the original post order inside each group.

Reply with JSON only, in exactly this shape:
{"groups":[{"name":"...","overview":"...","items":[{"id":"...","summary":"..."}]}]}

POSTS:

${tweets.map(formatPost).join('\n\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 16000,
      system: 'You summarize and organize saved social media posts. You reply with valid JSON only, no prose and no code fences.',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Claude API error: ${detail}`);
  }

  const text = (body?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The summary came back in an unexpected format. Try again.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The summary came back in an unexpected format. Try a smaller range.');
  }
}
