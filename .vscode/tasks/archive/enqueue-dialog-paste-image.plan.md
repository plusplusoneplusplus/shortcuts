# Enqueue Dialog — Paste Image Support

## Problem

The "Enqueue AI Task" dialog in the CoC SPA does not support pasting images into the prompt textarea. The "Generate Task" dialog already has this capability via the reusable `useImagePaste` hook and `ImagePreviews` component. Users need the same image-paste experience in the enqueue dialog to provide visual context with their prompts.

## Approach

Reuse existing image-paste infrastructure (`useImagePaste` hook, `ImagePreviews` component) in `EnqueueDialog`, and ensure both frontend submit paths (freeform and skill-based) send images to the backend. The backend already has image promotion logic in `validateAndParseTask` — the freeform legacy path just needs to forward the `images` array.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Dialog component — needs image paste wiring |
| `packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts` | Reusable hook — already exists, no changes needed |
| `packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx` | Reusable thumbnail strip — already exists, no changes needed |
| `packages/coc/src/server/queue-handler.ts` | Backend enqueue handler — legacy path needs to forward images |

## Tasks

### 1. Wire `useImagePaste` hook into `EnqueueDialog`

**File:** `EnqueueDialog.tsx`

- Import `useImagePaste` from `../hooks/useImagePaste`
- Import `ImagePreviews` from `../shared/ImagePreviews`
- Call `const { images, addFromPaste, removeImage, clearImages } = useImagePaste();` in the component
- Add `onPaste={submitting ? undefined : addFromPaste}` to the `<textarea>`
- Render `<ImagePreviews images={images} onRemove={removeImage} showHint />` below the textarea
- Call `clearImages()` alongside `setPrompt('')` on successful submit and dialog close

### 2. Include images in freeform submit path

**File:** `EnqueueDialog.tsx` — `handleSubmit` callback

In the freeform (non-skill) branch (currently lines 121-132), add `images` to the JSON body when present:
```ts
body: JSON.stringify({
    prompt: prompt.trim(),
    model: model || undefined,
    workspaceId: workspaceId || undefined,
    folderPath: folderPath || undefined,
    images: images.length > 0 ? images : undefined,   // ← add this
}),
```

### 3. Include images in skill-based submit path

**File:** `EnqueueDialog.tsx` — `handleSubmit` callback

In the skill-based branch (currently lines 101-120), add images to the payload:
```ts
const body: any = {
    type: 'follow-prompt',
    priority: 'normal',
    displayName: `Skill: ${selectedSkill}`,
    payload: {
        skillName: selectedSkill,
        promptContent: prompt.trim() || `Use the ${selectedSkill} skill.`,
        workingDirectory,
    },
    images: images.length > 0 ? images : undefined,   // ← add this
};
```
(`validateAndParseTask` already promotes top-level `images` into `payload.images`)

### 4. Forward images in backend legacy enqueue path

**File:** `queue-handler.ts` lines 428-452

In the `!hasTaskEnvelope` branch, include images from the request body in the constructed `taskSpec`:
```ts
const taskSpec = hasTaskEnvelope
    ? body
    : {
        type: 'chat',
        // ... existing fields ...
        // Add images promotion:
        ...(Array.isArray(body?.images) && body.images.length > 0
            ? { images: body.images }
            : {}),
    };
```
`validateAndParseTask` (line 165-168) already handles filtering and promoting `images` into `payload.images`.

### 5. Add `images` to `handleSubmit` dependency array

Update the `useCallback` deps for `handleSubmit` to include `images`:
```ts
}, [prompt, model, workspaceId, folderPath, selectedSkill, images, appState.workspaces, queueDispatch]);
```

### 6. Tests

- Add a test for `EnqueueDialog` verifying that pasting an image adds a preview thumbnail
- Add a test verifying the freeform submit path includes `images` in the request body
- Add a test for the backend enqueue handler verifying images are forwarded through `validateAndParseTask`
- Existing `useImagePaste` and `ImagePreviews` tests already cover the reusable components

## Notes

- Max 5 images (default from `useImagePaste` hook) — consistent with GenerateTaskDialog
- Images are base64 data URLs sent inline as JSON — no multipart upload needed
- Backend `validateAndParseTask` already caps at string-type filtering (line 167) — no additional server-side validation needed
- The `ImagePreviews` component includes built-in lightbox (click-to-zoom) for free
