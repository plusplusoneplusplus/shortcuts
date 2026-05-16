---
"@plusplusoneplusplus/coc": patch
---

Replace 🔁 emoji with a shared `LoopIcon` SVG (Heroicons arrow-path) in ChatListPane, LoopBadge, LoopManagementPanel, and ConversationTurnBubble. Color emoji ignored CSS `color` on most platforms, so the active (green) vs paused (amber) distinction was invisible; the SVG uses `stroke="currentColor"` and respects the wrapping element's `text-…` class.
