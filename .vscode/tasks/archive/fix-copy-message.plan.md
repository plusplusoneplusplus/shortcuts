# Fix: Copy Response / Copy User Message Not Working

## Problem

The copy button (📋) on chat message bubbles (both user and assistant) silently fails to copy content to the clipboard. There is no visual feedback on success or failure, making it hard to diagnose. The root causes are:

1. **`navigator.clipboard` unavailable in non-secure contexts** — The Clipboard API requires `window.isSecureContext` (HTTPS or `localhost`). When the CoC server is accessed via a non-standard HTTP origin, `navigator.clipboard` is `undefined`. The current code uses optional chaining (`?.`) which silently no-ops.
2. **Silent error swallowing** — `.catch(() => {})` discards all errors with no user feedback.
3. **No success feedback** — Unlike the code-block copy button (which shows ✓), the bubble copy button gives no visual confirmation.
4. **User message content may be empty** — `turn.content` is used directly for non-raw mode; if a user turn stores content differently, copy produces an empty string.

## Affected File

`packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

Specifically the `onClick` handler on the `bubble-copy-btn` button (~line 607–610):
```typescript
onClick={() => {
    const text = showRaw ? buildRawContent(turn) : (turn.content || '');
    navigator.clipboard?.writeText(text).catch(() => {});
}}
```

## Proposed Fix

### 1. Extract a `copyToClipboard` utility

Create (or reuse if it exists) a shared utility at:
`packages/coc/src/server/spa/client/react/utils/clipboard.ts`

```typescript
/** Copies text to clipboard, falling back to execCommand for non-secure contexts. */
export async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    // Fallback for HTTP contexts
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (!ok) throw new Error('execCommand copy failed');
}
```

### 2. Update `ConversationTurnBubble.tsx` copy button

- Import and call `copyToClipboard`.
- Add a local `copied` state (boolean, auto-reset after 1.5s) for visual feedback.
- Show ✓ icon when `copied` is true, 📋 otherwise.
- Log or show a toast on failure (at minimum, log to console; ideally surface via existing toast system).

```typescript
const [copied, setCopied] = useState(false);

// in onClick:
onClick={async () => {
    const text = showRaw ? buildRawContent(turn) : (turn.content || '');
    try {
        await copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    } catch (e) {
        console.error('Copy failed:', e);
        // optionally: addToast('Copy failed', 'error') if toast context is available
    }
}}

// button label:
{copied ? '✓' : '📋'}
```

### 3. Verify user message content

Confirm that `turn.content` is populated for user turns. If user messages are stored differently (e.g., as the first element of a parts array), update the text extraction logic accordingly.

## Out of Scope

- Changes to code-block or table copy buttons (already working).
- Server-side changes.

## Tasks

1. Create `packages/coc/src/server/spa/client/react/utils/clipboard.ts` with `copyToClipboard` utility.
2. Update `ConversationTurnBubble.tsx`:
   - Add `copied` state.
   - Replace inline clipboard call with `copyToClipboard`.
   - Update button label to show `✓` on success.
   - Add error handling (console + optional toast).
3. Verify user message content extraction is correct.
4. Test in both secure (localhost) and potentially non-secure contexts.
5. Add/update unit tests if applicable.
