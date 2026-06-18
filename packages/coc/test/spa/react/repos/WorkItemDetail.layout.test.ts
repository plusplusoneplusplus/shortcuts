/**
 * Tests for WorkItemDetail layout:
 * - Delete button placement (header, next to Execute)
 * - Execution Session section position (after AI Review, before Execution History)
 * - Execution history entries with commit links
 * - Inline commit review navigation via onViewCommit
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEM_DETAIL_SRC_PATH = path.join(REACT_SRC, 'features', 'work-items', 'WorkItemDetail.tsx');
const WORK_ITEMS_TAB_SRC_PATH = path.join(REACT_SRC, 'features', 'work-items', 'WorkItemsTab.tsx');
const WORK_ITEM_COMMIT_REVIEW_PANE_SRC_PATH = path.join(REACT_SRC, 'features', 'work-items', 'WorkItemCommitReviewPane.tsx');

describe('WorkItemDetail — layout', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(WORK_ITEM_DETAIL_SRC_PATH, 'utf-8');
    });

    describe('Delete button in header', () => {
        it('has the delete button with data-testid in the header', () => {
            expect(src).toContain('data-testid="work-item-delete-btn"');
        });

        it('places the delete button in the same container as the execute button', () => {
            // Both buttons should be inside the header "flex items-center gap-2 shrink-0" div
            const headerDiv = src.indexOf('flex items-center gap-2 shrink-0');
            const executeBtn = src.indexOf('data-testid="work-item-execute-btn"');
            const deleteBtn = src.indexOf('data-testid="work-item-delete-btn"');
            // All three should exist
            expect(headerDiv).toBeGreaterThan(-1);
            expect(executeBtn).toBeGreaterThan(-1);
            expect(deleteBtn).toBeGreaterThan(-1);
            // Delete button comes after execute button and after the header div
            expect(deleteBtn).toBeGreaterThan(executeBtn);
            expect(deleteBtn).toBeGreaterThan(headerDiv);
            // Both must be within the header (before the Body section)
            const bodyMarker = src.indexOf('{/* ── Body ── */}');
            expect(executeBtn).toBeLessThan(bodyMarker);
            expect(deleteBtn).toBeLessThan(bodyMarker);
        });

        it('does NOT have a separate Actions section', () => {
            expect(src).not.toContain('{/* Actions */}');
        });

        it('delete button triggers confirm dialog and typed delete request', () => {
            expect(src).toContain("confirm('Delete this work item?')");
            expect(src).toContain('workItems.deleteForOrigin(workItemOriginId, workItemId');
        });
    });

    describe('Execution Session position', () => {
        it('renders Execution Session section after AI Review and before Execution History', () => {
            const aiReviewPos = src.indexOf('{/* Review section');
            const execSessionPos = src.indexOf('{/* Execution session entry');
            const execHistoryPos = src.indexOf('{/* Execution history */}');
            const descriptionPos = src.indexOf('{/* Description */}');

            expect(aiReviewPos).toBeGreaterThan(-1);
            expect(execSessionPos).toBeGreaterThan(-1);
            expect(execHistoryPos).toBeGreaterThan(-1);
            expect(descriptionPos).toBeGreaterThan(-1);

            // Section order: Description < AI Review < Execution Session < Execution History
            expect(descriptionPos).toBeLessThan(aiReviewPos);
            expect(aiReviewPos).toBeLessThan(execSessionPos);
            expect(execSessionPos).toBeLessThan(execHistoryPos);
        });

        it('Execution Session is NOT between Error and Description', () => {
            // The execution session should come AFTER description, not before it
            const descriptionPos = src.indexOf('{/* Description */}');
            const execSessionPos = src.indexOf('{/* Execution session entry');
            expect(execSessionPos).toBeGreaterThan(descriptionPos);
        });
    });

    describe('Unified execution history with commits', () => {
        it('renders exec-entry data-testid for each execution entry', () => {
            expect(src).toContain('data-testid={`exec-entry-${i}`}');
        });

        it('renders exec-commits data-testid for commit sub-items', () => {
            expect(src).toContain('data-testid={`exec-commits-${i}`}');
        });

        it('looks up matching change by taskId to get commits', () => {
            expect(src).toContain("item.changes?.find(c => c.taskId === exec.taskId)");
            expect(src).toContain("matchingChange?.commits ?? []");
        });

        it('renders commit links for completed executions with commits', () => {
            // Should link to #commit/<sha> as fallback when onViewCommit is not provided
            expect(src).toContain('href={`#commit/${c.sha}`}');
            expect(src).toContain('c.sha.slice(0, 7)');
        });

        it('shows commit message and author inline with each commit', () => {
            expect(src).toContain('title={c.message}');
            expect(src).toContain('{c.message}');
            expect(src).toContain('{c.author');
        });

        it('shows "No commits" for completed executions without commits', () => {
            expect(src).toContain('No commits');
        });

        it('shows dash for running/failed/cancelled executions', () => {
            // Non-completed executions show a dash
            const dashPattern = src.includes('<span className="text-[#848484]">—</span>');
            expect(dashPattern).toBe(true);
        });

        it('renders each execution entry as a bordered card', () => {
            expect(src).toContain("rounded-md border border-[#e0e0e0]");
        });

        it('shows completed-at timestamp when available', () => {
            expect(src).toContain('exec.completedAt');
            expect(src).toContain('formatRelativeTime(exec.completedAt)');
        });

        it('does NOT have a separate Changes section', () => {
            expect(src).not.toContain('data-testid="work-item-changes-section"');
            // The old "Changes" heading should be gone
            expect(src).not.toContain('>Changes<');
        });

        it('renders orphaned changes for plan edits without matching execution', () => {
            expect(src).toContain('Orphaned changes');
            expect(src).toContain('data-testid={`orphaned-change-${change.id}`}');
            expect(src).toContain('Plan Change');
        });
    });

    describe('Per-commit resolve button', () => {
        it('does NOT gate the per-commit resolve button on isAiDone', () => {
            // The resolve button should be shown whenever openCount > 0,
            // not only when status is aiDone
            expect(src).not.toMatch(/isAiDone\s*&&\s*openCount\s*>\s*0\s*&&\s*\(\s*<button/);
        });

        it('shows resolve button when openCount > 0 in execution history', () => {
            // The button should be gated only on openCount > 0
            const execHistorySection = src.indexOf('{/* Execution history */}');
            const resolveBtn = src.indexOf('commit-resolve-btn-', execHistorySection);
            expect(resolveBtn).toBeGreaterThan(execHistorySection);
        });

        it('labels the button "Resolve with agent" in execution history', () => {
            const execHistorySection = src.indexOf('{/* Execution history */}');
            const orphanedSection = src.indexOf('Orphaned changes');
            // Find "Resolve with agent" between exec history and orphaned sections
            const labelPos = src.indexOf('Resolve with agent', execHistorySection);
            expect(labelPos).toBeGreaterThan(execHistorySection);
            expect(labelPos).toBeLessThan(orphanedSection);
        });

        it('renders resolve button in orphaned changes section', () => {
            const orphanedSection = src.indexOf('Orphaned changes');
            const resolveBtn = src.indexOf('commit-resolve-btn-', orphanedSection);
            expect(resolveBtn).toBeGreaterThan(orphanedSection);
        });

        it('labels the button "Resolve with agent" in orphaned changes', () => {
            const orphanedSection = src.indexOf('Orphaned changes');
            const labelPos = src.indexOf('Resolve with agent', orphanedSection);
            expect(labelPos).toBeGreaterThan(orphanedSection);
        });

        it('calls handlePerCommitResolve from orphaned changes resolve button', () => {
            const orphanedSection = src.indexOf('Orphaned changes');
            const handleCall = src.indexOf('handlePerCommitResolve(commit.sha)', orphanedSection);
            expect(handleCall).toBeGreaterThan(orphanedSection);
        });

        it('uses consistent commentTotals access in orphaned changes (.open/.resolved)', () => {
            const orphanedSection = src.indexOf('Orphaned changes');
            // Should access .open and .resolved, not use the value as a plain number
            const openAccess = src.indexOf('ct?.open', orphanedSection);
            const resolvedAccess = src.indexOf('ct?.resolved', orphanedSection);
            expect(openAccess).toBeGreaterThan(orphanedSection);
            expect(resolvedAccess).toBeGreaterThan(orphanedSection);
        });

        it('shows resolved badge in orphaned changes', () => {
            const orphanedSection = src.indexOf('Orphaned changes');
            const resolvedBadge = src.indexOf('commit-resolved-badge-', orphanedSection);
            expect(resolvedBadge).toBeGreaterThan(orphanedSection);
        });
    });

    describe('Execution history inline navigation', () => {
        it('renders "View Session →" as a labeled sub-line (not a bare arrow in the header)', () => {
            expect(src).toContain('View Session →');
            expect(src).toContain('onViewTask(exec.taskId)');
            expect(src).toContain('data-testid={`exec-view-session-${i}`}');
        });

        it('session link is outside the header row, in its own wrapper div', () => {
            // The session link should NOT be inside the flex header row that contains Run #
            // It should be in a separate div below it
            const execHistorySection = src.indexOf('{/* Execution history */}');
            const viewSession = src.indexOf('View Session →', execHistorySection);
            const runLabel = src.indexOf('Run #{i + 1}', execHistorySection);
            // "View Session" should appear after "Run #" in the execution history
            expect(viewSession).toBeGreaterThan(runLabel);
            // The header row line starts with 'flex gap-2 px-3 py-2'
            const headerFlexLine = src.lastIndexOf('flex gap-2 px-3 py-2', viewSession);
            expect(headerFlexLine).toBeGreaterThan(-1);
            const headerCloseDiv = src.indexOf('</div>', headerFlexLine);
            expect(viewSession).toBeGreaterThan(headerCloseDiv);
        });

        it('falls back to process link when onViewTask is not provided', () => {
            // When onViewTask is absent, the anchor link to #process/ should still render
            expect(src).toContain('href={`#process/${exec.processId}`}');
        });

        it('prefers onViewTask over process link', () => {
            // onViewTask branch should come before the process link fallback
            const onViewTaskPos = src.indexOf('onViewTask(exec.taskId)');
            const processLinkPos = src.indexOf('href={`#process/${exec.processId}`}');
            expect(onViewTaskPos).toBeGreaterThan(-1);
            expect(processLinkPos).toBeGreaterThan(-1);
            expect(onViewTaskPos).toBeLessThan(processLinkPos);
        });
    });

    describe('Inline commit review navigation (onViewCommit)', () => {
        it('accepts onViewCommit as an optional prop', () => {
            expect(src).toContain('onViewCommit?: (sha: string) => void');
        });

        it('destructures onViewCommit from props', () => {
            expect(src).toContain('onViewCommit');
            // Should be in the destructured props list
            expect(src).toMatch(/\{\s*[^}]*onViewCommit[^}]*\}\s*:\s*WorkItemDetailProps/);
        });

        it('uses onViewCommit button in execution history when provided', () => {
            // When onViewCommit is provided, render a button instead of an anchor
            expect(src).toContain('onViewCommit(c.sha)');
            expect(src).toContain('data-testid={`exec-commit-${c.sha.slice(0, 7)}`}');
        });

        it('falls back to anchor link in execution history when onViewCommit is absent', () => {
            // The fallback href should still exist
            expect(src).toContain('href={`#commit/${c.sha}`}');
        });

        it('prefers onViewCommit button over anchor link in execution history commits', () => {
            const onViewCommitPos = src.indexOf('onViewCommit(c.sha)');
            const anchorPos = src.indexOf('href={`#commit/${c.sha}`}');
            expect(onViewCommitPos).toBeGreaterThan(-1);
            expect(anchorPos).toBeGreaterThan(-1);
            expect(onViewCommitPos).toBeLessThan(anchorPos);
        });

        it('uses onViewCommit button for orphaned changes when provided', () => {
            expect(src).toContain('onViewCommit(commit.sha)');
            expect(src).toContain('data-testid={`change-commit-${commit.sha.slice(0, 7)}`}');
        });

        it('falls back to plain code element for orphaned changes when onViewCommit is absent', () => {
            // The orphaned changes section should still have the plain <code> fallback
            expect(src).toContain('<code className="text-[#848484] shrink-0 font-mono">{commit.sha.slice(0, 7)}</code>');
        });
    });
});

describe('WorkItemsTab — commit review navigation', () => {
    let tabSrc: string;
    let commitReviewPaneSrc: string;

    beforeAll(() => {
        tabSrc = fs.readFileSync(WORK_ITEMS_TAB_SRC_PATH, 'utf-8');
        commitReviewPaneSrc = fs.readFileSync(WORK_ITEM_COMMIT_REVIEW_PANE_SRC_PATH, 'utf-8');
    });

    it('has selectedCommitHash state', () => {
        expect(tabSrc).toContain('selectedCommitHash');
        expect(tabSrc).toContain('setSelectedCommitHash');
    });

    it('imports WorkItemCommitReviewPane component', () => {
        expect(tabSrc).toMatch(/import\s*\{[^}]*WorkItemCommitReviewPane[^}]*\}\s*from\s*['"]\.\/WorkItemCommitReviewPane['"]/);
    });

    it('renders WorkItemCommitReviewPane when selectedCommitHash is set', () => {
        expect(tabSrc).toContain('<WorkItemCommitReviewPane');
        expect(commitReviewPaneSrc).toContain('data-testid="work-item-commit-review"');
        expect(commitReviewPaneSrc).toContain('<CommitDetail');
    });

    it('has a back button to return from commit review', () => {
        expect(commitReviewPaneSrc).toContain('data-testid="commit-review-back-btn"');
        expect(tabSrc).toContain('handleBackFromCommit');
    });

    it('prioritises commit hash view over session task view', () => {
        // selectedCommitHash branch should appear before selectedSessionTaskId branch
        const commitPos = tabSrc.indexOf('selectedCommitHash ?');
        const sessionPos = tabSrc.indexOf('selectedSessionTaskId ?');
        expect(commitPos).toBeGreaterThan(-1);
        expect(sessionPos).toBeGreaterThan(-1);
        expect(commitPos).toBeLessThan(sessionPos);
    });

    it('clears selectedCommitHash when selecting a new work item', () => {
        // handleSelectWorkItem should reset commit hash
        const selectFn = tabSrc.indexOf('handleSelectWorkItem');
        const clearInSelect = tabSrc.indexOf('setSelectedCommitHash(null)', selectFn);
        expect(clearInSelect).toBeGreaterThan(selectFn);
    });

    it('clears selectedCommitHash when going back to list', () => {
        // handleBack should reset commit hash
        const backFn = tabSrc.indexOf('const handleBack');
        const clearInBack = tabSrc.indexOf('setSelectedCommitHash(null)', backFn);
        expect(clearInBack).toBeGreaterThan(backFn);
    });

    it('passes onViewCommit to WorkItemDetail', () => {
        expect(tabSrc).toContain('onViewCommit={handleViewCommit}');
    });

    it('shows truncated commit hash in the review header', () => {
        expect(commitReviewPaneSrc).toContain('selectedCommitHash.slice(0, 7)');
    });
});
