# Add "View Raw Prompt" Button for User Messages

## Problem

The chat conversation UI in the CoC SPA dashboard has a `</>` ("view raw content") toggle button on **assistant** messages, but **user** messages have no equivalent. When user prompts contain skill guidance, system instructions, or other injected context, the rendered markdown hides the raw structure. Users need a way to inspect the raw prompt text for user messages too.

## Proposed Approach

Mirror the existing assistant raw-view toggle (`</>` button) onto user message bubbles. The change is minimal — remove the `!isUser` guard on the button and raw-content display, then update tests.

## Key File

`packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

## Implementation Steps

### 1. Show the `</>` button on user messages

**Lines 583–592** — The raw-toggle button is currently wrapped in `{!isUser && ( … )}`. Change this to render for both roles (remove the `!isUser` guard or change to always-render).

```diff
-{!isUser && (
     <button
         className="bubble-raw-btn ml-auto …"
         title={showRaw ? 'View rendered content' : 'View raw content'}
         onClick={() => setShowRaw((v) => !v)}
         style={showRaw ? { opacity: 1, color: '#0078d4' } : undefined}
     >
         &lt;/&gt;
     </button>
-)}
```

### 2. Show the raw content view for user messages

**Lines 636–641** — The raw content panel is guarded by `!isUser && showRaw`. Add a parallel block for user messages, or remove the `!isUser` guard and unify:

When `isUser && showRaw`, render the raw content (`turn.content`) in a `<pre>` block instead of the `<MarkdownView>`. The simplest approach:

- When `showRaw` is true for a user message, hide the `<MarkdownView>` and show a `<pre>` with `turn.content` (raw text).
- The `buildRawContent()` function already handles the user case (it just returns `turn.content` since user turns have no tool calls), so it can be reused directly.

```diff
-{isUser && userContentHtml && <MarkdownView html={userContentHtml} />}
+{isUser && !showRaw && userContentHtml && <MarkdownView html={userContentHtml} />}
+{isUser && showRaw && (
+    <div className="raw-content-view rounded border …">
+        <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words …">
+            <code>{turn.content || ''}</code>
+        </pre>
+    </div>
+)}
```

### 3. Optionally show copy button for user messages too

**Lines 593–604** — The copy-to-clipboard button (`📋`) is also gated behind `!isUser`. Consider removing that guard as well so users can copy raw or rendered text from their own messages.

### 4. Update tests

**File:** `packages/coc/test/spa/react/ConversationTurnBubble-raw-view.test.tsx`

- **Update** the test at line 46 (`'does not render .bubble-raw-btn for user messages'`) — it currently asserts the button is absent for user messages. Change this to assert it **is** present.
- **Add** a test: clicking the `</>` button on a user message switches from rendered markdown to raw `<pre>` content.
- **Add** a test: raw view for a user message shows `turn.content` verbatim (no markdown rendering).
- **Add** a test: toggling back shows the MarkdownView again.
- **Add** a test: copy button works on user messages (copies raw text when `showRaw` is active).

## Scope & Constraints

- **Single file change** for the component (`ConversationTurnBubble.tsx`) — roughly 10 lines modified.
- **Single test file update** (`ConversationTurnBubble-raw-view.test.tsx`) — ~30 lines added/modified.
- No backend changes, no new dependencies, no data model changes.
- `buildRawContent()` already handles user turns (returns just `turn.content`), so no changes needed there.
