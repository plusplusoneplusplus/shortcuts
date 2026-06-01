import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Derives the default folder name git would use when cloning a given URL.
 * Mirrors the server-side `deriveDefaultCloneDirectoryName` so the UI can
 * predict the clone target without a round-trip.
 */
export function deriveRepoName(gitUrl: string): string {
    const trimmed = gitUrl.trim().replace(/[?#].*$/, '').replace(/[/\\]+$/, '');
    const lastSeparator = Math.max(
        trimmed.lastIndexOf('/'),
        trimmed.lastIndexOf('\\'),
        trimmed.lastIndexOf(':'),
    );
    const lastPart = trimmed.slice(lastSeparator + 1);
    return lastPart.endsWith('.git') ? lastPart.slice(0, -4) : lastPart;
}

/**
 * Returns `baseName` if it is not in `existingNames`; otherwise appends
 * incrementing suffixes (`-2`, `-3`, …) until a free name is found.
 */
export function suggestNonConflictingName(
    baseName: string,
    existingNames: ReadonlySet<string>,
): string {
    if (!existingNames.has(baseName)) {
        return baseName;
    }
    let counter = 2;
    while (existingNames.has(`${baseName}-${counter}`)) {
        counter++;
    }
    return `${baseName}-${counter}`;
}

export function CloneRepoDialog({ open, onClose, onSuccess }: CloneRepoDialogProps) {
    const { dispatch } = useApp();
    const [url, setUrl] = useState('');
    const [parentDir, setParentDir] = useState('');
    const [folderName, setFolderName] = useState('');
    const [conflictBaseName, setConflictBaseName] = useState<string | null>(null);
    // True while the folder name is still auto-derived (not yet manually edited).
    const isAutoFolderNameRef = useRef(true);
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
        setFolderName('');
        setConflictBaseName(null);
        isAutoFolderNameRef.current = true;
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

    // Stable ref so the browserEntries effect can read the latest value without
    // re-running every time browserEntries changes.
    const browserEntriesRef = useRef<BrowserEntry[]>(browserEntries);
    browserEntriesRef.current = browserEntries;

    // When the URL changes: re-derive the folder name and check for conflicts
    // against the currently browsed directory.
    useEffect(() => {
        const baseName = deriveRepoName(url);
        isAutoFolderNameRef.current = true;
        if (!baseName) {
            setFolderName('');
            setConflictBaseName(null);
            return;
        }
        const existingNames = new Set(browserEntriesRef.current.map(e => e.name));
        const suggested = suggestNonConflictingName(baseName, existingNames);
        setFolderName(suggested);
        setConflictBaseName(suggested !== baseName ? baseName : null);
    }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

    // Stable ref so the browserEntries effect can read the current URL without
    // becoming a dependency and running on every URL keystroke.
    const urlRef = useRef(url);
    urlRef.current = url;

    // When the user navigates to a new folder, re-check the current folder name
    // for conflicts — but only if the name hasn't been manually edited.
    useEffect(() => {
        if (!isAutoFolderNameRef.current) {
            return;
        }
        const baseName = deriveRepoName(urlRef.current);
        if (!baseName) {
            return;
        }
        const existingNames = new Set(browserEntries.map(e => e.name));
        const suggested = suggestNonConflictingName(baseName, existingNames);
        setFolderName(suggested);
        setConflictBaseName(suggested !== baseName ? baseName : null);
    }, [browserEntries]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleFolderNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        isAutoFolderNameRef.current = false;
        setFolderName(event.target.value);
        setConflictBaseName(null);
    }, []);

    const handleClone = useCallback(async () => {
        const trimmedUrl = url.trim();
        const trimmedParentDir = parentDir.trim();
        const trimmedFolderName = folderName.trim();
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
            const { clonedPath } = await cloneRepository({
                url: trimmedUrl,
                parentDir: trimmedParentDir,
                dirName: trimmedFolderName || undefined,
            });
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
    }, [dispatch, folderName, onClose, onSuccess, parentDir, url]);

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

                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="clone-folder-name">
                    Folder name
                </label>
                <input
                    id="clone-folder-name"
                    data-testid="clone-folder-name"
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                    value={folderName}
                    onChange={handleFolderNameChange}
                    placeholder="my-repo"
                    disabled={cloning}
                />

                {conflictBaseName && (
                    <div
                        data-testid="clone-folder-conflict-note"
                        className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                    >
                        A folder named &quot;{conflictBaseName}&quot; already exists here. We&apos;ve suggested a new name — feel free to change it.
                    </div>
                )}

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
