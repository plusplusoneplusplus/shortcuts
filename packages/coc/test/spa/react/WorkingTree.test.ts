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
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'WorkingTree.tsx'
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
    });

    describe('basename helper', () => {
        it('strips trailing slash from directory paths', () => {
            // The basename function should handle paths like "packages/foo/" without returning ""
            expect(source).toContain(".replace(/\\/$/, '')");
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
});
