# Plan: Chat Tab — Inline Input & Send Button on Mobile

## Problem

In `RepoChatTab.tsx`, the follow-up input area uses `space-y-2` (vertical stacking) on mobile,
placing the Send button below the textarea. On desktop it correctly uses `flex items-end gap-2`
(horizontal row). The goal is to make both mobile and desktop share the same horizontal layout.

There are two input areas in `RepoChatTab.tsx`:
1. **Start screen** (`renderStartScreen`, ~line 680) — initial textarea + "Start Chat" button  
2. **Conversation screen** (`renderConversation`, ~line 882) — follow-up textarea + "Send" button

Only the **conversation/follow-up** area (area 2) needs the inline fix, as described by the user.
The start screen already has the textarea above and controls below — that layout is acceptable.

## Approach

Minimal targeted change to `RepoChatTab.tsx`:

### Change 1 — Wrapper div (line 880)

Remove the `isMobile` conditional on the flex layout so the row is always horizontal:

```tsx
// Before
<div className={isMobile ? "space-y-2" : "flex items-end gap-2 relative"}>

// After
<div className="flex items-end gap-2 relative">
```

### Change 2 — Send button (lines 915–927)

Remove the `isMobile` ternary that wraps the Send button in a separate `div` on mobile.
Both branches render the same button, so collapse to a single `<Button>`:

```tsx
// Before
{isMobile ? (
    <div className="flex items-center justify-between gap-2" data-testid="chat-followup-controls-row">
        <Button disabled={sending || !inputValue.trim()} onClick={() => void sendFollowUp()} className="ml-auto">
            {sending ? '...' : 'Send'}
        </Button>
    </div>
) : (
    <>
        <Button disabled={sending || !inputValue.trim()} onClick={() => void sendFollowUp()}>
            {sending ? '...' : 'Send'}
        </Button>
    </>
)}

// After
<Button disabled={sending || !inputValue.trim()} onClick={() => void sendFollowUp()}>
    {sending ? '...' : 'Send'}
</Button>
```

## Files Changed

| File | Lines |
|------|-------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | ~880, ~915–927 |

## Tests to Verify

- `packages/coc/test/spa/react/repos/RepoChatTab-newChatTrigger.test.tsx` — run after change
- Visually verify on narrow viewport that textarea and Send button are side by side

## Out of Scope

- Start screen layout (textarea + Start Chat button) — acceptable as-is
- Any other chat components (WikiAsk, RepoCopilotTab)
