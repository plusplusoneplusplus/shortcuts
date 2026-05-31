/**
 * Tests for CommitDetail component source structure.
 *
 * Validates exports, props (diff + optional metadata), diff-only rendering,
 * commit info header section, overview-only diff support, error handling with retry,
 * and the API integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'commits', 'CommitDetail.tsx'
);

describe('CommitDetail', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports CommitDetail as a named export', () => {
            expect(source).toContain('export function CommitDetail');
        });

        it('exports CommitDetailProps interface', () => {
            expect(source).toContain('export interface CommitDetailProps');
        });
    });

    describe('component signature — diff props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional hash prop', () => {
            expect(source).toContain('hash?: string');
        });

        it('accepts optional commit prop', () => {
            expect(source).toContain('commit?: GitCommitItem');
        });
    });

    describe('diff API integration — always visible', () => {
        it('fetches from /git/commits/:hash/diff endpoint', () => {
            expect(source).toContain('/diff');
        });

        it('auto-fetches diff on mount (no toggle button)', () => {
            expect(source).not.toContain('View Full Diff');
            expect(source).not.toContain('Hide Diff');
            expect(source).not.toContain('data-testid="view-diff-btn"');
        });

        it('has diff loading state', () => {
            expect(source).toContain('data-testid="diff-loading"');
        });

        it('uses UnifiedDiffViewer for diff display', () => {
            expect(source).toContain('<UnifiedDiffViewer');
        });

        it('imports UnifiedDiffViewer', () => {
            expect(source).toContain("import { UnifiedDiffViewer, HunkNavButtons, parseDiffFileList } from '../diff/UnifiedDiffViewer'");
        });

        it('renders diff content with data-testid', () => {
            expect(source).toContain('data-testid="diff-content"');
        });

        it('has diff section container', () => {
            expect(source).toContain('data-testid="diff-section"');
        });

        it('has retry button for diff errors', () => {
            expect(source).toContain('data-testid="retry-diff-btn"');
            expect(source).toContain('Retry');
            expect(source).toContain('handleRetryDiff');
        });
    });

    describe('commit diff URL', () => {
        it('builds diffUrl from hash', () => {
            expect(source).toContain('const diffUrl = ');
        });

        it('constructs full commit diff URL through typed client', () => {
            expect(source).toContain('commitDiffPath(workspaceId, hash)');
        });

        it('does not construct per-file diff URLs', () => {
            expect(source).not.toContain('/files/${encodeURIComponent(focusedFilePath)}/diff');
            expect(source).not.toContain('/files/');
        });
    });

    describe('error handling', () => {
        it('tracks diff error state via useCachedDiff hook', () => {
            expect(source).toContain('diffError');
            expect(source).toContain('useCachedDiff');
        });

        it('shows visible error for diff loading failure', () => {
            expect(source).toContain('data-testid="diff-error"');
        });

        it('delegates error handling to useCachedDiff hook', () => {
            expect(source).toContain("import { useCachedDiff } from '../hooks/useCommitDiffCache'");
        });
    });

    describe('commit info header — metadata in right panel', () => {
        it('has commit-info-header section', () => {
            expect(source).toContain('data-testid="commit-info-header"');
        });

        it('has commit-info-subject section', () => {
            expect(source).toContain('data-testid="commit-info-subject"');
        });

        it('has commit-info-author section', () => {
            expect(source).toContain('data-testid="commit-info-author"');
        });

        it('has commit-info-date section', () => {
            expect(source).toContain('data-testid="commit-info-date"');
        });

        it('has commit-info-hash section', () => {
            expect(source).toContain('data-testid="commit-info-hash"');
        });

        it('has commit-info-parents section', () => {
            expect(source).toContain('data-testid="commit-info-parents"');
        });

        it('has commit-info-body section', () => {
            expect(source).toContain('data-testid="commit-info-body"');
        });

        it('imports copyToClipboard', () => {
            expect(source).toContain('copyToClipboard');
        });

        it('imports GitCommitItem type', () => {
            expect(source).toContain("import type { GitCommitItem } from './CommitList'");
        });

        it('conditionally renders header only for commit mode', () => {
            expect(source).toContain('commit && (');
        });
    });

    describe('overview-only responsibility', () => {
        it('does not accept focused-file props', () => {
            expect(source).not.toContain('focusedFilePath?: string | null');
            expect(source).not.toContain('onClearFocus?: () => void');
        });

        it('does not render focused-file breadcrumb controls', () => {
            expect(source).not.toContain('data-testid="focused-file-breadcrumb"');
            expect(source).not.toContain('data-testid="focused-file-back-btn"');
            expect(source).not.toContain('data-testid="focused-file-path"');
        });

        it('scrollToFilePath stays available for overview diff sections', () => {
            expect(source).toContain('if (!scrollToFilePath) return');
            expect(source).toContain('viewerRef.current?.scrollToFile(scrollToFilePath)');
        });
    });

    describe('commit detail root', () => {
        it('has data-testid', () => {
            expect(source).toContain('data-testid="commit-detail"');
        });
    });

    describe('DiffMiniMap layout — minimap stays fixed (does not scroll with content)', () => {
        it('outer commit-detail container uses overflow-hidden (not overflow-auto)', () => {
            expect(source).toContain('commit-detail flex flex-col h-full overflow-hidden');
        });

        it('outer commit-detail container does NOT have scrollContainerRef', () => {
            // The ref must NOT appear on the outermost div (which also has "commit-detail" class)
            expect(source).not.toMatch(/ref=\{scrollContainerRef\}[^>]*commit-detail/);
        });

        it('flex row wrapper has flex-1 so it fills remaining height', () => {
            expect(source).toContain('flex flex-1 min-h-0');
        });

        it('diff-section container has overflow-auto for scrolling', () => {
            expect(source).toContain('overflow-auto');
            expect(source).toContain('data-testid="diff-section"');
        });

        it('scrollContainerRef is placed on the diff-section container', () => {
            // ref and diff-section data-testid must be on the same element
            expect(source).toMatch(/ref=\{scrollContainerRef\}[^>]*data-testid="diff-section"/);
        });
    });

    describe('range-mode code removed', () => {
        it('does not import BranchCommitStrip', () => {
            expect(source).not.toContain('BranchCommitStrip');
        });

        it('does not import BranchAllFilesDiff', () => {
            expect(source).not.toContain('BranchAllFilesDiff');
        });

        it('does not contain range?: BranchRangeInfo', () => {
            expect(source).not.toContain('range?: BranchRangeInfo');
        });

        it('does not contain isRangeMode', () => {
            expect(source).not.toContain('isRangeMode');
        });

        it('does not contain RANGE_STORAGE_KEY', () => {
            expect(source).not.toContain('RANGE_STORAGE_KEY');
        });

        it('does not contain range-mode props', () => {
            expect(source).not.toContain('onFileSelect');
            expect(source).not.toContain('onAllCommentsClick');
            expect(source).not.toContain('onAskAI?: () => void');
            expect(source).not.toContain('onQueueTask?: () => void');
            expect(source).not.toContain('unpushedCount');
        });
    });
});
