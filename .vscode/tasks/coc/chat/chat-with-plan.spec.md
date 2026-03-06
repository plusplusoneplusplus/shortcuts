---
status: future
---
---
status: in-progress
type: ux-spec
ai_generated: true
---

# Chat with Plan File — UX Specification

## User Story

**As a** developer reviewing or iterating on a plan/spec/task file in the CoC dashboard,
**I want to** open a contextual chat conversation anchored to that document,
**so that I can** ask questions about it, request refinements, brainstorm alternatives, and get AI assistance without leaving the task preview — and without losing the plan file as context across turns.

### Problem Statement

Today, plan files and chat are disconnected experiences:

| Current Path | Limitation |
|---|---|
| **Chat tab** | Freeform — no document context. User must copy-paste plan content. |
| **FollowPrompt** | One-shot execution (pick a `.prompt.md` → run). Not conversational. |
| **Inline AI comments** | Scoped to a text selection, not a multi-turn dialogue about the whole document. |

Users frequently want to *discuss* a plan with the AI: "Is this spec complete?", "What edge cases am I missing?", "Rewrite the error-handling section", "Break this into smaller tasks". None of the current paths support that naturally.

---

## Entry Points

### 1. Chat button on task preview toolbar (Primary)

When a task document is open in the preview pane, a **💬 Chat** button appears in the toolbar alongside the existing **Preview | Source** toggle.

```
┌─────────────────────────────────────────────────────┐
│  ☐ mobile-responsive-spa                            │
│  Preview   Source   💬 Chat          Copy path  ⋯   │
│─────────────────────────────────────────────────────│
│  (preview / source / chat content)                  │
└─────────────────────────────────────────────────────┘
```

Clicking **💬 Chat** switches the right pane to a split or full chat view anchored to the current document.

### 2. Context menu on task tree item

Right-click a task file or document group in the tree → **"Chat about this document"**. Opens the chat pane with the document pre-loaded as context.

### 3. Keyboard shortcut

When a task preview has focus: **Ctrl+Shift+L** (or **Cmd+Shift+L**) opens the chat panel for the currently previewed document. Mirrors the VS Code Copilot shortcut convention for "send to chat".

### 4. Slash command from Chat tab

From the main **Chat** tab, typing `/plan <path>` or `/task <path>` attaches the referenced plan file as context for the conversation. Auto-complete suggests files from `.vscode/tasks/`.

---

## User Flow

### Primary Flow: Chat from Task Preview

```
                    ┌──────────────┐
                    │  User opens  │
                    │  task file   │
                    │  in preview  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Clicks      │
                    │  💬 Chat     │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │  Chat pane opens with   │
              │  document as context    │
              │                         │
              │  ┌───────────────────┐  │
              │  │ 📄 plan.md pinned │  │
              │  │    as context     │  │
              │  └───────────────────┘  │
              │                         │
              │  "How can I help with   │
              │   this document?"       │
              │                         │
              │  ┌───────────────────┐  │
              │  │  User types msg   │  │
              │  └───────────────────┘  │
              └────────────▬────────────┘
                           │
              ┌────────────▼────────────┐
              │  AI responds with full  │
              │  awareness of document  │
              │  content + structure    │
              └────────────┬────────────┘
                           │
                     ┌─────▼─────┐
                     │  Multi-   │◄──── User continues
                     │  turn     │      asking questions
                     │  dialog   │
                     └─────┬─────┘
                           │
              ┌────────────▼────────────┐
              │  AI suggests edits →    │
              │  User applies or        │
              │  dismisses them         │
              └─────────────────────────┘
```

### Step-by-step

1. **User browses tasks** in the left tree panel and selects a document (e.g., `mobile-responsive-spa.plan.md`).

2. **Preview loads** as it does today — rendered markdown with the Preview/Source toggle.

3. **User clicks 💬 Chat** in the toolbar. The right pane transitions to the chat view:
   - A **context badge** at the top shows the pinned document: `📄 mobile-responsive-spa.plan.md` with an ✕ to detach.
   - An optional **model selector** pill (inherits the user's preferred model from Chat tab).
   - A welcome message: *"I've loaded this document as context. What would you like to discuss?"*
   - Suggestion chips for common intents (see below).
   - A message input area at the bottom.

4. **User types a message** — e.g., "What edge cases are missing from the error handling section?"

5. **System sends** the message to the AI with the full document content prepended as context (similar to how `planFilePath` works in FollowPrompt today). The conversation is streamed via SSE.

6. **AI responds** with awareness of the document structure, referencing specific sections and headings.

7. **If the AI suggests changes**, a diff-style suggestion block is shown inline in the chat:
   ```
   ┌─ Suggested edit ─────────────────────────┐
   │  § Edge Cases & Error Handling            │
   │                                           │
   │  + | API rate limiting    | Exponential   │
   │  + |                      | backoff with  │
   │  + |                      | user toast    │
   │                                           │
   │  [Apply to document]  [Copy]  [Dismiss]   │
   └───────────────────────────────────────────┘
   ```
   Clicking **"Apply to document"** patches the source file on disk (via `PATCH /api/workspaces/:id/tasks/content`) and refreshes the preview.

8. **Conversation continues** — the AI retains context of both the document *and* all prior turns. If the document is edited (by the user in Source mode or by applying a suggestion), the AI sees the latest version on the next turn.

---

## Layout Options

### Option A: Third tab — Preview | Source | Chat (Recommended)

The chat view is a **third mode** alongside Preview and Source. The full right pane becomes the chat interface. The user can toggle back to Preview or Source at any time; the chat session persists.

```
┌──────────────────────────────────────────────────────┐
│  Preview   Source   💬 Chat                          │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📄 mobile-responsive-spa.plan.md        ✕           │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🤖 I've loaded this document as context.       │  │
│  │    What would you like to discuss?             │  │
│  │                                                │  │
│  │  [Review completeness] [Find gaps]             │  │
│  │  [Break into tasks]   [Simplify]               │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 👤 What edge cases am I missing for mobile?    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🤖 Looking at your Edge Cases table, I notice  │  │
│  │    three gaps:                                 │  │
│  │    1. **Touch gesture conflicts** — ...        │  │
│  │    2. **Accessibility zoom** — ...             │  │
│  │    3. **Split-screen / foldable** — ...        │  │
│  │                                                │  │
│  │  ┌─ Suggested edit ──────────────────────┐     │  │
│  │  │  + | Touch gesture   | Distinguish... │     │  │
│  │  │  + | Accessibility   | Support 200%.. │     │  │
│  │  │  + | Split-screen    | Detect multi.. │     │  │
│  │  │  [Apply to document]  [Copy] [Dismiss]│     │  │
│  │  └───────────────────────────────────────┘     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Type a message...                  📎  ➤     │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Why this option:** Consistent with the existing Preview/Source toggle pattern. No additional panels or layout complexity. The document context badge at the top reminds users which file the AI is discussing.

### Option B: Side-by-side split

The right pane splits vertically: preview on the left, chat on the right. More context visible simultaneously, but halves the available width for both. Better suited for wide screens (≥ 1280px).

**Recommendation:** Start with Option A for simplicity. Add Option B as a user preference later if requested.

---

## Suggestion Chips

When a new chat session starts, show contextual quick-action chips based on the document type:

| Document suffix | Chips |
|---|---|
| `.plan.md` | Review completeness · Find gaps · Break into tasks · Estimate complexity |
| `.spec.md` | Review requirements · Find ambiguities · Suggest test cases · Compare to plan |
| `.test.md` | Improve coverage · Add edge cases · Simplify assertions |
| `.design.md` | Evaluate trade-offs · Suggest alternatives · Check consistency with plan |
| `.review.md` | Summarize findings · Prioritize issues · Suggest fixes |
| (any other) | Summarize · Improve · Find issues · Ask a question |

Chips are one-click shortcuts that pre-fill the input with a prompt and immediately send.

---

## Context Management

### Pinned Document

- The document is shown as a **pinned context badge** at the top of the chat pane: `📄 filename.plan.md ✕`.
- Clicking the file name toggles back to Preview mode to review the document.
- Clicking ✕ detaches the document — the chat continues but the AI no longer has the file as automatic context.

### Live Document Sync

- When the user edits the document (via Source tab or by applying a suggestion) **and then returns to Chat**, a subtle system message appears:
  > 📝 *Document updated. The AI will use the latest version for your next message.*
- The AI always receives the **current on-disk content** of the pinned document, not a stale snapshot.

### Multiple Documents

- Users can pin additional documents by dragging them from the task tree onto the chat pane, or by using a **"+ Add context"** button below the pinned badge.
- Each pinned file shows as a separate badge. Maximum: **5 pinned documents** (to keep context window manageable).
- Related files from a `DocumentGroup` can be pinned as a group with a single click.

---

## Chat Session Lifecycle

### Creation

A new chat session is created when:
- User clicks 💬 Chat on a task file for the first time.
- The session is typed as `'plan-chat'` (new `TaskQueueType`) with metadata: `{ documentPath, workspaceId }`.

### Persistence

- Chat sessions are persisted via the existing queue/process infrastructure.
- Sessions appear in the Chat tab sidebar under a **"Document Chats"** section, grouped by document.
- Re-opening a previously chatted-about document in the Tasks tab shows a **"Resume chat"** option instead of the welcome screen.

### Expiration & Resume

- Same lifecycle as existing chat sessions: SSE streaming, session expiry (410), warm/cold resume.
- When resuming, the AI re-reads the document from disk (it may have changed since the last session).

---

## Applying Suggestions

When the AI proposes changes to the document, the response includes structured edit blocks:

### Edit Block UI

```
┌─ Suggested edit ──────────────────────────────────┐
│  Section: "Edge Cases & Error Handling"            │
│                                                    │
│  (rendered markdown diff or new content preview)   │
│                                                    │
│  [Apply to document]   [Copy]   [Dismiss]          │
└────────────────────────────────────────────────────┘
```

- **Apply to document**: Sends a `PATCH` to update the file. A toast confirms: *"Document updated. Switch to Preview to see changes."*
- **Copy**: Copies the suggested content to clipboard.
- **Dismiss**: Collapses the block with a strikethrough indicator.

### Undo

After applying, a 5-second **"Undo"** toast appears. Undo reverts the file to its previous content.

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| Document deleted while chat is open | Show warning: "This document has been deleted." Disable input. Allow reading history. |
| Document renamed while chat is open | Follow the rename if possible (watch filesystem). Otherwise show "Document moved" with a "Locate" button. |
| Very large document (> 50KB) | Warn user: "This is a large document. The AI may summarize rather than process every detail." Truncate to fit context window with a note. |
| AI unavailable (exit code 3) | Show existing "AI unavailable" state with retry button. |
| Network disconnect | Existing WS disconnect handling applies. Chat input disabled; reconnect auto-resumes. |
| Conflicting edits (user edits in Source tab while AI suggestion is pending) | Apply suggestion fails gracefully: "The document has changed since this suggestion was generated. Copy the suggestion and apply manually." |
| Empty document | Chips change to: "Help me write this plan" · "Start from a template" · "Generate from codebase" |

---

## Visual Design Considerations

### Icons

- **💬 Chat toolbar button**: Use `codicon-comment-discussion` (existing in VS Code icon set).
- **📄 Context badge**: Use `codicon-file` with the document type color (plan = blue, spec = green, test = orange — matching existing task tree colors).
- **Suggestion block**: Light blue left-border accent (consistent with diff-style additions).

### Typography

- Chat bubbles follow the same markdown rendering as the Preview tab (consistent `useMarkdownPreview` pipeline).
- System messages (document updated, session resumed) use muted italic text.

### Responsive

- On narrow viewports (< 768px): Chat tab is full-width. Context badge collapses to an icon-only pill.
- On tablets: Same as desktop layout.

### Theming

- Inherit dashboard theme (light/dark/auto).
- Chat bubble backgrounds: user = subtle primary tint, AI = surface color.

---

## Settings & Configuration

| Setting | Default | Description |
|---|---|---|
| `chat.autoAttachRelatedDocs` | `false` | When opening chat for a plan, also attach the spec/test if they exist in the same document group. |
| `chat.defaultSuggestionAction` | `"ask"` | What happens when clicking a suggestion chip: `"ask"` shows in input for editing, `"send"` sends immediately. |
| `chat.maxPinnedDocuments` | `5` | Maximum number of documents that can be pinned as context. |
| `chat.showDocumentChatHistory` | `true` | Show "Document Chats" section in Chat tab sidebar. |

---

## API Surface

### New/Modified Endpoints

| Method | Path | Description |
|---|---|
| `POST` | `/api/queue` | Extended: new `type: 'plan-chat'` with `{ documentPath, workspaceId }` in payload. |
| `POST` | `/processes/:pid/message` | Unchanged — follow-up messages work the same as regular chat. The context injection happens server-side. |
| `GET` | `/api/queue/history?type=plan-chat&documentPath=...` | Filter chat history by document path. |
| `GET` | `/api/workspaces/:id/tasks/content?path=...` | Existing — used to fetch latest document content before each AI turn. |
| `PATCH` | `/api/workspaces/:id/tasks/content` | Existing — used when applying suggestions. |

### SSE Events (additions)

| Event | Payload | Description |
|---|---|---|
| `suggestion` | `{ section, content, diff }` | Structured edit suggestion from AI. Rendered as an edit block in the chat. |
| `context-updated` | `{ documentPath }` | Notifies client that the pinned document has changed on disk. |

---

## Discoverability

1. **First-time tooltip**: When a user opens a task file preview for the first time after this feature ships, show a subtle tooltip on the Chat button: *"New: Chat about this document with AI"*. Dismiss after first click or after 3 views.

2. **Empty state in Chat tab**: The Chat tab's landing page (per the `redesign-new-chat.spec.md`) should include a **"Recent document chats"** section showing the last 3–5 plan-chat sessions with document name and last message preview.

3. **Context menu hint**: The right-click context menu on task tree items already groups AI actions. Add "Chat about this document" at the top of the AI submenu.

---

## Relationship to Existing Features

| Feature | Relationship |
|---|---|
| **Chat tab** | Plan-chat sessions appear in the Chat sidebar. Users can also start plan-chat from the Chat tab via `/plan` slash command. |
| **FollowPrompt** | Complementary, not replaced. FollowPrompt is for *executing* a prompt file against a plan (batch/one-shot). Plan-chat is for *discussing* a plan conversationally. |
| **Inline AI comments** | Complementary. Comments are anchored to specific text selections. Plan-chat is about the whole document. A future enhancement could let users "send comment thread to chat" for deeper discussion. |
| **Task creation with AI** | Plan-chat could invoke task creation as a side effect: "Break this plan into subtasks" → AI creates child task files. |

---

## Future Enhancements (Out of Scope)

- **Voice input** for plan discussion (accessibility).
- **Collaborative chat** — multiple users discussing the same plan simultaneously.
- **Plan versioning** — AI tracks what changed between chat sessions and summarizes diffs.
- **Auto-suggestions** — AI proactively flags issues when a plan file is saved (opt-in).
- **Cross-document references** — AI understands links between plan.md, spec.md, and implementation files.
