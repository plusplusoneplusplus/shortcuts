---
status: done
---

# 007: Item Conversation View + Chat Resume

## Summary
Add an `ItemConversationPanel` slide-in panel that shows the full AI conversation for a selected map item and allows the user to continue chatting via `POST /api/processes/:childId/message`.

## Motivation
The second core user story: "resume on the chat if it is an AI task." After clicking an item card in the map grid (Commit 6), users need to see what the AI said and be able to follow up — e.g., asking for clarification on a failed item or refining an AI-generated result.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/processes/dag/ItemConversationPanel.tsx` — Slide-in panel
  - Props: `{ processId: string, onClose: () => void, isDark: boolean }`
  - Fetches child process via `fetchApi(`/processes/${encodeURIComponent(processId)}`)` (from `hooks/useApi.ts`)
  - Extracts conversation turns using the same `getConversationTurns(data)` pattern used in `ProcessDetail.tsx` (lines 21-57) and `RepoChatTab.tsx` (lines 43-60): checks `process.conversationTurns`, then `data.conversation`, then `data.turns`, with synthetic fallback from `fullPrompt`/`result`
  - Renders `conversationTurns[]` using the existing `ConversationTurnBubble` component:
    ```tsx
    import { ConversationTurnBubble } from '../ConversationTurnBubble';
    // Props: { turn: ClientConversationTurn, taskId?: string, onRetry?: () => void }
    // - turn.role: 'user' | 'assistant'
    // - turn.content: string (markdown rendered internally via chatMarkdownToHtml)
    // - turn.streaming?: boolean (shows spinner when true)
    // - turn.isError?: boolean (shows Retry button when true + onRetry provided)
    // - turn.toolCalls?: ClientToolCall[] (renders ToolCallView/ToolCallGroupView)
    // - turn.timeline: ClientTimelineItem[] (tool execution timeline)
    // - turn.images?: string[] (base64 data-URL attached images)
    ```
  - Shows process metadata header: item index, status badge (`Badge` + `statusIcon`/`statusLabel` from `utils/format`), duration (`formatDuration`), input preview
  - Chat input at bottom: `<textarea>` + `<Button>` following the exact pattern from `RepoChatTab.tsx` (lines 984-1023):
    ```tsx
    <textarea
      rows={1}
      value={inputValue}
      disabled={inputDisabled}
      placeholder="Follow up…"
      onChange={e => setInputValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); }
      }}
      className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
    />
    <Button disabled={inputDisabled || !inputValue.trim()} onClick={() => void sendFollowUp()}>
      {sending ? '...' : 'Send'}
    </Button>
    ```
  - Send function calls `POST /api/processes/:processId/message` with `{ content }`, mirroring `RepoChatTab.tsx` lines 601-612:
    ```tsx
    const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    ```
  - After send: subscribes to SSE stream via `new EventSource(getApiBase() + '/processes/' + processId + '/stream')` for streaming response, following the `waitForFollowUpCompletion` pattern from `RepoChatTab.tsx` (lines 227-270):
    - Listen for `'done'` and `'status'` events to detect completion
    - Listen for `'conversation-snapshot'` event (from `ProcessDetail.tsx` lines 149-157) to refresh full turn list
    - 90-second timeout fallback, then re-fetch full process
  - Optimistic UI: immediately append `{ role: 'user', content, timeline: [] }` and `{ role: 'assistant', content: '', streaming: true, timeline: [] }` to turns before response arrives (same pattern as `RepoChatTab.tsx` lines 595-599)
  - `onRetry` prop wired to `ConversationTurnBubble` for error turns — re-sends the last user message
  - Dismissible via Escape key, click-outside, or X button
  - Uses portal rendering (like `BottomSheet.tsx`) for proper z-index stacking

### Files to Modify
- `packages/coc/src/server/spa/client/react/processes/dag/WorkflowDetailView.tsx`:
  - Add `selectedItemProcessId: string | null` state (initially `null`)
  - Pass `onItemClick={(processId) => setSelectedItemProcessId(processId)}` to `MapItemGrid`
  - Render `ItemConversationPanel` when `selectedItemProcessId` is set:
    ```tsx
    {selectedItemProcessId && (
      isMobile
        ? <BottomSheet isOpen onClose={() => setSelectedItemProcessId(null)} title="Item Conversation" height={80}>
            <ItemConversationPanel processId={selectedItemProcessId} onClose={() => setSelectedItemProcessId(null)} isDark={isDark} />
          </BottomSheet>
        : <ItemConversationPanel processId={selectedItemProcessId} onClose={() => setSelectedItemProcessId(null)} isDark={isDark} />
    )}
    ```
  - Desktop layout: panel as a right-side slide-in, ~400px wide, absolutely positioned or flex sibling
  - Mobile layout: wrap in existing `BottomSheet` component (`shared/BottomSheet.tsx`) which already handles drag-to-dismiss, Escape key, backdrop click, and body scroll lock
  - Detect mobile via `useBreakpoint` hook (already used in `RepoChatTab.tsx` line 24)

- `packages/coc/src/server/spa/client/react/processes/dag/MapItemGrid.tsx`:
  - Add `selectedProcessId?: string` prop
  - Apply visual highlight (border/ring) to the card whose `processId === selectedProcessId`
  - Style: `ring-2 ring-[#0078d4] dark:ring-[#3794ff]` (matches the blue accent used elsewhere, e.g., `RepoChatTab.tsx` link color)

- `packages/coc/src/server/spa/client/react/processes/dag/index.ts`:
  - Add export: `export { ItemConversationPanel } from './ItemConversationPanel';`

## Implementation Notes

### Existing Patterns to Reuse
- **`ConversationTurnBubble`** (`processes/ConversationTurnBubble.tsx`): The primary chat bubble component. Accepts `{ turn: ClientConversationTurn, taskId?: string, onRetry?: () => void }`. Internally renders markdown via `chatMarkdownToHtml`, tool calls via `ToolCallView`/`ToolCallGroupView`, images via `ImageGallery`, and a Retry button when `turn.isError && onRetry`. No need to reimplement any of this.
- **`ClientConversationTurn`** type (`types/dashboard.ts` lines 32-50): `{ role, content, timestamp?, streaming?, isError?, toolCalls?, timeline, images?, imagesCount?, historical? }`.
- **`fetchApi`** (`hooks/useApi.ts`): `fetchApi(path)` → prepends `getApiBase()`, throws on non-OK. Use for initial process fetch.
- **`getApiBase`** (`utils/config.ts`): Returns the API base URL for direct `fetch()` calls (needed for POST with custom options).
- **`Badge`**, **`Button`**, **`Spinner`** from `shared/index.ts`: Already used throughout ProcessDetail and RepoChatTab.
- **`BottomSheet`** (`shared/BottomSheet.tsx`): Portal-rendered mobile bottom sheet with drag-to-dismiss, Escape key, backdrop click, `height` prop. Reuse for mobile layout.
- **`formatDuration`**, **`statusIcon`**, **`statusLabel`** from `utils/format.ts`: Process status display helpers.
- **`linkifyFilePaths`** from `shared/file-path-utils.ts`: For rendering file paths in input previews.

### SSE Streaming Pattern
The chat resume works server-side (`POST /api/processes/:id/message` → bridge.enqueue chat-followup). This commit is purely about the SPA UI. The SSE pattern to follow is from `RepoChatTab.tsx` `waitForFollowUpCompletion` (lines 227-270):
1. `POST /api/processes/:id/message` with `{ content }`
2. Create `new EventSource(getApiBase() + '/processes/' + pid + '/stream')`
3. Listen for `'conversation-snapshot'` to get full updated turns
4. Listen for `'done'` / `'status'` (non-running status) to close EventSource
5. On error or timeout (90s), close EventSource and re-fetch process
6. After close, re-fetch full process to ensure turns are complete

### Panel Behavior
- Panel width: ~400px (desktop), full-width bottom sheet (mobile via `BottomSheet` at 80vh)
- Keyboard shortcuts: Escape to close (handled by `BottomSheet` on mobile; add `keydown` listener for desktop), Enter to send (no shift), Shift+Enter for newline
- Auto-scroll to bottom when new turns arrive (use `useRef` + `scrollIntoView`)
- Loading state: `Spinner` while fetching initial process data
- Empty state: "No conversation data available." (same text as `ProcessDetail.tsx` line 350)

### Error Handling
- If `POST /message` returns 410 → show "Session expired" (same as `RepoChatTab.tsx` line 613-618)
- If `POST /message` returns non-OK → mark last assistant turn as error with `isError: true`, which triggers the Retry button in `ConversationTurnBubble`
- Network errors → show error message inline

## Tests
- Component test: `ItemConversationPanel` renders conversation turns using `ConversationTurnBubble`
- Component test: Send button calls `POST /api/processes/:id/message` with correct body
- Component test: Panel shows `Spinner` loading state while fetching process
- Component test: Failed item (turn with `isError: true`) shows Retry button via `ConversationTurnBubble`'s `onRetry` prop
- Component test: Escape key closes panel (calls `onClose`)
- Component test: SSE streaming updates conversation turns after send (mock `EventSource`)
- Component test: Optimistic UI — user turn and streaming placeholder appear immediately on send
- Component test: Session expired (410 response) shows expired message
- Integration test: click item card → `selectedItemProcessId` set → panel opens → shows conversation
- Integration test: `MapItemGrid` highlights selected card with ring styling

## Acceptance Criteria
- [ ] Click item card → slide-in panel with conversation turns rendered by `ConversationTurnBubble`
- [ ] Chat input allows sending follow-up messages via `POST /api/processes/:id/message`
- [ ] Streaming response displayed in real-time via SSE (`EventSource` on `/api/processes/:id/stream`)
- [ ] Optimistic UI: user message + streaming placeholder appear instantly
- [ ] Error turns show Retry button (via `ConversationTurnBubble` `onRetry` prop)
- [ ] Panel dismissible via Escape/X/click-outside
- [ ] Responsive: right side panel (desktop, ~400px), `BottomSheet` (mobile, 80vh)
- [ ] Selected item card highlighted in `MapItemGrid`
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: 006

## Assumed Prior State
- `WorkflowDetailView` with `MapItemGrid` exists (Commit 6)
- `onItemClick(processId)` triggers from item card click (Commit 6)
- `POST /api/processes/:id/message` works for child processes (existing + Commit 4)
- `GET /api/processes/:id/stream` works for child process SSE (existing)
- `ConversationTurnBubble` renders turns with markdown, tool calls, images, and retry support
- `BottomSheet` provides mobile slide-up panel with drag-to-dismiss
- `fetchApi`, `getApiBase`, `Badge`, `Button`, `Spinner`, `formatDuration`, `statusIcon`, `statusLabel` all available
