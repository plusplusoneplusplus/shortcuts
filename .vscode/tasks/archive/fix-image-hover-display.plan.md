# Fix Image View Tool Hover Display Issue

## Problem

When hovering over a `view` tool call that returned an image (base64 data URL), the `ToolResultPopover` renders the raw base64 string as text instead of displaying the actual image. The inline expanded view (`ViewToolView`) already handles this correctly by checking `isImageDataUrl()` and rendering an `<img>` tag, but the hover popover lacks this logic.

**Screenshot evidence:** Hovering shows `FILE PREVIEW` with raw `data:image/png;base64,iVBOR…` text and line-range badges (`L1-L60`) that are meaningless for binary image data.

## Root Cause

`ToolResultPopover.tsx` (`renderBody()`) has three branches:
1. Markdown → rendered markdown
2. View + line numbers → code gutter
3. Default → raw `<pre><code>` text

There is **no branch for image data URLs**. Since base64 text doesn't match the `^\d+\.\s` line-number pattern, it falls through to the raw-text default — dumping the entire base64 string.

## Proposed Fix

### File: `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx`

1. **Add `isImageDataUrl` check** at the top of `renderBody()`, before the markdown/code branches.
2. **Render an `<img>` tag** with the data URL as `src`, matching the style already used in `ViewToolView` (line 272-276 of `ToolCallView.tsx`).

```tsx
// Inside renderBody(), add as the first check:
if (isImageDataUrl(result)) {
    return (
        <img
            src={result}
            alt={filePath ? shortenPath(filePath) : 'Image preview'}
            className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
            data-testid="popover-image"
        />
    );
}
```

3. **Import or inline** the `isImageDataUrl` helper (currently defined in `ToolCallView.tsx`). Options:
   - **(A) Extract to shared utility** — move `isImageDataUrl` to a shared module and import in both files. Cleanest approach.
   - **(B) Inline duplicate** — duplicate the one-liner regex in `ToolResultPopover.tsx`. Simpler but duplicates logic.
   - Recommendation: **(A)** if there's already a shared utils file; **(B)** if keeping the change minimal.

4. Similarly import or inline `shortenPath` for the alt text, or just use a static alt string.

### File: `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` (optional)

If extracting to shared utils: remove the local `isImageDataUrl` and import from the shared module.

## Todos

- [x] `add-image-check-popover` — Add image data URL detection and `<img>` rendering in `ToolResultPopover.renderBody()`
- [x] `share-or-inline-helper` — Either extract `isImageDataUrl` to shared utils or inline it in the popover
- [x] `add-tests` — Add test coverage for image rendering in `ToolResultPopover`
- [x] `verify-build` — Build and verify no regressions

## Notes

- The `ViewToolView` component (expanded inline view) already renders images correctly — this is hover-only.
- The `max-h-64` (256px) constraint matches existing image sizing in the expanded view.
- No changes needed to the backend or image pipeline; the data URL is already present in the result string.
