# Fix: Scroll-to-bottom button position shifts during scroll

## Problem

In the Queue detail view (`QueueTaskDetail.tsx`), the circular "↓" (scroll to bottom) button moves with the content as the user scrolls. It should stay fixed at the bottom-right corner of the visible scroll viewport.

## Root Cause

The button is positioned `absolute bottom-4 right-4` **inside** the scrollable container (`#queue-task-conversation`), which has `overflow-y: auto`. Because absolute positioning is relative to the nearest positioned ancestor (the same scrollable `div` with `relative`), the button becomes part of the scrolling content and shifts during scroll.

## Proposed Fix

Wrap the scrollable area and the button in a new `relative` container. Move the button **outside** the scrollable `div` so it stays fixed relative to the viewport of the wrapper, not the scrolling content.

**Before:**
```
<div id="queue-task-conversation" className="relative flex-1 min-h-0 overflow-y-auto p-4">
  {/* conversation content */}
  <button className="absolute bottom-4 right-4 ...">↓</button>
</div>
```

**After:**
```
<div className="relative flex-1 min-h-0">
  <div id="queue-task-conversation" className="flex-1 min-h-0 overflow-y-auto p-4 h-full">
    {/* conversation content */}
  </div>
  <button className="absolute bottom-4 right-4 ...">↓</button>
</div>
```

## Tasks

1. **~~Move button outside scrollable container~~** ✅
2. **~~Verify layout~~** ✅
3. **~~Run existing tests~~** ✅

## File

- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`
