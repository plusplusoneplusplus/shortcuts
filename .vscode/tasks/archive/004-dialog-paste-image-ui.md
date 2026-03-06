---
status: pending
---

# 004: Add Paste Image UI to Task Dialog

## Summary

Add clipboard image paste support to the AI Task creation dialog's textarea fields, with thumbnail previews and remove buttons, and add `images` field to task creation types so images flow from dialog to handler.

## Motivation

This is the user-facing piece of the paste-image feature. It is purely a webview UI change plus a type addition — it does not depend on the SDK/invoker commits (1-3). Keeping it separate makes the UI changes easy to review independently.

## Changes

### Files to Create
- (none)

### Files to Modify
- `src/shortcuts/tasks-viewer/ai-task-dialog.ts` — Add paste event handler, image preview container, CSS, and include images in postMessage payload; update CSP to allow `img-src data:`
- `src/shortcuts/tasks-viewer/types.ts` — Add `images?: string[]` field to `AITaskCreateOptions` and `AITaskFromFeatureOptions`

### Files to Delete
- (none)

## Implementation Notes

### 1. Type Changes in `types.ts`

Add `images` field to both option interfaces (lines ~181-206):

```typescript
// In AITaskCreateOptions (after `model: string;`):
/** Optional base64 data URL images pasted by user */
images?: string[];

// In AITaskFromFeatureOptions (after `model: string;`):
/** Optional base64 data URL images pasted by user */
images?: string[];
```

No changes needed to `AITaskCreationOptions` or `AITaskDialogResult` — they wrap the above.

### 2. CSP Update in `ai-task-dialog.ts`

The current CSP (line 273) is:
```
default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';
```

Add `img-src data:` to allow rendering base64 `<img>` tags:
```
default-src 'none'; img-src data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';
```

### 3. CSS Additions in `ai-task-dialog.ts`

Add these styles **inside** the `<style nonce="${nonce}">` block, after the existing `.no-features-message` rule (before `</style>`). These go inside `getWebviewContent()`:

```css
/* Image paste preview */
.image-preview-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}

.image-preview-container:empty {
    display: none;
}

.image-preview-item {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 4px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    overflow: hidden;
    background: var(--vscode-input-background, #3c3c3c);
}

.image-preview-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.image-preview-item .remove-image-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
}

.image-preview-item:hover .remove-image-btn {
    opacity: 1;
}

.paste-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #a0a0a0);
    margin-top: 4px;
}
```

### 4. HTML Changes in the Dialog Body

#### Create Mode (after the `taskDescription` textarea, around line 388)

After the existing hint `<div class="hint">AI will expand this into a comprehensive task document</div>`, add:

```html
<div class="paste-hint">💡 Paste images from clipboard (Ctrl+V)</div>
<div class="image-preview-container" id="createImagePreviews"></div>
```

#### From Feature Mode (after the `taskFocus` textarea, around line 426)

After the existing hint `<div class="hint">What specific aspect should this task focus on?...</div>`, add:

```html
<div class="paste-hint">💡 Paste images from clipboard (Ctrl+V)</div>
<div class="image-preview-container" id="featureImagePreviews"></div>
```

### 5. JavaScript Paste Handler (in the `<script>` block)

Add image tracking state and paste handler functions after the existing DOM element declarations (after line ~515, before "Populate location dropdown"). This is inside the IIFE in `getWebviewContent()`.

#### State Variables

```javascript
// Image storage per mode
const createImages = [];     // base64 data URLs for create mode
const featureImages = [];    // base64 data URLs for from-feature mode

// Preview containers
const createImagePreviews = document.getElementById('createImagePreviews');
const featureImagePreviews = document.getElementById('featureImagePreviews');
```

#### Paste Handler Function

```javascript
// Handle image paste on textareas
function handleImagePaste(e, imageArray, previewContainer) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;

            const reader = new FileReader();
            reader.onload = function(event) {
                const dataUrl = event.target.result;
                imageArray.push(dataUrl);
                renderImagePreviews(imageArray, previewContainer);
            };
            reader.readAsDataURL(file);
        }
    }
}
```

#### Preview Renderer

```javascript
function renderImagePreviews(imageArray, container) {
    container.innerHTML = '';
    imageArray.forEach((dataUrl, index) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';

        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Pasted image ' + (index + 1);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-image-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove image';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            imageArray.splice(index, 1);
            renderImagePreviews(imageArray, container);
        });

        item.appendChild(img);
        item.appendChild(removeBtn);
        container.appendChild(item);
    });
}
```

#### Attach Event Listeners

Add after the existing input event listeners (around line 655, near `taskNameInput.addEventListener('input', updateValidation)`):

```javascript
// Paste image handling for create mode
taskDescriptionInput.addEventListener('paste', (e) => {
    handleImagePaste(e, createImages, createImagePreviews);
});

// Paste image handling for from-feature mode
if (taskFocusInput) {
    taskFocusInput.addEventListener('paste', (e) => {
        handleImagePaste(e, featureImages, featureImagePreviews);
    });
}
```

**Important note on `e.preventDefault()`:** The paste handler only calls `preventDefault()` when an image item is found. If the clipboard contains only text (no image items), the loop won't match any `image/*` type and the default paste behavior (inserting text) proceeds normally. This ensures text-only paste is unaffected.

### 6. postMessage Payload Changes

#### Create mode submit (line ~666-673)

Add `images` to the postMessage for create mode:

```javascript
vscode.postMessage({
    type: 'submit',
    mode: 'create',
    name: taskNameInput.value.trim(),
    location: taskLocationSelect.value,
    description: taskDescriptionInput.value.trim(),
    model: aiModelCreateSelect.value,
    images: createImages.length > 0 ? createImages : undefined
});
```

#### From-feature mode submit (line ~687-695)

Add `images` to the postMessage for from-feature mode:

```javascript
vscode.postMessage({
    type: 'submit',
    mode: 'from-feature',
    name: featureTaskNameInput ? featureTaskNameInput.value.trim() : '',
    location: featureLocationSelect ? featureLocationSelect.value : '',
    focus: taskFocusInput ? taskFocusInput.value.trim() : '',
    depth: depthValue,
    model: aiModelFeatureSelect ? aiModelFeatureSelect.value : defaultModel,
    images: featureImages.length > 0 ? featureImages : undefined
});
```

### 7. handleMessage Update (Extension-side TypeScript)

In `handleMessage()` (line ~130-177), thread the `images` field from the message into the option objects:

```typescript
// In the 'create' branch (line ~139-144):
result.createOptions = {
    name: message.name,
    location: message.location,
    description: message.description,
    model: message.model,
    images: message.images   // <-- ADD
};

// In the 'from-feature' branch (line ~146-152):
result.fromFeatureOptions = {
    name: message.name,
    location: message.location,
    focus: message.focus,
    depth: message.depth,
    model: message.model,
    images: message.images   // <-- ADD
};
```

## Tests

- **Compilation test**: The type changes to `AITaskCreateOptions` and `AITaskFromFeatureOptions` must compile cleanly. Run `npm run compile` to verify no type errors.
- **Existing tests**: Run `npm run test` to ensure no regressions. The `images` field is optional so existing code that creates these types without `images` remains valid.
- **Manual test**: Open the dialog → paste an image from clipboard into the Description/Focus textarea → verify thumbnail appears → paste another → verify two thumbnails → click remove on one → verify removal → submit → confirm `images` array is in the message payload (observable via debug logging or breakpoint).

## Acceptance Criteria

- [ ] `AITaskCreateOptions` has `images?: string[]` field
- [ ] `AITaskFromFeatureOptions` has `images?: string[]` field
- [ ] CSP includes `img-src data:` so `<img src="data:...">` renders in the webview
- [ ] Pasting an image into the Description textarea (create mode) shows an 80×80 thumbnail below
- [ ] Pasting an image into the Task Focus textarea (from-feature mode) shows an 80×80 thumbnail below
- [ ] Multiple images can be pasted and each appends a new thumbnail
- [ ] Each thumbnail has a remove button (×) visible on hover
- [ ] Clicking the remove button removes that specific image from the array and re-renders
- [ ] Images are sent as base64 data URLs in the `submit` postMessage (`images` field)
- [ ] If no images are pasted, `images` field is `undefined` (not empty array) — backward compatible
- [ ] `handleMessage()` threads `message.images` into `createOptions.images` / `fromFeatureOptions.images`
- [ ] Text-only paste into the textarea still works normally (not intercepted)
- [ ] Dialog still works when no images are pasted (text-only prompts)
- [ ] `npm run compile` succeeds with no type errors
- [ ] `npm run test` passes with no regressions

## Dependencies

- Depends on: None (independent of commits 1-3)

## Assumed Prior State

None — this commit only touches the webview UI and task types, independent of SDK/invoker changes. The `images` field is added to the types here but is not consumed by any handler yet (that will be commit 5).
