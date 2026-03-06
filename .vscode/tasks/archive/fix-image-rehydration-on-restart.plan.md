# Fix: Images Lost in Queue Tasks After Server Restart

## Problem

When a CoC queue task includes images (e.g., screenshots attached to user messages), the images are visible during initial execution but **lost from the conversation history** after a server restart. The assistant's response says "Looking at the image..." but no image is shown in the conversation UI.

## Root Cause

Image persistence uses two stages with a timing mismatch:

1. **On enqueue/save:** `sanitizeTaskForPersistence()` externalizes images from `payload.images` to `~/.coc/blobs/<taskId>.images.json` via `ImageBlobStore`, then sets `payload.images = []` and records `payload.imagesFilePath`.

2. **On execution (`execute()` in `queue-executor-bridge.ts`):**
   - **Line ~180:** The initial conversation turn is created using `task.payload.images` — which is `[]` after restore.
   - **Line ~196:** This turn (with `images: undefined`) is persisted to the process store.
   - **Line ~690 (inside `executeWithAI()`):** Images are rehydrated from `imagesFilePath` — but this is **too late**; the conversation turn already has no images.

So the AI receives the images correctly (rehydrated before the API call), but the **conversation history record** permanently loses them.

## Proposed Fix

Move the image rehydration from `executeWithAI()` to `execute()`, **before** the initial conversation turn is constructed.

### Changes

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

1. **Before line ~179** (before `// Store initial user turn immediately`):
   - Add early rehydration: load images from `ImageBlobStore` if `payload.imagesFilePath` is set and `payload.images` is empty.

2. **Lines ~690-694** (inside `executeWithAI()`):
   - Keep the existing rehydration as a safety net (it's a no-op if images are already loaded, since it checks `payload.images.length === 0`).

### Pseudocode

```typescript
// In execute(), BEFORE creating initial conversation turn:
const payload = task.payload as any;
if (payload?.imagesFilePath && (!Array.isArray(payload.images) || payload.images.length === 0)) {
    payload.images = await ImageBlobStore.loadImages(payload.imagesFilePath);
}

// Then the existing code picks up the rehydrated images:
const payloadImages = Array.isArray(payload?.images)
    ? payload.images.filter((img: unknown) => typeof img === 'string')
    : undefined;
```

## Testing

- Queue a task with an image attached
- Restart the server
- Let the task execute (or check the conversation history for already-completed tasks)
- Verify the image appears in the conversation turn in the UI
- Verify the AI still receives the image correctly

## Scope

- Single file change (`queue-executor-bridge.ts`)
- ~5 lines added, 0 removed
- No behavioral change for tasks without images or tasks that don't go through a restart
