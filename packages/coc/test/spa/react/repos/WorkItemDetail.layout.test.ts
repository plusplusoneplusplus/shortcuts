/**
 * Tests for WorkItemDetail layout:
 * - Delete button placement (header, next to Execute)
 * - Execution Session section position (after AI Review, before Execution History)
 * - Execution history entries with commit links
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEM_DETAIL_SRC_PATH = path.join(REACT_SRC, 'repos', 'WorkItemDetail.tsx');

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

        it('delete button triggers confirm dialog and DELETE request', () => {
            expect(src).toContain("confirm('Delete this work item?')");
            expect(src).toContain("method: 'DELETE'");
        });
    });

    describe('Execution Session position', () => {
        it('renders Execution Session section after AI Review and before Execution History', () => {
            const aiReviewPos = src.indexOf('{/* AI Review section');
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

    describe('Execution history entries with commits', () => {
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
            // Should link to #commit/<sha>
            expect(src).toContain('href={`#commit/${c.sha}`}');
            expect(src).toContain('c.sha.slice(0, 7)');
        });

        it('shows "No commits" for completed executions without commits', () => {
            expect(src).toContain('No commits');
        });

        it('shows dash for running/failed/cancelled executions', () => {
            // Non-completed executions show a dash
            const dashPattern = src.includes('<span className="text-[#848484]">—</span>');
            expect(dashPattern).toBe(true);
        });

        it('sets commit message as title attribute on commit links', () => {
            expect(src).toContain('title={c.message}');
        });
    });
});
