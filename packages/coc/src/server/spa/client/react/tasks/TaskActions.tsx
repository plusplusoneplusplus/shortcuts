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
    /** When true, omit the bottom border (used when embedded in a toolbar with its own border). */
    noBorder?: boolean;
}

function copyToClipboard(text: string): void {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}

export function TaskActions({ wsId, openFilePath, selectedFilePaths, tasksFolderPath, selectedFolderPath, onClearSelection, noBorder }: TaskActionsProps) {
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
        <div className={`flex flex-col px-3 py-2 text-xs ${noBorder ? '' : 'border-b border-[#e0e0e0] dark:border-[#3c3c3c]'}`}>
            <div className="flex items-center gap-2">
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

            {selectedFolderPath && (
                <div
                    data-testid="cwd-display"
                    className="mt-0.5 font-mono text-[#848484] dark:text-[#666] overflow-hidden whitespace-nowrap cursor-pointer hover:text-[#616161] dark:hover:text-[#999]"
                    style={{ direction: 'rtl', textOverflow: 'ellipsis' }}
                    title={selectedFolderPath}
                    onClick={() => copyToClipboard(selectedFolderPath)}
                >
                    {selectedFolderPath}
                </div>
            )}
        </div>
    );
}
