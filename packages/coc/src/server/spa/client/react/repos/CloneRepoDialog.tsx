import { useCallback, useEffect, useState } from 'react';
import { Dialog, Button } from '../ui';
import { useApp } from '../contexts/AppContext';
import { hashString } from './repoGrouping';
import {
    browseWorkspaceFolders,
    cloneRepository,
    getRepositoryApiErrorMessage,
    registerWorkspace,
} from './repositoryService';

interface CloneRepoDialogProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface BrowserEntry {
    name: string;
    isGitRepo?: boolean;
}

interface BrowserResponse {
    path: string;
    parent?: string | null;
    entries?: BrowserEntry[];
    drives?: string[];
    browseRoots?: Array<{ label: string; path: string }>;
}

function getPathLeaf(pathValue: string): string {
    return pathValue
        .replace(/[/\\]+$/, '')
        .split(/[/\\]+/)
        .filter(Boolean)
        .pop() || '';
}

function joinBrowserPath(basePath: string, childName: string): string {
    if (!basePath) {
        return childName;
    }
    if (/[/\\]$/.test(basePath)) {
        return `${basePath}${childName}`;
    }
    const separator = basePath.includes('\\') ? '\\' : '/';
    return `${basePath}${separator}${childName}`;
}

export function CloneRepoDialog({ open, onClose, onSuccess }: CloneRepoDialogProps) {
    const { dispatch } = useApp();
    const [url, setUrl] = useState('');
    const [parentDir, setParentDir] = useState('');
    const [cloning, setCloning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [browserPath, setBrowserPath] = useState('');
    const [browserEntries, setBrowserEntries] = useState<BrowserEntry[]>([]);
    const [browserParent, setBrowserParent] = useState<string | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);
    const [browserDrives, setBrowserDrives] = useState<string[]>([]);
    const [browseRoots, setBrowseRoots] = useState<Array<{ label: string; path: string }>>([]);
    const [browserError, setBrowserError] = useState<string | null>(null);

    const navigateTo = useCallback(async (dir: string) => {
        setBrowserLoading(true);
        setBrowserError(null);
        try {
            const data = await browseWorkspaceFolders(dir) as BrowserResponse;
            setBrowserPath(data.path);
            setParentDir(data.path);
            setBrowserParent(data.parent || null);
            setBrowserEntries(data.entries || []);
            setBrowserDrives(Array.isArray(data.drives) ? data.drives : []);
            setBrowseRoots(Array.isArray(data.browseRoots) ? data.browseRoots : []);
        } catch (browseError) {
            setBrowserEntries([]);
            setBrowserParent(null);
            setBrowseRoots([]);
            setBrowserError(getRepositoryApiErrorMessage(browseError, 'Unable to browse this path'));
        } finally {
            setBrowserLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        setUrl('');
        setParentDir('');
        setCloning(false);
        setError(null);
        setBrowserPath('');
        setBrowserEntries([]);
        setBrowserParent(null);
        setBrowserDrives([]);
        setBrowseRoots([]);
        setBrowserError(null);
        void navigateTo('~');
    }, [navigateTo, open]);

    const handleClone = useCallback(async () => {
        const trimmedUrl = url.trim();
        const trimmedParentDir = parentDir.trim();
        if (!trimmedUrl) {
            setError('Repository URL is required');
            return;
        }
        if (!trimmedParentDir) {
            setError('Parent folder is required');
            return;
        }

        setCloning(true);
        setError(null);
        try {
            const { clonedPath } = await cloneRepository({ url: trimmedUrl, parentDir: trimmedParentDir });
            const workspace = await registerWorkspace({
                id: 'ws-' + hashString(clonedPath),
                name: getPathLeaf(clonedPath) || 'repo',
                rootPath: clonedPath,
            });
            dispatch({ type: 'WORKSPACE_REGISTERED', workspace });
            dispatch({ type: 'SET_SELECTED_REPO', id: workspace.id });
            location.hash = '#repos/' + encodeURIComponent(workspace.id);
            onSuccess();
            onClose();
        } catch (cloneError) {
            setError(getRepositoryApiErrorMessage(cloneError, 'Failed to clone repository', 'Network error'));
        } finally {
            setCloning(false);
        }
    }, [dispatch, onClose, onSuccess, parentDir, url]);

    return (
        <Dialog
            id="clone-repo-overlay"
            open={open}
            onClose={onClose}
            title="Clone Repository"
            disableClose={cloning}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={cloning}>Cancel</Button>
                    <Button
                        variant="primary"
                        id="clone-repo-submit"
                        data-testid="clone-repo-submit"
                        loading={cloning}
                        onClick={handleClone}
                    >
                        Clone
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="clone-repo-url">
                    Git URL
                </label>
                <input
                    id="clone-repo-url"
                    data-testid="clone-repo-url"
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                    value={url}
                    onChange={event => setUrl(event.target.value)}
                    placeholder="https://github.com/org/repo.git or git@host:org/repo.git"
                    disabled={cloning}
                />

                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="clone-parent-dir">
                    Parent folder
                </label>
                <input
                    id="clone-parent-dir"
                    data-testid="clone-parent-dir"
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                    value={parentDir}
                    onChange={event => setParentDir(event.target.value)}
                    placeholder="/path/to/parent"
                    disabled={cloning}
                />

                <div
                    id="clone-folder-browser"
                    data-testid="clone-folder-browser"
                    className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 max-h-52 overflow-y-auto text-xs"
                >
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-[#848484] truncate">
                        {browserPath || '...'}
                    </div>
                    {browseRoots.length > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                            {browseRoots.map(root => (
                                <button
                                    key={root.path}
                                    type="button"
                                    className={`px-1 py-0.5 rounded border text-[10px] ${browserPath.toLowerCase().startsWith(root.path.toLowerCase())
                                        ? 'border-[#0078d4] text-[#0078d4]'
                                        : 'border-[#d0d0d0] text-[#666] dark:border-[#444] dark:text-[#aaa]'}`}
                                    data-testid={`clone-browse-root-${root.label}`}
                                    disabled={cloning}
                                    onClick={() => navigateTo(root.path)}
                                >
                                    {root.label}
                                </button>
                            ))}
                        </div>
                    )}
                    {browseRoots.length === 0 && browserDrives.length > 1 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                            {browserDrives.map(drive => (
                                <button
                                    key={drive}
                                    type="button"
                                    className={`px-1 py-0.5 rounded border text-[10px] ${browserPath.toLowerCase().startsWith(drive.toLowerCase())
                                        ? 'border-[#0078d4] text-[#0078d4]'
                                        : 'border-[#d0d0d0] text-[#666] dark:border-[#444] dark:text-[#aaa]'}`}
                                    disabled={cloning}
                                    onClick={() => navigateTo(drive)}
                                >
                                    {drive}
                                </button>
                            ))}
                        </div>
                    )}
                    {browserLoading ? (
                        <div className="text-[#848484]">Loading...</div>
                    ) : (
                        <>
                            {browserError && (
                                <div className="text-red-600 dark:text-red-400 mb-1">{browserError}</div>
                            )}
                            {browserParent && (
                                <button
                                    type="button"
                                    className="block w-full text-left px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                    disabled={cloning}
                                    onClick={() => navigateTo(browserParent)}
                                >
                                    📁 ..
                                </button>
                            )}
                            {browserEntries.length === 0 && !browserError && (
                                <div className="text-[#848484]">No subdirectories</div>
                            )}
                            {browserEntries.map(entry => (
                                <button
                                    key={entry.name}
                                    type="button"
                                    className="clone-folder-browser-entry flex items-center gap-1 w-full text-left px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                    data-testid="clone-folder-browser-entry"
                                    disabled={cloning}
                                    onClick={() => navigateTo(joinBrowserPath(browserPath, entry.name))}
                                >
                                    📁 <span>{entry.name}</span>
                                    {entry.isGitRepo && (
                                        <span className="text-[10px] px-1 bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded">git</span>
                                    )}
                                </button>
                            ))}
                        </>
                    )}
                </div>

                {error && (
                    <div
                        id="clone-repo-error"
                        data-testid="clone-repo-error"
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 whitespace-pre-wrap"
                    >
                        {error}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
