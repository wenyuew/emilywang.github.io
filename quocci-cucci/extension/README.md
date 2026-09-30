# Quocci Cucci

The best quotes from any YouTube video, with timestamps. Click a quote and the video jumps to that moment.

## Install

1. Unzip this folder.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `quocci-cucci` folder.
4. Pin Quocci Cucci from the puzzle-piece menu.

## Use

1. Open a YouTube video and click the Quocci Cucci icon. A side panel opens next to the video.
2. The first time, paste your Anthropic API key (console.anthropic.com → API keys).
3. Pick 5, 10 or 20 quotes, or type any number (up to 100) in **Other**, and press **Get quotes**.
4. Click any quote to jump there. **Copy** gives you the quote with a timestamped link. **Copy all** copies the whole list.

**Ask** (second tab): type a question about the video, or tap the mic and say it (tap **EN / 中文** to switch the speech language). You get an answer based on what's said in the video, with supporting quotes you can click to jump to. If the video doesn't cover it, Quocci Cucci says so and adds a short note marked **Beyond the video**. Follow-up questions remember the conversation, and "what did they just say?" works because Quocci Cucci knows where you are in the video. The first time you use the mic, a tab opens asking for microphone permission, because Chrome can't show that prompt inside a side panel.

Results are saved per video, so opening the same video again shows them instantly. Use **Regenerate** for a fresh pick.

## How it works

- Reads the video's captions (the same ones the CC button shows). If it can't get them directly, it briefly flips CC on, and as a last resort it opens YouTube's "Show transcript" panel.
- Sends the transcript to Claude, which picks verbatim lines plus a two-sentence summary. The newest Sonnet model on your key is picked automatically.
- Each quote's timestamp is matched back to the exact caption where its words start.
- Ask sends the transcript with prompt caching, so follow-up questions on the same video are cheaper and faster.
- Your key is stored only in this browser (`chrome.storage.local`). Calls go straight from your browser to Anthropic, with no server in between.

Videos with no captions at all can't be quoted.

## Files

- `manifest.json`: extension setup (Manifest V3, side panel)
- `background.js`: opens the side panel when you click the icon
- `transcript.js`: runs in the YouTube page to read captions and jump to a time
- `panel.html` / `panel.css` / `panel.js`: the side panel (Quotes and Ask)
- `mic.html` / `mic.js`: one-time microphone permission page
