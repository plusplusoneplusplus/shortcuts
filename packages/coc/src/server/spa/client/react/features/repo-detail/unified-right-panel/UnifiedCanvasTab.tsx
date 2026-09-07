/**
 * UnifiedCanvasTab — the body of a `canvas` tab in the unified right panel.
 *
 * `CanvasPanel` does all the work; this component exists so the live
 * `canvas-updated` event can be looked up with a hook (AC-06). A tab body is
 * rendered from a switch over the tab kind, where a conditional hook is not an
 * option, so the lookup gets its own component — the same shape `UnifiedDiffTab`
 * and `UnifiedNoteTab` already use.
 *
 * The event is keyed by the OWNING clone plus the canvas id, so a canvas from a
 * repo-group member or a remote workspace reconciles from its own server's
 * events and never from a similarly named canvas elsewhere.
 */

import { CanvasPanel } from '../../canvas/CanvasPanel';
import { useUnifiedCanvasEvent } from './unifiedCanvasEvents';

export interface UnifiedCanvasTabProps {
    /** The clone that owns the canvas — routes content and matches its events. */
    workspaceId: string;
    /** The tab's `resourceId` — the canvas id. */
    canvasId: string;
    onClose: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
}

export function UnifiedCanvasTab({
    workspaceId, canvasId, onClose, onDirtyChange, onRegisterSave,
}: UnifiedCanvasTabProps) {
    const liveEvent = useUnifiedCanvasEvent(workspaceId, canvasId);
    return (
        <CanvasPanel
            workspaceId={workspaceId}
            canvasId={canvasId}
            liveEvent={liveEvent}
            onClose={onClose}
            onDirtyChange={onDirtyChange}
            onRegisterSave={onRegisterSave}
        />
    );
}
