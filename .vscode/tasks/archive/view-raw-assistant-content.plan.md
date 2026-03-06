# View Raw Assistant Content — Toggle Button on Message Bubble

## Problem

In the SPA dashboard chat view, assistant messages are rendered as rich HTML (markdown → HTML, tool call cards, nested sub-agents). There is no way to see the **raw** underlying content — the original markdown text and raw tool call JSON. This makes it hard to debug, copy precise content, or inspect what the AI actually returned.

## Proposed Approach

Add a **"View Raw" toggle button** to each assistant message bubble header (next to the existing 📋 copy button). When toggled ON, the bubble switches from the rich rendered view to a raw text view showing:

- The raw `turn.content` string (original markdown, not HTML-rendered)
- Each tool call's raw JSON (toolName, args, result/error) in a collapsible code block
- Timeline events in chronological order

The toggle is per-bubble (each assistant message can be toggled independently).

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Main bubble component — add toggle state + raw view |
| `packages/coc/src/server/spa/client/react/types/dashboard.ts` | Types (no changes needed — `turn.content` and `turn.timeline` already contain raw data) |
| `packages/coc/src/server/spa/client/tailwind.css` | Styling for raw view (monospace code block) |

## Implementation Plan

### 1. Add raw view toggle state to `ConversationTurnBubble`

- Add `const [showRaw, setShowRaw] = useState(false)` in `ConversationTurnBubble`
- Only for assistant messages (`!isUser`)

### 2. Add toggle button to the message header

- Place a `</>` or `{ }` icon button next to the existing 📋 copy button
- Toggles `showRaw` state on click
- Visual indicator when active (e.g., highlighted background)
- Tooltip: "View raw content" / "View rendered content"

### 3. Create `RawContentView` inline section

When `showRaw` is true, replace the rendered `chat-message-content` div with a raw view:

- **Raw text content**: Display `turn.content` in a `<pre>` block with monospace font
- **Raw tool calls**: For each tool call in the turn, show:
  - Tool name and status
  - `args` as pretty-printed JSON in a `<pre><code>` block
  - `result` (if present) as a `<pre><code>` block  
  - `error` (if present) in red
- **Timeline events** (optional, could be behind a sub-toggle): Show the raw timeline array

### 4. Build the raw content string

Create a helper function `buildRawContent(turn: ClientConversationTurn): string` that:

- Starts with `turn.content` (the raw markdown text)
- Appends each tool call as a formatted block:
  ```
  --- tool: <toolName> [status] ---
  Args: { ... }
  Result: ...
  ```
- This same string can be used for the copy button when in raw mode

### 5. Styling

- Raw view uses `font-mono text-xs` with a slightly different background
- Wrap in a scrollable container with max-height
- Code blocks get syntax highlighting for JSON

## UI Mockup

```
┌─────────────────────────────────────────────────────┐
│ ASSISTANT              6:28:29 AM  Live    </> 📋   │
│                                            ^^^ new  │
├─────────────────────────────────────────────────────┤
│ [When </> is OFF — current rich view]               │
│ ✅ task [explore] Explore chat feature code   57.8s │
│ ✅ task [explore] Explore chat session...     52.9s │
│ Now let me look at how the chat creates...          │
├─────────────────────────────────────────────────────┤
│ [When </> is ON — raw view]                         │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Now let me look at how the chat creates new     │ │
│ │ sessions to understand the full flow for resume.│ │
│ │                                                 │ │
│ │ --- tool: task [completed] ---                  │ │
│ │ Args: {                                         │ │
│ │   "agent_type": "explore",                      │ │
│ │   "description": "Explore chat feature code",   │ │
│ │   "prompt": "..."                               │ │
│ │ }                                               │ │
│ │ Result: "..."                                   │ │
│ │                                                 │ │
│ │ --- tool: view [completed] ---                  │ │
│ │ Args: { "path": "D:\\projects\\..." }           │ │
│ │ Result: "..."                                   │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Notes

- The raw `turn.content` is already available on the `ClientConversationTurn` object — no server changes needed
- Tool call args/results are already in `turn.toolCalls[]` and `turn.timeline[]`
- The 📋 copy button already uses `turn.content` — in raw mode it could copy the full raw dump instead
- Consider truncating very large tool results (e.g., `view` of a large file) with an expand toggle
- User messages don't need this feature (they're already plain text)
