# UX Specification: Improve Chat Input Bar on Mobile

## 1. User Story

**As a** developer using the CoC dashboard on a mobile device (phone or narrow tablet),  
**I want** the chat follow-up input bar and new-chat form to be comfortably usable on a small screen,  
**So that** I can type messages, switch models, and initiate or continue AI conversations without fighting a cramped UI.

---

## 2. Entry Points

The affected UI surfaces are accessed within the CoC dashboard SPA (served by `coc serve`):

- **Follow-up chat input bar** — visible at the bottom of any active repo chat session. Appears after a chat is started; used to send follow-up messages.
- **New-chat form** — visible when opening a chat tab for a repository for the first time (no active session). Contains a read-only toggle, model selector, and Start Chat button.
- **Image previews** — shown above the input bar when the user attaches images. Each preview has a remove (×) button.
- **Suggestion chips** — shown above the input bar as quick-action prompts.

---

## 3. User Flow

### 3a. Follow-up Chat on Mobile

**Initial state:** User has an active chat session open on a ~375px wide screen.

1. User taps the chat input area at the bottom of the screen.
2. The virtual keyboard rises, viewport adjusts via `useVisualViewport` padding.
3. **Expected layout:**
   - **Row 1 (top):** Textarea spans the full width of the container. User can type freely with ample visible space.
   - **Row 2 (bottom):** Model badge is left-aligned; Send button is right-aligned. Both are easily tappable.
4. User types a message and taps Send.
5. Message is submitted; input clears; response begins streaming.

**Success state:** The textarea is wide enough to display a meaningful amount of text (~30+ characters visible); the Send button is always reachable without scrolling.

---

### 3b. New-Chat Form on Mobile

**Initial state:** User opens a repo chat tab with no active session.

1. The new-chat form is displayed.
2. **Expected layout:**
   - **Row 1:** Read-only checkbox and model `<select>` share a row, taking available width.
   - **Row 2:** Start Chat button spans full width (or is right-aligned) and is prominently tappable.
3. User selects a model (or leaves default), optionally toggles read-only, and taps Start Chat.
4. Chat session begins.

**Success state:** No element is cut off or requires horizontal scrolling.

---

### 3c. Image Preview Remove Buttons on Mobile

**Initial state:** User has attached one or more images; previews are shown above the input.

1. User decides to remove an image.
2. On desktop, the × button appears on hover. On mobile, there is no hover — the button must always be visible.
3. User taps the × button; the image is removed.

**Success state:** The × button is visible at all times on touch devices and has a tap target large enough (~44px) to tap accurately.

---

### 3d. Suggestion Chips on Mobile

**Initial state:** Suggestion chips are displayed above the input bar.

1. On mobile, chips wrap to multiple lines rather than overflowing off-screen.
2. No horizontal scroll is required.
3. The input bar below the chips is not pushed out of the viewport.

**Success state:** All chips are reachable without horizontal scrolling; the input bar remains visible and accessible.

---

## 4. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|---|---|
| Very long model badge text | Badge truncates with ellipsis; does not push Send button off-screen |
| Many suggestion chips | Chips wrap; input bar is not displaced; page scrolls if needed rather than overflowing |
| Slow network while submitting | Send button shows loading state; user cannot double-submit |
| No images attached | Image preview row does not appear; no blank space above input |
| Textarea grows tall with multi-line input | Layout remains stable; Send button stays accessible (sticky or scrollable) |
| Keyboard open + layout shift | `useVisualViewport` padding adjusts correctly with two-row layout |
| SlashCommandMenu trigger | Menu appears above the textarea regardless of two-row layout; does not overlap Send button |

---

## 5. Visual Design Considerations

### Follow-up Input Bar (Mobile)
```
┌────────────────────────────────┐
│  [Textarea — full width      ] │  ← Row 1
│  [claude-sonnet-4.6]  [Send →] │  ← Row 2
└────────────────────────────────┘
```

### Follow-up Input Bar (Desktop — unchanged)
```
┌──────────────────────────────────────────┐
│  [Textarea       ] [badge] [Send →]       │  ← Single row
└──────────────────────────────────────────┘
```

### New-Chat Form (Mobile)
```
┌────────────────────────────────┐
│  [☐ Read-only] [Model ▾     ] │  ← Row 1
│  [    Start Chat    →        ] │  ← Row 2
└────────────────────────────────┘
```

### Image Preview Remove Button
- **Desktop:** `×` hidden by default, revealed on hover (`group-hover:opacity-100`)
- **Mobile:** `×` always visible (`opacity-100`), no hover state needed

### Suggestion Chips
- Chips use `flex-wrap` so they reflow to additional lines on narrow screens
- No horizontal scroll bar appears

**Icons / Buttons:**
- No new icons required
- Send button tap target should meet minimum 44×44px guideline
- × (remove image) button tap target should be at least 32×32px

---

## 6. Settings & Configuration

No new user-configurable settings are introduced. The layout change is automatic and triggered by the existing `useBreakpoint` hook (`isMobile`). The breakpoint threshold follows the existing convention in the codebase.

---

## 7. Discoverability

This is a passive improvement — users on mobile simply experience a better layout without needing to learn anything new. No onboarding, tooltip, or announcement is needed. The change is self-evident: the input bar looks correct and comfortable on small screens.
