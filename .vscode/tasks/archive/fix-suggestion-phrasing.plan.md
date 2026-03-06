# Implementation Plan: Fix Follow-Up Suggestion Phrasing

**Branch**: `fix-followup-suggestion-phrasing`  
**Feature**: CoC Chat — Follow-Up Suggestions

---

## Summary

Follow-up suggestions in the CoC chat page are currently phrased as **questions** (e.g., "How can a queued chat task be cancelled?"). The expected behavior is suggestions phrased as **actionable options** the user can click to continue the conversation (e.g., "Show the cancellation API", "Explain the config options"). The fix updates the `suggest_follow_ups` tool description and the `countSuffix` prompt suffix so the AI generates imperative action phrases instead of questions.

---

## Technical Context

**Language/Version**: TypeScript (strict mode)  
**Primary Dependencies**: `@plusplusoneplusplus/pipeline-core` (defineTool), `coc-server`, Copilot SDK  
**Storage**: N/A  
**Testing**: Vitest (`npm run test:run` in package dirs)  
**Target Platform**: Node.js (CoC server + coc-server package)  
**Performance Goals**: N/A (string-only change)  
**Constraints**: Must not change the tool's JSON schema shape or handler logic — only description strings  
**Scale/Scope**: 2 files, 3 string changes

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| User Experience First | ✅ PASS | Change improves UX: actionable options are clearer than questions |
| Cross-Platform Support | ✅ PASS | No platform-specific logic touched |
| Type Safety and Quality | ✅ PASS | No type changes; existing tests remain valid |
| ESLint / compile | ✅ PASS | String-only edits; no new lint surface |

---

## Files to Change

```
packages/coc-server/src/suggest-follow-ups-tool.ts   ← tool description strings
packages/coc/src/server/queue-executor-bridge.ts      ← countSuffix prompt string
```

---

## Changes

### 1. `packages/coc-server/src/suggest-follow-ups-tool.ts`

**Tool description** (currently says "follow-up questions"):
```diff
- description:
-   'After completing your response, call this tool to suggest 2-3 brief follow-up questions the user might want to ask next. Each suggestion should be a concise, actionable question directly related to the conversation context.',
+ description:
+   'After completing your response, call this tool to suggest 2-3 brief follow-up actions the user might want to take next. Each suggestion should be a short, direct action phrase (imperative, not a question) that continues the conversation — e.g., "Show an example", "Explain the config options", "Generate the fix".',
```

**Parameter description** (currently says "questions the user might ask"):
```diff
- description: '2-3 short follow-up questions the user might ask next',
+ description: '2-3 short follow-up action phrases the user might take next (imperative, not questions)',
```

### 2. `packages/coc/src/server/queue-executor-bridge.ts`

**`countSuffix`** (currently says "provide exactly N suggestions"):
```diff
- `\n\nWhen suggesting follow-ups, provide exactly ${this.followUpSuggestions.count} suggestions.`
+ `\n\nWhen suggesting follow-ups, provide exactly ${this.followUpSuggestions.count} suggestions. Each suggestion must be a short imperative action phrase (not a question), for example: "Show me an example", "Explain the retry config", "Generate the fix".`
```

---

## Project Structure

```
packages/
├── coc-server/src/suggest-follow-ups-tool.ts   ← 2 string changes
└── coc/src/server/queue-executor-bridge.ts      ← 1 string change
```

---

## Verification

1. Build: `npm run build` — must compile without errors
2. Test: `cd packages/coc-server && npm run test:run` and `cd packages/coc && npm run test:run`
3. Manual smoke test: open CoC chat page, send a message, confirm chips are phrased as action phrases (imperative) not questions

---

## Out of Scope

- Making suggestion style configurable (question vs action) — can be a follow-up
- Fixing the rendering bug (chips not showing) — separate issue; the phrasing fix is independent
