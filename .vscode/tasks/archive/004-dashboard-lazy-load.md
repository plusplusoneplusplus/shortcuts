---
status: pending
---

# 004: Dashboard Lazy-Loads Externalized Images

## Summary

Update the SPA dashboard so that `QueueTaskDetail` and `ConversationTurnBubble` fetch images on demand from `GET /api/queue/:id/images` instead of expecting inline base64 data, and add a loading state to `ImageGallery` for async image loading.

## Motivation

Commits 002 and 003 stripped inline base64 images from persisted tasks and from `serializeTask()` responses. The API now returns `imagesCount` / `hasImages` metadata instead of the (potentially multi-MB) `images` arrays. The SPA must be updated to lazily fetch images via the new endpoint; without this commit the dashboard would silently lose all image rendering.

## Changes

### Files to Create

(none)

### Files to Modify

- `packages/coc/src/server/spa/client/react/types/dashboard.ts` — Add `imagesCount?: number`, `hasImages?: boolean` to `ClientConversationTurn`. Note: `imagesFilePath` is deliberately NOT included — it's a server-side path stripped by `serializeTask()` in commit 003.

- `packages/coc/src/server/spa/client/react/shared/ImageGallery.tsx` — Accept new optional props `loading?: boolean` and `imagesCount?: number`. When `loading` is true, render a skeleton/spinner placeholder showing the expected count of images. The existing rendering path is unchanged when `loading` is false and `images` is populated.

- `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` — For user turns: when `turn.imagesCount > 0` but `turn.images` is absent/empty, add a state machine (`idle` → `loading` → `loaded` / `error`) that calls `fetchApi('/queue/<taskId>/images')` to retrieve the images. Two UX options:
  1. **Auto-fetch** — fetch immediately when the turn becomes visible.
  2. **Manual trigger** — show a "Load N images" button; fetch on click.
  Prefer **manual trigger** to avoid waterfall fetches when many turns have images. On success, pass the fetched `string[]` to `<ImageGallery>`. On error, show a subtle retry link.
  
  **Key question:** The turn does not carry a `taskId`. The images endpoint is `GET /api/queue/:id/images` where `:id` is the queue task ID. Two approaches:
  - **(A) Prop-drill `taskId`** from `QueueTaskDetail` → `ConversationTurnBubble`. This is straightforward because `QueueTaskDetail` already has `selectedTaskId`.
  - **(B) Add the queue task ID to each `ClientConversationTurn`** — cleaner long-term but a bigger server-side change.
  
  **Decision: (A)** — add an optional `taskId?: string` prop to `ConversationTurnBubbleProps`. `QueueTaskDetail` passes it; other callers (ProcessDetail) omit it, preserving current behavior.

- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` — Two changes:
  1. **Pending task payload images:** In `PendingTaskPayload`, when `payload.hasImages && !payload.images`, fetch `GET /api/queue/${task.id}/images` and render them via `<ImageGallery>`. Use a local `useState` + `useEffect` pattern (similar to `resolvedPrompt` fetching already in the component at line 678–683).
  2. **Pass `taskId` to `ConversationTurnBubble`:** In the conversation render loop, pass `taskId={selectedTaskId}` to each `<ConversationTurnBubble>`.

### Files to Delete

(none)

## Implementation Notes

### API contract (from commit 003)
`GET /api/queue/:id/images` returns:
```json
{ "images": ["data:image/png;base64,...", ...] }
```
Returns `{ "images": [] }` if no images or if the blob file is missing.

### ImageGallery loading state
Keep it minimal — a flex row of gray placeholder boxes (same 16×16 dimensions as thumbnails) with a subtle pulse animation. Use existing Tailwind utility `animate-pulse`. Show `imagesCount` boxes when the count is known, otherwise a single spinner.

### ConversationTurnBubble "Load N images" button
- Style: small inline button, similar to the timestamp text (11px, muted color).
- Text: `"📷 Load ${turn.imagesCount} image${turn.imagesCount > 1 ? 's' : ''}"`.
- While loading: replace button text with `<Spinner size="xs" />`.
- On error: show `"⚠ Failed to load images · Retry"` with a click handler.
- Once loaded, replace the button with `<ImageGallery images={fetchedImages} />`.

### Fetching approach
Use the existing `fetchApi` utility from `'../hooks/useApi'`. It already prepends the API base and throws on non-200. Wrap in try/catch and set loading/error states.

### No caching needed at this layer
The browser's HTTP cache and the React component lifecycle handle re-renders. If the user navigates away and back, a re-fetch is acceptable for this commit.

### Backward compatibility
- Turns/payloads that still have inline `images` (e.g., from older persistence files, or running tasks that haven't been serialized yet) continue to work unchanged — the new logic only activates when `images` is absent but `imagesCount > 0` or `hasImages` is true.
- Components outside the queue flow (`ProcessDetail`) don't pass `taskId`, so no image fetching occurs there — preserving current behavior.

## Tests

All tests follow the existing source-string analysis pattern (`fs.readFileSync` + `expect(source).toContain(...)`) for `QueueTaskDetail.test.ts`, and the `@testing-library/react` render pattern for `ConversationTurnBubble` and `ImageGallery`.

- **`packages/coc/test/spa/react/QueueTaskDetail.test.ts`** — Add a new `describe('lazy image loading')` block:
  - `PendingTaskPayload fetches images when payload.hasImages is true` — source contains `payload.hasImages` guard and `fetchApi` call to `/queue/${task.id}/images`.
  - `PendingTaskPayload renders ImageGallery for fetched images` — source contains `<ImageGallery` inside `PendingTaskPayload`.
  - `ConversationTurnBubble receives taskId prop` — source contains `taskId={selectedTaskId}` in the conversation map.

- **`packages/coc/test/spa/react/ConversationTurnBubble-images.test.tsx`** — Add tests to the existing file:
  - `renders "Load N images" button when turn has imagesCount but no images` — render a turn with `imagesCount: 3, images: undefined`, assert button text "Load 3 images".
  - `fetches and displays images on button click` — mock `fetchApi`, click button, await, assert `ImageGallery` renders with fetched images.
  - `shows error state on fetch failure` — mock `fetchApi` to reject, click button, assert error message visible.
  - `renders inline images directly when images array is present (backward compat)` — render with both `images` and `imagesCount`, assert `ImageGallery` uses inline images, no fetch button.
  - `does not render fetch button when taskId is not provided` — render without `taskId`, even with `imagesCount`, assert no button.

- **`packages/coc/test/spa/react/ImageGallery.test.tsx`** (new or extend existing) — Test the loading state:
  - `renders skeleton placeholders when loading is true` — pass `loading: true, imagesCount: 3, images: []`, assert 3 placeholder elements with `animate-pulse`.
  - `renders images normally when loading is false` — existing behavior, regression guard.
  - `renders nothing when loading is false and images is empty` — existing behavior preserved.

## Acceptance Criteria

- [ ] `ClientConversationTurn` type includes optional `imagesCount` and `hasImages` fields (no `imagesFilePath` — server-internal)
- [ ] `ImageGallery` accepts `loading` and `imagesCount` props and renders skeleton placeholders during loading
- [ ] `PendingTaskPayload` in `QueueTaskDetail.tsx` fetches images via `GET /api/queue/:id/images` when `payload.hasImages && !payload.images`
- [ ] `ConversationTurnBubble` accepts optional `taskId` prop and renders a "Load N images" button for turns with `imagesCount > 0` but no inline `images`
- [ ] Clicking "Load N images" fetches from the images endpoint, shows a spinner during fetch, and renders `ImageGallery` on success
- [ ] Fetch errors show a "Failed to load images · Retry" message
- [ ] Turns with inline `images` still render immediately (backward compatibility)
- [ ] `QueueTaskDetail` passes `taskId={selectedTaskId}` to all rendered `ConversationTurnBubble` components
- [ ] All new and existing tests pass (`npm run test` in `packages/coc/`)
- [ ] No changes to any backend/server files in this commit

## Dependencies

- Depends on: 003 (`serializeTask()` returns `imagesCount`/`hasImages`; `GET /api/queue/:id/images` endpoint exists)

## Assumed Prior State

`GET /api/queue/:id/images` endpoint exists and returns `{ images: string[] }`. `serializeTask()` returns `imagesCount` and `hasImages` instead of inline images. `ImageGallery`, `QueueTaskDetail`, and `ConversationTurnBubble` components exist with current image rendering. The `fetchApi` utility is available at `../hooks/useApi`. Existing tests use either source-string analysis or `@testing-library/react` render patterns.
