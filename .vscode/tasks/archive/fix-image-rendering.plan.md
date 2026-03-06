# Fix Image Rendering in Chat ToolCallView

## Problem

When the AI agent uses the `view` tool on an image file in the CoC chat/dashboard, the image renders as a broken image icon instead of displaying inline. The screenshot shows:
- `📁 C:\USERS\...\IMAGE-0.PNG` (file path header, correctly rendered)
- A broken image icon with the file path as alt text (image NOT rendered)

## Root Cause

**File:** `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`

The tool result truncation logic at **lines 34-35 & 342-344** caps results at 5000 characters:

```typescript
const MAX_RESULT_LENGTH = 5000;
const TRUNCATED_RESULT_LENGTH = 4900;
// ...
const isResultTruncated = resultText.length > MAX_RESULT_LENGTH;
const visibleResult = isResultTruncated
    ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated)`
    : resultText;
```

The `visibleResult` is then passed to `ViewToolView` at **line 476**:

```tsx
<ViewToolView args={argsObj} result={visibleResult} />
```

When the `view` tool runs on an image file, `copilot-sdk-service.ts` (line 1604) converts it to a base64 data URL via `tryConvertImageFileToDataUrl()`. A typical image data URL is **tens to hundreds of thousands of characters**. The 5000-char truncation chops the base64 payload, creating an invalid data URL.

Inside `ViewToolView`, `isImageDataUrl(result)` passes (it only checks the `data:image/...;base64,` prefix), so the component renders `<img src={truncatedDataUrl}>`. The browser can't decode the incomplete base64 → **broken image**.

## Fix

In `ToolCallView.tsx`, skip truncation when the result is an image data URL. The `ViewToolView` component already has its own image rendering path, so passing the full data URL is correct.

### Change (lines 342-344)

**Before:**
```typescript
const resultText = typeof toolCall.result === 'string' ? toolCall.result : '';
const isResultTruncated = resultText.length > MAX_RESULT_LENGTH;
const visibleResult = isResultTruncated ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated)` : resultText;
```

**After:**
```typescript
const resultText = typeof toolCall.result === 'string' ? toolCall.result : '';
const resultIsImage = isImageDataUrl(resultText);
const isResultTruncated = !resultIsImage && resultText.length > MAX_RESULT_LENGTH;
const visibleResult = isResultTruncated ? `${resultText.slice(0, TRUNCATED_RESULT_LENGTH)}\n... (output truncated)` : resultText;
```

This ensures that image data URLs are never truncated, preserving the complete base64 payload for proper `<img>` rendering.

## Testing

- Existing tests in `packages/coc/test/spa/react/ToolCallView*.test.tsx` should be verified/updated
- Verify that non-image results are still truncated at 5000 chars
- Build: `npm run build` from repo root
