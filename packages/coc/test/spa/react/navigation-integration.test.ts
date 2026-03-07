/**
 * Tests for navigation integration (Commit 8):
 * - RepoQueueTab: run-workflow tasks navigate to workflow view
 * - RepoQueueTab: chat/non-workflow tasks unchanged (no regression)
 * - RepoQueueTab: mini progress indicator on running workflow cards
 * - WorkflowRunHistory: clicks navigate to workflow view
 * - RepoDetail: workflow sub-tab renders WorkflowDetailView
 * - ProcessDetail: "View Workflow →" button for workflow processes
 * - useWorkflowProgress hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');

const REPO_QUEUE_TAB_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'repos', 'RepoQueueTab.tsx'),
    'utf-8',
);

const PIPELINE_RUN_HISTORY_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'repos', 'WorkflowRunHistory.tsx'),
    'utf-8',
);

const REPO_DETAIL_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

const PROCESS_DETAIL_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'processes', 'ProcessDetail.tsx'),
    'utf-8',
);

const USE_PIPELINE_PROGRESS_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'hooks', 'useWorkflowProgress.ts'),
    'utf-8',
);

const ACTIVITY_LIST_PANE_SRC = fs.readFileSync(
    path.join(SRC_ROOT, 'repos', 'ActivityListPane.tsx'),
    'utf-8',
);

// ─── RepoQueueTab: selectTask run-workflow branch ──────────────
describe('RepoQueueTab selectTask: run-workflow navigation', () => {
    it('has a run-workflow branch in selectTask that navigates to workflow', () => {
        const handler = REPO_QUEUE_TAB_SRC.substring(
            REPO_QUEUE_TAB_SRC.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SRC.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])')
        );
        expect(handler).toContain("task?.type === 'run-workflow'");
        expect(handler).toContain('/workflow/');
    });

    it('run-workflow branch returns early before SELECT_QUEUE_TASK', () => {
        const handler = REPO_QUEUE_TAB_SRC.substring(
            REPO_QUEUE_TAB_SRC.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SRC.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])')
        );
        const pipelineBranch = handler.indexOf("task?.type === 'run-workflow'");
        const returnAfterPipeline = handler.indexOf('return;', pipelineBranch);
        const selectDispatch = handler.indexOf("'SELECT_QUEUE_TASK'");
        expect(returnAfterPipeline).toBeLessThan(selectDispatch);
    });

    it('uses task.processId preferentially, falling back to task.id', () => {
        const handler = REPO_QUEUE_TAB_SRC.substring(
            REPO_QUEUE_TAB_SRC.indexOf("task?.type === 'run-workflow'"),
            REPO_QUEUE_TAB_SRC.indexOf('return;', REPO_QUEUE_TAB_SRC.indexOf("task?.type === 'run-workflow'"))
        );
        expect(handler).toContain('task.processId || task.id');
    });
});

// ─── RepoQueueTab: non-workflow tasks unchanged ────────────────
describe('RepoQueueTab selectTask: no regression for other types', () => {
    it('chat branch is preserved before run-workflow', () => {
        const handler = REPO_QUEUE_TAB_SRC.substring(
            REPO_QUEUE_TAB_SRC.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SRC.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])')
        );
        const chatIdx = handler.indexOf("task?.type === 'chat'");
        const pipelineIdx = handler.indexOf("task?.type === 'run-workflow'");
        expect(chatIdx).toBeGreaterThan(-1);
        expect(pipelineIdx).toBeGreaterThan(chatIdx);
    });

    it('generic fallback dispatches SELECT_QUEUE_TASK after run-workflow', () => {
        const handler = REPO_QUEUE_TAB_SRC.substring(
            REPO_QUEUE_TAB_SRC.indexOf('const selectTask = useCallback'),
            REPO_QUEUE_TAB_SRC.indexOf('}, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId])')
        );
        const pipelineReturn = handler.indexOf('return;', handler.indexOf("task?.type === 'run-workflow'"));
        const selectDispatch = handler.indexOf("'SELECT_QUEUE_TASK'");
        expect(selectDispatch).toBeGreaterThan(pipelineReturn);
    });
});

// ─── RepoQueueTab: mini progress indicator (QueueTaskItem is in shared ActivityListPane) ─────
describe('RepoQueueTab: mini progress indicator', () => {
    it('imports useWorkflowProgress', () => {
        expect(ACTIVITY_LIST_PANE_SRC).toContain("import { useWorkflowProgress } from '../hooks/useWorkflowProgress'");
    });

    it('QueueTaskItem calls useWorkflowProgress for running pipeline tasks', () => {
        const itemFn = ACTIVITY_LIST_PANE_SRC.substring(
            ACTIVITY_LIST_PANE_SRC.indexOf('function QueueTaskItem'),
        );
        expect(itemFn).toContain("task.type === 'run-workflow'");
        expect(itemFn).toContain('useWorkflowProgress');
    });

    it('renders progress indicator with data-testid', () => {
        expect(ACTIVITY_LIST_PANE_SRC).toContain('data-testid="workflow-progress-indicator"');
    });

    it('shows Map: N/M text in the progress indicator', () => {
        const itemFn = ACTIVITY_LIST_PANE_SRC.substring(
            ACTIVITY_LIST_PANE_SRC.indexOf('function QueueTaskItem'),
        );
        expect(itemFn).toContain('▶ Map: {progress.completed}/{progress.total}');
    });

    it('only renders progress when showProgress is true and total > 0', () => {
        const itemFn = ACTIVITY_LIST_PANE_SRC.substring(
            ACTIVITY_LIST_PANE_SRC.indexOf('function QueueTaskItem'),
        );
        expect(itemFn).toContain('showProgress && progress && progress.total > 0');
    });

    it('does not subscribe to SSE for non-pipeline or queued tasks', () => {
        const itemFn = ACTIVITY_LIST_PANE_SRC.substring(
            ACTIVITY_LIST_PANE_SRC.indexOf('function QueueTaskItem'),
        );
        expect(itemFn).toContain("task.type === 'run-workflow' && status === 'running'");
    });
});

// ─── WorkflowRunHistory: workflow navigation ────────────────────
describe('WorkflowRunHistory: workflow navigation', () => {
    it('does not import WorkflowResultCard', () => {
        expect(PIPELINE_RUN_HISTORY_SRC).not.toContain("import { WorkflowResultCard }");
        expect(PIPELINE_RUN_HISTORY_SRC).not.toContain("from '../processes/WorkflowResultCard'");
    });

    it('does not have selectedTaskId state', () => {
        expect(PIPELINE_RUN_HISTORY_SRC).not.toContain('useState<string | null>(null)');
    });

    it('does not have selectedProcess state', () => {
        expect(PIPELINE_RUN_HISTORY_SRC).not.toContain('setSelectedProcess');
    });

    it('does not render WorkflowResultCard', () => {
        expect(PIPELINE_RUN_HISTORY_SRC).not.toContain('<WorkflowResultCard');
    });

    it('handleSelectTask navigates to run view', () => {
        const handler = PIPELINE_RUN_HISTORY_SRC.substring(
            PIPELINE_RUN_HISTORY_SRC.indexOf('const handleSelectTask'),
            PIPELINE_RUN_HISTORY_SRC.indexOf('};', PIPELINE_RUN_HISTORY_SRC.indexOf('const handleSelectTask')) + 2
        );
        expect(handler).toContain('/run/');
        expect(handler).toContain('location.hash');
    });

    it('uses processId with queue_ prefix fallback', () => {
        const handler = PIPELINE_RUN_HISTORY_SRC.substring(
            PIPELINE_RUN_HISTORY_SRC.indexOf('const handleSelectTask'),
            PIPELINE_RUN_HISTORY_SRC.indexOf('};', PIPELINE_RUN_HISTORY_SRC.indexOf('const handleSelectTask')) + 2
        );
        expect(handler).toContain('task.processId || `queue_${task.id}`');
    });

    it('RunHistoryItem no longer has isSelected prop', () => {
        const ifaceMatch = PIPELINE_RUN_HISTORY_SRC.match(/interface RunHistoryItemProps\s*\{[^}]+\}/);
        expect(ifaceMatch).not.toBeNull();
        expect(ifaceMatch![0]).not.toContain('isSelected');
    });
});

// ─── RepoDetail: workflow sub-tab rendering ─────────────────────
describe('RepoDetail: workflow sub-tab rendering', () => {
    it('imports WorkflowDetailView', () => {
        expect(REPO_DETAIL_SRC).toContain("import { WorkflowDetailView } from '../processes/dag'");
    });

    it('renders WorkflowDetailView when activeSubTab is workflow', () => {
        expect(REPO_DETAIL_SRC).toContain("activeSubTab === 'workflow'");
        expect(REPO_DETAIL_SRC).toContain('<WorkflowDetailView');
    });

    it('passes selectedWorkflowProcessId to WorkflowDetailView', () => {
        expect(REPO_DETAIL_SRC).toContain('state.selectedWorkflowProcessId');
    });
});

// ─── ProcessDetail: View Workflow button ────────────────────────
describe('ProcessDetail: View Workflow button', () => {
    it('has a View Workflow button with data-testid', () => {
        expect(PROCESS_DETAIL_SRC).toContain('data-testid="view-workflow-btn"');
    });

    it('button text says "View Workflow →"', () => {
        expect(PROCESS_DETAIL_SRC).toContain('View Workflow →');
    });

    it('button is shown for pipeline-type processes', () => {
        expect(PROCESS_DETAIL_SRC).toContain("metadataProcess?.metadata?.workflowName || metadataProcess?.type === 'run-workflow'");
    });

    it('button navigates to workflow hash with wsId and process.id', () => {
        const btnSection = PROCESS_DETAIL_SRC.substring(
            PROCESS_DETAIL_SRC.indexOf('view-workflow-btn') - 200,
            PROCESS_DETAIL_SRC.indexOf('view-workflow-btn') + 300
        );
        expect(btnSection).toContain('/workflow/');
        expect(btnSection).toContain('process.id');
    });
});

// ─── useWorkflowProgress hook ───────────────────────────────────
describe('useWorkflowProgress hook', () => {
    it('exports useWorkflowProgress function', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('export function useWorkflowProgress');
    });

    it('accepts processId parameter (string | null)', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('processId: string | null');
    });

    it('returns PipelineProgressState or null', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('PipelineProgressState | null');
    });

    it('subscribes to pipeline-progress SSE events', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain("'workflow-progress'");
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('EventSource');
    });

    it('closes EventSource on unmount', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('es.close()');
    });

    it('closes EventSource when status is completed/failed/cancelled', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain("'status'");
        expect(USE_PIPELINE_PROGRESS_SRC).toContain("data.status === 'completed'");
        expect(USE_PIPELINE_PROGRESS_SRC).toContain("data.status === 'failed'");
        expect(USE_PIPELINE_PROGRESS_SRC).toContain("data.status === 'cancelled'");
    });

    it('returns null progress when processId is null', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('if (!processId)');
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('setProgress(null)');
    });

    it('exports PipelineProgressState interface with completed, total, phase', () => {
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('completed: number');
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('total: number');
        expect(USE_PIPELINE_PROGRESS_SRC).toContain('phase: string');
    });
});
