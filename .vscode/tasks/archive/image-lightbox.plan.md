# Image Lightbox — Click to View Full Size

## Problem

In the CoC SPA dashboard (served by `coc-server`), images rendered inside markdown content are constrained to `max-width: 100%` and cannot be viewed at their actual/full size. Users need to click on an image to open it in a fullscreen overlay at its native resolution.

## Approach

Add a lightweight CSS/JS lightbox directly into the SPA client bundle. No external dependencies required.

## Key Files

| File | Change |
|------|--------|
| `packages/coc-server/src/wiki/spa/client/styles.css` | Add lightbox overlay + backdrop CSS |
| `packages/coc-server/src/wiki/spa/client/markdown.ts` | Add click handlers to `<img>` elements inside `processMarkdownContent()` |

## Todos

### 1. Add lightbox CSS to `styles.css`
Add styles for:
- **Backdrop overlay**: fixed fullscreen, semi-transparent black background (`rgba(0,0,0,0.85)`), high z-index, hidden by default
- **Image container**: centered, `max-width: 95vw`, `max-height: 95vh`, `object-fit: contain` so the image shows at actual size up to viewport bounds
- **Cursor**: `zoom-in` on thumbnails inside `.markdown-body`, `pointer` on the overlay (click to dismiss)
- **Transition**: fade-in/out for smooth UX

### 2. Add image click handlers in `processMarkdownContent()` (`markdown.ts`)
Inside `processMarkdownContent()`, after existing post-processing:
- Create the lightbox overlay element once (a `<div>` containing an `<img>`) and append to `document.body`
- Query all `img` elements inside `.markdown-body`
- For each image, add a `click` event listener that:
  - Sets the lightbox `<img>.src` to the clicked image's `src`
  - Shows the overlay (add an `active` class)
- Add a click listener on the overlay itself to dismiss (remove `active` class)
- Add an `Escape` keydown listener to dismiss

### 3. Rebuild the SPA client bundle
- Run the esbuild step (or `npm run build` in `packages/coc-server`) to regenerate `bundle.js` and `bundle.css` that get inlined into `html-template.ts`

### 4. Verify
- Run `npm run build` from repo root
- Run existing tests (`npm run test:run` in `packages/coc-server`)
- Manual verification: `coc serve`, open dashboard, confirm clicking an image opens the lightbox at full size, clicking backdrop or pressing Escape dismisses it

## Design Notes

- **No external deps** — pure CSS + vanilla JS, consistent with existing codebase style
- **Idempotent** — `processMarkdownContent()` is called on every page render; the lightbox overlay element should be created only once (guard with `document.getElementById`)
- **Accessibility** — Escape key dismissal, click-outside dismissal
- **No zoom/pan** — keep it simple; just show the image at native resolution constrained to viewport
