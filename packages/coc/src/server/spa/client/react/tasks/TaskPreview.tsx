/**
 * TaskPreview — task panel wrapper for the shared MarkdownReviewEditor.
 */

import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
}

export function TaskPreview({ wsId, filePath }: TaskPreviewProps) {
    return (
        <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode="tasks"
            />
        </div>
    );
}
