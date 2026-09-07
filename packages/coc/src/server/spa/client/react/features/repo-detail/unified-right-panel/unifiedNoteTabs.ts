/**
 * unifiedNoteTabs — what a recognized note link opens in the unified right
 * panel, and how that note's identity survives a reload (AC-04).
 *
 * A note is not a file as far as the panel is concerned. The file view reads
 * bytes through a repo's blob API; a note is edited through `NoteEditor`, which
 * needs three things the path alone does not carry: the workspace to edit in,
 * an IO adapter (the tasks-backed one for files under `.vscode/tasks/`, the
 * workspace-file one otherwise), and the notes root when it is known. All of
 * that resolution already exists — `resolveMarkdownReviewTarget`, shared by the
 * floating markdown review dialog and the docked source canvas's note editor —
 * so this module reuses it and only decides how the answer is stored.
 *
 * A tab descriptor has exactly one identity field, so the fetch mode and the
 * notes root travel INSIDE `resourceId` (`<fetchMode>|<root>|<path>`). That is
 * what the goal means by "note root identity": two notes with the same relative
 * path under different roots are different resources and must not collapse onto
 * one tab, and a restored descriptor has to be able to rebuild the editor's
 * wiring without re-running a resolution whose inputs (the clicked link, the
 * source file it appeared in) are long gone.
 *
 * Note tabs are workspace-owned: a note belongs to the workspace, not to the
 * chat that happened to link it, so it stays visible across chat switches.
 * They are editable, because the surfaces this replaces are — an editable plan
 * note reached through a chat link stays editable here. That is a property of
 * the note *view*, not a widening of a source link: `sourceLinkTabInput` still
 * declines note refs, and code refs still open read-only.
 */

import {
    resolveMarkdownReviewTarget,
    type MarkdownReviewFetchMode,
    type WorkspaceLike,
} from '../../../shared/markdown-review/resolveMarkdownReviewTarget';
import type { SourceCanvasFileRef } from '../../chat/source-canvas/types';
import { resourcePathName } from './unifiedPanelOpenMenuModel';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** Everything `NoteEditor` needs, recovered from a persisted `resourceId`. */
export interface UnifiedNoteResource {
    /** Which `NoteEditorIO` adapter loads and saves this note. */
    fetchMode: MarkdownReviewFetchMode;
    /** Absolute notes/tasks root, when the resolution knew one. */
    notesRoot?: string;
    /** The path the adapter reads — task-relative under a tasks root, else full. */
    notePath: string;
}

/**
 * `<fetchMode>|<root>|<path>`. Only the first two separators are structural;
 * everything after them is the path, so a path containing `|` round-trips. The
 * strip's tab id escapes `|` independently, so this cannot forge another tab's
 * identity.
 */
export function noteResourceId(resource: UnifiedNoteResource): string {
    return `${resource.fetchMode}|${resource.notesRoot ?? ''}|${resource.notePath}`;
}

/** Recover a note resource, or null when the descriptor is not one. */
export function parseNoteResourceId(resourceId: string): UnifiedNoteResource | null {
    const firstSep = resourceId.indexOf('|');
    if (firstSep < 0) return null;
    const secondSep = resourceId.indexOf('|', firstSep + 1);
    if (secondSep < 0) return null;

    const fetchMode = resourceId.slice(0, firstSep);
    if (fetchMode !== 'tasks' && fetchMode !== 'auto') return null;
    const notesRoot = resourceId.slice(firstSep + 1, secondSep);
    const notePath = resourceId.slice(secondSep + 1);
    if (!notePath) return null;

    return {
        fetchMode,
        ...(notesRoot ? { notesRoot } : {}),
        notePath,
    };
}

export interface NoteTabInputArgs {
    /** The clicked reference, exactly as the `coc-open-source-canvas` event carried it. */
    fileRef: SourceCanvasFileRef;
    /** Every workspace resolution may choose from — remote clones included. */
    workspaces: ReadonlyArray<WorkspaceLike>;
    /** The panel's own workspace (a group id in a repo group); only for repo labelling. */
    scopeWorkspaceId: string;
}

/**
 * The tab a note link opens, or `null` when no workspace owns the path — in
 * which case the caller keeps the existing docked surface, which shows its own
 * "no matching workspace" message rather than an empty tab.
 */
export function noteTabInput(args: NoteTabInputArgs): OpenUnifiedTabInput | null {
    const { fileRef, workspaces, scopeWorkspaceId } = args;
    if (!fileRef.fullPath) return null;

    const target = resolveMarkdownReviewTarget(
        {
            filePath: fileRef.fullPath,
            wsId: fileRef.wsId,
            sourceFilePath: fileRef.sourceFilePath,
        },
        workspaces as WorkspaceLike[],
    );
    if (!target) return null;

    const workspace = workspaces.find(ws => ws.id === target.wsId);
    const repoLabel = target.wsId === scopeWorkspaceId ? undefined : workspace?.name;

    return {
        kind: 'note',
        // The clone that owns the note, which the resolution may have moved off
        // the clicked container's hint (a group member's root wins).
        ownerWorkspaceId: target.wsId,
        // Workspace-owned: `openTab` ignores this for a note, and passing the
        // chat id would only misrepresent the ownership at the call site.
        chatId: null,
        resourceId: noteResourceId({
            fetchMode: target.fetchMode,
            ...(target.taskRootPath ? { notesRoot: target.taskRootPath } : {}),
            notePath: target.filePath,
        }),
        label: resourcePathName(target.filePath) || resourcePathName(target.displayPath),
        ...(repoLabel === undefined ? {} : { repoLabel }),
        ...(fileRef.line === undefined ? {} : { line: fileRef.line }),
    };
}
