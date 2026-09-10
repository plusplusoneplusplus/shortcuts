/**
 * UnifiedDiffTab — the body of a `diff` tab in the unified right panel (AC-04).
 *
 * The panel reuses the chat's own read-only whisper diff surface
 * (`WhisperDiffPanel` over `useWhisperDiffState`); this component is only the
 * lookup between a persisted tab descriptor and the in-memory group it points
 * at. The descriptor's `resourceId` is a source id from `unifiedDiffSources`,
 * so:
 *
 *  - a live group renders exactly the diff the chat's own dock would show,
 *    including the file dropdown and the "not shown" list;
 *  - a source that is gone — the tab survived a reload, or its transcript is no
 *    longer loaded — renders the explicit expired state instead of a blank
 *    panel, because a diff is reconstructed from a chat group rather than
 *    fetched, so there is nothing to retry against.
 *
 * A chat's own **Changes** tab is the exception to that second point, because
 * it is the one diff that *can* come back: its source id is fixed per chat
 * (`chatChangesSourceId`) and the chat republishes the whole-chat context from
 * its restored history. So when this tab is that tab, it reads the chat's
 * published entry directly and claims the source id for it. Three states fall
 * out of the entry rather than out of the registry:
 *
 *  - unresolved (no entry) — the transcript is still loading, so the tab shows
 *    loading rather than announcing an expiry that has not happened;
 *  - resolved with nothing — the retained history holds no file change, so the
 *    panel renders its ordinary empty diff;
 *  - resolved with changes — the diff, with the source registered so later
 *    edits refresh it through `publishUnifiedChatChanges` as usual.
 *
 * Claiming happens *here*, in a mounted tab, which is what keeps publishing
 * from ever creating a tab: a tab the user never opened, or has closed, has no
 * component to claim its id.
 *
 * The expired state is reported upward as an error so the strip marks the tab:
 * a stale diff behind another tab has to be findable without selecting it.
 */

import { useEffect } from 'react';
import { WhisperDiffPanel, useWhisperDiffState } from '../../chat/whisper-diff';
import { chatChangesSourceId, useUnifiedChatChangesEntry } from './unifiedChatChanges';
import { registerUnifiedDiffSource, useUnifiedDiffSource } from './unifiedDiffSources';

export interface UnifiedDiffTabProps {
    /** The tab's `resourceId` — a `unifiedDiffSources` source id. */
    sourceId: string;
    /** The tab label, echoed in the expired state so the user knows which diff. */
    label: string;
    /** The panel's own workspace — the scope a chat publishes its changes under. */
    scopeWorkspaceId: string;
    /** The chat this tab belongs to, or null for a workspace-scoped diff. */
    chatId: string | null;
    /** Close this tab (the panel's own X routes here). */
    onClose: () => void;
    /** Report the expired state to the strip. */
    onErrorChange?: (hasError: boolean) => void;
}

export function UnifiedDiffTab({
    sourceId, label, scopeWorkspaceId, chatId, onClose, onErrorChange,
}: UnifiedDiffTabProps) {
    const source = useUnifiedDiffSource(sourceId);
    // Only a tab that *is* a chat's Changes tab may resolve itself from the
    // chat: a whisper group's content-addressed source has no publisher, and
    // must keep expiring exactly as before.
    const changesChatId = chatId !== null && sourceId === chatChangesSourceId(chatId) ? chatId : null;
    const entry = useUnifiedChatChangesEntry(scopeWorkspaceId, changesChatId);
    const published = entry ?? null;

    // Hooks stay unconditional: `useWhisperDiffState` is pure and synchronous,
    // and returns its idle state for a null context.
    //
    // The tab's own `sourceId` is the selection key: it is exactly as stable as
    // the thing the tab points at. A whisper group is content-addressed, so a
    // different group is a different id and the panel resets as before; a chat's
    // Changes source keeps one id while its context is rebuilt on every streamed
    // edit, so the file the user picked survives the update.
    const ctx = source?.ctx ?? published?.ctx ?? null;
    const workspaceRootPath = source !== null ? source.workspaceRootPath : published?.workspaceRootPath;
    const state = useWhisperDiffState(ctx, { selectionKey: sourceId });

    // Claim the source id for the published context. The registry is module
    // state, so after a reload this is the only thing that fills it — and it
    // runs only because this tab is mounted, which is the invariant that keeps a
    // publish from resurrecting a closed tab. The registration is idempotent for
    // an unchanged context, so it settles after one pass.
    useEffect(() => {
        if (source !== null || published === null) return;
        registerUnifiedDiffSource(published.ctx, {
            workspaceRootPath: published.workspaceRootPath,
            sourceId,
        });
    }, [source, published, sourceId]);

    // Unresolved: the chat that owns this tab has not finished loading its
    // transcript. Not an error, and not an expiry — just not yet.
    const pending = changesChatId !== null && source === null && entry === undefined;
    const expired = source === null && published === null && changesChatId === null;
    useEffect(() => {
        onErrorChange?.(expired);
        return () => onErrorChange?.(false);
    }, [expired, onErrorChange]);

    if (pending) {
        return (
            <div
                className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]"
                data-testid="unified-panel-diff-loading"
            >
                <span>Loading changes…</span>
                <span className="opacity-70">{label}</span>
            </div>
        );
    }

    if (expired) {
        return (
            <div
                className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#616161] dark:text-[#9d9d9d]"
                data-testid="unified-panel-diff-expired"
            >
                <span>This diff is no longer available.</span>
                <span className="opacity-70">{label}</span>
                <span className="opacity-70">
                    It is rebuilt from the chat that produced it — reopen it from that
                    conversation to see it again.
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-1 rounded border border-[#e0e0e0] px-2 py-1 hover:bg-black/[0.06] dark:border-[#474749] dark:hover:bg-white/[0.08]"
                    data-testid="unified-panel-diff-expired-close"
                >
                    Close tab
                </button>
            </div>
        );
    }

    return (
        <WhisperDiffPanel
            state={state}
            workspaceRootPath={workspaceRootPath}
            onClose={onClose}
        />
    );
}
