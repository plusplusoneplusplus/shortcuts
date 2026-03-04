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

describe('RepoQueueTab filter dropdown', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
    });

    describe('filter state and constants', () => {
        it('defines TASK_TYPE_LABELS mapping with known task types', () => {
            expect(source).toContain('TASK_TYPE_LABELS');
            expect(source).toContain("'follow-prompt'");
            expect(source).toContain("'run-pipeline'");
            expect(source).toContain("'code-review'");
            expect(source).toContain("'chat'");
            expect(source).toContain("'custom'");
        });

        it('defines OTHER_TYPES set for uncommon task types', () => {
            expect(source).toContain('OTHER_TYPES');
            expect(source).toContain("'resolve-comments'");
            expect(source).toContain("'ai-clarification'");
            expect(source).toContain("'task-generation'");
        });

        it('has filterType state initialized to all', () => {
            expect(source).toMatch(/\[filterType,\s*setFilterType\]\s*=\s*useState[^(]*\(\s*'all'\s*\)/);
        });

        it('defines taskMatchesFilter helper function', () => {
            expect(source).toContain('function taskMatchesFilter');
        });
    });

    describe('taskMatchesFilter logic', () => {
        it('returns true for filter=all regardless of task type', () => {
            const fnIdx = source.indexOf('function taskMatchesFilter');
            const fnBlock = source.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain("filter === 'all'");
            expect(fnBlock).toContain('return true');
        });

        it('matches other filter for types in OTHER_TYPES set', () => {
            const fnIdx = source.indexOf('function taskMatchesFilter');
            const fnBlock = source.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain("filter === 'other'");
            expect(fnBlock).toContain('OTHER_TYPES.has(task.type)');
        });

        it('matches specific type by comparing task.type to filter value', () => {
            const fnIdx = source.indexOf('function taskMatchesFilter');
            const fnBlock = source.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain('task.type === filter');
        });

        it('groups unknown types under other filter', () => {
            // Unknown types (not in TASK_TYPE_LABELS and not in OTHER_TYPES) should match 'other'
            const fnIdx = source.indexOf('function taskMatchesFilter');
            const fnBlock = source.slice(fnIdx, fnIdx + 300);
            expect(fnBlock).toContain('!TASK_TYPE_LABELS[task.type]');
        });
    });

    describe('available filter computation', () => {
        it('computes availableFilters via useMemo', () => {
            expect(source).toContain('availableFilters');
            expect(source).toMatch(/availableFilters\s*=\s*useMemo/);
        });

        it('always includes All as the first filter option', () => {
            const memoIdx = source.indexOf('availableFilters');
            const memoBlock = source.slice(memoIdx, memoIdx + 500);
            expect(memoBlock).toContain("value: 'all'");
            expect(memoBlock).toContain("label: 'All'");
        });

        it('only includes filter options that have matching tasks', () => {
            const memoIdx = source.indexOf('availableFilters');
            const memoBlock = source.slice(memoIdx, memoIdx + 500);
            expect(memoBlock).toContain('types.has(type)');
        });

        it('includes Other option when tasks have non-primary types', () => {
            const memoIdx = source.indexOf('availableFilters');
            const memoBlock = source.slice(memoIdx, memoIdx + 600);
            expect(memoBlock).toContain("value: 'other'");
            expect(memoBlock).toContain("label: 'Other'");
        });

        it('depends on allTasks for reactivity', () => {
            // allTasks is combined from running, queued, history
            expect(source).toContain('allTasks');
            expect(source).toMatch(/allTasks\s*=\s*useMemo\(\(\)\s*=>\s*\[\.\.\.\s*running/);
        });
    });

    describe('filtered list derivation', () => {
        it('derives filteredRunning via useMemo with taskMatchesFilter', () => {
            expect(source).toMatch(/filteredRunning\s*=\s*useMemo/);
            expect(source).toContain('running.filter(t =>');
            expect(source).toContain('taskMatchesFilter(t, filterType)');
        });

        it('derives filteredQueued via useMemo with taskMatchesFilter (always includes markers)', () => {
            expect(source).toMatch(/filteredQueued\s*=\s*useMemo/);
            // markers are always included; tasks are filtered
            expect(source).toMatch(/queued\.filter\(t\s*=>/);
            expect(source).toContain('taskMatchesFilter(t, filterType)');
        });

        it('derives filteredHistory via useMemo with taskMatchesFilter', () => {
            expect(source).toMatch(/filteredHistory\s*=\s*useMemo/);
            expect(source).toContain('history.filter(t =>');
            expect(source).toContain('taskMatchesFilter(t, filterType)');
        });

        it('filters out chat follow-up tasks from all rendered lists', () => {
            // chat follow-up tasks (chat with processId) are internal implementation details and should not appear in the UI
            expect(source).toMatch(/filteredRunning.*payload.*processId/s);
            expect(source).toMatch(/filteredQueued.*payload.*processId/s);
            expect(source).toMatch(/filteredHistory.*payload.*processId/s);
        });
    });

    describe('dropdown rendering', () => {
        it('renders a <select> element for the filter', () => {
            expect(source).toContain('<select');
            expect(source).toContain('data-testid="queue-filter-dropdown"');
        });

        it('binds select value to filterType state', () => {
            expect(source).toContain('value={filterType}');
        });

        it('updates filterType on change', () => {
            expect(source).toContain('onChange={e => setFilterType(e.target.value)}');
        });

        it('renders option elements from availableFilters', () => {
            expect(source).toContain('availableFilters.map');
            expect(source).toContain('<option');
        });

        it('only shows dropdown when more than 2 filter options exist (All + at least 2 types)', () => {
            expect(source).toContain('availableFilters.length > 2');
        });

        it('uses text-xs styling consistent with existing UI', () => {
            // Find the select element context — search a wider window
            const selectIdx = source.indexOf('queue-filter-dropdown');
            const selectBlock = source.slice(Math.max(0, selectIdx - 400), selectIdx);
            expect(selectBlock).toContain('text-xs');
        });
    });

    describe('section counts use filtered lists', () => {
        it('Running Tasks count uses filteredRunning.length', () => {
            expect(source).toContain('({filteredRunning.length})');
        });

        it('Queued Tasks count uses filteredQueued length (excluding pause markers)', () => {
            // The count either uses filteredQueued.length or filters out pause-markers
            expect(source).toMatch(/filteredQueued(?:\.filter[^)]*\))?\s*\.length/);
        });

        it('Completed Tasks count uses filteredHistory.length', () => {
            expect(source).toContain('({filteredHistory.length})');
        });

        it('sections render from filtered lists not raw lists', () => {
            // After the toolbar, Running should use filteredRunning
            const runningSection = source.slice(source.indexOf('Running Tasks'));
            expect(runningSection).toContain('filteredRunning.map');

            const queuedSection = source.slice(source.indexOf('Queued Tasks'));
            expect(queuedSection).toContain('filteredQueued.map');

            const historySection = source.slice(source.indexOf('Completed Tasks'));
            expect(historySection).toContain('filteredHistory.map');
        });
    });

    describe('filter reset on workspace change', () => {
        it('resets filterType to all when workspaceId changes', () => {
            // Find the useEffect that depends on workspaceId
            const effectIdx = source.indexOf('Initial HTTP fetch on mount');
            const effectBlock = source.slice(effectIdx, effectIdx + 300);
            expect(effectBlock).toContain("setFilterType('all')");
        });
    });

    describe('toolbar always visible', () => {
        it('toolbar renders unconditionally (not gated by running/queued length)', () => {
            // The toolbar div with "Queue" label should not be inside a conditional
            // that requires running.length > 0 or queued.length > 0
            const toolbarIdx = source.indexOf('Toolbar: Queue label, filter dropdown');
            expect(toolbarIdx).toBeGreaterThan(-1);
            // The toolbar should be a direct child of the panel, not conditionally rendered
            const beforeToolbar = source.slice(Math.max(0, toolbarIdx - 100), toolbarIdx);
            expect(beforeToolbar).not.toContain('running.length > 0');
        });

        it('pause/resume button is conditionally shown within the toolbar', () => {
            // Pause/resume button still has conditional visibility
            expect(source).toContain('(isPaused || running.length > 0 || queued.length > 0)');
        });
    });

    describe('preserves existing behavior', () => {
        it('still has pause/resume button with data-testid', () => {
            expect(source).toContain('data-testid="repo-pause-resume-btn"');
        });

        it('still shows Running/Queued/Completed section headers', () => {
            expect(source).toContain('Running Tasks');
            expect(source).toContain('Queued Tasks');
            expect(source).toContain('Completed Tasks');
        });

        it('still supports history collapse toggle', () => {
            expect(source).toContain('setShowHistory(!showHistory)');
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
