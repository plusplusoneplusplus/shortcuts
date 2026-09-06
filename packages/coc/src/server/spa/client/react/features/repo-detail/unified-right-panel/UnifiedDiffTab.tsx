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
 * The expired state is reported upward as an error so the strip marks the tab:
 * a stale diff behind another tab has to be findable without selecting it.
 */

import { useEffect } from 'react';
import { WhisperDiffPanel, useWhisperDiffState } from '../../chat/whisper-diff';
import { useUnifiedDiffSource } from './unifiedDiffSources';

export interface UnifiedDiffTabProps {
    /** The tab's `resourceId` — a `unifiedDiffSources` source id. */
    sourceId: string;
    /** The tab label, echoed in the expired state so the user knows which diff. */
    label: string;
    /** Close this tab (the panel's own X routes here). */
    onClose: () => void;
    /** Report the expired state to the strip. */
    onErrorChange?: (hasError: boolean) => void;
}

export function UnifiedDiffTab({ sourceId, label, onClose, onErrorChange }: UnifiedDiffTabProps) {
    const source = useUnifiedDiffSource(sourceId);
    // Hooks stay unconditional: `useWhisperDiffState` is pure and synchronous,
    // and returns its idle state for a null context.
    const state = useWhisperDiffState(source?.ctx ?? null);

    const expired = source === null;
    useEffect(() => {
        onErrorChange?.(expired);
        return () => onErrorChange?.(false);
    }, [expired, onErrorChange]);

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
            workspaceRootPath={source.workspaceRootPath}
            onClose={onClose}
        />
    );
}
