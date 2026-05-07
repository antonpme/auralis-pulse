# README Assets - capture checklist

The new README (currently in `README.draft.md`) references these images. Capture them from the **Mock Studio** (`mock/index.html`) which uses sample data only - no real session names or paths leak into screenshots.

## Workflow

Mock studio is at `mock/index.html`. Open via Vite (already running, or `npm run dev`):

<http://localhost:1421/mock/?clean>

The `?clean` param hides the studio control bar so you get a pristine framed window for capture. Switch theme/view/overlay/size via the studio controls (without `?clean`), then add `?clean` and screenshot.

## Cover image (1 file)

**`docs/cover.png`** - hero image at the top.

Pending: generate via Nano Banana / GPT-Image 2 using the prompt for the chosen concept (A / B / C, see chat). Composite real screenshots over the generated background. Final canvas: 1280x640 px.

## Theme gallery (3 files)

Capture each at 2x size for high-res rendering on Retina/HiDPI screens.

Steps for each theme:
1. Mock controls: Theme = (target), View = Main, Overlay = None, Size = 2x
2. Append `?clean` to URL
3. Screenshot the framed window only (Win+Shift+S, drag tight)

Files:
- **`docs/theme-cyberpunk.png`** - dark, neon green, sharp corners
- **`docs/theme-glass.png`** - translucent dark, blue accents, soft corners
- **`docs/theme-light.png`** - clean white, purple accent

Target visual size when rendered: 1620x1040 native (will downscale in browser to ~440px wide each in the README triptych).

## Inline feature shots (optional, for delta-style inline pairing)

If we go with inline mini-screenshots next to bullet items in the Features section:

- **`docs/feature-preset-modal.png`** - Mock with Overlay = Preset modal (Glass theme reads best)
- **`docs/feature-alert-state.png`** - Cyberpunk theme with the harness-architect alert tier visible
- **`docs/feature-settings-alerts.png`** - Settings -> Alerts tab showing the four built-in presets

Sized smaller, ~600px wide each.

## Per-PID demo GIF (optional, 1 file)

**`docs/demo-per-pid.gif`** - the unique-feature demo.

Hard to mock since this needs the real app sending into a real terminal. Capture from the actual app running, with neutral session names visible. Or skip and let the technical explainer in the How-it-works `<details>` carry the weight.

## After all assets are in place

1. Verify all files are in `docs/`
2. Compare against `README.draft.md` paths
3. Move: `mv README.md README.old.md && mv README.draft.md README.md`
4. Commit: `docs: rewrite README - cover, theme gallery, restructured features`
5. Push
