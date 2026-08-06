/**
 * CanvasPanelBanners — the three stacked notices under the header:
 * read-only history, a 409 save conflict, and a pending remote AI update.
 *
 * The conflict banner wins over the remote-update banner: once a save is
 * rejected, "load latest" is the only way forward, so showing both would offer
 * the same action twice.
 */

import type { Canvas, CanvasVersion } from '@plusplusoneplusplus/coc-client';
import type { SaveState } from '../canvas-panel-model';

export interface CanvasPanelBannersProps {
    canvas: Canvas | null;
    viewingVersion: CanvasVersion | null;
    dirty: boolean;
    restoring: boolean;
    onRestore: () => void;
    onBackToLatest: () => void;
    saveState: SaveState;
    remoteUpdatePending: boolean;
    onLoadLatest: () => void;
}

export function CanvasPanelBanners({
    canvas, viewingVersion, dirty, restoring, onRestore, onBackToLatest,
    saveState, remoteUpdatePending, onLoadLatest,
}: CanvasPanelBannersProps) {
    return (
        <>
            {viewingVersion && canvas && (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] bg-violet-50 dark:bg-violet-950 border-b border-violet-200 dark:border-violet-800" data-testid="canvas-panel-history-banner">
                    <span className="flex-1">
                        Viewing rev {viewingVersion.revision} of {canvas.revision} ({viewingVersion.editor === 'ai' ? 'AI' : 'you'}, read-only)
                    </span>
                    <button
                        type="button"
                        className="underline font-semibold disabled:opacity-40"
                        disabled={dirty || restoring}
                        title={dirty ? 'Save or discard your unsaved edits first' : undefined}
                        onClick={onRestore}
                        data-testid="canvas-panel-restore"
                    >
                        {restoring ? 'Restoring…' : 'Restore as latest'}
                    </button>
                    <button type="button" className="underline" onClick={onBackToLatest} data-testid="canvas-panel-back-to-latest">
                        Back to latest
                    </button>
                </div>
            )}

            {saveState === 'conflict' && (
                <div className="px-3 py-2 text-[11px] bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800" data-testid="canvas-panel-conflict-banner">
                    The canvas changed while you were editing.{' '}
                    <button type="button" className="underline font-semibold" onClick={onLoadLatest}>
                        Load latest (discards your edits)
                    </button>
                </div>
            )}
            {remoteUpdatePending && saveState !== 'conflict' && (
                <div className="px-3 py-2 text-[11px] bg-sky-50 dark:bg-sky-950 border-b border-sky-200 dark:border-sky-800" data-testid="canvas-panel-remote-update-banner">
                    The AI updated this canvas.{' '}
                    <button type="button" className="underline font-semibold" onClick={onLoadLatest}>
                        Load latest (discards your edits)
                    </button>
                </div>
            )}
        </>
    );
}
