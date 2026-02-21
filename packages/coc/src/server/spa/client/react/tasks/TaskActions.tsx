/**
 * TaskActions — toolbar rendered above the Miller columns.
 */

import { Button } from '../shared';
import { useTaskPanel } from '../context/TaskContext';
import { useQueue } from '../context/QueueContext';
import { isContextFile } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';

interface TaskActionsProps {
    wsId: string;
    openFilePath: string | null;
    selectedFilePaths: string[];
    tasksFolderPath: string;
    selectedFolderPath?: string | null;
    onClearSelection: () => void;
    onGenerateWithAI?: () => void;
}

function copyToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}

export function TaskActions({ wsId, openFilePath, selectedFilePaths, tasksFolderPath, selectedFolderPath, onClearSelection, onGenerateWithAI }: TaskActionsProps) {
    const { showContextFiles, toggleShowContextFiles } = useTaskPanel();
    const { dispatch: queueDispatch } = useQueue();

    const nonContextSelected = selectedFilePaths.filter(p => {
        const parts = p.split('/');
        const fileName = parts[parts.length - 1];
        return !isContextFile(fileName);
    });

    const handleCopyPath = () => {
        if (openFilePath) {
            copyToClipboard(openFilePath);
        }
    };

    const handleOpenInEditor = async () => {
        if (!openFilePath) return;
        try {
            await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/open-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: openFilePath }),
            });
        } catch { /* ignore */ }
    };

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-xs">
            <Button variant="secondary" size="sm" data-testid="generate-with-ai-btn" onClick={onGenerateWithAI}>
                ✨ Generate with AI
            </Button>

            {openFilePath && (
                <>
                    <Button variant="ghost" size="sm" onClick={handleCopyPath}>
                        Copy path
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenInEditor}>
                        Open in editor
                    </Button>
                </>
            )}

            <label className="flex items-center gap-1 ml-auto cursor-pointer text-[#616161] dark:text-[#999]">
                <input
                    type="checkbox"
                    checked={showContextFiles}
                    onChange={toggleShowContextFiles}
                    className="accent-[#0078d4]"
                />
                Context files
            </label>

            {nonContextSelected.length > 0 && (
                <div className="flex items-center gap-1 ml-2">
                    <span className="text-[#616161] dark:text-[#999]">
                        {nonContextSelected.length} selected
                    </span>
                    <Button variant="primary" size="sm" data-testid="queue-all-btn"
                        onClick={() => queueDispatch({ type: 'OPEN_DIALOG', folderPath: selectedFolderPath ?? null })}>
                        Queue all
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onClearSelection}>
                        Clear
                    </Button>
                </div>
            )}
        </div>
    );
}
