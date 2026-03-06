---
status: done
---

# 005: Workflow DAG & MarkdownReviewDialog E2E Tests

## Summary

Add Playwright e2e specs for two visual/overlay features that currently have zero e2e coverage: the WorkflowDAGChart (SVG-based pipeline DAG visualization with zoom/pan) and the MarkdownReviewDialog (modal opened from file-path links in process conversations, with minimize/restore lifecycle).

## Motivation

Both components are interactive overlays that can regress silently — the DAG chart involves SVG rendering, zoom/pan transforms, and dynamic node layouts, while the MarkdownReviewDialog involves a multi-step flow (click link → dialog opens → minimize → chip appears → restore). Unit tests exist for both (`WorkflowDAGChart.test.tsx`, `MarkdownReviewDialog.test.tsx`, `MarkdownReviewMinimizedChip.test.tsx`) but they test isolated rendering, not the real browser integration: actual SVG viewBox calculations, CSS-driven zoom transforms, custom event dispatch across components, scroll position persistence, and the global `coc-open-markdown-review` event flow from `file-path-preview.ts` through `App.tsx`. Grouping them in one commit is justified because each spec is ~60-80 lines and they share no fixtures.

## Changes

### Files to Create

- **`packages/coc/test/e2e/workflow-dag.spec.ts`** — E2E tests for the WorkflowDAGChart rendered inside the Repos → Pipelines → View flow. Tests that a workflow-type YAML (containing `nodes` object) produces the DAG SVG with expected nodes, edges, and interactive zoom controls.

- **`packages/coc/test/e2e/markdown-review-dialog.spec.ts`** — E2E tests for the MarkdownReviewDialog opened by clicking a `.file-path-link` in a process conversation bubble. Tests the full lifecycle: open → display content → minimize → chip appears → restore → close.

### Files to Modify

- None

### Files to Delete

- None

## Implementation Notes

### WorkflowDAGChart — Fixture & Navigation

**How to reach the DAG:** The WorkflowDAGChart is rendered inside `PipelineDAGPreview` (testid: `pipeline-dag-preview`), which is a child of `PipelineDetail`. The navigation path is:

1. Seed a workspace via `seedWorkspace(serverUrl, 'ws-dag-1', 'dag-repo', repoDir)` pointing to a temp fixture dir
2. The fixture dir must contain `.vscode/pipelines/<name>/pipeline.yaml` with a workflow-type YAML
3. Navigate: `page.goto(serverUrl)` → click `[data-tab="repos"]` → click `.repo-item` → click `.repo-sub-tab[data-subtab="pipelines"]` → click View button on pipeline item

**Workflow YAML fixture (must have `nodes` object, not linear phases):**

```yaml
nodes:
  load_data:
    type: load
    source: data.csv
  filter_rows:
    type: filter
    from: [load_data]
    rules:
      - field: status
        operator: equals
        value: active
  map_items:
    type: map
    from: [filter_rows]
    prompt: "Summarize: {{item}}"
  reduce_results:
    type: reduce
    from: [map_items]
    type: ai
    prompt: "Combine all summaries"
```

This YAML triggers `buildPreviewDAG()` to return `{ type: 'workflow', data: WorkflowPreviewData }`, which renders `WorkflowDAGChart` instead of `PipelineDAGChart`.

**Fixture creation pattern** (follow `repos.spec.ts` line 601):

```typescript
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dag-'));
const pipeDir = path.join(tmpDir, '.vscode', 'pipelines', 'workflow-test');
fs.mkdirSync(pipeDir, { recursive: true });
fs.writeFileSync(path.join(pipeDir, 'pipeline.yaml'), workflowYaml);
```

**Key selectors:**

| Element | Selector |
|---------|----------|
| DAG container | `[data-testid="workflow-dag-container"]` |
| SVG chart | `[data-testid="workflow-dag-chart"]` |
| Individual node | `[data-testid="workflow-node-load_data"]` |
| Zoom controls | `[data-testid="zoom-controls"]` |
| Zoom label | `[data-testid="zoom-label"]` |
| Zoom in button | `[data-testid="zoom-controls"] button[title="Zoom in"]` |
| Zoom out button | `[data-testid="zoom-controls"] button[title="Zoom out"]` |
| Reset button | `[data-testid="zoom-controls"] button[title="Reset zoom"]` |
| Fit button | `[data-testid="zoom-controls"] button[title="Fit to view"]` |
| Pipeline preview | `[data-testid="pipeline-dag-preview"]` |

**SVG verification:** Assert that the `<svg>` has a `viewBox` attribute with positive dimensions. Assert `<g transform="...">` exists inside for the zoom/pan group. Verify node `<rect>` elements and `<title>` elements contain expected type labels.

**Zoom interaction:** Click the "Zoom in" button, then assert the `zoom-label` text changes from the default `100%`. Click "Reset zoom" and verify it returns to `100%`.

### MarkdownReviewDialog — Trigger & Lifecycle

**How to trigger the dialog:** Clicking a `.file-path-link` span in a chat bubble dispatches a `coc-open-markdown-review` CustomEvent (handled in `file-path-preview.ts` line 489). The `App.tsx` listener opens `MarkdownReviewDialog` with the resolved `wsId` + `filePath`.

**Prerequisites:**
1. A workspace must exist (dialog renders `null` without `wsId`)
2. A process with conversation containing a file path must exist
3. The file preview API must be mocked to return content

**Seeding pattern:**

```typescript
// 1. Seed a workspace
await seedWorkspace(serverUrl, 'ws-md-1', 'review-ws', '/projects/review-ws');

// 2. Seed a queue task with a file path in the prompt
mockAI.mockSendMessage.mockResolvedValueOnce({
    success: true,
    response: 'I reviewed /projects/review-ws/docs/README.md and found issues.',
    sessionId: 'sess-md-1',
});

const task = await seedQueueTask(serverUrl, {
    payload: { prompt: 'Review the docs' },
});

// 3. Mock workspace API so dialog can resolve wsId
await page.route('**/api/workspaces', (route) =>
    route.fulfill({
        status: 200,
        body: JSON.stringify({
            workspaces: [{ id: 'ws-md-1', name: 'review-ws', root: '/projects/review-ws' }],
        }),
        contentType: 'application/json',
    }),
);

// 4. Mock file content API for the MarkdownReviewEditor
await page.route('**/api/workspaces/*/files/content*', (route) =>
    route.fulfill({
        status: 200,
        body: JSON.stringify({ content: '# README\n\nHello world\n' }),
        contentType: 'application/json',
    }),
);

// Also mock the tasks endpoint (fetchMode: 'tasks'|'auto')
await page.route('**/api/workspaces/*/tasks*', (route) =>
    route.fulfill({
        status: 200,
        body: JSON.stringify({ tasks: [] }),
        contentType: 'application/json',
    }),
);
```

**Triggering the dialog:**

```typescript
// Navigate to conversation
await page.goto(`${serverUrl}/#process/queue_${taskId}`);
await page.waitForSelector('#detail-panel.chat-layout', { timeout: 8_000 });
await waitForBubbles(page, 2); // user + assistant

// Click the file-path-link in the assistant bubble
const link = page.locator('.chat-message.assistant .file-path-link');
await expect(link).toHaveCount(1);
await link.click();
```

**Key selectors for dialog lifecycle:**

| Element | Selector |
|---------|----------|
| Dialog (open) | `dialog[open]` or `[role="dialog"]` |
| Minimize button | `[data-testid="markdown-review-minimize-btn"]` |
| Close button | `button[aria-label="Close"]` |
| Minimized chip | `[data-testid="minimized-chip"]` |
| Chip restore button | `[data-testid="minimized-chip-restore"]` |
| Chip restore icon | `[data-testid="minimized-chip-restore-icon"]` |
| Chip close button | `[data-testid="minimized-chip-close"]` |

**Minimize/restore flow:**
1. Click `[data-testid="markdown-review-minimize-btn"]` → dialog disappears
2. Assert `[data-testid="minimized-chip"]` is visible
3. Assert chip text contains the filename (e.g., `README.md`)
4. Click `[data-testid="minimized-chip-restore"]` → dialog reappears
5. (Scroll position restoration is internal state — hard to assert in e2e, skip)

**Close flow:**
1. Click `button[aria-label="Close"]` → dialog disappears
2. Assert `[data-testid="minimized-chip"]` is NOT visible (close ≠ minimize)

## Tests

### workflow-dag.spec.ts

1. **`workflow YAML renders WorkflowDAGChart with expected nodes`** — Seed workspace with workflow YAML fixture. Navigate to Repos → Pipelines → View. Assert `[data-testid="workflow-dag-container"]` is visible. Assert `[data-testid="workflow-dag-chart"]` SVG element exists. Assert `[data-testid^="workflow-node-"]` count matches the number of nodes in the YAML (4 nodes).

2. **`each workflow node displays correct type label`** — For each seeded node, assert the SVG `<title>` element contains the expected label and type string (e.g., `load_data (load)`, `filter_rows (filter)`).

3. **`zoom controls are visible and functional`** — Assert `[data-testid="zoom-controls"]` is visible. Assert `[data-testid="zoom-label"]` shows `100%`. Click "Zoom in" → assert label changes (e.g., `110%` or `120%`). Click "Reset zoom" → assert label returns to `100%`.

4. **`fit-to-view adjusts zoom level`** — Click "Zoom in" twice to change zoom. Click "Fit to view" → assert the zoom label changes to a value that is not `100%` (fit recalculates based on container vs content size).

5. **`DAG container supports drag cursor`** — Assert `[data-testid="workflow-dag-container"]` has `cursor: grab` style. (Pan interaction is hard to verify in e2e beyond cursor state.)

### markdown-review-dialog.spec.ts

6. **`clicking file-path-link opens MarkdownReviewDialog`** — Seed workspace + queue task with file path in assistant response. Mock workspace and file content APIs. Navigate to conversation. Click `.file-path-link`. Assert dialog is visible (e.g., `dialog[open]` or the dialog container is in the DOM). Assert dialog title contains the filename.

7. **`minimize button hides dialog and shows chip`** — Open dialog via file-path-link click. Click `[data-testid="markdown-review-minimize-btn"]`. Assert dialog is hidden. Assert `[data-testid="minimized-chip"]` is visible. Assert chip text contains the filename.

8. **`restore from chip reopens the dialog`** — Open dialog → minimize → click `[data-testid="minimized-chip-restore"]`. Assert dialog is visible again. Assert `[data-testid="minimized-chip"]` is hidden.

9. **`close button fully dismisses dialog without chip`** — Open dialog → click Close (`button[aria-label="Close"]`). Assert dialog is hidden. Assert `[data-testid="minimized-chip"]` is NOT in the DOM.

10. **`chip close button dismisses both chip and dialog`** — Open dialog → minimize (chip visible) → click `[data-testid="minimized-chip-close"]`. Assert chip is hidden. Re-checking for dialog also hidden.

## Acceptance Criteria

- [x] `workflow-dag.spec.ts` has 5 passing tests covering DAG rendering, node types, and zoom controls
- [x] `markdown-review-dialog.spec.ts` has 5 passing tests covering open, minimize, restore, and close flows
- [x] All tests use existing seed helpers (`seedWorkspace`, `seedQueueTask`, `seedConversationTurns`) — no new fixture helpers
- [x] All tests use `data-testid` selectors where available, falling back to `aria-label` or CSS class selectors from existing patterns
- [x] Workflow YAML fixture is a valid multi-node DAG (not linear pipeline) so `buildPreviewDAG` returns `type: 'workflow'`
- [x] Tests clean up temp directories in `finally` blocks (follow `repos.spec.ts` pattern with `safeRmSync`)
- [x] All 10 tests pass on CI across Linux, macOS, and Windows
- [x] No modifications to production source code

## Dependencies

- Depends on: None (independent)

## Assumed Prior State

None — uses existing fixtures only. The `seedWorkspace`, `seedQueueTask`, and `seedConversationTurns` helpers in `packages/coc/test/e2e/fixtures/seed.ts` provide all necessary seeding. The `server-fixture.ts` provides `serverUrl`, `mockAI`, and `page` via Playwright test fixtures. CDN stubs for highlight.js and mermaid are already handled by the fixture.
