# Xtract

A Chrome extension for your saved posts on X.

Pick a **start** and **end** post on your X bookmarks page, click **Summarize**, and get a one-line summary of every saved post in between. Group them by topic, by person, or by categories you choose.

## Install (2 minutes)

1. Unzip this folder somewhere you'll keep it.
2. In Chrome, go to `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped `xtract` folder. (Updating? Replace the folder and click the reload arrow on the extension's card.)
4. Pin the extension to your toolbar (puzzle icon → pin). Click it to open the side panel, then **Settings** to paste your Anthropic API key.

## Use

1. Open your bookmarks on X (x.com/i/bookmarks, or the Bookmarks tab under History) and click the extension icon — the digest opens as a side panel next to the page.
2. Hover a post and click **Start here**. Hover another post and click **End here**. (Click again to unset.) Marking a post also opens the panel if it's closed.
3. In the panel, choose **Group by**: Topic, Person, or My categories (type your own, comma-separated), and a language (English, 中文, or each post's own).
4. Click **Summarize range**. The page goes back to your start post and scrolls down to the end post at a human pace (about 1–2 seconds per screen) to load everything in between, then Claude writes the digest.
5. Read it in the panel, open any post with **Open →**, or click **Copy** to get it as Markdown.

## Good to know

- Up to 300 posts per run. For bigger backlogs, do it in chunks.
- Only post text, author, date and link-card text go to Claude. Nothing is sent anywhere else, and nothing is stored after you close the tab.
- It reads the page the way you see it. It doesn't call X's hidden APIs, and it paces its scrolling to stay gentle on your account.
- Long posts that X cuts off with "Show more" are summarized from the visible part.
- If X changes its page layout, the part that reads posts (`parseTweet` in `content.js`) may need a small update.
- If the Start/End buttons overlap something on a post, change `right: 96px` in `content.css`.
