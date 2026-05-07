# Mock Studio

Static HTML prototype that mirrors the real Pulse UI pixel-for-pixel using the same `style.css`. Used for taking marketing screenshots, theme previews, and recording demo videos without exposing real session data.

## How to open

Two ways, both work.

### Via Vite dev server (recommended)

```bash
cd auralis-pulse
npm install         # first time only
npm run dev
```

Open: <http://localhost:1421/mock/>

### Direct file open

Just double-click `mock/index.html`. Works in Chrome/Edge without a server because everything is plain HTML/CSS/JS with relative paths.

## What you can control (top bar)

- **Theme** - Cyberpunk / Glass / Light. Same theme tokens as the real app.
- **View** - Main (sessions panel) or Settings (with all 5 tabs).
- **Tab** - When in Settings: Appearance / Behavior / Alerts / Commands / About.
- **Overlay** - None / Preset modal / Send popover. Anchored to a sample session.
- **Size** - 1x (native 810x520), 2x (1620x1040), 3x (2430x1560). Use 2x or 3x for high-DPI README screenshots without quality loss.

## Taking screenshots

1. Set up the state you want (theme + view + overlay + size).
2. Append `?clean` to the URL: <http://localhost:1421/mock/?clean>. The studio bar disappears, leaving only the framed mock window centered on the page.
3. Use OS screenshot tool (Win+Shift+S on Windows) and drag a tight rectangle around the framed window.
4. Save as PNG to `docs/`.

## Recording demos (optional, for GIF)

Use [ScreenToGif](https://www.screentogif.com/) or [ShareX](https://getsharex.com/):
1. Set state to `?clean&size=2`
2. Record the framed area
3. Manually toggle controls between captures (or do it from a second tab and screenshot the result)

For a Remotion-based rendered video, the mock can be embedded in a Remotion composition (the studio frame is just a `<div id="mock-app">` with normal HTML inside). Out of scope for v1.

## Sample data

All hardcoded in `mock.js` at the top:
- 5 sessions with neutral agent-y names: architect-spark, mira-strategist, harness-architect, anima-architect, content-architect
- One session pinned (architect-spark)
- One session crossing T1 alert threshold (harness-architect at 56%)
- 4 alert presets (Default / Worker / Architect / Soul)
- 4 commands (Compact / Crystallize / Handoff / Status)
- Sample usage: 5h 29%, weekly 41%, sonnet 3%

Edit any of these in `mock.js` if you want different screenshots.

## Sync with the real app

The mock imports `../src/style.css` directly, so any visual change in the real app (colors, spacing, theme tokens, animations) propagates automatically.

What does NOT auto-sync: DOM structure inside session cards, settings views, modal bodies. If you change the structure of `renderSession` or any other render function in `src/main.js`, mirror that change in `mock/mock.js`. There is a comment at the top of `mock.js` noting which version it last synced with.
