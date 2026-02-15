---
status: pending
---

# 005: Add CSS Styles for Chat Bubbles, Input Bar, and Conversation Layout

**Depends on:** None (CSS is independent of backend)

## Goal

Add all CSS required for the ChatGPT-style conversational UI: chat message bubbles with user/assistant distinction, a fixed input bar, per-bubble streaming indicators, collapsible metadata, a scroll-to-bottom button, and responsive layout — all working in both light and dark themes.

## Dependencies

None. CSS is independent of backend and JavaScript logic.

## File Changed

`packages/coc/src/server/spa/client/styles.css` — the single SPA stylesheet (currently ~1505 lines).

## Existing Context

### Theme Variables (`:root` / `html[data-theme="dark"]`)

| Variable | Light | Dark | Usage in new styles |
|---|---|---|---|
| `--bg-primary` | `#ffffff` | `#1e1e1e` | Input bar background, code blocks |
| `--bg-secondary` | `#f3f3f3` | `#252526` | Assistant bubble bg, conversation body |
| `--text-primary` | `#1e1e1e` | `#cccccc` | Message content text |
| `--text-secondary` | `#6e6e6e` | `#858585` | Timestamps, role labels, placeholders |
| `--border-color` | `#e0e0e0` | `#3c3c3c` | Bubble borders, input bar border |
| `--accent` | `#0078d4` | `#0078d4` | User bubble tint, send button, streaming border |
| `--hover-bg` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.04)` | Send button hover |
| `--active-bg` | `rgba(0,120,212,0.08)` | `rgba(0,120,212,0.15)` | User bubble background |
| `--status-running` | `#0078d4` | `#3794ff` | Streaming indicator color |

### Existing Conversation Styles (lines 868–934)

- `.conversation-section` — outer wrapper (`margin-top: 16px`)
- `.conversation-section h2` — section heading with flex layout
- `.streaming-indicator` — pulsing dot using `@keyframes pulse`
- `.conversation-body` — current monolithic output area (`background: var(--bg-secondary)`, `border-radius: 6px`, `max-height: 60vh`, `overflow-y: auto`, `white-space: pre-wrap`)
- `.conversation-body pre/code/p/h1-h4/ul/ol/blockquote` — markdown rendering styles
- `.conversation-waiting` — italic centered placeholder

### Design Constraints

- All new classes **must** use existing CSS variables so dark/light theming works automatically.
- The existing `@keyframes pulse` animation (line 884) is reusable for streaming indicators.
- The responsive breakpoint at `768px` (line 937) must be extended for new elements.
- Existing `.conversation-body` markdown styles (lines 901–928) must be preserved and inherited by `.chat-message-content`.

## Detailed Changes

### 1. Modify `.conversation-body` (line 888)

Convert from a monolithic pre-formatted block into a flex column message container.

**Before:**
```css
.conversation-body {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 16px;
    min-height: 200px;
    max-height: 60vh;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
}
```

**After:**
```css
.conversation-body {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 16px;
    min-height: 200px;
    max-height: 60vh;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.6;
    /* Removed: white-space: pre-wrap — each message handles its own formatting */
    word-wrap: break-word;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;  /* anchor for scroll-to-bottom button */
}
```

Key changes:
- **Remove** `white-space: pre-wrap` — individual messages handle their own text formatting.
- **Add** `display: flex; flex-direction: column; gap: 12px` — vertical stack with spacing.
- **Add** `position: relative` — positioning anchor for the scroll-to-bottom button.
- **Keep** everything else (`max-height`, `overflow-y`, `border-radius`, background, etc.).

### 2. Chat Message Bubbles (append after `.conversation-waiting`, ~line 934)

```css
/* ---- Chat Message Bubbles ---- */
.chat-message {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    word-wrap: break-word;
}
.chat-message.user {
    align-self: flex-end;
    background: var(--active-bg);               /* accent at 8%/15% opacity */
    border-color: rgba(0, 120, 212, 0.2);
}
.chat-message.assistant {
    align-self: flex-start;
    background: var(--bg-primary);
}
```

**Rationale:**
- `max-width: 85%` keeps bubbles from spanning the full width, creating a chat feel.
- User messages align right with a subtle accent tint via `--active-bg` (already theme-aware: 8% light, 15% dark).
- Assistant messages align left with `--bg-primary` to contrast against the `--bg-secondary` container.

### 3. Chat Message Header

```css
.chat-message-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 600;
}
.chat-message-header .role-icon {
    font-size: 12px;
}
.chat-message-header .timestamp {
    font-weight: 400;
    margin-left: auto;
}
```

**Rationale:**
- Small, muted header row with role label + icon on the left, timestamp pushed right via `margin-left: auto`.
- Uses `--text-secondary` for unobtrusive metadata.

### 4. Chat Message Content

```css
.chat-message-content {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
}
```

**Rationale:**
- This element inherits the existing `.conversation-body pre/code/p/h1-h4/ul/ol/blockquote` styles since it's a descendant of `.conversation-body`. No duplication needed.
- Explicitly sets font-size and line-height to match the conversation body baseline.

### 5. Input Bar (append after chat message styles)

```css
/* ---- Chat Input Bar ---- */
.chat-input-bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
}
.chat-input-bar textarea {
    flex: 1;
    min-height: 36px;
    max-height: 120px;                          /* ~4 lines */
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    overflow-y: auto;
}
.chat-input-bar textarea:focus {
    outline: none;
    border-color: var(--accent);
}
.chat-input-bar textarea::placeholder {
    color: var(--text-secondary);
    font-style: italic;
}
.chat-input-bar .send-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
}
.chat-input-bar .send-btn:hover {
    opacity: 0.85;
}
.chat-input-bar.disabled textarea {
    opacity: 0.6;
    pointer-events: none;
}
.chat-input-bar.disabled .send-btn {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
}
```

**Rationale:**
- `flex` with `align-items: flex-end` keeps the send button bottom-aligned as the textarea grows.
- Textarea: `min-height: 36px` (~1 line), `max-height: 120px` (~4 lines), `resize: none` — auto-grow handled by JS.
- `.disabled` state grays out both textarea and button during streaming.
- Focus ring uses `--accent` matching the existing `.filter-bar input:focus` pattern (line 134).

### 6. Streaming Indicator Per-Bubble

```css
/* ---- Streaming State ---- */
.chat-message.streaming {
    border-left: 3px solid var(--status-running);
    animation: pulse 1.5s ease-in-out infinite;
}
.typing-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--text-primary);
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: blink 0.8s step-end infinite;
}
@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
}
```

**Rationale:**
- `.streaming` adds a left accent border and reuses the existing `pulse` animation (line 884) for a subtle breathing effect.
- `.typing-cursor` is a thin blinking bar appended to the end of streaming content, using a `step-end` timing for a classic cursor look.
- New `@keyframes blink` is separate from existing `pulse` because it uses step-end (hard toggle) vs ease-in-out (smooth fade).

### 7. Collapsible Metadata

```css
/* ---- Collapsible Metadata ---- */
.meta-collapse {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.15s;
    overflow: hidden;
    max-height: 28px;                           /* collapsed: single line */
    transition: max-height 0.2s ease;
}
.meta-collapse:hover {
    background: var(--hover-bg);
}
.meta-collapse .meta-grid {
    display: none;
    width: 100%;
    margin-top: 6px;
}
.meta-collapse.expanded {
    max-height: 300px;                          /* enough for full grid */
    flex-wrap: wrap;
}
.meta-collapse.expanded .meta-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 12px;
}
```

**Rationale:**
- Collapsed state shows a single-line summary (model name, token count, etc.) via `max-height: 28px`.
- Expanded state reveals the full `.meta-grid` with a CSS grid two-column layout for key-value pairs.
- Uses `max-height` transition for a smooth expand/collapse animation.

### 8. Scroll-to-Bottom Button

```css
/* ---- Scroll to Bottom ---- */
.scroll-to-bottom {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    border: 1px solid var(--border-color);
    border-radius: 16px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: opacity 0.15s, background-color 0.15s;
    z-index: 5;
    opacity: 0;
    pointer-events: none;
}
.scroll-to-bottom.visible {
    opacity: 1;
    pointer-events: auto;
}
.scroll-to-bottom:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
}
```

**Rationale:**
- Absolutely positioned within `.conversation-body` (which gets `position: relative`).
- Hidden by default (`opacity: 0; pointer-events: none`); JS toggles `.visible` when the user scrolls up.
- Pill shape (`border-radius: 16px`) with a subtle shadow for floating effect.
- Dark mode: `box-shadow` with `rgba(0,0,0,0.1)` works in both themes because dark theme already has a dark background.

### 9. Responsive Additions (inside existing `@media (max-width: 768px)` block, line 937)

Append these rules inside the existing media query block:

```css
    .chat-message { max-width: 95%; }
    .chat-input-bar { padding: 8px 12px; }
    .chat-input-bar .send-btn { padding: 8px 12px; }
```

**Rationale:**
- On small screens, bubbles expand to 95% width to avoid wasted space.
- Input bar and send button get slightly tighter padding.

### 10. Dark Mode Considerations

No additional `html[data-theme="dark"]` selectors are needed because:

- All new rules use existing CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--border-color`, `--accent`, `--active-bg`, `--hover-bg`, `--status-running`).
- These variables are already redefined in the dark theme block (lines 20–35).
- The `--active-bg` variable provides the right accent tint in both themes: `rgba(0,120,212,0.08)` in light, `rgba(0,120,212,0.15)` in dark.

## Insertion Points Summary

| What | Where in file | Action |
|---|---|---|
| `.conversation-body` modifications | Line 888 | **Edit** existing rule |
| Chat message bubble styles | After line 934 (after `.conversation-waiting`) | **Insert** new block |
| Chat input bar styles | After chat message block | **Insert** new block |
| Streaming indicator styles | After input bar block | **Insert** new block |
| Collapsible metadata styles | After streaming block | **Insert** new block |
| Scroll-to-bottom styles | After metadata block | **Insert** new block |
| Responsive additions | Inside `@media` block at line 937 | **Append** rules |

## Acceptance Criteria

- [ ] User messages (`.chat-message.user`) have subtle accent-tinted background, align right
- [ ] Assistant messages (`.chat-message.assistant`) have primary background, align left
- [ ] `.conversation-body` is a flex column with gap between messages, no `white-space: pre-wrap`
- [ ] Input bar is fixed at bottom of detail panel with responsive textarea (1–4 lines)
- [ ] Send button uses accent color; both textarea and button gray out when `.disabled`
- [ ] Streaming messages have a left accent border with pulse animation
- [ ] `.typing-cursor` blinks at end of streaming content
- [ ] `.meta-collapse` shows single-line summary; `.expanded` reveals full grid
- [ ] `.scroll-to-bottom` button appears when user scrolls up (`.visible` toggle)
- [ ] All styles work correctly in both light and dark themes without extra selectors
- [ ] Existing non-chat styles (process list, sidebar, detail panel) are not broken
- [ ] Responsive layout adjusts bubble width and input padding at ≤768px

## Testing

No automated tests — CSS changes are verified visually:

1. Build the SPA (`cd packages/coc && npm run build`)
2. Start the server (`coc serve --no-open`)
3. Open `http://localhost:4000` in browser
4. Toggle dark/light theme via the theme button
5. Resize browser to ≤768px to verify responsive behavior
6. Verify existing process list and detail panel styles are unaffected
