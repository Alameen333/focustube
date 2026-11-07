# FocusTube — starter PWA

A mobile-first, installable web app whose feed is restricted to channels the user explicitly approves.

## Included in this first build
- Approve YouTube channels using `@handle` or `/channel/UC...` links.
- Load recent uploads from approved channels using YouTube Data API v3.
- Play videos in a clean modal using YouTube's privacy-enhanced embed domain.
- Watch-later toggle, local search, remove channels, export/import library.
- Local browser storage; no account or app backend.
- PWA manifest and service worker for installing the app shell.

## Important setup
Channel uploads require a YouTube Data API v3 key:
1. Create a project in Google Cloud Console.
2. Enable **YouTube Data API v3**.
3. Create an API key.
4. Restrict it to the deployed website's HTTP referrers and restrict API access to YouTube Data API v3.
5. Open FocusTube → Settings → paste the key → Save key → Refresh approved channels.

The key is stored in this browser's localStorage. A browser-side key is not secret; referrer/API restrictions are important. YouTube API quota limits apply.

## Run locally
A PWA/service worker needs localhost or HTTPS. On a computer with Python installed, from this folder run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

For Android, deploy the folder to an HTTPS static host (for example, GitHub Pages), open the URL in Chrome, then use **⋮ → Add to Home screen** / **Install app**.

## Current limitations
- `/c/custom-name` links are not resolved automatically. Use the channel's `@handle` or `/channel/UC...` URL.
- YouTube controls playback and may show some player UI, ads, or end-screen elements. FocusTube hides its own recommendation surfaces but cannot fully control YouTube's embedded player.
- This first version loads recent uploads, not every historical video.
- No Shorts feed, trending page, autoplay queue, comments panel, or algorithmic recommendation system is implemented.
- Library data and API key are browser-local. Export regularly if you want a backup.
- Removing a channel also removes its cached videos.

## Next development steps
1. Add a dedicated Saved view and watched/unwatched state.
2. Add pagination / load more for approved channel uploads.
3. Add a stronger focus mode and session timer.
4. Add optional sync only if needed.
