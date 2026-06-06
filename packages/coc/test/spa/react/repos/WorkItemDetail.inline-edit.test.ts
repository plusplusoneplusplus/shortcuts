/**
 * Source-pattern tests for WorkItemDetail always-on inline editing.
 *
 * The work item detail view no longer has an Edit button / edit-mode toggle.
 * Every field renders as an editable control at all times and a single Ctrl+S
 * (Cmd+S) persists all dirty fields in one batch (AC-01..AC-05).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('WorkItemDetail always-on inline editing', () => {
    let src: string;

    beforeAll(() => {
        src = readFileSync(
            resolve(__dirname, '../../../../src/server/spa/client/react/features/work-items/WorkItemDetail.tsx'),
            'utf8'
        );
    });

    describe('AC-01: no Edit button / edit-mode toggle', () => {
        it('removes the Edit button testid and edit-toggle handlers', () => {
            expect(src).not.toContain('wi-edit-btn');
            expect(src).not.toContain('wi-edit-save-btn');
            expect(src).not.toContain('wi-edit-cancel-btn');
            expect(src).not.toContain('handleEditStart');
            expect(src).not.toContain('handleEditCancel');
            expect(src).not.toMatch(/\bisEditing\b/);
        });

        it('renders fields as always-on inputs', () => {
            expect(src).toContain('wi-title-input');
            expect(src).toContain('WorkItemDescriptionEditor');
            expect(src).toContain('wi-priority-select');
            expect(src).toContain('wi-tags-input');
        });

        it('binds inputs to the unified draft via updateDraft', () => {
            expect(src).toContain('const updateDraft');
            expect(src).toContain("updateDraft('title'");
            expect(src).toContain("updateDraft('description'");
            expect(src).toContain("updateDraft('priority'");
            expect(src).toContain("updateDraft('tags'");
            expect(src).toContain("updateDraft('status'");
        });
    });

    describe('AC-02: batched Ctrl+S save', () => {
        it('has a single Save affordance gated on isDirty', () => {
            expect(src).toContain('wi-save-btn');
            expect(src).toContain('disabled={!isDirty || saving}');
        });

        it('listens for Ctrl+S / Cmd+S to trigger save', () => {
            expect(src).toContain('e.metaKey || e.ctrlKey');
            expect(src).toMatch(/e\.key === 's'/);
            expect(src).toContain("addEventListener('keydown'");
        });

        it('status feeds the draft instead of instant-saving', () => {
            expect(src).not.toContain('handleStatusChange');
            const idx = src.indexOf('work-item-status-select');
            const statusSelect = src.slice(idx - 400, idx + 200);
            expect(statusSelect).toContain("updateDraft('status'");
        });

        it('saves metadata in a single PATCH via workItems.update', () => {
            expect(src).toContain('workItems.update(workspaceId, workItemId, updates');
        });

        it('plan changes join the same PATCH payload', () => {
            expect(src).toContain('planChanged');
            expect(src).toContain('updates.plan');
            expect(src).not.toContain('workItems.updatePlan(workspaceId, workItemId, planDraft');
        });
    });

    describe('AC-04: dirty indicator + navigation warning', () => {
        it('shows an unsaved-changes indicator when dirty', () => {
            expect(src).toContain('wi-dirty-indicator');
            expect(src).toContain('isDirty');
        });

        it('warns on page unload while dirty', () => {
            expect(src).toContain("addEventListener('beforeunload'");
        });

        it('guards in-app back navigation while dirty', () => {
            expect(src).toContain('guardedBack');
            expect(src).toContain('unsaved changes');
        });

        it('guards SPA hash and link navigation while dirty', () => {
            expect(src).toContain("addEventListener('hashchange'");
            expect(src).toContain("addEventListener('click'");
            expect(src).toContain('lastAllowedHashRef');
        });
    });

    describe('AC-05: save failure preserves values', () => {
        it('validates title and shows inline error', () => {
            expect(src).toContain('draftToSave.title.trim()');
            expect(src).toContain('Title is required');
            expect(src).toContain('wi-edit-error');
            expect(src).toContain('setEditError');
        });

        it('does not invent new request fields — reuses UpdateWorkItemRequest shape', () => {
            expect(src).not.toContain('updates.type');
            expect(src).not.toContain('parentId: null');
        });

        it('normalizes tags to unique trimmed non-empty values', () => {
            expect(src).toContain('function parseTags');
            expect(src).toContain('new Set(tags.split');
        });
    });

    describe('AC-06: remote sync conflict resolution', () => {
        it('detects the shared sync conflict code and renders an inline panel', () => {
            expect(src).toContain('WORK_ITEM_SYNC_CONFLICT_CODE');
            expect(src).toContain('getSyncConflictDetails');
            expect(src).toContain('wi-sync-conflict-panel');
        });

        it('retries the normal PATCH path with syncConflictResolution', () => {
            expect(src).toContain('syncConflictResolution');
            expect(src).toContain('conflictResolutionFor');
            expect(src).toContain('Apply resolution &amp; Save');
            expect(src).toContain('saveDraft(resolvedDraft, conflictResolutionFor(syncConflict))');
        });
    });
});
