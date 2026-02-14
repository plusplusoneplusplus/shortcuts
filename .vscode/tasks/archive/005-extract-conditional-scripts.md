---
status: pending
---

# 005: Extract conditional script modules (graph, ask-ai, websocket)

## Summary
Extract the three feature-gated script sections — dependency graph (D3.js), Ask AI widget, and WebSocket live reload — into separate modules with explicit enable/disable control.

## Motivation
These sections are conditionally included based on `opts.enableGraph`, `opts.enableAI`, and `opts.enableWatch`. Each is large (graph: ~220 lines, ask-ai: ~390 lines, websocket: ~60 lines) and self-contained. Extracting them makes it trivial to add new optional features following the same pattern in the future.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/scripts/graph.ts` — Exports `getGraphScript(): string`. Contains: `getCategoryColor()`, `showGraph()`, `renderGraph()` (D3 force simulation), `updateGraphVisibility()`, drag handlers. Returns empty string when not used (the caller decides whether to include it). (Lines ~2008-2226)
- `packages/deep-wiki/src/server/spa/scripts/ask-ai.ts` — Exports `getAskAiScript(): string`. Contains: `updateAskSubject()`, `expandWidget()`, `collapseWidget()`, `askPanelSend()`, SSE streaming, `appendAskMessage()`, `appendAskAssistantStreaming()`, `updateAskAssistantStreaming()`, `appendAskContext()`, `appendAskTyping()`, `appendAskError()`, `addDeepDiveButton()`, `toggleDeepDiveSection()`, `startDeepDive()`, `finishDeepDive()`, deep-dive SSE streaming. (Lines ~2228-2617)
- `packages/deep-wiki/src/server/spa/scripts/websocket.ts` — Exports `getWebSocketScript(): string`. Contains: `connectWebSocket()`, `handleWsMessage()`, WebSocket reconnection logic. (Lines ~2619-2679)

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — In `getSpaScript()`, replace the three conditional blocks with:
  ```
  ${opts.enableGraph ? getGraphScript() : ''}
  ${opts.enableAI ? getAskAiScript() : ''}
  ${opts.enableWatch ? getWebSocketScript() : ''}
  ```
  The conditional wrapping stays in the assembler, not inside the modules themselves.

## Implementation Notes
- **Conditional inclusion pattern**: Each module returns its full JS string unconditionally. The assembler (`getSpaScript()`) decides whether to include it based on opts. This keeps modules pure and testable in isolation.
- **Ask AI is the largest section** (~390 lines). It includes both the Ask panel and Deep Dive functionality. These could be further split in the future, but keeping them together for now since they share streaming utilities.
- **Graph module** depends on D3.js being loaded via CDN `<script>` tag in the HTML head (conditional on `enableGraph`). The HTML template handles this.
- **WebSocket module** uses the browser-native `WebSocket` API — no external dependencies.
- **Cross-references from Ask AI**: calls `loadModule()` (from content), `escapeHtml()` (from core), `marked.parse()` and `hljs.highlightElement()` (external libs). All available in global scope.

## Tests
- No new tests needed — `ask-panel.test.ts`, `deep-dive-ui.test.ts`, and `dependency-graph.test.ts` already verify these sections
- Run full test suite

## Acceptance Criteria
- [ ] Three new files created in `spa/scripts/`
- [ ] Each returns its complete JS string
- [ ] Conditional inclusion handled by the caller, not the module
- [ ] Generated HTML output is byte-identical to before
- [ ] All existing tests pass unchanged

## Dependencies
- Depends on: 004 (content/markdown extracted; ask-ai calls functions from content)
