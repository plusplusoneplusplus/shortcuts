/**
 * Explorer selections as unified-panel file tabs (AC-04).
 *
 * With the unified panel on, an Explorer mounted inside it is a NAVIGATOR: a
 * file it opens becomes a tab in the panel's own strip rather than a buffer in
 * a second, nested editor. This module is the translation — Explorer's
 * `{ path, name, line? }` plus its read-only bit into the descriptor the panel
 * files.
 *
 * Two things it has to get right that the "+" menu's `fileOpenInput` does not:
 *
 *  - A trusted absolute path (`ExactOpen`'s `__trusted__:` form) is NOT a
 *    repo-relative path and must reach `PreviewPane` byte-identical — the same
 *    prefix test is what makes it read an absolute file. Normalizing it would
 *    mangle a Windows path (`__trusted__:C:\x` -> `.../C:/x`), so trusted paths
 *    pass through untouched and take their label from the absolute name.
 *  - Explorer's own read-only opens (a trusted file) stay read-only. Everything
 *    else the Explorer opens is editable, which is the point of routing its
 *    selections here rather than through the source-link path: the Explorer is
 *    an authorized entry point, a chat link is a reference.
 *
 * Explorer's preview/pinned distinction is deliberately dropped. The panel has
 * no replaceable preview slot — one tab per resource — so a single click opens
 * the tab and a double click focuses that same tab instead of stacking a
 * second one.
 */

import { TRUSTED_PATH_PREFIX, fileName as trustedFileName } from '../explorer/ExactOpen';
import { normalizeResourcePath, resourcePathName } from './unifiedPanelOpenMenuModel';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

export interface ExplorerFileOpenContext {
    /** The clone the Explorer is browsing — where the blob read must route. */
    ownerWorkspaceId: string;
    /** The panel's own workspace; a differing owner earns a repo label. */
    scopeWorkspaceId: string;
    /** Label for the owning repo, shown when it is not the panel's own. */
    ownerLabel?: string;
    /** The selected chat; files follow it, or the workspace when there is none. */
    chatId: string | null;
}

/** The tab an Explorer file selection opens. */
export function explorerFileTabInput(
    file: { path: string; name?: string; line?: number },
    options: { readOnly?: boolean },
    context: ExplorerFileOpenContext,
): OpenUnifiedTabInput | null {
    const trusted = file.path.startsWith(TRUSTED_PATH_PREFIX);
    const resourceId = trusted ? file.path : normalizeResourcePath(file.path.trim());
    if (resourceId === '' || resourceId === TRUSTED_PATH_PREFIX) return null;

    const label = trusted
        ? trustedFileName(resourceId.slice(TRUSTED_PATH_PREFIX.length))
        : (file.name?.trim() || resourcePathName(resourceId));

    return {
        kind: 'file',
        ownerWorkspaceId: context.ownerWorkspaceId,
        chatId: context.chatId,
        resourceId,
        label,
        ...(context.ownerWorkspaceId !== context.scopeWorkspaceId && context.ownerLabel
            ? { repoLabel: context.ownerLabel }
            : {}),
        ...(options.readOnly ? { readOnly: true } : {}),
        ...(file.line === undefined ? {} : { line: file.line }),
    };
}
