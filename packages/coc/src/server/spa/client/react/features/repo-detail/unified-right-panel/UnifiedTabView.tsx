/**
 * UnifiedTabView — the body for one unified-panel tab (AC-04).
 *
 * Every kind maps onto a view that already exists elsewhere in the app; nothing
 * here is a second editor, a second file transport, or a second canvas store:
 *
 *  - `terminal` / `explorer` / `notes` — the workspace dock's own views.
 *  - `file` — the Explorer's `PreviewPane`, the same buffer controller the
 *    flag-off Explorer tabs use, so load/retry/dirty/save/status behave
 *    identically wherever a file was opened from. `tab.readOnly` forces the
 *    editor read-only and suppresses its save path, which is how a chat source
 *    link stays a preview while an Explorer selection stays editable. The
 *    descriptor carries that bit (it is never re-derived), so restoring or
 *    reordering a tab cannot widen a read-only reference into a writable file.
 *  - `canvas` — `CanvasPanel`, routed at `tab.ownerWorkspaceId` so a canvas from
 *    a remote clone keeps hitting its own server for revisions and comments.
 *  - `diff` — the chat's own read-only `WhisperDiffPanel`, resolved through the
 *    `unifiedDiffSources` registry, because a diff is reconstructed from an
 *    in-memory tool-call group rather than fetched. A tab whose group is gone
 *    shows the expired state (`UnifiedDiffTab`).
 *  - `note` — the editable `NoteEditor`, wired exactly as the docked source
 *    canvas wires a note link, with the resolution decoded from the descriptor
 *    rather than re-run (`UnifiedNoteTab`).
 *
 * The fallback state is for a descriptor this build has no view for at all — a
 * kind from a newer version, say — never for a kind listed above.
 *
 * Dirty and error state are reported upward rather than shown here, because the
 * strip is where a hidden tab's state has to be visible — a background buffer
 * with unsaved edits or a failed read must be findable without selecting every
 * tab in turn.
 */

import { useCallback } from 'react';
import { TerminalView } from '../../terminal/TerminalView';
import { DockNotesPanel } from '../../notes/dock/DockNotesPanel';
import { ExplorerPanel } from '../explorer/ExplorerPanel';
import { PreviewPane, type PreviewStatus } from '../explorer/PreviewPane';
import { CanvasPanel } from '../../canvas/CanvasPanel';
import { UnifiedDiffTab } from './UnifiedDiffTab';
import { UnifiedNoteTab } from './UnifiedNoteTab';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

export interface UnifiedTabViewProps {
    tab: UnifiedPanelTab;
    /** The panel's own workspace — Notes' owner, and the deep-link test. */
    scopeWorkspaceId: string;
    /** Close this tab (the views' own close affordances route here). */
    onClose: (tabId: string) => void;
    /** Unsaved-edit state for this tab, for the strip's dirty marker. */
    onDirtyChange?: (tabId: string, isDirty: boolean) => void;
    /** Load failure state for this tab, for the strip's error marker. */
    onErrorChange?: (tabId: string, hasError: boolean) => void;
}

/** The last path segment — what the editor uses to pick a language. */
function fileNameOf(tab: UnifiedPanelTab): string {
    const normalized = tab.resourceId.replace(/\\/g, '/');
    return normalized.split('/').pop() || tab.label;
}

export function UnifiedTabView({
    tab, scopeWorkspaceId, onClose, onDirtyChange, onErrorChange,
}: UnifiedTabViewProps) {
    // One instance of this component exists per tab (the panel keys the list by
    // tab id), so binding the id here keeps the callbacks the reused views see
    // stable — `PreviewPane` re-registers its save handler whenever they change.
    const close = useCallback(() => onClose(tab.id), [onClose, tab.id]);
    const handleDirty = useCallback(
        (isDirty: boolean) => onDirtyChange?.(tab.id, isDirty),
        [onDirtyChange, tab.id],
    );
    const handleStatus = useCallback(
        (status: PreviewStatus) => onErrorChange?.(tab.id, status === 'error'),
        [onErrorChange, tab.id],
    );
    const handleError = useCallback(
        (hasError: boolean) => onErrorChange?.(tab.id, hasError),
        [onErrorChange, tab.id],
    );

    switch (tab.kind) {
        case 'terminal':
            return <TerminalView workspaceId={tab.ownerWorkspaceId} />;
        case 'explorer':
            // Deep-linking only when the tab targets the panel's own scope: the
            // hash a group member would write reads as "select that repo" and
            // would navigate the user out of the group on every file click.
            return <ExplorerPanel workspaceId={tab.ownerWorkspaceId} deepLink={tab.ownerWorkspaceId === scopeWorkspaceId} />;
        case 'notes':
            return <DockNotesPanel workspaceId={scopeWorkspaceId} />;
        case 'file':
            return (
                <PreviewPane
                    repoId={tab.ownerWorkspaceId}
                    filePath={tab.resourceId}
                    fileName={fileNameOf(tab)}
                    revealLine={tab.line}
                    readOnly={tab.readOnly === true}
                    onClose={close}
                    onDirtyChange={handleDirty}
                    onStatusChange={handleStatus}
                />
            );
        case 'canvas':
            return (
                <CanvasPanel
                    workspaceId={tab.ownerWorkspaceId}
                    canvasId={tab.resourceId}
                    liveEvent={null}
                    onClose={close}
                />
            );
        case 'note':
            return (
                <UnifiedNoteTab
                    workspaceId={tab.ownerWorkspaceId}
                    resourceId={tab.resourceId}
                    label={tab.label}
                    line={tab.line}
                    onClose={close}
                    onErrorChange={handleError}
                />
            );
        case 'diff':
            return (
                <UnifiedDiffTab
                    sourceId={tab.resourceId}
                    label={tab.label}
                    onClose={close}
                    onErrorChange={handleError}
                />
            );
        default:
            return (
                <div
                    className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]"
                    data-testid="unified-panel-unsupported"
                >
                    <span>This resource cannot be shown here yet.</span>
                    <span className="opacity-70">{tab.label}</span>
                </div>
            );
    }
}
