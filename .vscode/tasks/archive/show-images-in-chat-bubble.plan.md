# Show Images in Chat Bubbles

## Problem

When users attach images to a chat message, the images are sent to the AI backend but are **not displayed** inside the user's chat bubble in the conversation view. The `ImageGallery` component exists and is already wired for user turns, but there is a related question: are images actually being stored in `turn.images` after submission, or only shown in the staging area (`ImagePreviews`) before sending?

Looking at the current code in `ConversationTurnBubble.tsx` (line 465–467):

```tsx
{isUser && turn.images && turn.images.length > 0 && (
    <ImageGallery images={turn.images} />
)}
```

The rendering logic **already exists** for user bubbles. The likely issue is that images are sent in the HTTP payload but **not persisted back into the `ClientConversationTurn.images` field** when the conversation is loaded from the server, so `turn.images` is empty/undefined when rendering historical turns.

## Approach

Trace the full image lifecycle: paste → send → server persist → reload → render. Identify where images are dropped and fix the gap.

## Tasks

### 1. Verify client-side image attachment flow ✅
- **File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`
- Images included in POST body ✅. Local user turns now include images for immediate rendering ✅.

### 2. Verify server-side image persistence ✅
- **Files:** `queue-executor-bridge.ts`, `api-handler.ts`
- POST /processes/:id/message already persisted images ✅. POST /queue initial turn now persists images ✅.

### 3. Verify image round-trip on reload ✅
- `ConversationTurn` and `SerializedConversationTurn` both have `images` field. Serialization/deserialization preserves it.

### 4. Handle externalized images (if applicable) — N/A
- Not applicable for this change; images are stored inline as base64 data URLs.

### 5. Add tests ✅
- Added 3 executor bridge tests (persist, no-images, filter non-strings) and 2 RepoChatTab source tests.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Renders chat bubbles; already has `ImageGallery` for user turns |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Chat tab; sends images in POST body |
| `packages/coc/src/server/spa/client/react/shared/ImageGallery.tsx` | Thumbnail grid + lightbox component |
| `packages/coc/src/server/spa/client/react/shared/useImagePaste.ts` | Clipboard paste → base64 hook |
| `packages/coc-server/src/api-handler.ts` (or equivalent) | Server route handling for queue/message |
| `packages/pipeline-core/src/process-store/` | Process/turn persistence |

## Notes

- Images are base64 data URLs. For large images this can bloat persisted JSON. The `queue-image-externalization` task folder suggests this is a known concern — coordinate with that effort if needed.
- The `ImageGallery` component already handles thumbnails (64×64) with click-to-expand lightbox, so no UI component work is expected.
- Only user turns have images today. Assistant turns don't generate images, so no changes needed there.
