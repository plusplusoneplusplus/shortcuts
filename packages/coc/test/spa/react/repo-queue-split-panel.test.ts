/**
 * Tests for RepoQueueTab split-panel layout.
 *
 * Verifies that the Queue tab uses a split-panel layout (matching PipelinesTab)
 * with:
 *   - Left panel: task list with selected state highlighting
 *   - Right panel: QueueTaskDetail or empty placeholder
 *   - History items are clickable for task selection
 *   - Deselection when selected task is removed from lists
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

const QUEUE_TASK_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'QueueTaskDetail.tsx'
);

describe('RepoQueueTab split-panel layout', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
    });

    describe('split-panel container', () => {
        it('uses flex h-full overflow-hidden layout (matching PipelinesTab pattern)', () => {
            expect(source).toContain('flex h-full overflow-hidden');
        });

        it('has a data-testid for the split-panel container', () => {
            expect(source).toContain('data-testid="repo-queue-split-panel"');
        });

        it('has a left panel with w-80 flex-shrink-0 and border-r', () => {
            expect(source).toContain('w-80 flex-shrink-0 border-r');
        });

        it('has a right panel with flex-1 min-w-0', () => {
            expect(source).toContain('flex-1 min-w-0 overflow-hidden');
        });

        it('has a data-testid for the detail panel', () => {
            expect(source).toContain('data-testid="repo-queue-detail-panel"');
        });
    });

    describe('QueueTaskDetail integration', () => {
        it('imports QueueTaskDetail component', () => {
            expect(source).toContain("import { QueueTaskDetail } from '../queue/QueueTaskDetail'");
        });

        it('renders QueueTaskDetail when a task is selected', () => {
            expect(source).toContain('<QueueTaskDetail />');
        });

        it('shows empty-state placeholder when no task is selected', () => {
            expect(source).toContain('Select a task to view details');
        });

        it('empty state has clipboard icon', () => {
            expect(source).toContain('📋');
        });
    });

    describe('selected state highlighting', () => {
        it('QueueTaskItem accepts selected prop', () => {
            expect(source).toContain('selected?: boolean');
        });

        it('applies ring-2 ring-[#0078d4] when selected', () => {
            expect(source).toContain('ring-2 ring-[#0078d4]');
        });

        it('passes selected prop to running task items', () => {
            expect(source).toContain('selected={selectedTaskId === task.id}');
        });

        it('uses cursor-pointer class on task items', () => {
            expect(source).toContain('cursor-pointer');
        });
    });

    describe('history items are clickable', () => {
        it('history Card has onClick handler for selection', () => {
            // The history Card should have onClick to select the task
            const historySection = source.slice(source.indexOf('Completed Tasks'));
            expect(historySection).toContain('onClick={() => selectTask(task.id)}');
        });

        it('history Card has cursor-pointer class', () => {
            const historySection = source.slice(source.indexOf('Completed Tasks'));
            expect(historySection).toContain('cursor-pointer');
        });

        it('history Card applies selected ring highlight', () => {
            const historySection = source.slice(source.indexOf('Completed Tasks'));
            expect(historySection).toContain('ring-2 ring-[#0078d4]');
        });
    });

    describe('deselection on removed tasks', () => {
        it('has a useEffect that clears selection when task is removed', () => {
            expect(source).toContain('Clear selection if the selected task is no longer in any list');
        });

        it('dispatches SELECT_QUEUE_TASK with null when task disappears', () => {
            // Find the deselection effect
            const deselectIdx = source.indexOf('Clear selection');
            const deselectBlock = source.slice(deselectIdx, deselectIdx + 400);
            expect(deselectBlock).toContain("SELECT_QUEUE_TASK");
            expect(deselectBlock).toContain("null");
        });
    });

    describe('selectTask helper', () => {
        it('defines selectTask with useCallback', () => {
            expect(source).toContain('const selectTask = useCallback');
        });

        it('dispatches SELECT_QUEUE_TASK through selectTask', () => {
            const callbackIdx = source.indexOf('const selectTask = useCallback');
            const callbackBlock = source.slice(callbackIdx, callbackIdx + 200);
            expect(callbackBlock).toContain('SELECT_QUEUE_TASK');
        });
    });

    describe('context sync after HTTP fetch', () => {
        it('syncs fetched queue lists back into repoQueueMap', () => {
            expect(source).toContain("type: 'REPO_QUEUE_UPDATED'");
            expect(source).toContain('repoId: workspaceId');
        });

        it('includes queued, running, and history in the synced payload', () => {
            expect(source).toContain('queued: nextQueued');
            expect(source).toContain('running: nextRunning');
            expect(source).toContain('history: nextHistory');
        });
    });

    describe('history default expanded', () => {
        it('showHistory defaults to true so completed tasks are visible on load', () => {
            expect(source).toContain('useState(true)');
            // Verify it's the showHistory state specifically
            expect(source).toMatch(/\[showHistory,\s*setShowHistory\]\s*=\s*useState\(true\)/);
        });
    });

    describe('preserves existing functionality', () => {
        it('still has pause/resume toolbar', () => {
            expect(source).toContain('data-testid="repo-pause-resume-btn"');
        });

        it('still has pause-aware empty state', () => {
            expect(source).toContain('Queue is paused');
            expect(source).toContain('No tasks in queue');
        });

        it('still shows running/queued/history sections', () => {
            expect(source).toContain('Running Tasks');
            expect(source).toContain('Queued Tasks');
            expect(source).toContain('Completed Tasks');
        });

        it('still uses correct API paths for cancel/move', () => {
            expect(source).not.toContain('/queue/tasks/');
            expect(source).toContain("method: 'DELETE'");
            expect(source).toContain("+ '/move-up'");
            expect(source).toContain("+ '/move-to-top'");
        });
    });
});

describe('QueueTaskDetail repoQueueMap lookup', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(QUEUE_TASK_DETAIL_PATH, 'utf-8');
    });

    it('searches repoQueueMap when task not found in global arrays', () => {
        expect(source).toContain('repoQueueMap');
    });

    it('iterates Object.values of repoQueueMap', () => {
        expect(source).toContain('Object.values(queueState.repoQueueMap)');
    });

    it('searches repo running, queued, and history arrays', () => {
        const repoSearchIdx = source.indexOf('Object.values(queueState.repoQueueMap)');
        const searchBlock = source.slice(repoSearchIdx, repoSearchIdx + 300);
        expect(searchBlock).toContain('repo.running');
        expect(searchBlock).toContain('repo.queued');
        expect(searchBlock).toContain('repo.history');
    });

    it('includes repoQueueMap in the useEffect dependency array', () => {
        // Find the task lookup useEffect
        const effectIdx = source.indexOf('Determine task object from queue state');
        const effectBlock = source.slice(effectIdx, effectIdx + 600);
        expect(effectBlock).toContain('queueState.repoQueueMap');
    });

    it('tries global arrays first before repoQueueMap (optimization)', () => {
        const effectIdx = source.indexOf('Determine task object from queue state');
        const effectBlock = source.slice(effectIdx, effectIdx + 600);
        const globalIdx = effectBlock.indexOf('queueState.running');
        const repoIdx = effectBlock.indexOf('repoQueueMap');
        // Global search should come before repoQueueMap search
        expect(globalIdx).toBeLessThan(repoIdx);
    });
});
