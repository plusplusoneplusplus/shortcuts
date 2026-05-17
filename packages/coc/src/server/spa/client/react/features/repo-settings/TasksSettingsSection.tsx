/**
 * TasksSettingsSection — Settings panel for configuring plans folder paths.
 * Displays the primary (read-only) folder and lets users add/remove extra folders.
 */

import { useState, useEffect, useCallback } from 'react';
import type { TaskSettings } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

interface TasksSettingsSectionProps {
    workspaceId: string;
}

export function TasksSettingsSection({ workspaceId }: TasksSettingsSectionProps) {
    const [primaryPath, setPrimaryPath] = useState('');
    const [folderPaths, setFolderPaths] = useState<string[]>([]);
    const [defaultPaths, setDefaultPaths] = useState<string[]>([]);
    const [newInput, setNewInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const loadSettings = useCallback(async () => {
        try {
            const data: TaskSettings = await getSpaCocClient().preferences.getTaskSettings(workspaceId);
            setPrimaryPath(data.taskRootPath || '');
            setFolderPaths(data.folderPaths || []);
            setDefaultPaths(data.hasDefaultFolderPaths ? (data.folderPaths || []) : []);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to load task settings');
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => { loadSettings(); }, [loadSettings]);

    const patchFolders = useCallback(async (paths: string[]) => {
        setSaving(true);
        setError(null);
        setDefaultPaths([]);
        try {
            const data = await getSpaCocClient().preferences.updateTaskSettings(
                workspaceId,
                { folderPaths: paths },
            );
            setFolderPaths(data.folderPaths ?? paths);
        } catch (err: any) {
            setError(err.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    }, [workspaceId]);

    const handleAdd = useCallback(() => {
        const trimmed = newInput.trim();
        if (!trimmed) return;
        if (folderPaths.includes(trimmed)) {
            setError('This folder is already in the list');
            return;
        }
        const updated = [...folderPaths, trimmed];
        setFolderPaths(updated);
        setNewInput('');
        patchFolders(updated);
    }, [newInput, folderPaths, patchFolders]);

    const handleRemove = useCallback((pathToRemove: string) => {
        const updated = folderPaths.filter(p => p !== pathToRemove);
        setFolderPaths(updated);
        patchFolders(updated);
    }, [folderPaths, patchFolders]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    }, [handleAdd]);

    const canAdd = newInput.trim().length > 0 && !folderPaths.includes(newInput.trim());

    if (loading) {
        return <div className="text-xs text-[#848484]" data-testid="tasks-settings-loading">Loading…</div>;
    }

    return (
        <div data-testid="tasks-settings-section">
            {/* Primary folder (read-only) */}
            <div className="mb-4">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1.5">Primary folder</div>
                <div
                    className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] opacity-60 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-[#f5f5f5] dark:bg-[#252526]"
                    data-testid="primary-folder"
                >
                    <span>📁</span>
                    <span className="flex-1 truncate">{primaryPath}</span>
                    <span className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] text-[#848484] rounded px-1 ml-1">default</span>
                </div>
            </div>

            {/* Additional folders */}
            <div className="mb-4">
                <div className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1.5">Additional folders</div>
                {folderPaths.length === 0 ? (
                    <div className="text-xs text-[#848484] mb-2" data-testid="no-extra-folders">No additional folders configured.</div>
                ) : (
                    <div className="flex flex-col gap-1.5 mb-2">
                        {folderPaths.map(fp => (
                            <div
                                key={fp}
                                className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e]"
                                data-testid="extra-folder"
                            >
                                <span>📁</span>
                                <span className="flex-1 truncate">{fp}</span>
                                {defaultPaths.includes(fp) && (
                                    <span className="text-[10px] bg-[#f0f0f0] dark:bg-[#3c3c3c] text-[#848484] rounded px-1" data-testid="default-badge">default</span>
                                )}
                                <button
                                    className="text-[#cc3333] hover:text-red-700 text-xs px-1"
                                    title="Remove"
                                    disabled={saving}
                                    onClick={() => handleRemove(fp)}
                                    data-testid="remove-folder-btn"
                                >✕</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Add new folder */}
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={newInput}
                    onChange={e => setNewInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="/enter/a/path"
                    className="flex-1 text-xs font-mono border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-2 py-1 bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#999]"
                    disabled={saving}
                    data-testid="new-folder-input"
                />
                <button
                    className={`text-xs px-2 py-1 rounded border ${
                        canAdd && !saving
                            ? 'border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4] hover:text-white cursor-pointer'
                            : 'border-[#e0e0e0] text-[#999] cursor-not-allowed'
                    }`}
                    disabled={!canAdd || saving}
                    onClick={handleAdd}
                    data-testid="add-folder-btn"
                >+ Add</button>
            </div>

            {/* Inline help text */}
            <div className="text-[10px] text-[#848484] mt-2">
                Changes save automatically when you click + Add or remove a folder.
            </div>

            {/* Error display */}
            {error && (
                <div className="text-xs text-[#cc3333] mt-2" data-testid="tasks-settings-error">{error}</div>
            )}
        </div>
    );
}
