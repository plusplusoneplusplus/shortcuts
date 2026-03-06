# Plan: WebSocket Connection Status Indicator

## Problem
The AI Execution Dashboard web app has no visible indicator showing whether the WebSocket connection to the server is alive or disconnected. Users have no way to know their view is stale unless they manually refresh.

## Current State
- `useWebSocket` hook already tracks `WsStatus: 'connecting' | 'open' | 'closed'` (line 9, `useWebSocket.ts`)
- `App` destructures only `connect` from the hook, ignoring `status` (line 216, `App.tsx`)
- `TopBar` has no connection-related props or UI elements
- The hook has exponential backoff reconnection logic (1s → 30s max) but nothing is surfaced to the user

## Approach
Thread the WebSocket `status` through the existing React context and render a small status indicator in the TopBar, next to the admin/theme buttons.

### Changes

1. **`AppContext.tsx`** — Add `wsStatus: WsStatus` to `AppContextState`, add `SET_WS_STATUS` action, handle in reducer.

2. **`App.tsx`** — Destructure `status` from `useWebSocket`, dispatch `SET_WS_STATUS` on change via a `useEffect`.

3. **`TopBar.tsx`** — Read `wsStatus` from `useApp()`, render a small colored dot + tooltip:
   - 🟢 `open` → green dot, tooltip "Connected"
   - 🟡 `connecting` → yellow dot (pulsing animation), tooltip "Reconnecting…"
   - 🔴 `closed` → red dot, tooltip "Disconnected"

4. **Toast notification** — When status transitions from `open` → `closed`, show a warning toast "Connection lost — reconnecting…". When it transitions back to `open`, show a success toast "Reconnected". (Uses existing `useToast` in `AppInner`.)

### Visual Design
The indicator will appear in the TopBar's right-side control group (before the admin gear icon). It's a small 8px dot with a tooltip, consistent with the existing VS Code-inspired styling. The `connecting` state will use a CSS pulse animation.

## Todos

1. `ctx-ws-status` — Add `wsStatus` field + `SET_WS_STATUS` action to AppContext
2. `app-dispatch-status` — Sync WebSocket `status` into AppContext via useEffect in App.tsx
3. `topbar-indicator` — Render connection status dot in TopBar
4. `toast-notifications` — Show toast on disconnect/reconnect transitions
5. `tests` — Add/update tests for the new behavior
