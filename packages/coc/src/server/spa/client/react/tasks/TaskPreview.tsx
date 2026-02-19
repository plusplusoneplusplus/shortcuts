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
        <MarkdownReviewEditor
            wsId={wsId}
            filePath={filePath}
            fetchMode="tasks"
        />
    );
}
