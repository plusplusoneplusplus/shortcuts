/**
 * AddRepoDialog — dual-mode dialog for adding and editing a workspace.
 * Includes inline filesystem browser.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { hashString, normalizeRemoteUrl } from './repoGrouping';
import type { RepoData } from './repoGrouping';

const COLOR_PALETTE = [
    { label: 'Blue', value: '#0078d4' },
    { label: 'Green', value: '#107c10' },
    { label: 'Orange', value: '#d83b01' },
    { label: 'Purple', value: '#b4009e' },
    { label: 'Teal', value: '#008272' },
    { label: 'Dark Green', value: '#004b1c' },
    { label: 'Grey', value: '#848484' },
];

interface AddRepoDialogProps {
    open: boolean;
    onClose: () => void;
    editId?: string | null;
    repos: RepoData[];
    onSuccess: () => void;
}

interface BrowserEntry {
    name: string;
    isGitRepo?: boolean;
}

export function AddRepoDialog({ open, onClose, editId, repos, onSuccess }: AddRepoDialogProps) {
    const isEdit = !!editId;
    const editRepo = isEdit ? repos.find(r => r.workspace.id === editId) : null;

    const [path, setPath] = useState('');
    const [name, setName] = useState('');
    const [color, setColor] = useState('#0078d4');
    const [validation, setValidation] = useState<{ msg: string; ok: boolean } | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Browser state
    const [showBrowser, setShowBrowser] = useState(false);
    const [browserPath, setBrowserPath] = useState('');
    const [browserEntries, setBrowserEntries] = useState<BrowserEntry[]>([]);
    const [browserParent, setBrowserParent] = useState<string | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);

    // Pre-fill for edit mode
    useEffect(() => {
        if (open && isEdit && editRepo) {
            setPath(editRepo.workspace.rootPath || '');
            setName(editRepo.workspace.name || '');
            setColor(editRepo.workspace.color || '#0078d4');
        } else if (open) {
            setPath('');
            setName('');
            setColor('#0078d4');
        }
        setValidation(null);
        setShowBrowser(false);
    }, [open, isEdit, editRepo]);

    const navigateTo = useCallback(async (dir: string) => {
        setBrowserLoading(true);
        try {
            const data = await fetchApi(`/fs/browse?path=${encodeURIComponent(dir)}`);
            setBrowserPath(data.path);
            setBrowserParent(data.parent || null);
            setBrowserEntries(data.entries || []);
        } catch {
            setBrowserEntries([]);
        }
        setBrowserLoading(false);
    }, []);

    const openBrowser = useCallback(() => {
        setShowBrowser(true);
        navigateTo(path.trim() || '~');
    }, [path, navigateTo]);

    const selectBrowserDir = useCallback(() => {
        if (browserPath) {
            setPath(browserPath);
            if (!name.trim()) {
                setName(browserPath.split('/').filter(Boolean).pop() || '');
            }
        }
        setShowBrowser(false);
    }, [browserPath, name]);

    const handleSubmit = async () => {
        const trimmedPath = path.trim();
        if (!isEdit && !trimmedPath) {
            setValidation({ msg: 'Path is required', ok: false });
            return;
        }

        setSubmitting(true);
        setValidation(null);

        try {
            if (isEdit && editId) {
                await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(editId), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim(), color }),
                });
            } else {
                const wsName = name.trim() || trimmedPath.split('/').filter(Boolean).pop() || 'repo';
                const id = 'ws-' + hashString(trimmedPath);
                const res = await fetch(getApiBase() + '/workspaces', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, name: wsName, rootPath: trimmedPath, color }),
                });

                if (!res.ok) {
                    const body = await res.json().catch(() => ({ error: 'Failed' }));
                    setValidation({ msg: body.error || 'Failed to add repo', ok: false });
                    setSubmitting(false);
                    return;
                }

                // Clone detection
                const created = await res.json().catch(() => null);
                if (created?.remoteUrl) {
                    const normalized = normalizeRemoteUrl(created.remoteUrl);
                    const clones = repos.filter(r => {
                        const u = r.workspace.remoteUrl || r.gitInfo?.remoteUrl;
                        return u && normalizeRemoteUrl(u) === normalized;
                    });
                    if (clones.length > 0) {
                        setValidation({
                            msg: `Clone detected: shares remote with ${clones.map(c => c.workspace.name).join(', ')}. They will be grouped together.`,
                            ok: true,
                        });
                        await new Promise(r => setTimeout(r, 1200));
                    }
                }
            }

            onSuccess();
            onClose();
        } catch {
            setValidation({ msg: 'Network error', ok: false });
        }
        setSubmitting(false);
    };

    return (
        <Dialog
            id="add-repo-overlay"
            open={open}
            onClose={onClose}
            title={isEdit ? 'Edit Repository' : 'Add Repository'}
            footer={
                <>
                    <Button variant="secondary" id="add-repo-cancel-btn" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" id="add-repo-submit" loading={submitting} onClick={handleSubmit}>
                        {isEdit ? 'Save Changes' : 'Add Repo'}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {/* Path */}
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]">Path</label>
                <div className="flex gap-2">
                    <input
                        id="repo-path"
                        data-testid="repo-path"
                        className="flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                        value={path}
                        onChange={e => setPath(e.target.value)}
                        readOnly={isEdit}
                        placeholder="/path/to/repo"
                    />
                    {!isEdit && (
                        <Button variant="secondary" size="sm" id="browse-btn" data-testid="browse-btn" onClick={openBrowser}>
                            Browse
                        </Button>
                    )}
                </div>

                {/* Inline browser */}
                {showBrowser && (
                    <div id="path-browser" data-testid="path-browser" className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 max-h-48 overflow-y-auto text-xs">
                        <div id="path-breadcrumb" className="flex items-center gap-1 mb-1 text-[10px] text-[#848484] truncate">
                            {browserPath}
                        </div>
                        {browserLoading ? (
                            <div className="text-[#848484]">Loading...</div>
                        ) : (
                            <>
                                {browserParent && (
                                    <div
                                        className="px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                        onClick={() => navigateTo(browserParent)}
                                    >
                                        📁 ..
                                    </div>
                                )}
                                {browserEntries.length === 0 && (
                                    <div className="text-[#848484]">No subdirectories</div>
                                )}
                                {browserEntries.map(entry => (
                                    <div
                                        key={entry.name}
                                        className="path-browser-entry flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                        data-testid="path-browser-entry"
                                        onClick={() => navigateTo(browserPath + (browserPath.endsWith('/') ? '' : '/') + entry.name)}
                                    >
                                        📁 <span className="entry-name">{entry.name}</span>
                                        {entry.isGitRepo && <span className="text-[10px] px-1 bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded">git</span>}
                                    </div>
                                ))}
                            </>
                        )}
                        <div className="flex justify-end gap-1 mt-1 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <Button variant="secondary" size="sm" onClick={() => setShowBrowser(false)}>Cancel</Button>
                            <Button variant="primary" size="sm" id="path-browser-select" data-testid="path-browser-select" onClick={selectBrowserDir}>Select</Button>
                        </div>
                    </div>
                )}

                {/* Name */}
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]">Name</label>
                <input
                    id="repo-alias"
                    data-testid="repo-alias"
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Alias / display name"
                />

                {/* Color */}
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]">Color</label>
                <div className="flex gap-1.5" id="repo-color-picker" data-testid="repo-color-picker">
                    {COLOR_PALETTE.map(c => (
                        <button
                            key={c.value}
                            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c.value ? 'border-[#0078d4] scale-110' : 'border-transparent'}`}
                            style={{ background: c.value }}
                            onClick={() => setColor(c.value)}
                            title={c.label}
                            type="button"
                            data-value={c.value}
                        />
                    ))}
                </div>

                {/* Validation */}
                {validation && (
                    <div id="repo-validation" data-testid="repo-validation" className={`text-xs px-2 py-1 rounded ${validation.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                        {validation.msg}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
