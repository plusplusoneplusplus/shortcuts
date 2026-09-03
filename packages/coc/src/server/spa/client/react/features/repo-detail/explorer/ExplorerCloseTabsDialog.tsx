/**
 * ExplorerCloseTabsDialog — the Save / Don't Save / Cancel prompt shown when
 * closing one or more editor tabs that still hold unsaved edits (AC-04 of
 * explorer editor tabs).
 *
 * Purely presentational: it is told which files are at stake and reports which
 * of the three outcomes the user picked. The owner (ExplorerPanel) decides what
 * "Save" means, keeps the tabs whose write failed open and dirty, and feeds the
 * failure back in through `error` so the user can retry from the same prompt.
 */

import { Dialog, Button } from '../../../ui';

export interface ExplorerCloseTabsDialogProps {
    /** Whether the prompt is showing. */
    open: boolean;
    /** Full paths of the dirty files that would be discarded, in tab order. */
    paths: readonly string[];
    /** True while the Save action is writing; all three actions are disabled. */
    saving?: boolean;
    /** A failed save, in the Explorer's existing error style. */
    error?: string | null;
    onSave: () => void;
    onDontSave: () => void;
    onCancel: () => void;
}

export function ExplorerCloseTabsDialog({
    open,
    paths,
    saving,
    error,
    onSave,
    onDontSave,
    onCancel,
}: ExplorerCloseTabsDialogProps) {
    if (!open) return null;

    const title = paths.length === 1
        ? 'Do you want to save the changes you made?'
        : `Do you want to save the changes to ${paths.length} files?`;

    return (
        <Dialog
            open
            onClose={onCancel}
            title="Unsaved changes"
            id="explorer-close-tabs-dialog"
            footer={
                <div className="flex items-center justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving} data-testid="explorer-close-cancel-btn">
                        Cancel
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onDontSave} disabled={saving} data-testid="explorer-close-dont-save-btn">
                        Don&apos;t Save
                    </Button>
                    <Button variant="primary" size="sm" onClick={onSave} disabled={saving} data-testid="explorer-close-save-btn">
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-2" data-testid="explorer-close-tabs-prompt">
                <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">{title}</p>
                <ul className="flex flex-col gap-0.5 max-h-40 overflow-auto">
                    {paths.map(path => (
                        <li key={path} className="text-xs text-[#848484] truncate" title={path} data-testid="explorer-close-tabs-file">
                            {path}
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-[#848484]">Your changes will be lost if you don&apos;t save them.</p>
                {error && (
                    <span className="text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="explorer-close-tabs-error">{error}</span>
                )}
            </div>
        </Dialog>
    );
}
