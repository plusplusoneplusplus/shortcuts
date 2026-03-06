---
status: done
---

# 003: Frontend — Render Images in Chat Conversation Bubbles

## Summary

Add an `ImageGallery` component that renders base64 image thumbnails with a click-to-expand lightbox, wire it into `ConversationTurnBubble` for user-attached images, and optionally detect image data URLs in tool-call results in `ToolCallView`.

## Motivation

Commits 001 and 002 added the `images` field to conversation turns and ensured the backend persists/streams them. Without this commit, attached images are silently dropped in the UI — users see only their text. This commit closes the loop by rendering images where they belong: inside chat bubbles and tool results.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/shared/ImageGallery.tsx` — Reusable component that accepts `images: string[]` (base64 data URLs) and renders a flex row of 64×64 thumbnails. Clicking a thumbnail opens a full-size lightbox overlay (using the existing `Dialog` component from `packages/coc/src/server/spa/client/react/shared/Dialog.tsx` or a lightweight portal with Escape-to-close). Tailwind-styled to match the existing dark/light theme patterns (bg-[#f5f5f5]/dark:bg-[#2d2d2d], border colors).

### Files to Modify

- **`packages/coc/src/server/spa/client/react/types/dashboard.ts`** (line 32–40) — Add optional `images?: string[]` field to `ClientConversationTurn` interface. This aligns with the server-side `ConversationTurn` type updated in commit 001. Insert after line 38 (`streaming?: boolean;`):
  ```ts
  images?: string[];
  ```

- **`packages/coc/src/server/spa/client/react/shared/index.ts`** (line 17–18) — Add re-export for the new `ImageGallery` component:
  ```ts
  export { ImageGallery } from './ImageGallery';
  export type { ImageGalleryProps } from './ImageGallery';
  ```

- **`packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`** — Two changes:
  1. **Import** `ImageGallery` from `'../shared/ImageGallery'` (or `'../shared'`) at line 5–8.
  2. **Render images below user markdown** — at line 464, after `{isUser && userContentHtml && <MarkdownView html={userContentHtml} />}`, add:
     ```tsx
     {isUser && turn.images && turn.images.length > 0 && (
         <ImageGallery images={turn.images} />
     )}
     ```

- **`packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`** (lines 274–281) — In the result section, detect if `resultText` is an image data URL and render an `<img>` instead of a `<pre>` block:
  1. **Add a helper** near the top of the file (after line 59):
     ```ts
     function isImageDataUrl(s: string): boolean {
         return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(s.trim());
     }
     ```
     (If the shared `isImageDataUrl` utility from commit 001 is available as an importable function, import it instead of duplicating.)
  2. **Replace the result rendering block** (lines 274–280). Change:
     ```tsx
     {resultText && (
         <div>
             <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
             <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                 <code>{visibleResult}</code>
             </pre>
         </div>
     )}
     ```
     To:
     ```tsx
     {resultText && (
         <div>
             <div className="text-[10px] uppercase text-[#848484] mb-0.5">Result</div>
             {isImageDataUrl(resultText) ? (
                 <img
                     src={resultText}
                     alt="Tool result image"
                     className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] cursor-pointer"
                 />
             ) : (
                 <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                     <code>{visibleResult}</code>
                 </pre>
             )}
         </div>
     )}
     ```

### Files to Delete

- None

## Implementation Notes

### ImageGallery Component Design

- **Props:** `images: string[]`, optional `className?: string`.
- **Thumbnails:** 64×64px, `object-cover`, flex row with `gap-2`, wrapped. Style mirrors `ImagePreviews.tsx` (line 24: `w-12 h-12 rounded overflow-hidden border`) but uses `w-16 h-16` for slightly larger display-only thumbnails (no remove button).
- **Lightbox:** Use a portal-based overlay similar to `Dialog.tsx` (lines 33–55). The lightbox shows the full image with `max-w-[90vw] max-h-[90vh] object-contain`. Clicking the overlay backdrop or pressing Escape closes it. Could either reuse `Dialog` directly (passing the image as `children`) or create a minimal lightbox inline — the Dialog approach is simpler and consistent.
- **No remove button:** Unlike `ImagePreviews` which has per-image remove buttons (for the input area), `ImageGallery` is read-only for chat history.
- **Empty guard:** Return `null` if `images` is empty or undefined.

### Theme Consistency

Follow existing patterns:
- Border: `border-[#d0d0d0] dark:border-[#3c3c3c]`
- Background: `bg-[#f5f5f5] dark:bg-[#2d2d2d]`
- These match `ImagePreviews.tsx` line 24.

### isImageDataUrl Placement

Commit 001 added `isImageDataUrl()` to the server-side types. For the SPA frontend, either:
1. Import from a shared utility if it's available in a path the SPA can reach, or
2. Define a small inline helper in `ToolCallView.tsx` (3 lines). Prefer option 2 to avoid coupling the SPA bundle to server code.

### Data Flow

```
Server SSE → ClientConversationTurn.images (string[]) → ConversationTurnBubble → ImageGallery
                                                                                     ↓
                                                                              Lightbox on click
```

## Tests

- **ImageGallery unit tests** (`packages/coc/src/server/spa/client/react/shared/__tests__/ImageGallery.test.tsx`):
  - Renders nothing when `images` is empty or undefined.
  - Renders one `<img>` thumbnail per image in the array.
  - Clicking a thumbnail opens the lightbox overlay.
  - Pressing Escape closes the lightbox.
  - Clicking the backdrop closes the lightbox.

- **ConversationTurnBubble tests** (update existing test file or add new):
  - User turn with `images: ['data:image/png;base64,...']` renders an `ImageGallery`.
  - User turn without images does not render `ImageGallery`.
  - Assistant turn never renders `ImageGallery` (images are user-only).

- **ToolCallView tests** (update existing test file or add new):
  - Tool result starting with `data:image/png;base64,` renders an `<img>` tag, not a `<pre>`.
  - Tool result with normal text renders as `<pre>` (existing behavior preserved).

## Acceptance Criteria

- [ ] `ClientConversationTurn` type includes optional `images?: string[]` field
- [ ] New `ImageGallery` component renders a row of thumbnails from base64 data URLs
- [ ] Clicking a thumbnail opens a full-size lightbox; Escape or backdrop click closes it
- [ ] User chat bubbles display attached images below the markdown content
- [ ] Tool results that are image data URLs render as inline images instead of raw text
- [ ] Dark and light themes both render correctly (borders, backgrounds)
- [ ] All new and existing tests pass (`npm run test` in `packages/coc`)
- [ ] No regressions in assistant bubble rendering or tool call display

## Dependencies

- Depends on: 001 (types + utility), 002 (backend persistence of images in turns)

## Assumed Prior State

Commit 001 has added `images?: string[]` to `ConversationTurn` and `ClientConversationTurn` types, plus the `isImageDataUrl()` utility. Commit 002 persists user-attached images in the `ConversationTurn` and includes them in SSE events, so `turn.images` is populated with base64 data URLs when the frontend receives conversation data.
