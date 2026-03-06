# UX Specification: Chat Conversation Mini Map

**Feature:** Mini Map for CoC Chat Conversation  
**Status:** Draft  
**Location:** CoC Dashboard SPA → Process Detail → Conversation View

---

## 1. User Story

> As a developer using CoC's AI chat dashboard, I have long-running conversations with many messages and tool calls. Scrolling up and down to find a specific response, a tool execution result, or the start of a topic is slow and disorienting. I want a compact visual overview of the conversation that lets me jump to any message instantly — similar to VS Code's editor mini map.

---

## 2. Entry Points

### Primary: Always Visible (default on)
- The mini map appears as a **narrow vertical panel** on the **right edge** of the conversation view inside `ProcessDetail` whenever there are more messages than can fit in the viewport (e.g., ≥ 5 turns).
- Automatically collapses into a thin toggle strip when the window is narrow (< 900 px).

### Secondary: Keyboard Shortcut
- `Alt+M` (or `Cmd+M` on Mac) toggles the mini map visible/hidden while focus is inside the conversation panel.

### Tertiary: Settings Toggle
- A settings toggle in the chat panel's **top-right overflow menu** (⋯): **"Show conversation mini map"** (on by default).

---

## 3. User Flow

### 3.1 Primary Flow — Navigate by Clicking a Bubble

1. **Initial State:** User is viewing a long conversation (10+ turns) in `ProcessDetail`. The mini map panel is visible on the right side.
2. **Mini Map Renders:** Each conversation turn is represented as a compact colored strip in the mini map, stacked vertically in proportion to the full conversation length.
3. **Viewport Indicator:** A translucent highlight box overlays the mini map, showing which portion of the conversation is currently visible on screen.
4. **User Scans:** User visually scans the mini map — colored strips give instant hints about message type.
5. **User Clicks a Strip:** User clicks a strip in the mini map.
6. **Smooth Scroll:** The conversation panel smoothly scrolls to bring that turn into view, with a brief highlight pulse on the target turn bubble.
7. **Viewport Indicator Updates:** The translucent box repositions to reflect the new scroll position.

### 3.2 Secondary Flow — Drag the Viewport Indicator

1. User grabs the viewport indicator box in the mini map and drags it up or down.
2. The conversation panel scrolls in real time as the user drags.
3. On release, the scroll position is finalized.

### 3.3 Streaming Flow

1. A new assistant turn is streaming in.
2. A new strip is added to the bottom of the mini map with a pulsing animation.
3. If **Auto-scroll** is enabled (default), the viewport indicator follows to the bottom automatically.
4. If the user has manually scrolled up, auto-scroll is suspended and a **"Jump to latest ↓"** badge appears in the mini map footer.

### 3.4 Collapse / Expand Flow

1. User clicks the thin toggle strip (or presses `Alt+M`).
2. The mini map panel collapses with a smooth CSS transition to a ~12 px wide strip showing only the viewport indicator line.
3. Clicking the collapsed strip re-expands it.

---

## 4. Visual Design of the Mini Map Panel

### Panel Layout
```
┌─────────────────────────┬──────┐
│                         │  ↑   │  ← mini map panel (80px wide)
│   Conversation View     │ ███  │  ← user turn (blue strip)
│                         │      │
│   [Turn 1 - User]       │ ░░░░ │  ← viewport indicator box
│   [Turn 2 - AI]         │ ░███ │
│   [Turn 3 - User]       │ ░░░░ │
│   [Turn 4 - AI +tools]  │ ████ │  ← AI turn with tools (taller)
│   ...                   │ ███  │
│                         │ ▓▓▓  │  ← streaming turn (pulsing)
│                         │  ↓   │
└─────────────────────────┴──────┘
```

### Strip Color Coding
| Turn Type | Color |
|-----------|-------|
| User message | Blue (`#3b82f6`) |
| Assistant message | Green (`#22c55e`) |
| Assistant + tool calls | Amber (`#f59e0b`) — indicates tool activity |
| Streaming / in-progress | Pulsing blue-green gradient |
| Error / failed turn | Red (`#ef4444`) |
| Historical (resumed context) | Gray (`#6b7280`) |

### Strip Height Proportionality
- Strip height is **proportional to the turn's content length**, capped between a minimum of 4 px (so short turns are always clickable) and a maximum of 40 px.
- Tool-call timelines contribute to height.

### Viewport Indicator Box
- Semi-transparent overlay (white at 20% opacity with a 1 px border) showing current scroll position.
- Cursor changes to `ns-resize` on hover to invite dragging.

### Hover Tooltip
- Hovering a strip shows a small floating tooltip:  
  `[Role] Turn N · HH:MM` and the first ~60 chars of the message content.

---

## 5. Jump Navigation Landmarks

Beyond clicking any strip, the mini map includes **landmark markers** on its left edge for quick orientation:

| Marker | Meaning |
|--------|---------|
| ▶ (arrow) | First user message in the conversation |
| ★ (star) | Pinned / bookmarked messages (if user has bookmarked any) |
| ⚠ (warning) | Turns containing errors or failed tool calls |
| ⚡ (bolt) | Turns with significant tool activity (≥ 3 tool calls) |

Clicking a landmark marker jumps to that turn.

---

## 6. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| < 5 turns (short conversation) | Mini map hidden; toggle still available in ⋯ menu to force-show |
| Single very long turn (e.g., huge code block) | Strip height capped at 40 px; tooltip previews truncated content |
| Rapid streaming (many chunks/sec) | Mini map throttle-updates at ~10 fps to avoid jitter |
| Conversation re-loaded / history imported | Mini map re-renders from scratch; no stale state |
| Window resize crosses 900 px threshold | Mini map auto-collapses or expands with a transition |
| Dark / light theme switch | Strip colors adapt to theme via CSS variables |

---

## 7. Settings & Configuration

Accessible under CoC Dashboard → Settings (gear icon) → **Conversation**:

| Setting | Default | Description |
|---------|---------|-------------|
| Show conversation mini map | On | Display the mini map panel in conversation view |
| Mini map width | 80 px | Width of the expanded mini map panel (range: 60–120 px) |
| Auto-scroll to latest | On | Auto-follow new messages while streaming |
| Show landmark markers | On | Display ▶ ★ ⚠ ⚡ markers in the mini map |
| Mini map strip color scheme | Role-based | Alternate: Density (all same color, darker = more content) |

Settings are persisted in `~/.coc/preferences.json` (existing mechanism).

---

## 8. Discoverability

- **First Long Conversation:** When the user's conversation exceeds 5 turns for the first time in a session, a one-time **tooltip callout** appears pointing at the mini map: *"Use the mini map to navigate long conversations quickly."* Dismissed on click or after 5 s.
- **Keyboard Shortcut Hint:** The ⋯ menu item shows the `Alt+M` shortcut inline.
- **Empty State Help:** If the user manually hides the mini map and the conversation grows long, a small icon button (map icon) appears in the conversation toolbar to re-enable it.

---

## 9. Out of Scope (v1)

- Full-text search / filter within the mini map (separate feature)
- Annotations or inline comments on mini map strips
- Mini map for the process list / session sidebar
- Mobile/responsive layout below 600 px (dashboard is desktop-first)
