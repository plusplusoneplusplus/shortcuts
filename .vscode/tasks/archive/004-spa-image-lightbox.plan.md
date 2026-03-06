---
status: pending
---

# 004: SPA — Click-to-View Image Lightbox for Thumbnails

## Summary

Create a shared `ImageLightbox` React component and wire it into all SPA image thumbnail locations (`ImagePreviews.tsx` and `GenerateTaskDialog.tsx`) so users can click a thumbnail to view the full-size image in an overlay.

## Motivation

The SPA currently renders pasted/attached images as small thumbnails (48×48 in `ImagePreviews`, 80×80 in `GenerateTaskDialog`) with no way to see the full image. Users need to verify what they pasted before submitting. A click-to-expand lightbox is the standard UX pattern and was already planned for the `ImageGallery` read-only component (commit 003). Extracting the lightbox into a standalone shared component lets both input thumbnails and future read-only galleries reuse the same code.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/shared/ImageLightbox.tsx` — Lightweight full-screen overlay component for viewing a single image at full size.

  **Props:**
  ```ts
  export interface ImageLightboxProps {
      src: string | null;     // base64 data URL or null to hide
      alt?: string;
      onClose: () => void;
  }
  ```

  **Behavior:**
  - Renders via `ReactDOM.createPortal` to `document.body` (same pattern as `Dialog.tsx` line 42).
  - Returns `null` when `src` is `null`.
  - Overlay: `fixed inset-0 z-[10003] flex items-center justify-center bg-black/80` (z-index one above Dialog's 10002).
  - Image: `max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl`.
  - Close `×` button: `absolute top-4 right-4`, white text, semi-transparent background, 32×32px.
  - Clicking the overlay backdrop calls `onClose`.
  - Pressing `Escape` calls `onClose` (via `useEffect` keydown listener, same pattern as `Dialog.tsx` lines 19–24).
  - `cursor-zoom-out` on the overlay, `cursor-default` on the image.

### Files to Modify

- **`packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx`**
  - Import `{ useState }` from React and `ImageLightbox` from `./ImageLightbox`.
  - Add internal state: `const [viewIndex, setViewIndex] = useState<number | null>(null);`
  - Add `cursor-pointer` (or `cursor-zoom-in`) class to the `<img>` element (line 29), and an `onClick` handler on the `<img>`: `onClick={() => setViewIndex(index)}`.
  - Render `<ImageLightbox>` at the end of the returned JSX:
    ```tsx
    <ImageLightbox
        src={viewIndex !== null ? images[viewIndex] : null}
        alt={viewIndex !== null ? `Pasted image ${viewIndex + 1}` : undefined}
        onClose={() => setViewIndex(null)}
    />
    ```
  - The existing remove button already calls `e.stopPropagation()` (line 34), so clicking remove will NOT trigger the lightbox.

- **`packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`**
  - Import `{ ImageLightbox }` from `'../shared/ImageLightbox'`.
  - Add state: `const [viewImageIndex, setViewImageIndex] = useState<number | null>(null);`
  - On each `<img>` in the image preview strip (line 189), add:
    - `className="... cursor-zoom-in"` (append to existing classes)
    - `onClick={() => setViewImageIndex(i)}`
  - Render `<ImageLightbox>` at the bottom of the Dialog's children (before the closing `</Dialog>`):
    ```tsx
    <ImageLightbox
        src={viewImageIndex !== null ? images[viewImageIndex] : null}
        alt={viewImageIndex !== null ? `Attachment ${viewImageIndex + 1}` : undefined}
        onClose={() => setViewImageIndex(null)}
    />
    ```

- **`packages/coc/src/server/spa/client/react/shared/index.ts`**
  - Add re-export:
    ```ts
    export { ImageLightbox } from './ImageLightbox';
    export type { ImageLightboxProps } from './ImageLightbox';
    ```

### Files to Delete

- None

## Implementation Notes

### Why a Standalone Component (Not Inline in ImagePreviews)

`GenerateTaskDialog` does NOT use `ImagePreviews` — it has its own inline 80×80 thumbnail strip. A standalone `ImageLightbox` serves both locations and can also be reused by the planned `ImageGallery` component (commit 003) without creating a dependency on the input-oriented `ImagePreviews`.

### Interaction Details

- **Click image → lightbox opens** showing the full image centered on a dark backdrop.
- **Click backdrop / press Escape / click ×** → lightbox closes.
- The remove `×` button on each thumbnail remains functional and does NOT trigger the lightbox (existing `e.stopPropagation()` in `ImagePreviews`; separate `<button>` element in `GenerateTaskDialog`).

### z-index Layering

`Dialog.tsx` uses `z-[10002]`. The lightbox uses `z-[10003]` so it renders above any open dialog (the Generate Task dialog is itself a `<Dialog>`).

### Theme Consistency

The lightbox overlay is always dark (`bg-black/80`) since it's a photo-viewer context. The close button uses white text with a semi-transparent dark background, consistent with the existing `openImageModal` pattern in `image-handlers.ts`.

## Tests

- **ImageLightbox unit tests** (`packages/coc/src/server/spa/client/react/shared/__tests__/ImageLightbox.test.tsx`):
  - Renders nothing when `src` is `null`.
  - Renders a portal overlay with the full image when `src` is provided.
  - Clicking the backdrop calls `onClose`.
  - Pressing `Escape` calls `onClose`.
  - Clicking the close `×` button calls `onClose`.
  - The image `<img>` has the correct `src` and `alt` attributes.

- **ImagePreviews integration** (update existing tests or add to `__tests__/ImagePreviews.test.tsx`):
  - Clicking a thumbnail image opens the lightbox (portal appears with full image).
  - Clicking the remove button does NOT open the lightbox.
  - Closing the lightbox returns to the thumbnail view.

- **GenerateTaskDialog integration** (update existing tests or add):
  - Clicking a thumbnail in the image strip opens the lightbox.
  - Lightbox renders above the dialog (z-index check via portal).

## Acceptance Criteria

- [ ] New `ImageLightbox` component exported from `shared/`
- [ ] Clicking any thumbnail in `ImagePreviews` opens a full-size lightbox
- [ ] Clicking any thumbnail in `GenerateTaskDialog` opens a full-size lightbox
- [ ] Lightbox closes on Escape, backdrop click, or close button click
- [ ] Remove `×` buttons still work without triggering lightbox
- [ ] Lightbox renders above the Generate Task dialog (z-index 10003 > 10002)
- [ ] Works in both dark and light themes
- [ ] All existing and new tests pass (`npm run test` in `packages/coc`)

## Dependencies

- Depends on: None (this commit only touches existing input-thumbnail components, not the chat-bubble rendering from 001–003)

## Assumed Prior State

Existing `ImagePreviews.tsx`, `GenerateTaskDialog.tsx`, `Dialog.tsx`, and `shared/index.ts` are in their current state. No changes from commits 001–003 are required — those affect conversation turn types and chat bubble rendering, which are orthogonal to the input-thumbnail lightbox.
