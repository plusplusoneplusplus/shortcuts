# Add Scroll Support to Follow Prompt Menu

## Problem
When there are many prompt files in the "AI Action → Follow Prompt" submenu, the list grows beyond the screen and users cannot access items at the bottom. The current CSS uses `overflow: hidden` which clips content instead of allowing scrolling.

## Proposed Approach
Add CSS scroll support to the `.ai-action-submenu` container by changing `overflow: hidden` to `overflow-y: auto` and constraining the height with `max-height`.

## Files to Modify
- `src/shortcuts/markdown-comments/webview/webview.css` - Update submenu styling

## Workplan

- [x] Update `.ai-action-submenu` CSS in `webview.css`:
  - Change `overflow: hidden` to `overflow-y: auto`
  - Add `max-height: 60vh` (or similar) to trigger scroll when needed
  - Add custom scrollbar styling for VS Code theme consistency
- [x] Test with many prompt files to verify scroll behavior
- [x] Test that short lists still work correctly (no unnecessary scrollbar)

## Implementation Notes

**Current CSS (problematic):**
```css
.ai-action-submenu {
    overflow: hidden;  /* Blocks scrolling */
}
```

**Target CSS:**
```css
.ai-action-submenu {
    overflow-y: auto;
    max-height: 60vh;  /* Limit height, enable scroll */
}
```

**Scrollbar Styling (optional but recommended):**
```css
.ai-action-submenu::-webkit-scrollbar {
    width: 6px;
}
.ai-action-submenu::-webkit-scrollbar-thumb {
    background: var(--comment-border);
    border-radius: 3px;
}
```

## Considerations
- `60vh` provides good visibility while ensuring scroll triggers on smaller screens
- Scrollbar styling keeps it consistent with VS Code's theme
- No JavaScript changes required - pure CSS fix
