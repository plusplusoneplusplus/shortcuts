# Add Border to Markdown Rendering in Chat Bubbles

## Problem

In the CoC Server Dashboard chat view (`RepoChatTab` → `ConversationTurnBubble`), the markdown content rendered by `MarkdownView` flows directly into the chat bubble without any visual boundary. This makes it hard to distinguish the markdown output area from the surrounding bubble chrome (role label, timestamp, tool calls).

## Proposed Approach

Add a subtle border, rounded corners, padding, and background tint to the `.markdown-body` elements **only when inside a `.chat-message-content`** container. This scopes the change to chat bubbles and avoids affecting markdown rendering elsewhere (e.g., tasks viewer, process file review dialog).

## Files to Change

1. **`packages/coc/src/server/spa/client/tailwind.css`** — Add a new CSS rule:
   ```css
   .chat-message-content .markdown-body {
       border: 1px solid #e0e0e0;
       border-radius: 0.375rem;
       padding: 0.75rem;
       background: #ffffff;
   }
   .dark .chat-message-content .markdown-body {
       border-color: #3c3c3c;
       background: #1e1e1e;
   }
   ```

   This gives the markdown rendering area a distinct bordered card appearance within the chat bubble while respecting dark mode.

## Considerations

- The outer chat bubble already has `border`, `rounded-lg`, `px-3 py-2`, `shadow-sm`. The inner markdown border should use a slightly different or matching tone so it nests cleanly.
- User bubbles have a blue tint (`bg-[#e8f3ff]`); the markdown border inside user bubbles could optionally match (`border-[#b3d7ff]`), but a neutral border is simpler and consistent.
- No TypeScript/React changes needed — pure CSS addition scoped via `.chat-message-content .markdown-body`.
- Existing `.markdown-body` base styles (line-height, word-break, user-select) remain unchanged.

## Tasks

1. Add scoped CSS rules for `.chat-message-content .markdown-body` (light + dark mode) in `tailwind.css`
2. Build and visually verify in the dashboard
