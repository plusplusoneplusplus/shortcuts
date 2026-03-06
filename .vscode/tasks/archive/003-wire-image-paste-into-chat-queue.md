---
status: pending
commit: "003"
title: "Frontend: wire image paste into chat and queue UIs"
depends_on:
  - "001"  # Backend accepts images in POST /queue and POST /processes/:id/message
  - "002"  # useImagePaste hook and ImagePreviews component exist
---

# 003 — Wire image paste into chat and queue UIs

## Objective

Integrate the `useImagePaste` hook and `ImagePreviews` component (from commit 002)
into the two React views that send messages — `RepoChatTab` and `QueueTaskDetail` —
and include the `images` array in every POST request body so the backend (commit 001)
receives them. Also assess the vanilla-JS `detail.ts` and decide whether to update or
skip it.

---

## Files to modify

| # | File | Role |
|---|------|------|
| 1 | `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Chat tab — two textareas, two send paths |
| 2 | `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Queue detail — follow-up textarea + send |
| 3 | `packages/coc/src/server/spa/client/detail.ts` | Legacy vanilla-JS detail view (assess only) |

---

## Detailed changes

### 1. `RepoChatTab.tsx`

#### 1a. Imports (line 9 area)

Add two imports after the existing React/shared imports:

```ts
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
```

> The exact path depends on where commit 002 placed these files — most likely
> under `react/hooks/` and `react/shared/` respectively. Verify and adjust.

#### 1b. Hook instantiation — initial-chat context

Inside `RepoChatTab` component body (after line 57, near the other `useState` calls),
add a hook call for the **initial chat** textarea:

```ts
const initialImagePaste = useImagePaste();
```

And a second instance for the **follow-up** textarea:

```ts
const followUpImagePaste = useImagePaste();
```

> Two instances are needed because the initial-chat UI (`!chatTaskId` branch, line 277)
> and the follow-up UI (`chatTaskId` truthy branch, line 297) are independent render
> paths with different send handlers.

#### 1c. Initial-chat textarea (line 281–288)

Add `onPaste` to the `<textarea>`:

```diff
 <textarea
     className="w-full max-w-md border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
     rows={3}
     placeholder="Ask anything about this repository…"
     value={inputValue}
     onChange={e => setInputValue(e.target.value)}
     onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleStartChat(); } }}
+    onPaste={initialImagePaste.addFromPaste}
 />
```

#### 1d. Initial-chat image previews (between textarea and error/button, ~line 289)

Insert `<ImagePreviews>` after the textarea, before the error div:

```tsx
<ImagePreviews images={initialImagePaste.images} onRemove={initialImagePaste.removeImage} />
```

So the render order becomes: textarea → ImagePreviews → error → Button.

#### 1e. `handleStartChat` — include images in POST body (lines 180–220)

In the `body: JSON.stringify({...})` call at line 190–196, add the `images` field:

```diff
 body: JSON.stringify({
     type: 'chat',
     workspaceId,
     workingDirectory: workspacePath,
     prompt,
     displayName: 'Chat',
+    images: initialImagePaste.images.length > 0
+        ? initialImagePaste.images.map(img => img.dataUrl)
+        : undefined,
 }),
```

After the successful send (after line 215, inside the `try` block, after
`setTurnsAndCache`), clear the images:

```ts
initialImagePaste.clearImages();
```

#### 1f. Follow-up textarea (line 317–325)

Add `onPaste` to the follow-up `<textarea>`:

```diff
 <textarea
     rows={1}
     value={inputValue}
     disabled={sending || sessionExpired}
     placeholder={sessionExpired ? 'Session expired. Start a new chat.' : 'Follow up…'}
     onChange={e => setInputValue(e.target.value)}
     onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); } }}
     className="flex-1 border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
+    onPaste={followUpImagePaste.addFromPaste}
 />
```

#### 1g. Follow-up image previews (between textarea and Send button, ~line 326)

Insert `<ImagePreviews>` after the textarea inside the `div.flex.items-end.gap-2`
wrapper. Since the current layout is `<div flex> <textarea/> <Button/> </div>`, place
the previews **above** this flex row (inside the `div.space-y-2` at line 314) or wrap
the textarea + previews:

Preferred approach — insert between the textarea and the send button row. Change the
input area structure to:

```tsx
<div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
    {error && <div className="text-xs text-red-500">{error}</div>}
    <ImagePreviews images={followUpImagePaste.images} onRemove={followUpImagePaste.removeImage} />
    <div className="flex items-end gap-2">
        <textarea ... onPaste={followUpImagePaste.addFromPaste} />
        <Button ...>Send</Button>
    </div>
</div>
```

This renders previews above the input row. Only renders if there are images (the
component itself should handle the empty case gracefully).

#### 1h. `sendFollowUp` — include images in POST body (lines 223–261)

At line 241, in the `body: JSON.stringify({ content })` call, add images:

```diff
-body: JSON.stringify({ content }),
+body: JSON.stringify({
+    content,
+    images: followUpImagePaste.images.length > 0
+        ? followUpImagePaste.images.map(img => img.dataUrl)
+        : undefined,
+}),
```

After the successful `await waitForFollowUpCompletion(processId)` at line 255,
clear images:

```ts
followUpImagePaste.clearImages();
```

Place this **before** the `finally` block so it only runs on success (not on error
paths which `return` early).

---

### 2. `QueueTaskDetail.tsx`

#### 2a. Imports (line 7 area)

Add after existing imports:

```ts
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
```

#### 2b. Hook instantiation

Inside the `QueueTaskDetail` component function body (near the other state/ref
declarations), add:

```ts
const { images, addFromPaste, removeImage, clearImages } = useImagePaste();
```

Only one instance is needed — there is a single follow-up textarea in this component.

#### 2c. Follow-up textarea (line 609–622)

Add `onPaste` to the existing `<textarea>`:

```diff
 <textarea
     id="chat-input"
     rows={1}
     value={followUpInput}
     disabled={followUpInputDisabled}
     placeholder={followUpPlaceholder}
     className="flex-1 min-h-[34px] max-h-28 resize-y rounded border ..."
     onChange={(event) => setFollowUpInput(event.target.value)}
     onKeyDown={(event) => {
         if (event.key === 'Enter' && !event.shiftKey) {
             event.preventDefault();
             void sendFollowUp();
         }
     }}
+    onPaste={addFromPaste}
 />
```

#### 2d. Image previews (between textarea row and error area, ~line 608)

Insert `<ImagePreviews>` inside the chat input section, immediately before the
`<div className="flex items-end gap-2">` at line 608:

```tsx
<ImagePreviews images={images} onRemove={removeImage} />
<div className="flex items-end gap-2">
    <textarea ... />
    <button ...>Send</button>
</div>
```

#### 2e. `sendFollowUp` — include images in POST body (line 210–214)

```diff
 const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(selectedProcessId)}/message`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
-    body: JSON.stringify({ content }),
+    body: JSON.stringify({
+        content,
+        images: images.length > 0
+            ? images.map(img => img.dataUrl)
+            : undefined,
+    }),
 });
```

#### 2f. Clear images on success

After the successful `await waitForFollowUpCompletion(selectedProcessId)` at line 231,
add:

```ts
clearImages();
```

This must go **before** the `finally` block (line 235) so images are only cleared
on success, not on early-return error paths (lines 218–228).

#### 2g. Reset images when switching tasks (line 322 area)

There is an existing effect that resets follow-up state when the selected task
changes. Add `clearImages()` inside that effect so stale image previews from a
previous task don't carry over:

Find the effect that resets follow-up state (around line 322, identified by the
comment "Reset follow-up state when switching tasks") and add `clearImages();`.

---

### 3. `detail.ts` (legacy vanilla JS)

#### Assessment

- `detail.ts` is a **legacy** vanilla-JS detail view (1710+ lines).
- It exposes `sendFollowUpMessage` on `window` (line 1710).
- The React `QueueTaskDetail` component is the primary UI now.
- `detail.ts` may still render for non-React routes or as a fallback.

#### Decision: Skip full implementation, add TODO

The vanilla-JS code does not use React hooks or components. Adding image paste
support here would require significant DOM manipulation for:
- A paste event listener on the textarea
- Dynamic thumbnail rendering
- Tracking image state outside React
- Passing images through the fetch call

This is disproportionate effort for a legacy codepath. Instead:

1. In `sendFollowUpMessage` (line 1059), add a `// TODO: support images field` comment.
2. If the legacy path is still actively loaded alongside React views, confirm via
   runtime testing that users see the React version for chat interactions.

```diff
-function sendFollowUpMessage(processId: string, content: string): void {
+// TODO(chat-image-attach): Add image paste support here if this legacy path is
+// still actively used. React QueueTaskDetail already supports images.
+function sendFollowUpMessage(processId: string, content: string): void {
```

---

## Data shape reference

The `useImagePaste` hook (commit 002) is expected to return:

```ts
interface ImagePasteState {
    images: PastedImage[];        // Array of { id: string; dataUrl: string; mimeType: string }
    addFromPaste: (e: React.ClipboardEvent) => void;
    removeImage: (id: string) => void;
    clearImages: () => void;
}
```

The POST bodies send `images` as:

```ts
images?: string[]   // Array of data-URL strings, e.g. "data:image/png;base64,..."
```

> If the hook stores a different shape (e.g., `{ dataUrl, name, size }`), adjust
> the `.map(img => img.dataUrl)` calls accordingly to extract the raw data URL string.

---

## Tests

### New / updated test files

| File | What to test |
|------|-------------|
| `RepoChatTab.test.tsx` (new or extend existing) | See below |
| `QueueTaskDetail.test.tsx` (new or extend existing) | See below |

### RepoChatTab tests

1. **Image paste shows preview** — simulate a `paste` event with a `DataTransfer`
   containing an image `File` on the initial-chat textarea. Assert that an
   `<ImagePreviews>` element with a thumbnail appears in the DOM.

2. **handleStartChat includes images** — paste an image, type a message, click
   "Start Chat". Mock `fetch` and assert the POST body to `/queue` contains
   `images: ["data:image/png;base64,..."]`.

3. **clearImages on successful start** — after a successful `handleStartChat`,
   assert that `<ImagePreviews>` shows zero images.

4. **Follow-up paste shows preview** — with an active chat, paste an image in the
   follow-up textarea. Assert preview appears.

5. **sendFollowUp includes images** — paste an image, send a follow-up. Assert
   the POST body to `/processes/:id/message` contains `images`.

6. **clearImages on successful follow-up** — after successful follow-up send,
   assert images are cleared.

7. **No images field when none pasted** — send a text-only message. Assert the
   POST body does **not** contain an `images` key (or it is `undefined`).

### QueueTaskDetail tests

1. **Image paste shows preview** — paste an image on the follow-up textarea.
   Assert thumbnail preview renders.

2. **sendFollowUp includes images** — paste image, send. Assert POST body
   includes `images`.

3. **clearImages on success** — after send completes, images are cleared.

4. **Images cleared on task switch** — paste an image, switch to a different
   task. Assert the preview disappears.

5. **Text-only sends no images** — send without pasting. Assert no `images`
   in POST body.

### Test utilities needed

- A helper to create a synthetic `ClipboardEvent` with image data in `DataTransfer`.
- Mock `fetch` (or use `msw`) to capture POST bodies.
- Mock `FileReader.readAsDataURL` (or use a blob-to-dataurl polyfill for jsdom).

---

## Acceptance criteria

- [ ] Pasting an image in RepoChatTab initial textarea shows a thumbnail preview
- [ ] Pasting an image in RepoChatTab follow-up textarea shows a thumbnail preview
- [ ] Pasting an image in QueueTaskDetail follow-up textarea shows a thumbnail preview
- [ ] Clicking remove (×) on a thumbnail removes it from the preview list
- [ ] "Start Chat" POST to `/queue` includes `images: string[]` when images are pasted
- [ ] "Send" follow-up POST to `/processes/:id/message` includes `images` when images are pasted
- [ ] Images are cleared from state after a successful send
- [ ] Text-only flow is unchanged — no `images` field sent when no images are present
- [ ] Images are reset when switching tasks in QueueTaskDetail
- [ ] Legacy `detail.ts` has a TODO comment documenting the gap

---

## Edge cases to verify manually

1. **Multiple images** — paste multiple times before sending; all should appear
   as previews and all data URLs should be in the `images` array.
2. **Large images** — pasting a very large screenshot; confirm it converts to
   base64 without crashing (may want to add a size guard in a future commit).
3. **Non-image paste** — pasting plain text should not trigger `addFromPaste`
   (the hook should check `clipboardData.files` / item types).
4. **Send failure** — if the POST fails, images should **not** be cleared so
   the user can retry without re-pasting.
5. **Session expiry (410)** — images should not be cleared on 410 responses.
