---
status: pending
commit: "002"
title: "Frontend: shared image paste hook and preview component"
depends_on: ["001"]
files_to_create:
  - packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts
  - packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx
  - packages/coc/test/spa/react/useImagePaste.test.ts
  - packages/coc/test/spa/react/ImagePreviews.test.tsx
files_to_modify:
  - packages/coc/src/server/spa/client/react/shared/index.ts
---

# 002 — Frontend: shared image paste hook and preview component

## Objective

Create a reusable React hook `useImagePaste` and an `ImagePreviews` component for the CoC SPA dashboard. These allow any textarea to capture pasted images as base64 data URLs and display thumbnail previews with remove buttons. Both `RepoChatTab` and `QueueTaskDetail` will consume these in later commits.

## Motivation

The VS Code extension already has vanilla JS paste handling in `src/shortcuts/tasks-viewer/ai-task-dialog.ts` (`handleImagePaste` + `renderImagePreviews`). Converting this to a React hook + component:
- Avoids duplication between `RepoChatTab.tsx` and `QueueTaskDetail.tsx`
- Makes it trivial to add image paste to any future textarea
- Follows the existing SPA pattern of shared hooks + shared components

## Reference implementation

### Vanilla JS source (ai-task-dialog.ts lines 590–636)

```js
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
        removeBtn.textContent = '\u00d7';
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

### Vanilla JS CSS reference (ai-task-dialog.ts lines 340–395)

- Thumbnail: 80×80px, border-radius 4px, object-fit cover
- Remove button: 20×20px circle, positioned absolute top-right, shows on hover
- Container: flex wrap, 8px gap
- Paste hint: 11px font, muted color

## Existing patterns to follow

### Hooks (packages/coc/src/server/spa/client/react/hooks/)

- **No barrel index.ts** — hooks are imported directly by path
- Named export: `export function useXxx(...) { ... }`
- Types exported alongside: `export interface UseXxxResult { ... }`
- Import React hooks from `'react'`
- See `useRecentPrompts.ts` for a representative pattern

### Shared components (packages/coc/src/server/spa/client/react/shared/)

- **Barrel index.ts exists** — re-exports components and types
- Pattern: `export { ComponentName } from './ComponentName';` + `export type { ComponentNameProps } from './ComponentName';`
- Components use `cn()` utility from `./cn` for conditional class composition
- Tailwind CSS with explicit VS Code-style color tokens (e.g., `bg-[#0078d4]`, `dark:bg-[#1f1f1f]`, `border-[#3c3c3c]`)
- Props interface exported alongside: `export interface XxxProps { ... }`
- Small, focused components (Button, Badge, Spinner, Card, Dialog)

### Tests (packages/coc/test/spa/react/)

- Framework: **vitest** (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`)
- React rendering: `@testing-library/react` (`render`, `screen`, `fireEvent`, `waitFor`, `act`, `renderHook`)
- Mocking: `vi.fn()`, `vi.spyOn()`, `vi.restoreAllMocks()` in `afterEach`
- Hooks tested via `renderHook(() => useXxx(...))`
- DOM cleanup in `afterEach`

---

## Detailed implementation

### File 1: `packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts`

#### Exported interface

```typescript
export interface UseImagePasteResult {
    /** Current list of base64 data URL strings */
    images: string[];
    /** Paste event handler — attach to textarea's onPaste */
    addFromPaste: (e: React.ClipboardEvent) => void;
    /** Remove an image by index */
    removeImage: (index: number) => void;
    /** Clear all images */
    clearImages: () => void;
}
```

#### Hook signature

```typescript
export function useImagePaste(maxImages?: number): UseImagePasteResult
```

Default `maxImages` = **5**.

#### Implementation details

1. **State**: `const [images, setImages] = useState<string[]>([]);`

2. **`addFromPaste` handler** (wrap in `useCallback` with `[images, maxImages]` deps):
   - Access `e.clipboardData.items` (the React `ClipboardEvent` wraps the native one)
   - Iterate items, check `item.type.startsWith('image/')`
   - If any image item found: `e.preventDefault()` (prevent default paste of image as text)
   - Call `item.getAsFile()` — skip if null
   - Use `FileReader.readAsDataURL(file)`
   - On `reader.onload`: append `event.target!.result as string` to images via `setImages(prev => ...)`
   - **Enforce maxImages**: in the `setImages` updater, cap the array at `maxImages`. If current length is already at max, ignore new paste. Use a counter across all items in a single paste to avoid exceeding the limit.

3. **`removeImage`** (wrap in `useCallback`):
   - `setImages(prev => prev.filter((_, i) => i !== index))`

4. **`clearImages`** (wrap in `useCallback`):
   - `setImages([])`

#### Important edge cases

- A single paste event can contain multiple images (e.g., from apps that put multiple items on clipboard). Each should be processed individually up to the `maxImages` ceiling.
- `readAsDataURL` is async — multiple readers fire `onload` independently. The `setImages` must use the functional updater (`prev => [...]`) to avoid stale closures.
- `e.preventDefault()` should only be called if at least one image item is found, so text paste still works normally.
- The `maxImages` check must be inside the `setImages` updater (not outside) to handle the race condition of multiple `onload` callbacks from a single paste.

### File 2: `packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx`

#### Props interface

```typescript
export interface ImagePreviewsProps {
    /** Base64 data URL strings to show as thumbnails */
    images: string[];
    /** Called with the index of the image to remove */
    onRemove: (index: number) => void;
    /** If true, show a paste hint when there are no images */
    showHint?: boolean;
    /** Optional additional className on the outer container */
    className?: string;
    /** data-testid for testing */
    'data-testid'?: string;
}
```

#### Component

```typescript
export function ImagePreviews({ images, onRemove, showHint, className, ...props }: ImagePreviewsProps)
```

#### Render structure

```
<div className="flex flex-wrap gap-2 mt-2 {className}" data-testid={...}>
  {images.map((dataUrl, index) => (
    <div key={index} className="relative w-12 h-12 rounded overflow-hidden border ..."
         data-testid="image-preview-item">
      <img src={dataUrl} alt={`Pasted image ${index + 1}`}
           className="w-full h-full object-cover" />
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        title="Remove image"
        data-testid={`remove-image-${index}`}
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white ..."
      >
        ×
      </button>
    </div>
  ))}
  {images.length === 0 && showHint && (
    <span className="text-[11px] text-[#a0a0a0] dark:text-[#666]">
      💡 Paste images (Ctrl+V)
    </span>
  )}
</div>
```

#### Tailwind class breakdown

| Element | Classes | Notes |
|---------|---------|-------|
| Container | `flex flex-wrap gap-2 mt-2` | Matches 8px gap from reference |
| Thumbnail wrapper | `relative w-12 h-12 rounded overflow-hidden border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d]` | 48×48px (w-12/h-12), rounded corners, themed border |
| Image | `w-full h-full object-cover` | Fill container, crop to fit |
| Remove button | `absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none` | Hidden until parent hover. Add `group` class to thumbnail wrapper. |
| Hint text | `text-[11px] text-[#a0a0a0] dark:text-[#666]` | Matches reference paste-hint style |

**Size decision**: Use 48×48 (Tailwind `w-12 h-12`) rather than the 80×80 from the VS Code extension reference. The SPA chat textareas are narrower than the VS Code webview dialog, so smaller thumbnails fit better. This also matches the `48x48px` mentioned in the spec.

**Hover reveal**: Use Tailwind `group`/`group-hover:opacity-100` pattern. The thumbnail wrapper div gets `group` class, and the remove button uses `opacity-0 group-hover:opacity-100`.

#### No render when empty (no images and no hint)

If `images.length === 0 && !showHint`, return `null` to avoid rendering an empty container.

### File 3: `packages/coc/src/server/spa/client/react/shared/index.ts` (modify)

Add two lines at the end (before the trailing newline):

```typescript
export { ImagePreviews } from './ImagePreviews';
export type { ImagePreviewsProps } from './ImagePreviews';
```

This follows the exact barrel pattern used for Button, Card, Badge, etc.

**Note**: No barrel file exists for hooks — hooks are imported directly by path (e.g., `import { useImagePaste } from '../hooks/useImagePaste'`). Do NOT create a hooks barrel.

---

## Tests

### File 4: `packages/coc/test/spa/react/useImagePaste.test.ts`

Framework: vitest + @testing-library/react (`renderHook`, `act`)

#### Test cases

1. **`returns empty images array initially`**
   - `renderHook(() => useImagePaste())`
   - Assert `result.current.images` is `[]`

2. **`addFromPaste extracts image from clipboard`**
   - Create a mock `ClipboardEvent` with a `clipboardData.items` containing one `image/png` item
   - Mock `item.getAsFile()` to return a `File` (or mock Blob)
   - Mock `FileReader` globally: override `FileReader.prototype.readAsDataURL` to synchronously call `onload` with a fake data URL
   - Call `act(() => result.current.addFromPaste(mockEvent))`
   - Assert `result.current.images` has length 1 and contains the fake data URL

3. **`addFromPaste ignores non-image items`**
   - Clipboard with `text/plain` item only
   - Assert `e.preventDefault` was NOT called
   - Assert `images` remains `[]`

4. **`addFromPaste respects maxImages limit`**
   - `renderHook(() => useImagePaste(2))`
   - Paste 3 images sequentially
   - Assert `images.length` never exceeds 2

5. **`removeImage removes by index`**
   - Start with 3 images (paste them in)
   - Call `act(() => result.current.removeImage(1))`
   - Assert images array has 2 items, and the one at index 1 was removed

6. **`clearImages removes all images`**
   - Start with 2 images
   - Call `act(() => result.current.clearImages())`
   - Assert `images` is `[]`

7. **`default maxImages is 5`**
   - Paste 6 images into hook with no maxImages arg
   - Assert only 5 are kept

#### Mocking strategy for FileReader

```typescript
let readerOnload: ((e: any) => void) | null = null;

beforeEach(() => {
    vi.spyOn(globalThis, 'FileReader').mockImplementation(() => {
        const reader = {
            readAsDataURL: vi.fn(function(this: any) {
                // Synchronously invoke onload for test determinism
                if (this.onload) {
                    this.onload({ target: { result: 'data:image/png;base64,fakedata' } });
                }
            }),
            onload: null as any,
        };
        return reader as any;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});
```

#### Mocking strategy for ClipboardEvent

```typescript
function createMockPasteEvent(items: Array<{ type: string; getAsFile: () => File | null }>): React.ClipboardEvent {
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            items: items.map(item => ({
                type: item.type,
                getAsFile: item.getAsFile,
            })),
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}
```

### File 5: `packages/coc/test/spa/react/ImagePreviews.test.tsx`

Framework: vitest + @testing-library/react (`render`, `screen`, `fireEvent`)

#### Test cases

1. **`renders nothing when images is empty and showHint is false`**
   - `render(<ImagePreviews images={[]} onRemove={vi.fn()} />)`
   - Assert container is empty (component returns null)

2. **`renders hint text when images is empty and showHint is true`**
   - `render(<ImagePreviews images={[]} onRemove={vi.fn()} showHint />)`
   - Assert `screen.getByText(/Paste images/)` is present

3. **`renders thumbnails for each image`**
   - `render(<ImagePreviews images={['data:image/png;base64,a', 'data:image/png;base64,b']} onRemove={vi.fn()} />)`
   - Assert 2 `img` elements rendered
   - Assert `alt` attributes are `"Pasted image 1"` and `"Pasted image 2"`
   - Assert `src` attributes match the data URLs

4. **`remove button calls onRemove with correct index`**
   - Render with 2 images
   - `fireEvent.click(screen.getByTestId('remove-image-0'))`
   - Assert `onRemove` was called with `0`

5. **`remove button click stops propagation`**
   - Wrap in a parent div with `onClick` handler
   - Click remove button
   - Assert parent onClick was NOT called

6. **`applies custom className`**
   - `render(<ImagePreviews images={['data:...']} onRemove={vi.fn()} className="my-extra" data-testid="previews" />)`
   - Assert the container has `my-extra` in its className

---

## Integration notes (for later commits)

After this commit, the consuming components (`RepoChatTab.tsx`, `QueueTaskDetail.tsx`) will integrate by:

```tsx
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared';

// Inside the component:
const { images, addFromPaste, removeImage, clearImages } = useImagePaste(5);

// On the textarea:
<textarea onPaste={addFromPaste} ... />

// Below the textarea:
<ImagePreviews images={images} onRemove={removeImage} showHint />

// On send: include images in the API payload, then clearImages()
```

This integration is NOT part of this commit — it belongs in commit 003.

## Acceptance criteria

- [ ] `useImagePaste` hook exported from `packages/coc/src/server/spa/client/react/hooks/useImagePaste.ts`
- [ ] `ImagePreviews` component exported from `packages/coc/src/server/spa/client/react/shared/ImagePreviews.tsx`
- [ ] `ImagePreviews` re-exported from `shared/index.ts` barrel
- [ ] Hook correctly handles paste events with `image/*` clipboard items
- [ ] Hook ignores non-image paste events (text paste still works)
- [ ] `maxImages` limit enforced (default 5)
- [ ] `removeImage(index)` correctly removes the specified image
- [ ] `clearImages()` resets to empty array
- [ ] Thumbnails render at 48×48px with object-fit cover
- [ ] Remove button appears on hover with × icon
- [ ] Components follow SPA dark/light theme patterns (`dark:` Tailwind prefixes)
- [ ] All vitest tests pass: `npm run test:run` in `packages/coc/`
- [ ] `npm run build` succeeds with no type errors
