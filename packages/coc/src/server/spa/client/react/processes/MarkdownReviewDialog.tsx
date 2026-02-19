/**
 * MarkdownReviewDialog — large modal surface for reviewing markdown files
 * opened from process conversation file-path links.
 */

import { Dialog } from '../shared';
import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';

export interface MarkdownReviewDialogProps {
    open: boolean;
    onClose: () => void;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
}

function getTitle(displayPath: string | null, filePath: string | null): string {
    const source = displayPath || filePath || '';
    if (!source) return 'Markdown Review';
    const normalized = source.replace(/\\/g, '/');
    return normalized.split('/').pop() || source;
}

export function MarkdownReviewDialog({
    open,
    onClose,
    wsId,
    filePath,
    displayPath,
    fetchMode,
}: MarkdownReviewDialogProps) {
    if (!open || !wsId || !filePath) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            className="max-w-[95vw] w-[95vw] h-[92vh] p-0 gap-0"
        >
            <div className="flex h-[92vh] flex-col">
                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]">
                    <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {getTitle(displayPath, filePath)}
                    </div>
                    <div
                        className="text-xs text-[#848484] truncate mt-0.5"
                        title={displayPath || filePath}
                    >
                        {displayPath || filePath}
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                    <MarkdownReviewEditor
                        wsId={wsId}
                        filePath={filePath}
                        fetchMode={fetchMode}
                    />
                </div>
            </div>
        </Dialog>
    );
}
