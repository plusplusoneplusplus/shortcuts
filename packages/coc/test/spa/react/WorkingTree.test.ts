/**
 * Tests for WorkingTree component source structure.
 *
 * Validates exports, props, parent group collapse/expand behavior,
 * sub-section rendering, and per-file action buttons.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'working-tree', 'WorkingTree.tsx'
);

describe('WorkingTree', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports WorkingTree as a named export', () => {
            expect(source).toContain('export function WorkingTree');
        });

        it('exports WorkingTreeChange interface', () => {
            expect(source).toContain('export interface WorkingTreeChange');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional onRefresh callback', () => {
            expect(source).toContain('onRefresh?: () => void');
        });

        it('accepts optional refreshKey prop', () => {
            expect(source).toContain('refreshKey?: number');
        });

        it('destructures refreshKey in function signature', () => {
            expect(source).toContain('refreshKey');
        });
    });

    describe('working changes parent group', () => {
        it('renders parent group with data-testid', () => {
            expect(source).toContain('data-testid="working-changes-group"');
        });

        it('renders parent group header button', () => {
            expect(source).toContain('data-testid="working-changes-header"');
        });

        it('shows "Working Changes" label', () => {
            expect(source).toContain('Working Changes');
        });

        it('shows combined totalCount badge', () => {
            expect(source).toContain('totalCount');
            expect(source).toContain('{totalCount}');
        });

        it('renders the header as a single compact line', () => {
            // Compact card: badge + summary share one row — no fixed 38px min
            // height and no stacked two-line body.
            expect(source).not.toContain('min-h-[38px]');
            expect(source).not.toContain('flex flex-col gap-0.5');
        });

        it('tracks workingChangesExpanded state', () => {
            expect(source).toContain('workingChangesExpanded');
            expect(source).toContain('setWorkingChangesExpanded');
        });

        it('initializes collapsed (false) by default', () => {
            expect(source).toContain('useState(false)');
        });

        it('auto-expands when changes become non-empty', () => {
            expect(source).toContain('changes.length > 0');
            expect(source).toContain('setWorkingChangesExpanded(true)');
        });

        it('renders working-changes-content when expanded', () => {
            expect(source).toContain('data-testid="working-changes-content"');
        });

        it('shows expand/collapse chevron indicators', () => {
            expect(source).toContain('▶');
            expect(source).toContain('▼');
        });
    });

    describe('sub-sections inside parent group', () => {
        it('renders Staged sub-section', () => {
            expect(source).toContain('testId="working-tree-staged"');
        });

        it('renders Changes (unstaged) sub-section', () => {
            expect(source).toContain('testId="working-tree-unstaged"');
        });

        it('renders Untracked sub-section', () => {
            expect(source).toContain('testId="working-tree-untracked"');
        });

        it('sub-sections are inside working-changes-content', () => {
            const contentIdx = source.indexOf('working-changes-content');
            const stagedIdx = source.indexOf('working-tree-staged');
            expect(contentIdx).toBeGreaterThan(-1);
            expect(stagedIdx).toBeGreaterThan(contentIdx);
        });
    });

    describe('totalCount computation', () => {
        it('computes totalCount from staged + unstaged + untracked', () => {
            expect(source).toContain('const totalCount = staged.length + unstaged.length + untracked.length');
        });
    });

    describe('per-file actions', () => {
        it('has stage action for unstaged files', () => {
            expect(source).toContain("onAction('stage')");
        });

        it('has unstage action for staged files', () => {
            expect(source).toContain("onAction('unstage')");
        });

        it('has discard action for unstaged files', () => {
            expect(source).toContain("onAction('discard')");
        });

        it('has delete action for untracked files', () => {
            expect(source).toContain("onAction('delete')");
        });

        it('has Stage All button for Changes section', () => {
            expect(source).toContain('handleStageAll');
        });

        it('has Unstage All button for Staged section', () => {
            expect(source).toContain('handleUnstageAll');
        });

        it('renders actions via shared components with renderActions slot', () => {
            expect(source).toContain('renderActions');
            expect(source).toContain('FileActions');
        });
    });

    describe('basename helper', () => {
        it('strips trailing slash from directory paths', () => {
            // The basename function should handle paths like "packages/foo/" without returning ""
            expect(source).toContain(".replace(/\\/$/, '')");
        });
    });

    describe('refreshKey external refresh', () => {
        it('imports useRef', () => {
            expect(source).toContain('useRef');
        });

        it('declares refreshKeyMountedRef to skip initial render', () => {
            expect(source).toContain('refreshKeyMountedRef');
        });

        it('has useEffect depending on refreshKey', () => {
            expect(source).toContain('[refreshKey, fetchChanges]');
        });

        it('guards against undefined refreshKey before fetching', () => {
            expect(source).toContain('if (refreshKey !== undefined)');
        });

        it('calls fetchChanges when refreshKey changes', () => {
            const effectIdx = source.indexOf('[refreshKey, fetchChanges]');
            const fetchCallIdx = source.lastIndexOf('fetchChanges()', effectIdx);
            expect(fetchCallIdx).toBeGreaterThan(-1);
        });
    });

    describe('loading and error states', () => {
        it('shows loading indicator', () => {
            expect(source).toContain('data-testid="working-tree-loading"');
        });

        it('shows error state', () => {
            expect(source).toContain('data-testid="working-tree-error"');
        });

        it('shows action error', () => {
            expect(source).toContain('data-testid="working-tree-action-error"');
        });
    });

    describe('all-comments button', () => {
        it('accepts optional onAllCommentsClick prop', () => {
            expect(source).toContain('onAllCommentsClick?: () => void');
        });

        it('renders the all-comments button when onAllCommentsClick is provided', () => {
            expect(source).toContain('data-testid="working-tree-all-comments-btn"');
        });

        it('shows comment count badge from allWorkingComments', () => {
            expect(source).toContain('allWorkingComments.length');
        });

        it('fetches working-tree comments through typed git client', () => {
            expect(source).toContain("listDiffComments(workspaceId, { newRef: 'working-tree' })");
        });

        it('stops click propagation on the all-comments button', () => {
            expect(source).toContain('e.stopPropagation()');
        });
    });

    describe('batch staging endpoints', () => {
        it('handleStageAll uses typed stageFiles method', () => {
            expect(source).toContain('stageFiles(workspaceId, files.map(f => f.filePath))');
        });

        it('handleUnstageAll uses typed unstageFiles method', () => {
            expect(source).toContain('unstageFiles(workspaceId, files.map(f => f.filePath))');
        });

        it('handleStageAll sends a single POST request (no per-file loop)', () => {
            // Ensure the old per-file loop pattern is gone
            const stageAllStart = source.indexOf('handleStageAll');
            const stageAllEnd = source.indexOf('handleUnstageAll');
            const stageAllBody = source.substring(stageAllStart, stageAllEnd);
            expect(stageAllBody).not.toContain('for (const f of files)');
        });

        it('handleUnstageAll sends a single POST request (no per-file loop)', () => {
            const unstageAllStart = source.indexOf('handleUnstageAll');
            const unstageAllEnd = source.indexOf('const staged', unstageAllStart);
            const unstageAllBody = source.substring(unstageAllStart, unstageAllEnd);
            expect(unstageAllBody).not.toContain('for (const f of files)');
        });
    });

    describe('Discard All bulk action', () => {
        it('renders a visible Discard All control (not in an overflow menu)', () => {
            expect(source).toContain('data-testid="working-tree-discard-all"');
            expect(source).toContain('Discard All');
        });

        it('places the control in a bulk-actions area inside the expanded content', () => {
            expect(source).toContain('data-testid="working-tree-bulk-actions"');
            const contentIdx = source.indexOf('working-changes-content');
            const bulkIdx = source.indexOf('working-tree-bulk-actions');
            const stagedIdx = source.indexOf('working-tree-staged');
            // Bulk actions sit between the content wrapper and the first section.
            expect(bulkIdx).toBeGreaterThan(contentIdx);
            expect(stagedIdx).toBeGreaterThan(bulkIdx);
        });

        it('only shows the control when there are changes', () => {
            expect(source).toContain('totalCount > 0 &&');
        });

        it('discards through the typed clone-routed git client', () => {
            expect(source).toContain('cloneClient.git.discardAllChanges(workspaceId)');
        });

        it('tracks an in-progress state and disables the control while running', () => {
            expect(source).toContain('discardingAll');
            expect(source).toContain('setDiscardingAll');
            expect(source).toContain('disabled={discardingAll || stagingAll}');
        });

        it('refreshes the working tree even on failure so partial failures are not hidden', () => {
            const start = source.indexOf('handleDiscardAll');
            const end = source.indexOf('const staged', start);
            const body = source.substring(start, end);
            // catch block still refreshes before surfacing the error
            expect(body).toContain('catch');
            expect(body).toContain('fetchChanges()');
            expect(body).toContain('setActionError');
        });

        it('surfaces discard errors so it cannot look like success', () => {
            expect(source).toContain('result.errors');
        });
    });
});
