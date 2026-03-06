# Bug: Stale image shown when switching between queued tasks

## Problem

When a user clicks on a queued task that has an image attachment, then navigates to a different task that has **no** image, the previous task's image still appears in the detail panel.

**Root cause:** `PendingTaskPayload` component (`packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`, line 802) maintains a local `payloadImages` state that is **never cleared** when switching to a task without images.

### Failure path

1. User selects **Task A** (`hasImages: true`) → `useEffect` fires, `payloadImages` populated with A's images.
2. User selects **Task B** (`hasImages: false`) → `useEffect` hits the early-return guard at line 809 (`!payload.hasImages`) **without resetting** `payloadImages`.
3. Render logic at line 821 falls back to stale `payloadImages` → ghost image from Task A appears on Task B.

## Fix

In the `useEffect` inside `PendingTaskPayload` (line 808), reset `payloadImages` **before** the early-return guard:

```tsx
useEffect(() => {
    setPayloadImages([]);           // ← clear stale images on every task switch
    setPayloadImagesLoading(false); // ← reset loading state too
    if (!task?.id || !payload.hasImages || (payload.images && payload.images.length > 0)) return;
    setPayloadImagesLoading(true);
    fetchApi(`/queue/${encodeURIComponent(task.id)}/images`)
        .then((data: any) => { setPayloadImages(data?.images || []); })
        .catch(() => { /* non-fatal */ })
        .finally(() => { setPayloadImagesLoading(false); });
}, [task?.id, payload.hasImages]);
```

### Why the parent's `clearImages()` doesn't help

The `clearImages()` called in the reset effect (line 341) only clears **paste images** from the `useImagePaste` hook (images pasted into the follow-up textarea). It is completely separate from `payloadImages` inside `PendingTaskPayload`.

## Tasks

1. ~~**Fix `PendingTaskPayload` useEffect** — Add `setPayloadImages([]); setPayloadImagesLoading(false);` before the early-return guard in the effect at line 808.~~ ✅
2. ~~**Add test** — Verify that switching from a task with images to a task without images clears the displayed images.~~ ✅

## Files to change

- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` — the 2-line fix in `PendingTaskPayload`
