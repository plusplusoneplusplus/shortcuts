# Chat Bottom Buttons Cleanup

## Problem

In the chat conversation view (`RepoChatTab.tsx`), there are three buttons at the bottom of the chat area ("Resume", "Resume In Terminal", "New Chat") that are redundant with the top-level controls ("↻ Resume" in header, "New Chat" in sidebar). The user wants to:

1. **Remove** the "New Chat" button from the bottom action bar
2. **Remove** the "Resume" button from the bottom action bar
3. **Move** "Resume In Terminal" to the **top** header bar (next to the existing "↻ Resume" button)

## File

`packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

## Current Layout

### Header (line ~516–526)
```
[Chat]                              [↻ Resume]
```
- "↻ Resume" shows when `sessionExpired || taskFinished` and not streaming

### Bottom — session expired (line ~564–575)
```
        [Resume]  [Resume in Terminal]  [New Chat]
```

### Bottom — task finished (line ~594–606)
```
        [Resume]  [Resume in Terminal]  [New Chat]
```

## Target Layout

### Header
```
[Chat]                [Resume in Terminal]  [↻ Resume]
```
- "Resume in Terminal" shows alongside "↻ Resume" when `sessionExpired || taskFinished`

### Bottom — session expired
```
        (empty — show nothing, or just the text input area is hidden)
```
- Remove all three bottom buttons in the `sessionExpired` branch

### Bottom — task finished
```
        (no button bar)
```
- Remove the `taskFinished` button group entirely

## Changes

### 1. Add "Resume in Terminal" to the header (line ~518–525)
Insert a new `Button` for `handleResumeInTerminal` next to the existing "↻ Resume" button in the header `<div className="flex gap-2">` block. It should appear **before** the Resume button (leftmost = Resume in Terminal, rightmost = Resume). Show it under the same condition: `(sessionExpired || taskFinished) && !isStreaming`.

### 2. Remove bottom buttons in `sessionExpired` branch (line ~564–575)
Replace the three-button div with just a simple centered message like "Session expired" or keep the empty state — since the actions are now in the header.

### 3. Remove bottom buttons in `taskFinished` branch (line ~594–606)
Delete the entire `{taskFinished && (...)}` block containing the three buttons.

## Testing

- `npm run test:run` in `packages/coc/` to verify no test breakage
- Visual verification in the dashboard
