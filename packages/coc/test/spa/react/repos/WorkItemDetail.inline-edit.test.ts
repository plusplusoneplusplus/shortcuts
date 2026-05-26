/**
 * Layout/source-string tests for WorkItemDetail inline edit mode.
 * These tests verify that the source file contains the expected patterns
 * for the container work item inline edit feature (AC-01, AC-02, AC-03).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('WorkItemDetail inline edit', () => {
    let src: string;

    beforeAll(() => {
        src = readFileSync(
            resolve(__dirname, '../../../../src/server/spa/client/react/features/work-items/WorkItemDetail.tsx'),
            'utf8'
        );
    });

    describe('AC-01: Edit mode for container items', () => {
        it('imports isWorkItemsHierarchyEnabled', () => {
            expect(src).toContain('isWorkItemsHierarchyEnabled');
        });

        it('imports WorkItemParentPicker', () => {
            expect(src).toContain('WorkItemParentPicker');
        });

        it('defines hierarchyEnabled constant', () => {
            expect(src).toContain('hierarchyEnabled = isWorkItemsHierarchyEnabled()');
        });

        it('defines isEditing state', () => {
            expect(src).toContain('isEditing');
        });

        it('renders Edit button only when isContainer and hierarchyEnabled', () => {
            expect(src).toContain('isContainer && hierarchyEnabled');
            expect(src).toContain("wi-edit-btn");
        });

        it('shows Save and Cancel buttons in edit mode', () => {
            expect(src).toContain("wi-edit-save-btn");
            expect(src).toContain("wi-edit-cancel-btn");
        });

        it('handleEditStart populates edit state from item', () => {
            expect(src).toContain('handleEditStart');
            expect(src).toContain('setEditTitle(item.title)');
        });

        it('handleEditCancel clears editing state', () => {
            expect(src).toContain('handleEditCancel');
            expect(src).toContain('setIsEditing(false)');
        });

        it('resets edit mode when workItemId changes', () => {
            expect(src).toContain('setIsEditing(false)');
            expect(src).toContain('[workItemId]');
        });
    });

    describe('AC-02: Editable fields', () => {
        it('has title input in edit mode', () => {
            expect(src).toContain('wi-edit-title-input');
        });

        it('has description textarea in edit mode', () => {
            expect(src).toContain('wi-edit-description-input');
        });

        it('has priority select with High, Normal, Low options', () => {
            expect(src).toContain('wi-edit-priority-select');
            expect(src).toContain('"high"');
            expect(src).toContain('"normal"');
            expect(src).toContain('"low"');
        });

        it('has tags input', () => {
            expect(src).toContain('wi-edit-tags-input');
        });

        it('has parent edit section for non-epic containers', () => {
            expect(src).toContain('work-item-parent-edit');
            expect(src).toContain('wi-edit-parent-btn');
        });

        it('does not offer parent unlink in edit UI — no null parentId send', () => {
            // The new edit UI should not set parentId to null
            expect(src).not.toContain("parentId: null");
        });

        it('keeps type immutable — no type field in edit form', () => {
            expect(src).not.toContain("updates.type");
        });
    });

    describe('AC-03: Validation, save, and error handling', () => {
        it('handleEditSave trims title and validates', () => {
            expect(src).toContain('trimmedTitle = editTitle.trim()');
            expect(src).toContain("Title is required");
        });

        it('normalizes tags to unique trimmed non-empty values', () => {
            expect(src).toContain("split(',')");
            expect(src).toContain('new Set(parsedTags)');
        });

        it('shows edit error display', () => {
            expect(src).toContain('wi-edit-error');
            expect(src).toContain('editError');
        });

        it('does not send status from editor', () => {
            const handleSaveBlock = src.slice(
                src.indexOf('handleEditSave = useCallback'),
                src.indexOf('}, [editTitle')
            );
            expect(handleSaveBlock).not.toContain('status');
        });

        it('dispatches WORK_ITEM_UPDATED on success', () => {
            expect(src).toContain("WORK_ITEM_UPDATED");
        });

        it('disables controls during save via saving state', () => {
            expect(src).toContain('disabled={saving}');
        });

        it('uses existing PATCH endpoint via workItems.update', () => {
            expect(src).toContain('workItems.update(workspaceId, workItemId');
        });

        it('shows WorkItemParentPicker with onlyPick for parent editing', () => {
            expect(src).toContain('onlyPick={true}');
            expect(src).toContain('showParentPicker');
        });
    });
});
