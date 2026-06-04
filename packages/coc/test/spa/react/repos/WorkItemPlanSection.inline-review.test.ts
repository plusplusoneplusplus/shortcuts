/**
 * Tests for WorkItemPlanSection inline review behavior.
 *
 * Verifies that the component:
 * - Uses markdown rendering (dangerouslySetInnerHTML) instead of plain text
 * - Wires useTaskComments with the synthetic __wi-plan__/<workItemId> path
 * - Includes right-click context menu with "Add comment" and "Ask AI"
 * - Includes InlineCommentPopup for composing comments
 * - Includes CommentSidebar for reviewing comments
 * - Includes CommentPopover for clicking highlighted spans
 * - Exposes a "Resolve N comments with AI" button when open comments exist
 * - Builds anchor data via createAnchorData from forge
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const PLAN_SECTION_PATH = path.join(REACT_SRC, 'features', 'work-items', 'WorkItemPlanSection.tsx');

describe('WorkItemPlanSection — inline review', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(PLAN_SECTION_PATH, 'utf-8');
    });

    // ── Imports ──────────────────────────────────────────────────────────────

    it('imports useMarkdownPreview for markdown rendering', () => {
        expect(src).toContain("import { useMarkdownPreview }");
    });

    it('imports useTaskComments for inline comment CRUD', () => {
        expect(src).toContain("import { useTaskComments }");
    });

    it('imports ContextMenu component', () => {
        expect(src).toContain("import { ContextMenu }");
    });

    it('imports InlineCommentPopup component', () => {
        expect(src).toContain("import { InlineCommentPopup }");
    });

    it('imports CommentSidebar component', () => {
        expect(src).toContain("import { CommentSidebar }");
    });

    it('imports CommentPopover component', () => {
        expect(src).toContain("import { CommentPopover }");
    });

    it('imports selectionToSourcePosition utility', () => {
        expect(src).toContain("import { selectionToSourcePosition }");
    });

    it('imports createAnchorData from forge', () => {
        expect(src).toContain("createAnchorData");
        expect(src).toContain("DEFAULT_ANCHOR_MATCH_CONFIG");
    });

    it('imports DASHBOARD_AI_COMMANDS for Ask AI submenu', () => {
        expect(src).toContain("import { DASHBOARD_AI_COMMANDS }");
    });

    it('imports extractDocumentContext for AI context', () => {
        expect(src).toContain("import { extractDocumentContext }");
    });

    // ── Synthetic comment path ────────────────────────────────────────────────

    it('defines planCommentPath helper returning __wi-plan__ prefixed path', () => {
        expect(src).toContain('__wi-plan__/');
        expect(src).toContain('planCommentPath');
    });

    it('passes synthetic comment path to useTaskComments', () => {
        expect(src).toContain('useTaskComments(workspaceId, commentPath)');
    });

    // ── Selection & context menu ──────────────────────────────────────────────

    it('tracks savedSelection state for selected text', () => {
        expect(src).toContain('savedSelection');
        expect(src).toContain('setSavedSelection');
    });

    it('adds mouseup listener to capture text selections', () => {
        expect(src).toContain('mouseup');
        expect(src).toContain('window.getSelection()');
    });

    it('respects MIN_SELECTION_LENGTH threshold', () => {
        expect(src).toContain('MIN_SELECTION_LENGTH');
    });

    it('implements handleContextMenu that prevents default', () => {
        expect(src).toContain('handleContextMenu');
        expect(src).toContain('e.preventDefault()');
    });

    it('disables context menu in source (edit) mode', () => {
        expect(src).toContain("if (viewMode !== 'preview') return;");
    });

    it('attaches onContextMenu to the markdown preview div', () => {
        expect(src).toContain('onContextMenu={handleContextMenu}');
    });

    // ── Markdown rendering ────────────────────────────────────────────────────

    it('renders plan content via dangerouslySetInnerHTML', () => {
        expect(src).toContain('dangerouslySetInnerHTML');
        expect(src).toContain('__html:');
    });

    it('passes renderComments to useMarkdownPreview for highlight injection', () => {
        expect(src).toContain('renderComments');
        expect(src).toContain('comments: renderComments');
    });

    it('maps planComments to RenderCommentInfo[]', () => {
        expect(src).toContain('RenderCommentInfo');
        expect(src).toContain('planComments.map(c => ({ id: c.id, selection: c.selection, status: c.status }))');
    });

    it('uses markdown-body CSS class for plan content div', () => {
        expect(src).toContain('markdown-body');
    });

    // ── Comment interactions ──────────────────────────────────────────────────

    it('implements handleAddCommentFromMenu using savedSelection', () => {
        expect(src).toContain('handleAddCommentFromMenu');
        expect(src).toContain('savedSelection.range.getBoundingClientRect()');
    });

    it('implements handlePopupSubmit that calls addComment with selection', () => {
        expect(src).toContain('handlePopupSubmit');
        expect(src).toContain('await addComment({');
        expect(src).toContain('filePath: commentPath');
        expect(src).toContain('selectedText: pendingSelection.text');
    });

    it('builds anchor data in popup submit', () => {
        expect(src).toContain('buildPlanAnchor(');
        expect(src).toContain('anchor,');
    });

    it('implements handleHighlightClick for comment span clicks', () => {
        expect(src).toContain('handleHighlightClick');
        expect(src).toContain('[data-comment-id]');
        expect(src).toContain('onClick={handleHighlightClick}');
    });

    // ── ContextMenu rendering ─────────────────────────────────────────────────

    it('renders ContextMenu when contextMenuVisible is true', () => {
        expect(src).toContain('{contextMenuVisible && (');
        expect(src).toContain('<ContextMenu');
    });

    it('ContextMenu includes Add comment item', () => {
        expect(src).toContain("label: 'Add comment'");
    });

    it('ContextMenu includes Ask AI submenu populated from DASHBOARD_AI_COMMANDS', () => {
        expect(src).toContain("label: 'Ask AI'");
        expect(src).toContain('DASHBOARD_AI_COMMANDS');
    });

    it('Add comment item is disabled when no text is selected', () => {
        expect(src).toContain('disabled: !savedSelection');
    });

    // ── InlineCommentPopup ────────────────────────────────────────────────────

    it('renders InlineCommentPopup when popupVisible is true', () => {
        expect(src).toContain('{popupVisible && (');
        expect(src).toContain('<InlineCommentPopup');
    });

    it('InlineCommentPopup passes onSubmit={handlePopupSubmit}', () => {
        expect(src).toContain('onSubmit={handlePopupSubmit}');
    });

    // ── CommentSidebar ────────────────────────────────────────────────────────

    it('renders CommentSidebar when planComments are present', () => {
        expect(src).toContain('planComments.length > 0');
        expect(src).toContain('<CommentSidebar');
    });

    it('CommentSidebar is hidden in source (edit) mode', () => {
        expect(src).toContain("planComments.length > 0 && viewMode === 'preview'");
    });

    it('CommentSidebar has data-testid work-item-plan-comment-sidebar', () => {
        expect(src).toContain('data-testid="work-item-plan-comment-sidebar"');
    });

    it('CommentSidebar wires onResolve to handleResolveSingleComment, onUnresolve, and onDelete', () => {
        expect(src).toContain('onResolve={handleResolveSingleComment}');
        expect(src).toContain('onUnresolve={unresolveComment}');
        expect(src).toContain('onDelete={deleteComment}');
    });

    // ── CommentPopover ────────────────────────────────────────────────────────

    it('renders CommentPopover when activePopoverComment is set', () => {
        expect(src).toContain('{activePopoverComment && (');
        expect(src).toContain('<CommentPopover');
    });

    // ── Resolve All with AI ───────────────────────────────────────────────────

    it('implements handleResolveAllWithAI that uses the typed resolve-comments client method', () => {
        expect(src).toContain('handleResolveAllWithAI');
        expect(src).toContain('workItems.resolveComments(workspaceId, workItemId, { type: \'plan\' })');
    });

    it('filters open inline comments before resolving', () => {
        expect(src).toContain("planComments.filter(c => c.status === 'open')");
    });

    it('renders Resolve N comments with AI button when open comments exist', () => {
        expect(src).toContain('data-testid="work-item-plan-resolve-all-btn"');
        expect(src).toContain('openCommentCount');
    });

    it('passes onResolveAllWithAI to CommentSidebar', () => {
        expect(src).toContain('onResolveAllWithAI={openCommentCount > 0 ? handleResolveAllWithAI : undefined}');
    });

    // ── Single comment resolve via AI ─────────────────────────────────────────

    it('implements handleResolveSingleComment', () => {
        expect(src).toContain('handleResolveSingleComment');
    });

    it('handleResolveSingleComment posts to batch-resolve with singleCommentId', () => {
        expect(src).toContain('singleCommentId: commentId');
        expect(src).toContain('batch-resolve');
    });

    it('handleResolveSingleComment does not call onNavigateToTasksTab', () => {
        // The single-comment resolve callback must not reference onNavigateToTasksTab
        const fn = src.match(/handleResolveSingleComment[\s\S]*?}\s*,\s*\[/)?.[0] ?? '';
        expect(fn).not.toContain('onNavigateToTasksTab');
    });

    it('CommentSidebar onResolve is wired to handleResolveSingleComment', () => {
        expect(src).toContain('onResolve={handleResolveSingleComment}');
    });

    it('CommentPopover onResolve uses handleResolveSingleComment', () => {
        expect(src).toContain('handleResolveSingleComment(id)');
    });

    // ── Backward compat: existing features preserved ──────────────────────────

    it('still renders version tabs', () => {
        expect(src).toContain('data-testid={`plan-version-tab-${v.version}`}');
    });

    it('renders an always-editable source editor wired to the parent draft batch', () => {
        expect(src).toContain('<SourceEditor');
        expect(src).toContain('onChange={onDraftChange}');
        expect(src).toContain("testId: 'work-item-plan-mode-source'");
    });

    it('no longer performs an instant standalone plan save (folded into Ctrl+S batch)', () => {
        expect(src).not.toContain('data-testid="work-item-plan-editor"');
        expect(src).not.toContain('data-testid="work-item-plan-edit-btn"');
        expect(src).not.toContain('data-testid="work-item-plan-add-btn"');
        expect(src).not.toContain('workItems.updatePlan(');
    });

    it('no longer renders AI resolve preview with accept/discard buttons', () => {
        expect(src).not.toContain('data-testid="work-item-resolve-accept-btn"');
        expect(src).not.toContain('data-testid="work-item-resolve-reject-btn"');
    });

    it('no longer has the old whole-plan textarea', () => {
        expect(src).not.toContain('data-testid="work-item-plan-comments-input"');
    });

    it('no longer has the old Resolve with AI button (replaced by resolve-all)', () => {
        expect(src).not.toContain('data-testid="work-item-plan-resolve-btn"');
    });
});
