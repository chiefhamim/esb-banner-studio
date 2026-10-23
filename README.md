# ESB Studio

Desktop editor that reproduces the ESB PowerLine news banner templates exactly (10 categories ×
Facebook 1598×1431 and Web 1920×1080), then lets you pick the date, headline and photos and export both sizes.
Everything runs locally and offline (fonts and artwork are bundled). The UI follows esbpowerline.com: Inter + Space Grotesk, slate cards, pill navigation, light/dark.

## Use
* **Story**: category, date, headline (auto font size per the brand guideline, warning over 90 characters),
  highlighted phrase (Web panel), "NEWS LINK IN COMMENT" pill.
* **Photos**: add one or many (button, drag-and-drop, or Ctrl+V), pick a collage layout, set the gap,
  drag a photo to pan it and scroll to zoom it. Framing is stored separately for Facebook and Web.
* **Inspector** (Photoshop-style): align to canvas or to each other, distribute, X/Y/W/H, keep proportions, arrange order,
  opacity, fill/radius, full Character controls (weight, size, tracking, leading, alignment, colour),
  drop shadow, outline/border. Drag any number's label sideways to scrub it (Shift ×10, Alt fine).
* **Layers**: flat stack in paint order - drag to reorder, eye/lock, filter, duplicate, delete; add your own
  text, rectangle and image layers (T, R, toolbar). Template layers can be hidden/restyled/reset but not deleted.
* **Canvas**: rulers with draggable guides (double-click to remove), snapping, marquee and Shift multi-select,
  hand tool / Space-drag, Ctrl+wheel zoom at cursor, double-click text to edit in place, right-click layer menu.
* **Shortcuts**: press `?` in the app. Undo/redo is unlimited per session (Ctrl+Z / Ctrl+Y).
* **Export** (Ctrl+E): presets (WhatsApp, Publish, Retina, Print, Web, Everything-ZIP), pick Facebook and/or Web,
  any number of resolutions at once (0.5x-4x or a custom multiplier, same layout, more pixels), PNG / JPG / WebP with quality,
  file-name template (`{cat} {category} {date} {format} {w} {h} {scale} {headline}`), optional single ZIP, remembered folder
  in the desktop app. Copy the current banner to the clipboard with Ctrl+Shift+C. The Export caret has quick one-click exports.
  Work in progress autosaves (photos are re-added each session).

## New in 1.1
* **Formats**: Facebook Feed 4:5 (1080x1350, recommended, same size as the YoY cards), Square 1:1, Facebook Classic (1598x1431, legacy) and Web 16:9. Each keeps its own layout, edits, layers and guides; headline, date, category and photos are shared.
* **Everything is movable straight away** (nothing is locked by default). Shift = keep proportions, Alt = from the centre, Shift+Alt = both. Ctrl+drag marquee, Alt+click picks the layer underneath.
* **Menu bar** (File / Edit / Insert / Arrange / View / Help) showing every shortcut, copy / cut / paste layers, projects (`.esb`, Ctrl+S / Ctrl+O) with photos embedded, recent list.
* **Everyday tools**: photo credit line, post-caption generator with hashtags, one-click highlight suggestion, *Next story - keep this layout* (Ctrl+Shift+N), crop guides showing how Facebook trims the banner, export preflight, an editable project saved beside every export (desktop app), per-layer reset.
* Tests: `npm run test:ui` (57 checks), `node tools/fuzz.mjs 350 <seed>` (random-operation bug hunt), `node tools/overflow-audit.mjs` (clipped-text audit), `node tools/golden-test.mjs` (pixel match to Figma).

## New in 1.2
* Formats: **YouTube Thumbnail 1280x720** added. Photos can **zoom out below 1x** (down to 0.1x) with a blurred / black / white / tint backdrop, plus Fill and Fit-whole-photo buttons.
* The **headline icon** is a real object: drag it, resize from its corners, blur, opacity, stroke, colour. It is also on the 4:5 and 1:1 layouts.
* Text can use **four bundled fonts** (Inter, Space Grotesk, Source Serif 4, Oswald). Photo credit has placement, font, size, colour and an optional dark pill.
* Tooltips are drawn in the top layer (no more clipping under cards); dark-mode logo sits on a clean white section.

## New in 1.3
* **Selection that lets go**: a plain click on bare canvas always clears the selection (backgrounds and the headline icon no longer catch clicks). Select them from Layers, Alt+click or double-click; move any selected layer by dragging its name tag.
* **Label pills** copied from the website: Breaking (red, flame), Featured (amber, star), Trending (blue, trending-up) plus Custom; text, corner and size are editable.
* **Facebook preview** tab: live phone feed post, desktop feed post and link-share card (1.91:1 crop), Facebook dark mode, large 1:1 view, "See more" caption truncation.
* Fixes: text-field focus is released when you click elsewhere so Ctrl+Z always undoes the banner.

## Run / build
```
npm install
npm run dev          # browser dev server
npm run app          # build + open in Electron
npm run dist         # package to release-v1.3.0/win-unpacked/ESB Studio.exe
npm run test:golden  # pixel-diff templates against Figma exports (tools/golden)
npm run test:ui      # end-to-end UI test in Edge
```
Electron's own binary is fetched by `node node_modules/electron/install.js` (npm blocks install scripts by default).

## How exactness is guaranteed
`src/core/*` is a custom canvas renderer of the Figma templates (Inter 3.19, Figma text metrics, layer blur,
gradients). `tools/golden-test.mjs` diffs it against Figma's own exports: Facebook ≤ 0.025 % of pixels,
Web ≤ 0.17 %, all of it glyph anti-aliasing.

## v1.4
- Live **Facebook preview** is a floating window next to the format selector (button or `P`): phone / desktop / link-post, dark mode, zoom, drag anywhere.
- Label pill can sit in the **header centre** with equal gaps above and below.
- Photo library opens automatically on launch and when photos are added, and shows a photo count.
- Desktop shell honours `--user-data-dir` / `ESB_USER_DATA` so tests never touch the real profile.

## v1.5 — "Quiet Studio" design language
- **Neutral interface**: graphite greys with ink (near-black / near-white) as the only accent — switches, primary buttons, selection. Red/amber appear only for warnings. The banner's own colours are the only colour on screen.
- **One geometry**: 4 px grid; type scale 11 / 12 / 13 / 15 / 18 px (Inter only, three weights); control heights 28 / 32 / 36; radii 4 / 8 / 12 / 16; flat hairline-divided panels. Every text/background pair is ≥ 4.5 : 1 in light and dark.
- **Resizable panels**: drag the edge of the left or right panel, or the top of the Elements/Layers dock. Double-click or Home resets, arrow keys nudge (Shift = ×3). Sizes are remembered.
- **Elements panel**: every part of the banner (logo, date, category chip, photo area, label, credit, headline, headline icon, link pill, footer socials, stripes, edge line…) plus your custom layers has an on/off switch, per group and per item, one undo step each. "Show all" brings everything back. The raw layer stack is the neighbouring *Layers* tab.
- **Refresh-rate smooth**: panel resizing, layer dragging and the preview window run one write per animation frame (compositor transforms, grid track changes — no whole-tree restyles); while dragging, everything above/below the moving layer is frozen into bitmaps. Measured on the production build: 2–3 ms of main-thread work per frame (budget 6.9 ms at 144 Hz).
- **Preview window**: opens beside the right panel, drags by its title bar, resizes from its corner (50–160 %), dark-mode toggle in the zoom group.
- Tools: `tools/perf-ui.mjs` (frame cost), `tools/audit-ui.mjs` (type/radius/spacing census), `tools/shot-*.mjs` (review screenshots).
