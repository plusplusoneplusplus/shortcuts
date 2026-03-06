# Render Image for `view` Tool Calls on Image Files

## Problem

When the Copilot SDK's built-in `view` tool is called on an image file (e.g., `.png`, `.jpg`), the tool result string is `"Viewed image file successfully."` instead of a base64 data URL. The CoC dashboard's `ToolCallView` component already has full image rendering support (`ViewToolView` checks `isImageDataUrl(result)` and renders an `<img>` tag), but this check fails because the result is a plain text string, not a data URL.

**Current flow:**
```
SDK view tool on image → result = "Viewed image file successfully."
→ isImageDataUrl("Viewed image file successfully.") → false
→ renders as text in a <pre> block
```

**Desired flow:**
```
SDK view tool on image → result = "Viewed image file successfully."
→ intercept: detect view tool + image extension in args.path
→ read file from disk, convert to base64 data URL
→ isImageDataUrl("data:image/png;base64,...") → true
→ renders as <img> tag
```

## Approach

Intercept in `copilot-sdk-service.ts` at the `tool.execution_complete` handler (line ~1559) where both the tool name and the file path (from the captured `ToolCall.args`) are available. When the `view` tool completes successfully on an image file, read the file from disk and replace the result string with a `data:image/<ext>;base64,...` data URL.

### Why this layer (not the bridge or frontend)?

- **copilot-sdk-service.ts**: Has access to the file system (Node.js), knows both tool name + args + result. The replacement flows naturally to both `capturedTool.result` and the `onToolEvent` emission — zero duplication.
- **queue-executor-bridge.ts**: Would work but only applies to CoC server context, not to any other consumer of `CopilotSDKService`.
- **Frontend (ToolCallView.tsx)**: Cannot read files from disk; would need a new API endpoint to serve images.

## Tasks

### 1. Add image file detection + base64 conversion utility
**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts` (or a new small utility alongside it)

- Create a helper: `tryConvertImageFileToDataUrl(filePath: string): string | null`
  - Check file extension against known image types: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`
  - Check file exists and is readable (`fs.existsSync` + `fs.readFileSync`)
  - Read file, encode as base64, return `data:image/<mime>;base64,<data>`
  - Return `null` on any error (file not found, too large, not an image, etc.)
  - Add a size guard (e.g., skip files > 10 MB) to prevent memory issues

### 2. Intercept `view` tool completion for image files
**File:** `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts`

In the `tool.execution_complete` handler (~line 1559), after setting `capturedTool.result`:
```ts
if (toolSuccess && tracked?.toolName === 'view') {
    const filePath = capturedTool?.args?.path as string;
    if (filePath) {
        const dataUrl = tryConvertImageFileToDataUrl(filePath);
        if (dataUrl) {
            capturedTool.result = dataUrl;
            // Also need to update the event.data.result.content reference
            // used in the onToolEvent emission below
        }
    }
}
```

Also update the `onToolEvent` emission (line ~1585) to use the replaced result.

### 3. Add tests
**File:** `packages/pipeline-core/test/copilot-sdk-wrapper/` (new test file or extend existing)

- Test `tryConvertImageFileToDataUrl` with:
  - Valid PNG file → returns `data:image/png;base64,...`
  - Valid JPEG file → returns `data:image/jpeg;base64,...`
  - Non-image file (`.txt`) → returns `null`
  - Non-existent file → returns `null`
  - File too large → returns `null`

**File:** `packages/coc/test/spa/react/ToolCallView-images.test.tsx` (extend)

- Test that `ViewToolView` with a proper data URL renders the image (already exists)
- Test that the view tool with a converted data URL displays correctly in the full flow

### 4. Verify end-to-end in dashboard
- Build the project (`npm run build`)
- Run `coc serve` and trigger a `view` tool call on an image file
- Verify the image renders inline in the chat UI instead of "Viewed image file successfully."

## Files to Modify

| File | Change |
|------|--------|
| `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts` | Add image detection + base64 conversion at tool completion |
| `packages/pipeline-core/test/copilot-sdk-wrapper/` | Unit tests for the conversion utility |
| `packages/coc/test/spa/react/ToolCallView-images.test.tsx` | Extend with view-tool-specific image tests (if needed) |

## Risks & Considerations

- **File size**: Large images (e.g., screenshots) could bloat the process store JSON. Mitigate with a 10 MB size cap.
- **Security**: Only convert files with known image extensions; don't blindly read arbitrary files.
- **Performance**: `fs.readFileSync` is synchronous but runs inside an already-async event handler; the blocking time for typical images (< 1 MB) is negligible.
- **SVG**: SVGs are text-based and could contain scripts. Consider whether to include SVG or exclude it from auto-conversion.
- **Path resolution**: The file path from `args.path` may be relative. Need to handle both absolute and workspace-relative paths.
