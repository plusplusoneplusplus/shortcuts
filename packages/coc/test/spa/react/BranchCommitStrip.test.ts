/**
 * Tests for BranchCommitStrip component source structure.
 *
 * Validates exports, props, rendering patterns, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'branches', 'BranchCommitStrip.tsx'
);

describe('BranchCommitStrip', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('file existence', () => {
        it('exists at expected path', () => {
            expect(fs.existsSync(COMPONENT_PATH)).toBe(true);
        });
    });

    describe('exports', () => {
        it('exports BranchCommitStrip as a named export', () => {
            expect(source).toContain('export function BranchCommitStrip');
        });
    });

    describe('imports', () => {
        it('imports formatRelativeTime', () => {
            expect(source).toContain("formatRelativeTime");
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("GitCommitItem");
        });

        it('imports BranchRangeInfo type', () => {
            expect(source).toContain("BranchRangeInfo");
        });

        it('imports shared pointer context drag helpers', () => {
            expect(source).toContain('GitRangeContextDragPayload');
            expect(source).toContain('writePointerContextDragData');
        });
    });

    describe('component signature', () => {
        it('accepts commits prop', () => {
            expect(source).toContain('commits: GitCommitItem[]');
        });

        it('accepts branchRangeData prop', () => {
            expect(source).toContain('branchRangeData: BranchRangeInfo');
        });
    });

    describe('rendering', () => {
        it('renders header with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip-header"');
        });

        it('renders commit list with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip-list"');
        });

        it('renders empty state', () => {
            expect(source).toContain('data-testid="branch-commit-strip-empty"');
        });

        it('renders outer container with data-testid', () => {
            expect(source).toContain('data-testid="branch-commit-strip"');
        });

        it('shows additions in green', () => {
            expect(source).toContain('text-[#16825d]');
        });

        it('shows deletions in red', () => {
            expect(source).toContain('text-[#d32f2f]');
        });

        it('shows short hashes in orange (unpushed color)', () => {
            expect(source).toContain('text-[#f57c00] dark:text-[#ffb74d]');
        });

        it('uses formatRelativeTime for commit dates', () => {
            expect(source).toContain('formatRelativeTime(commit.date)');
        });

        it('renders Ask AI button with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-ask-ai-btn"');
        });

        it('renders All Comments button with data-testid', () => {
            expect(source).toContain('data-testid="branch-range-all-comments-btn"');
        });

        it('makes the header a range pointer context drag source when payload is provided', () => {
            expect(source).toContain('sessionContextPayload?: GitRangeContextDragPayload | null');
            expect(source).toContain('draggable={!!sessionContextPayload}');
            expect(source).toContain('data-session-context-kind={sessionContextPayload ? \'range\' : undefined}');
            expect(source).toContain('writePointerContextDragData(e.dataTransfer, sessionContextPayload)');
        });
    });

    describe('Ask AI / All Comments props', () => {
        it('accepts onAskAI optional prop', () => {
            expect(source).toContain('onAskAI?: () => void');
        });

        it('accepts onAllCommentsClick optional prop', () => {
            expect(source).toContain('onAllCommentsClick?: () => void');
        });

        it('conditionally renders Ask AI button when onAskAI is provided', () => {
            expect(source).toContain('{onAskAI && (');
        });

        it('conditionally renders All Comments button when onAllCommentsClick is provided', () => {
            expect(source).toContain('{onAllCommentsClick && (');
        });

        it('Ask AI button calls onAskAI onClick', () => {
            expect(source).toContain('onClick={onAskAI}');
        });

        it('All Comments button calls onAllCommentsClick onClick', () => {
            expect(source).toContain('onClick={onAllCommentsClick}');
        });

        it('Ask AI button has accessible title', () => {
            expect(source).toContain('title="Ask AI about branch changes"');
        });

        it('All Comments button has accessible title', () => {
            expect(source).toContain('title="Show all branch comments"');
        });
    });
});
