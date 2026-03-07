/**
 * Tests for RepoQueueTab filter dropdown.
 *
 * Verifies that:
 *   - Filter state and type-label mapping exist
 *   - Available filter options are computed from task types
 *   - Filtered lists are derived via useMemo
 *   - <select> dropdown renders with data-testid
 *   - Section counts use filtered list lengths
 *   - Filter resets to 'all' on workspace change
 *   - taskMatchesFilter helper handles all cases
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

const ACTIVITY_LIST_PANE_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ActivityListPane.tsx'
);

describe('RepoQueueTab filter dropdown', () => {
    let source: string;
    let listPaneSource: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
        listPaneSource = fs.readFileSync(ACTIVITY_LIST_PANE_PATH, 'utf-8');
    });

    describe('filter state and constants', () => {
        it('defines TASK_TYPE_LABELS mapping with known task types', () => {
            expect(listPaneSource).toContain('TASK_TYPE_LABELS');
            expect(listPaneSource).toContain("'follow-prompt'");
            expect(listPaneSource).toContain("'run-workflow'");
            expect(listPaneSource).toContain("'code-review'");
            expect(listPaneSource).toContain("'chat'");
            expect(listPaneSource).toContain("'custom'");
        });

        it('defines OTHER_TYPES set for uncommon task types', () => {
            expect(listPaneSource).toContain('OTHER_TYPES');
            expect(listPaneSource).toContain("'resolve-comments'");
            expect(listPaneSource).toContain("'ai-clarification'");
            expect(listPaneSource).toContain("'task-generation'");
        });

        it('has filterType state initialized to all', () => {
            expect(listPaneSource).toMatch(/\[filterType,\s*setFilterType\]\s*=\s*useState[^(]*\(\s*'all'\s*\)/);
        });

        it('defines taskMatchesFilter helper function', () => {
            expect(listPaneSource).toContain('function taskMatchesFilter');
        });
    });

    describe('taskMatchesFilter logic', () => {
        it('returns true for filter=all regardless of task type', () => {
            const fnIdx = listPaneSource.indexOf('function taskMatchesFilter');
            const fnBlock = listPaneSource.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain("filter === 'all'");
            expect(fnBlock).toContain('return true');
        });

        it('matches other filter for types in OTHER_TYPES set', () => {
            const fnIdx = listPaneSource.indexOf('function taskMatchesFilter');
            const fnBlock = listPaneSource.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain("filter === 'other'");
            expect(fnBlock).toContain('OTHER_TYPES.has(task.type)');
        });

        it('matches specific type by comparing task.type to filter value', () => {
            const fnIdx = listPaneSource.indexOf('function taskMatchesFilter');
            const fnBlock = listPaneSource.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain('task.type === filter');
        });

        it('groups unknown types under other filter', () => {
            // Unknown types (not in TASK_TYPE_LABELS and not in OTHER_TYPES) should match 'other'
            const fnIdx = listPaneSource.indexOf('function taskMatchesFilter');
            const fnBlock = listPaneSource.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain('!TASK_TYPE_LABELS[task.type]');
        });
    });

    describe('available filter computation', () => {
        it('computes availableFilters via useMemo', () => {
            expect(listPaneSource).toContain('availableFilters');
            expect(listPaneSource).toMatch(/availableFilters\s*=\s*useMemo/);
        });

        it('always includes All as the first filter option', () => {
            const memoIdx = listPaneSource.indexOf('availableFilters');
            const memoBlock = listPaneSource.slice(memoIdx, memoIdx + 500);
            expect(memoBlock).toContain("value: 'all'");
            expect(memoBlock).toContain("label: 'All'");
        });

        it('only includes filter options that have matching tasks', () => {
            const memoIdx = listPaneSource.indexOf('availableFilters');
            const memoBlock = listPaneSource.slice(memoIdx, memoIdx + 500);
            expect(memoBlock).toContain('types.has(type)');
        });

        it('includes Other option when tasks have non-primary types', () => {
            const memoIdx = listPaneSource.indexOf('availableFilters');
            const memoBlock = listPaneSource.slice(memoIdx, memoIdx + 600);
            expect(memoBlock).toContain("value: 'other'");
            expect(memoBlock).toContain("label: 'Other'");
        });

        it('depends on allTasks for reactivity', () => {
            // allTasks is combined from running, queued, history
            expect(listPaneSource).toContain('allTasks');
            expect(listPaneSource).toMatch(/allTasks\s*=\s*useMemo/);
            expect(listPaneSource).toContain('[running, queued, history]');
        });
    });

    describe('filtered list derivation', () => {
        it('derives filteredRunning via useMemo with taskMatchesFilter', () => {
            expect(listPaneSource).toMatch(/filteredRunning\s*=\s*useMemo/);
            expect(listPaneSource).toContain('running.filter(t =>');
            expect(listPaneSource).toContain('taskMatchesFilter(t, filterType)');
        });

        it('derives filteredQueued via useMemo with taskMatchesFilter (always includes markers)', () => {
            expect(listPaneSource).toMatch(/filteredQueued\s*=\s*useMemo/);
            // markers are always included; tasks are filtered
            expect(listPaneSource).toMatch(/queued\.filter\(t\s*=>/);
            expect(listPaneSource).toContain('taskMatchesFilter(t, filterType)');
        });

        it('derives filteredHistory via useMemo with taskMatchesFilter', () => {
            expect(listPaneSource).toMatch(/filteredHistory\s*=\s*useMemo/);
            expect(listPaneSource).toContain('history.filter(t =>');
            expect(listPaneSource).toContain('taskMatchesFilter(t, filterType)');
        });

        it('filters out chat follow-up tasks from all rendered lists', () => {
            // chat follow-up tasks (chat with processId) are internal implementation details and should not appear in the UI
            expect(listPaneSource).toContain('filteredRunning');
            expect(listPaneSource).toContain('!isChatFollowUp(t)');
            expect(listPaneSource).toContain('filteredQueued');
            expect(listPaneSource).toContain('filteredHistory');
            expect(listPaneSource).toContain('isChatFollowUp');
        });
    });

    describe('dropdown rendering', () => {
        it('renders a <select> element for the filter', () => {
            expect(listPaneSource).toContain('<select');
            expect(listPaneSource).toContain('data-testid="queue-filter-dropdown"');
        });

        it('binds select value to filterType state', () => {
            expect(listPaneSource).toContain('value={filterType}');
        });

        it('updates filterType on change', () => {
            expect(listPaneSource).toContain('onChange={e => setFilterType(e.target.value)}');
        });

        it('renders option elements from availableFilters', () => {
            expect(listPaneSource).toContain('availableFilters.map');
            expect(listPaneSource).toContain('<option');
        });

        it('only shows dropdown when more than 2 filter options exist (All + at least 2 types)', () => {
            expect(listPaneSource).toContain('availableFilters.length > 2');
        });

        it('uses text-xs styling consistent with existing UI', () => {
            // Find the select element context — search a wider window
            const selectIdx = listPaneSource.indexOf('queue-filter-dropdown');
            const selectBlock = listPaneSource.slice(Math.max(0, selectIdx - 400), selectIdx);
            expect(selectBlock).toContain('text-xs');
        });
    });

    describe('section counts use filtered lists', () => {
        it('Running Tasks count uses filteredRunning.length', () => {
            expect(listPaneSource).toContain('({filteredRunning.length})');
        });

        it('Queued Tasks count uses filteredQueued length (excluding pause markers)', () => {
            // The count either uses filteredQueued.length or filters out pause-markers
            expect(listPaneSource).toMatch(/filteredQueued(?:\.filter[^)]*\))?\s*\.length/);
        });

        it('Completed Tasks count uses filteredHistory.length', () => {
            expect(listPaneSource).toContain('({filteredHistory.length})');
        });

        it('sections render from filtered lists not raw lists', () => {
            // After the toolbar, Running should use filteredRunning
            const runningSection = listPaneSource.slice(listPaneSource.indexOf('Running Tasks'));
            expect(runningSection).toContain('filteredRunning.map');

            const queuedSection = listPaneSource.slice(listPaneSource.indexOf('Queued Tasks'));
            expect(queuedSection).toContain('filteredQueued.map');

            const historySection = listPaneSource.slice(listPaneSource.indexOf('Completed Tasks'));
            expect(historySection).toContain('filteredHistory.map');
        });
    });

    describe('filter reset on workspace change', () => {
        it('resets filterType to all when workspaceId changes', () => {
            // ActivityListPane receives workspaceId and resets filter when it changes
            expect(listPaneSource).toContain("setFilterType('all')");
            const effectIdx = listPaneSource.indexOf("setFilterType('all')");
            const effectBlock = listPaneSource.slice(Math.max(0, effectIdx - 150), effectIdx + 50);
            expect(effectBlock).toContain('useEffect');
            expect(listPaneSource).toMatch(/\[workspaceId\]/);
        });
    });

    describe('toolbar always visible', () => {
        it('toolbar has Queue label and filter dropdown', () => {
            expect(listPaneSource).toContain('Queue');
            expect(listPaneSource).toContain('queue-filter-dropdown');
        });

        it('pause/resume button is conditionally shown within the toolbar', () => {
            // Pause/resume button still has conditional visibility
            expect(listPaneSource).toContain('(isPaused || running.length > 0 || queued.length > 0)');
        });
    });

    describe('preserves existing behavior', () => {
        it('still has pause/resume button with data-testid', () => {
            expect(listPaneSource).toContain('data-testid="repo-pause-resume-btn"');
        });

        it('still shows Running/Queued/Completed section headers', () => {
            expect(listPaneSource).toContain('Running Tasks');
            expect(listPaneSource).toContain('Queued Tasks');
            expect(listPaneSource).toContain('Completed Tasks');
        });

        it('still supports history collapse toggle', () => {
            expect(listPaneSource).toContain('setShowHistory(!showHistory)');
        });

        it('selected task is not cleared when filter changes', () => {
            // The clear-selection effect depends on running/queued/history (unfiltered),
            // not on filteredRunning/filteredQueued/filteredHistory
            const clearEffect = source.slice(
                source.indexOf('Clear selection if the selected task is no longer'),
                source.indexOf('Clear selection if the selected task is no longer') + 400
            );
            expect(clearEffect).not.toContain('filteredRunning');
            expect(clearEffect).not.toContain('filteredHistory');
        });
    });
});
