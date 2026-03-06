---
status: pending
---

# 002: Pipeline Run History & Result Card in Pipelines Tab

## Summary
Move the primary pipeline execution experience into the Pipelines tab. After clicking "Run", the user stays on the Pipelines tab and sees run history appear inline below the YAML editor, with a rich `PipelineResultCard` showing execution stats, mermaid diagrams, and formatted output. The Queue tab continues to show pipeline tasks for operational awareness but is no longer the primary destination.

## Motivation
Currently, running a pipeline auto-navigates to the Queue tab, where pipeline tasks are mixed with chat tasks in an undifferentiated list. This breaks the pipeline-centric workflow. Users should be able to: see the pipeline definition → run it → see results — all without leaving the Pipelines tab. Chat already has its own dedicated tab; pipelines deserve the same treatment.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/repos/PipelineRunHistory.tsx` — New component showing a list of past runs for the selected pipeline, with status badges, timestamps, durations, and click-to-expand detail
- `packages/coc/src/server/spa/client/react/processes/PipelineResultCard.tsx` — New component rendering pipeline-specific result content (header with name + status, stats grid, markdown result with mermaid support)
- `packages/coc/test/spa/react/PipelineRunHistory.test.tsx` — Tests for run history list
- `packages/coc/test/spa/react/PipelineResultCard.test.tsx` — Tests for result card

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/PipelinesTab.tsx` — Remove auto-navigation to Queue tab on run success. Instead, refresh the run history list inline. Pass pipeline name to `PipelineRunHistory`.
- `packages/coc/src/server/spa/client/react/repos/PipelineDetail.tsx` — Add `PipelineRunHistory` section below the YAML content area. Change `onRunSuccess` behavior from navigation to refreshing the history list.
- `packages/coc/src/server/queue-handler.ts` — Extend `GET /api/queue/history` to accept optional `pipelineName` and `taskType` query parameters for filtering.
- `packages/coc/src/server/queue-executor-bridge.ts` — Store `pipelineName` in task metadata at creation time (not just in the result after execution), so it's available for filtering before the run completes.

### Files to Delete
- (none)

## Implementation Notes

### PipelinesTab.tsx changes

**Remove auto-navigation (lines 38–41):**
Replace `handleRunSuccess` — instead of dispatching `SET_REPO_SUB_TAB` to 'queue' and changing `location.hash`, trigger a history refresh:
```typescript
const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

const handleRunSuccess = () => {
    setHistoryRefreshKey(k => k + 1); // triggers PipelineRunHistory re-fetch
};
```

### PipelineDetail.tsx changes

**Add run history section below YAML content area (after line ~164):**
```tsx
{/* Run History */}
<PipelineRunHistory
    workspaceId={workspaceId}
    pipelineName={pipeline.name}
    refreshKey={refreshKey}  // passed from parent via new prop
/>
```

**New prop:**
```typescript
export interface PipelineDetailProps {
    workspaceId: string;
    pipeline: PipelineInfo;
    onClose: () => void;
    onDeleted: () => void;
    onRunSuccess?: () => void;
    refreshKey?: number;  // NEW — incremented to trigger history re-fetch
}
```

### PipelineRunHistory.tsx (new component)

**Props:**
```typescript
interface PipelineRunHistoryProps {
    workspaceId: string;
    pipelineName: string;
    refreshKey?: number;  // triggers re-fetch when incremented
}
```

**Data fetching:**
```typescript
// Fetch history filtered by pipeline name
const data = await fetchApi(
    `/queue/history?repoId=${encodeURIComponent(workspaceId)}&pipelineName=${encodeURIComponent(pipelineName)}`
);
```

Also subscribe to WebSocket `queue-updated` events to show newly running/queued tasks in real-time.

**Component structure:**
```
<div>
  <h3>Run History</h3>
  <div className="space-y-2">
    {/* Running/queued tasks for this pipeline (from WebSocket queue state) */}
    {activeTasks.map(task => (
        <RunHistoryItem key={task.id} task={task} status="running" />
    ))}

    {/* Completed history (from API) */}
    {history.map(task => (
        <RunHistoryItem key={task.id} task={task} />
    ))}
  </div>

  {/* Expandable detail: PipelineResultCard */}
  {selectedTask && (
      <PipelineResultCard process={selectedProcess} />
  )}
</div>
```

**RunHistoryItem** (inline or sub-component): Shows status icon (✅/❌/🔄/⏳), timestamp, duration, and item count summary. Clicking expands to show the `PipelineResultCard`.

**Empty state:** "No runs yet. Click ▶ Run to execute this pipeline."

### PipelineResultCard.tsx (new component)

**Props interface:**
```typescript
interface PipelineResultCardProps {
    process: any;
    className?: string;
}
```

**Metadata access pattern** (follows `ConversationMetadataPopover.tsx` line 49–89):
- `process.metadata?.pipelineName` — pipeline display name
- `process.metadata?.executionStats` — `{ totalItems, successfulMaps, failedMaps, mapPhaseTimeMs, reducePhaseTimeMs, maxConcurrency }`
- `process.result` — formatted output string (markdown, may contain mermaid blocks)
- `process.status` — 'completed' | 'failed' | 'running' etc.

**Component structure:**
```
Card (from shared/Card.tsx)
├── Header div
│   ├── Pipeline name (metadata.pipelineName || 'Pipeline Execution')
│   ├── Badge (from shared/Badge.tsx) showing status
│   └── Duration (formatDuration)
├── Stats grid (only if metadata.executionStats exists)
│   ├── Total Items
│   ├── Successful
│   ├── Failed
│   ├── Success Rate (computed: successfulMaps/totalItems * 100)
│   ├── Map Phase time (formatDuration)
│   └── Concurrency
├── Result content
│   └── MarkdownView (from ./MarkdownView.tsx)
│       rendered via renderMarkdownToHtml(process.result)
│       (mermaid blocks handled automatically)
└── Copy button (reuse copyToClipboard)
```

**Mermaid rendering:** Wrap card content in a `useRef<HTMLDivElement>` and call `useMermaid(cardRef, process.result)`. The `MarkdownView` component does NOT call `useMermaid` internally, so it must be called at the `PipelineResultCard` level.

**Stats grid styling** — mirrors `result-viewer-content.ts` lines 178–200:
```
grid grid-cols-3 gap-2 text-xs
```
Each stat cell: `rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center`

**Graceful degradation:**
- No `metadata.pipelineName` → show "Pipeline Execution" as title
- No `metadata.executionStats` → hide stats grid entirely
- No `process.result` → show "No output available." placeholder
- No mermaid blocks → `useMermaid` is a no-op

### queue-handler.ts changes

**Extend GET /api/queue/history (lines 616–642):**
Add optional query params `pipelineName` and `taskType`:
```typescript
const pipelineName = typeof parsed.query.pipelineName === 'string' ? parsed.query.pipelineName : undefined;
const taskType = typeof parsed.query.taskType === 'string' ? parsed.query.taskType : undefined;

// After fetching history, filter:
if (pipelineName) {
    history = history.filter(t =>
        t.metadata?.pipelineName === pipelineName ||
        t.displayName?.includes(pipelineName)
    );
}
if (taskType) {
    history = history.filter(t => t.type === taskType);
}
```

### queue-executor-bridge.ts changes

**Store pipelineName in metadata at task creation time (around line 148–153):**
When creating the AIProcess for a `run-pipeline` task, extract pipeline name from the payload path:
```typescript
metadata: {
    type: `queue-${task.type}`,
    queueTaskId: task.id,
    priority: task.priority,
    model: task.config.model,
    pipelineName: task.type === 'run-pipeline'
        ? path.basename((task.payload as RunPipelinePayload).pipelinePath)
        : undefined,
},
```

This makes `pipelineName` available immediately for filtering, not just after execution completes.

### Key imports
- `PipelineResultCard` imports: `Card`, `Badge`, `cn` from `../shared`, `MarkdownView` from `./MarkdownView`, `useMermaid` from `../hooks/useMermaid`, `renderMarkdownToHtml` from `../../markdown-renderer`, `formatDuration`, `copyToClipboard` from `../utils/format`
- `PipelineRunHistory` imports: `fetchApi` from `../../api`, `PipelineResultCard` from `../processes/PipelineResultCard`, `Badge` from `../shared`, `formatDuration` from `../utils/format`

## Tests

### PipelineResultCard.test.tsx
Follow the established pattern from `ConversationTurnBubble.test.tsx` (vitest + @testing-library/react, mock MarkdownView and markdown-renderer):

- **renders pipeline name from metadata**: Supply `process.metadata.pipelineName = 'Bug Triage'`, assert text 'Bug Triage' appears
- **renders fallback title when pipelineName is missing**: Supply process without `metadata.pipelineName`, assert 'Pipeline Execution' appears
- **renders execution stats grid when executionStats present**: Supply `metadata.executionStats = { totalItems: 10, successfulMaps: 8, failedMaps: 2, ... }`, assert '10', '8', '2' appear and '80%' success rate
- **hides stats grid when executionStats is missing**: Supply process without `executionStats`, assert no stats grid rendered
- **renders result content via MarkdownView**: Supply `process.result = '# Hello'`, assert MarkdownView receives HTML
- **renders placeholder when result is empty**: Supply `process.result = ''`, assert 'No output available.' text
- **copy button copies result to clipboard**: Mock `navigator.clipboard.writeText`, click copy, assert called with `process.result`
- **renders status badge**: Supply `process.status = 'completed'`, assert Badge rendered

Mock setup:
```typescript
vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));
vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));
vi.mock('../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: () => {},
}));
```

### PipelineRunHistory.test.tsx
- **renders empty state when no history**: Mock `fetchApi` returning `{ history: [] }`, assert "No runs yet" text
- **renders history items with status badges**: Mock history with 3 items (completed, failed, running), assert all rendered with correct status icons
- **clicking a history item fetches and shows PipelineResultCard**: Mock item click, assert process detail fetched and card rendered
- **re-fetches on refreshKey change**: Render with `refreshKey=1`, update to `refreshKey=2`, assert `fetchApi` called twice
- **shows active tasks from WebSocket queue state**: Mock queue state with a running task matching the pipeline name, assert it appears above history

## Acceptance Criteria
- [ ] Running a pipeline stays on the Pipelines tab (no auto-navigation to Queue tab)
- [ ] `PipelineRunHistory` appears below the YAML editor in `PipelineDetail`, showing runs filtered to the selected pipeline
- [ ] Active (running/queued) tasks for the pipeline appear at the top of the history via WebSocket state
- [ ] Completed runs appear below with status icons, timestamps, and durations
- [ ] Clicking a run expands to show `PipelineResultCard` with stats grid, mermaid diagrams, and formatted output
- [ ] `PipelineResultCard` gracefully degrades: missing pipelineName → fallback title, missing executionStats → no stats, missing result → placeholder
- [ ] `useMermaid` hook renders mermaid blocks in result markdown as diagrams
- [ ] `pipelineName` is stored in task metadata at creation time (not just in the result)
- [ ] `GET /api/queue/history` supports `pipelineName` query param for filtering
- [ ] Empty state shows "No runs yet. Click ▶ Run to execute this pipeline."
- [ ] Copy button on result card works
- [ ] All new tests pass (`npm run test` in `packages/coc`)
- [ ] Pipeline tasks still appear in Queue tab for cross-cutting operational visibility (no regression)
- [ ] Card styling is consistent with existing SPA theme

## Dependencies
- Depends on: 001

## Assumed Prior State
Commit 001 has already:
- Gated the chat input bar — when `sdkSessionId` is missing from the process, the `ChatInputBar` is hidden
- Added a footer message explaining that conversation continuation is not available for pipeline/legacy processes
