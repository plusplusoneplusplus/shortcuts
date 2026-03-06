# Bug Fix: "+ New Chat" From Non-Chat Tab Opens Old Chat

## Problem

When the user clicks the "+ New Chat" button while on any tab other than Chat (e.g. Info, Git, Queue), the app correctly navigates to the Chat tab but displays the **previously active chat session** instead of a blank new chat.

## Root Cause

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — line 397

```tsx
const prevTriggerRef = useRef(newChatTrigger ?? 0);
```

`RepoChatTab` is conditionally rendered only when the Chat sub-tab is active:

```tsx
{activeSubTab === 'chat' && <RepoChatTab ... newChatTrigger={newChatTrigger} />}
```

This means whenever the user is on a different tab, `RepoChatTab` is **unmounted**. The sequence when clicking "+ New Chat" from another tab:

1. `newChatTrigger` counter in `RepoDetail` increments: `N → N+1`
2. `switchSubTab('chat')` causes `RepoChatTab` to **mount fresh** with `newChatTrigger = N+1`
3. `prevTriggerRef` initialises to `useRef(N+1)` — the **already-incremented** value
4. The guard in `useEffect`: `N+1 !== prevTriggerRef.current (N+1)` → **false** → `handleNewChat()` is never called
5. Component mounts and restores the previous chat session from state/URL

When the user is **already on the Chat tab** (component stays mounted), `prevTriggerRef.current` is `N` at the time of the click, so `N+1 !== N` → the effect fires correctly. This is why the bug only manifests from other tabs.

## Proposed Fix

Lift `prevTriggerRef` out of `RepoChatTab` and into `RepoDetail` so it **persists across Chat tab mount/unmount cycles**.

### Changes

#### `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

Add a persistent ref and pass it to `RepoChatTab`:

```tsx
// Near existing newChatTrigger state
const [newChatTrigger, setNewChatTrigger] = useState(0);
const newChatTriggerProcessedRef = useRef(0);   // ← add this

// In JSX (line ~204)
<RepoChatTab
    workspaceId={ws.id}
    workspacePath={ws.rootPath}
    initialSessionId={state.selectedChatSessionId}
    newChatTrigger={newChatTrigger}
    newChatTriggerProcessedRef={newChatTriggerProcessedRef}   // ← add this
/>
```

#### `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Accept the new prop and use it instead of the local ref:

```tsx
interface RepoChatTabProps {
    workspaceId: string;
    workspacePath?: string;
    initialSessionId?: string | null;
    newChatTrigger?: number;
    newChatTriggerProcessedRef?: React.MutableRefObject<number>;  // ← add
}
```

Replace the local ref initialisation (line 397):

```tsx
// Before
const prevTriggerRef = useRef(newChatTrigger ?? 0);

// After
const localTriggerRef = useRef(0);
const prevTriggerRef = newChatTriggerProcessedRef ?? localTriggerRef;
```

The `useEffect` body (lines 398–403) requires **no changes** — it already updates `prevTriggerRef.current` after calling `handleNewChat()`.

### Why This Works

| Scenario | Before fix | After fix |
|---|---|---|
| Click "+ New Chat" while on Chat tab (component stays mounted) | ✅ works | ✅ works |
| Click "+ New Chat" from another tab (component remounts) | ❌ `prevTriggerRef` initialises to `N+1`, effect skipped | ✅ parent ref holds `N`, effect fires |
| Navigate back to Chat tab normally (no button click) | ✅ no unintended reset | ✅ parent ref already at `N+1`, `N+1 !== N+1` → no reset |

## Affected Files

| File | Change |
|---|---|
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Add `newChatTriggerProcessedRef`, pass as prop |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Accept prop, replace local `useRef(newChatTrigger ?? 0)` with parent ref |

## Out of Scope

- No changes to server-side logic
- No changes to chat session creation (`POST /queue`)
- No changes to routing or URL hash handling
