# Plan: E2E AI-Generated Title Support

## Problem

The backend already generates an AI title (`process.title`) for each conversation via `generateTitleIfNeeded()` in `queue-executor-bridge.ts`. The `title` field is serialized and included in API responses. However, the frontend **ignores `process.title`** entirely — both the sidebar list and the detail header still use `promptPreview` (a dumb 80-char truncation) and `fullPrompt`.

## Goal

Surface the AI-generated title end-to-end: sidebar list, search/filter, and the detail page header.

## Scope

- **In:** Use `p.title` wherever the sidebar or detail page currently uses `promptPreview`  
- **In:** Include `title` in the sidebar search/filter text  
- **In:** Show a visual indicator (e.g., subtle "AI ✦" badge or italics) when a title is AI-generated vs. raw preview  
- **Out:** No backend changes — title generation is already correct  
- **Out:** No new API endpoints  
- **Out:** No change to title generation logic or model

## Approach

Three surgical changes to the SPA frontend, all in the `processes/` components:

### 1. `ProcessesSidebar.tsx` — List label (lines 261–263)

Change the `preview` computation to prefer `p.title` over `p.promptPreview`:

```diff
- const preview = p.promptPreview
-     ? (p.promptPreview.length > 80 ? p.promptPreview.slice(0, 80) + '…' : p.promptPreview)
-     : p.id;
+ const hasAITitle = Boolean(p.title);
+ const preview = p.title || (p.promptPreview
+     ? (p.promptPreview.length > 80 ? p.promptPreview.slice(0, 80) + '…' : p.promptPreview)
+     : p.id);
```

Render with optional indicator in the card:
```tsx
<div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 break-words">
    {preview}
    {hasAITitle && <span className="ml-1 text-[10px] text-[#848484]">✦</span>}
</div>
```

### 2. `ProcessesSidebar.tsx` — Search/filter (lines 93–96)

Include `title` in the searchable text so users can search by AI title:

```diff
- const title = (p.promptPreview || p.id || '').toLowerCase();
+ const title = (p.title || p.promptPreview || p.id || '').toLowerCase();
```

### 3. `ProcessDetail.tsx` — Detail header (lines 313–321)

Show AI title prominently above the full prompt, with a fallback to existing behavior:

```diff
+ {process.title && (
+     <div className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
+         {process.title}
+         <span className="ml-1 text-[11px] font-normal text-[#848484]">✦ AI title</span>
+     </div>
+ )}
  <div
      className="text-sm text-[#1e1e1e] dark:text-[#cccccc] break-words"
      dangerouslySetInnerHTML={{...}}
  />
```

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/ProcessesSidebar.tsx` | Use `p.title` in list label + search filter |
| `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx` | Show `process.title` as header when available |

## Testing

1. **Manual:** Run `coc serve`, submit a prompt, wait for task to complete, reload — sidebar should show AI title; detail header should show it prominently.
2. **Search:** Type part of the AI title in the search box — process should appear.
3. **Fallback:** For in-progress or old processes without a title, `promptPreview` should still render normally.
4. **Unit tests:** Update/add tests in `packages/coc/test/server/` to assert `title` field is included in process responses. Update SPA snapshot tests if any exist.

## Notes

- `title` is generated async after task completion — in-progress tasks will show `promptPreview` and update to AI title on next render/WebSocket update. No loading state needed.
- The `✦` indicator is optional/cosmetic — easy to remove if unwanted.
