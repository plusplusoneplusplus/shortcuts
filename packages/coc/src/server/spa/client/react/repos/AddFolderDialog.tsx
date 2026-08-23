/**
 * AddFolderDialog — bulk-add repos found under a parent directory.
 *
 * Phase A: Pick parent folder via the inline filesystem browser.
 * Phase B: Show discovered git repos in a checklist.
 * Phase C: Bulk-add selected repos and show progress.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, Button } from '../ui';
import {
    browseWorkspaceFolders,
    discoverWorkspaces,
    getRepositoryApiErrorMessage,
    registerWorkspace,
} from './repositoryService';
import { describeServerFailure, useServerSelection } from './useServerSelection';
import { isContainerMode, setCurrentAgentId } from '../utils/config';
import { useContainerAgents } from '../contexts/ContainerAgentContext';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

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

interface DiscoveredRepo {
    path: string;
    name: string;
}

interface AddFolderDialogProps {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
    /**
     * Server to pre-select when the dialog is launched from a remote context
     * (the remote picker's "Add workspace folder"). Omitted = Local.
     */
    serverId?: string;
    /** That server's base URL, so it is targetable before the list loads. */
    baseUrl?: string;
}

type Phase = 'pick' | 'checklist' | 'adding' | 'done';

function joinBrowserPath(basePath: string, childName: string): string {
    if (!basePath) return childName;
    if (/[/\\]$/.test(basePath)) return `${basePath}${childName}`;
    const separator = basePath.includes('\\') ? '\\' : '/';
    return `${basePath}${separator}${childName}`;
}

export function AddFolderDialog({ open, onClose, onAdded, serverId, baseUrl }: AddFolderDialogProps) {
    const [phase, setPhase] = useState<Phase>('pick');
    const { agents } = useContainerAgents();
    const availableAgents = agents;
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const server = useServerSelection(open, serverId, baseUrl);
    const selectedServer = server.selected;

    // Browser state
    const [browserPath, setBrowserPath] = useState('');
    const [browserEntries, setBrowserEntries] = useState<BrowserEntry[]>([]);
    const [browserParent, setBrowserParent] = useState<string | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);
    const [browserDrives, setBrowserDrives] = useState<string[]>([]);
    const [browseRoots, setBrowseRoots] = useState<Array<{ label: string; path: string }>>([]);
    const [browserError, setBrowserError] = useState<string | null>(null);

    // Checklist state
    const [repos, setRepos] = useState<DiscoveredRepo[]>([]);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [scanError, setScanError] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);

    // Adding progress state
    const [addingIdx, setAddingIdx] = useState(0);
    const [errors, setErrors] = useState<string[]>([]);
    const [added, setAdded] = useState<string[]>([]);
    const [notAdded, setNotAdded] = useState<string[]>([]);
    const cancelRef = useRef(false);

    // Reset when dialog opens
    useEffect(() => {
        if (open) {
            setPhase('pick');
            setBrowserPath('');
            setBrowserEntries([]);
            setBrowserParent(null);
            setBrowserDrives([]);
            setBrowseRoots([]);
            setBrowserError(null);
            setRepos([]);
            setChecked(new Set());
            setScanError(null);
            setScanning(false);
            setAddingIdx(0);
            setErrors([]);
            setAdded([]);
            setNotAdded([]);
            cancelRef.current = false;
            if (isContainerMode() && availableAgents.length > 0) {
                setSelectedAgentId(availableAgents[0].id);
            }
            navigateTo('~');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const navigateTo = useCallback(async (dir: string, targetServerId?: string) => {
        // The server is passed explicitly when it just changed, since this
        // callback still closes over the previous selection at that moment.
        const target = server.resolveServer(targetServerId ?? server.serverId);
        // Container agents and remote servers are two different ways to reach
        // another filesystem and do not compose: a remote pick bypasses the
        // agent-id dance entirely.
        const isLocalTarget = !target.baseUrl;
        setBrowserLoading(true);
        setBrowserError(null);
        try {
            if (isLocalTarget && isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
            const data = await browseWorkspaceFolders(dir, target.baseUrl) as BrowserResponse;
            setBrowserPath(data.path);
            setBrowserParent(data.parent || null);
            setBrowserEntries(data.entries || []);
            setBrowserDrives(Array.isArray(data.drives) ? data.drives : []);
            setBrowseRoots(Array.isArray(data.browseRoots) ? data.browseRoots : []);
        } catch (err) {
            setBrowserEntries([]);
            setBrowserParent(null);
            setBrowseRoots([]);
            const errStatus = (err as any)?.status;
            const errMsg = err instanceof Error ? err.message : String(err);
            const isAuthError = (errStatus === 401 || errStatus === 403)
                || /unexpected.*token|not valid json|authentication required/i.test(errMsg);
            console.warn('[AddFolderDialog] Browse error:', { errStatus, errMsg, isAuthError, err });
            if (isLocalTarget && isAuthError && isContainerMode() && selectedAgentId) {
                const agent = availableAgents.find(a => a.id === selectedAgentId);
                if (agent?.address) {
                    const helperUrl = `${agent.address}/api/fs/browse-helper?path=${encodeURIComponent(dir)}`;
                    setBrowserError('Authenticating — complete login in the opened tab if prompted...');
                    const popup = window.open(helperUrl, '_blank', 'width=600,height=400');
                    const onMessage = (event: MessageEvent) => {
                        if (event.data?.type === 'browse-result') {
                            window.removeEventListener('message', onMessage);
                            const data = event.data.data as BrowserResponse;
                            setBrowserPath(data.path);
                            setBrowserParent(data.parent || null);
                            setBrowserEntries(data.entries || []);
                            setBrowserDrives(Array.isArray(data.drives) ? data.drives : []);
                            setBrowseRoots(Array.isArray(data.browseRoots) ? data.browseRoots : []);
                            setBrowserError(null);
                            setBrowserLoading(false);
                        } else if (event.data?.type === 'browse-error') {
                            window.removeEventListener('message', onMessage);
                            setBrowserError(`Browse failed: ${event.data.error}`);
                            setBrowserLoading(false);
                        }
                    };
                    window.addEventListener('message', onMessage);
                    if (popup) {
                        const cleanup = setInterval(() => {
                            if (popup.closed) {
                                clearInterval(cleanup);
                                window.removeEventListener('message', onMessage);
                                setBrowserLoading(false);
                            }
                        }, 1000);
                        setTimeout(() => { clearInterval(cleanup); window.removeEventListener('message', onMessage); }, 300_000);
                    }
                } else {
                    setBrowserError('Authentication required. Please authenticate with this agent first.');
                }
            } else {
                setBrowserError(describeServerFailure('Unable to browse this path', target));
            }
        }
        setBrowserLoading(false);
    }, [selectedAgentId, availableAgents, server]);

    // A path only means something on the server it came from, so switching
    // servers drops it, forgets any scan results, and re-roots the browser at
    // the new box's home.
    const changeServer = useCallback((nextServerId: string) => {
        server.selectServer(nextServerId);
        setBrowserPath('');
        setBrowserEntries([]);
        setBrowserParent(null);
        setBrowserDrives([]);
        setBrowseRoots([]);
        setBrowserError(null);
        setRepos([]);
        setChecked(new Set());
        setScanError(null);
        navigateTo('~', nextServerId);
    }, [server, navigateTo]);

    const handleScan = useCallback(async () => {
        if (!browserPath) return;
        setScanning(true);
        setScanError(null);
        const target = selectedServer;
        try {
            if (!target.baseUrl && isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
            const data = await discoverWorkspaces(browserPath, target.baseUrl) as { repos: DiscoveredRepo[] };
            setRepos(data.repos);
            setChecked(new Set(data.repos.map(r => r.path)));
            setPhase('checklist');
        } catch (error: unknown) {
            setScanError(describeServerFailure(getRepositoryApiErrorMessage(error, 'Failed to scan folder'), target));
        }
        setScanning(false);
    }, [browserPath, selectedAgentId, selectedServer]);

    const toggleCheck = (repoPath: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(repoPath)) next.delete(repoPath);
            else next.add(repoPath);
            return next;
        });
    };

    const toggleAll = () => {
        if (checked.size === repos.length) setChecked(new Set());
        else setChecked(new Set(repos.map(r => r.path)));
    };

    const handleAddSelected = useCallback(async () => {
        const selected = repos.filter(r => checked.has(r.path));
        if (selected.length === 0) return;

        cancelRef.current = false;
        setPhase('adding');
        setAddingIdx(0);
        setErrors([]);
        setAdded([]);
        setNotAdded([]);

        const target = selectedServer;
        const newErrors: string[] = [];
        const addedNames: string[] = [];
        const notAddedNames: string[] = [];
        for (let i = 0; i < selected.length; i++) {
            const repo = selected[i];
            if (cancelRef.current) {
                notAddedNames.push(...selected.slice(i).map(r => r.name));
                break;
            }
            setAddingIdx(i + 1);
            try {
                if (!target.baseUrl && isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
                // Id is server-authoritative (machine-scoped); the server computes
                // the canonical workspace id from each repo path.
                await registerWorkspace({
                    name: repo.name,
                    rootPath: repo.path,
                }, target.baseUrl);
                addedNames.push(repo.name);
            } catch (error) {
                // Stop on the first failure: a registry that just rejected one
                // repo will most likely reject the rest, and hammering it hides
                // the real error. Successes are kept, never rolled back.
                newErrors.push(`${repo.name}: ${describeServerFailure(getRepositoryApiErrorMessage(error, 'Failed', 'Network error'), target)}`);
                notAddedNames.push(...selected.slice(i).map(r => r.name));
                break;
            }
        }

        setErrors(newErrors);
        setAdded(addedNames);
        setNotAdded(notAddedNames);
        setPhase('done');
    }, [repos, checked, selectedAgentId, selectedServer]);

    const handleClose = useCallback(() => {
        cancelRef.current = true;
        onClose();
    }, [onClose]);

    const handleDone = useCallback(() => {
        onAdded();
    }, [onAdded]);

    // ── Footer buttons per phase ───────────────────────────────────────

    const footer = (() => {
        if (phase === 'pick') {
            return (
                <>
                    <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        id="scan-folder-btn"
                        data-testid="scan-folder-btn"
                        loading={scanning}
                        onClick={handleScan}
                        disabled={!browserPath}
                    >
                        Scan
                    </Button>
                </>
            );
        }
        if (phase === 'checklist') {
            return (
                <>
                    <Button variant="secondary" onClick={() => setPhase('pick')}>Back</Button>
                    <Button variant="secondary" onClick={handleClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        id="add-selected-btn"
                        data-testid="add-selected-btn"
                        onClick={handleAddSelected}
                        disabled={checked.size === 0}
                    >
                        Add Selected ({checked.size})
                    </Button>
                </>
            );
        }
        if (phase === 'adding') {
            return (
                <Button variant="secondary" onClick={() => { cancelRef.current = true; }}>Cancel</Button>
            );
        }
        // done
        return (
            <Button variant="primary" id="folder-add-done-btn" data-testid="folder-add-done-btn" onClick={handleDone}>
                {errors.length > 0 ? 'Close' : 'Done'}
            </Button>
        );
    })();

    // ── Body per phase ─────────────────────────────────────────────────

    const body = (() => {
        if (phase === 'pick') {
            return (
                <div className="flex flex-col gap-2">
                    {/* Agent selector (container mode only, Local target only) */}
                    {isContainerMode() && !selectedServer.baseUrl && (
                        <>
                            <label className="text-xs font-medium text-[#616161] dark:text-[#999]">Agent</label>
                            <select
                                className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                                value={selectedAgentId}
                                onChange={e => setSelectedAgentId(e.target.value)}
                            >
                                {availableAgents.length === 0 && (
                                    <option value="" disabled>No agents available</option>
                                )}
                                {availableAgents.map(agent => (
                                    <option key={agent.id} value={agent.id}>
                                        {agent.name} ({agent.address}){agent.status === 'offline' ? ' [offline]' : ''}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                    <p className="text-xs text-[#616161] dark:text-[#999]">
                        Select a parent folder. CoC will scan its direct child directories for git repositories.
                    </p>

                    {/* Filesystem browser */}
                    <div
                        id="folder-browser"
                        data-testid="folder-browser"
                        className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 max-h-52 overflow-y-auto text-xs"
                    >
                        <div className="flex items-center gap-1 mb-1 text-[10px] text-[#848484] truncate" id="folder-breadcrumb">
                            {browserPath || '…'}
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
                                        data-testid={`browse-root-${root.label}`}
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
                                        onClick={() => navigateTo(drive)}
                                    >
                                        {drive}
                                    </button>
                                ))}
                            </div>
                        )}
                        {browserLoading ? (
                            <div className="text-[#848484]">Loading…</div>
                        ) : (
                            <>
                                {browserError && (
                                    <div className="text-red-600 dark:text-red-400 mb-1">{browserError}</div>
                                )}
                                {browserParent && (
                                    <div
                                        className="px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                        onClick={() => navigateTo(browserParent)}
                                    >
                                        📁 ..
                                    </div>
                                )}
                                {browserEntries.length === 0 && !browserError && (
                                    <div className="text-[#848484]">No subdirectories</div>
                                )}
                                {browserEntries.map(entry => (
                                    <div
                                        key={entry.name}
                                        className="folder-browser-entry flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                        data-testid="folder-browser-entry"
                                        onClick={() => navigateTo(joinBrowserPath(browserPath, entry.name))}
                                    >
                                        📁 <span>{entry.name}</span>
                                        {entry.isGitRepo && (
                                            <span className="text-[10px] px-1 bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded">git</span>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    {/* Selected path display */}
                    {browserPath && (
                        <div className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#2d2d2d] px-2 py-1 rounded truncate">
                            📁 {browserPath}
                        </div>
                    )}

                    {scanError && (
                        <div
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                            data-testid="scan-error"
                        >
                            {scanError}
                        </div>
                    )}
                </div>
            );
        }

        if (phase === 'checklist') {
            return (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-[#616161] dark:text-[#999]">
                        <span>Found <strong>{repos.length}</strong> repositor{repos.length !== 1 ? 'ies' : 'y'} in <span className="font-mono">{browserPath}</span></span>
                        {repos.length > 0 && (
                            <button
                                type="button"
                                className="text-[#0078d4] hover:underline text-[11px]"
                                onClick={toggleAll}
                            >
                                {checked.size === repos.length ? 'Deselect all' : 'Select all'}
                            </button>
                        )}
                    </div>

                    {repos.length === 0 ? (
                        <div className="text-xs text-[#848484] py-4 text-center" data-testid="no-repos-found">
                            No new git repositories found. All repositories in this folder are either not git repos or already registered.
                        </div>
                    ) : (
                        <div
                            className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded max-h-52 overflow-y-auto"
                            data-testid="repo-checklist"
                        >
                            {repos.map(repo => (
                                <label
                                    key={repo.path}
                                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-xs"
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked.has(repo.path)}
                                        onChange={() => toggleCheck(repo.path)}
                                        data-testid={`repo-check-${repo.name}`}
                                    />
                                    <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{repo.name}</span>
                                    <span className="text-[#848484] truncate">{repo.path}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (phase === 'adding') {
            const selected = repos.filter(r => checked.has(r.path));
            return (
                <div className="flex flex-col gap-2 py-2">
                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]" data-testid="adding-progress">
                        Adding {addingIdx} of {selected.length}…
                    </div>
                    <div className="h-1.5 rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] overflow-hidden">
                        <div
                            className="h-full bg-[#0078d4] transition-all duration-200"
                            style={{ width: `${Math.round((addingIdx / selected.length) * 100)}%` }}
                        />
                    </div>
                </div>
            );
        }

        // done
        const addedCount = added.length;
        return (
            <div className="flex flex-col gap-2 py-2" data-testid="adding-done">
                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                    {addedCount > 0 && (
                        <span className="text-green-700 dark:text-green-400">
                            ✓ Added {addedCount} repositor{addedCount !== 1 ? 'ies' : 'y'}.
                        </span>
                    )}
                </div>
                {addedCount > 0 && (
                    <div className="text-xs text-[#616161] dark:text-[#999]" data-testid="added-list">
                        Added: {added.join(', ')}
                    </div>
                )}
                {errors.length > 0 && (
                    <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2 space-y-0.5">
                        <div className="font-medium mb-1">Failed to add {errors.length}:</div>
                        {errors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                )}
                {notAdded.length > 0 && (
                    <div className="text-xs text-[#616161] dark:text-[#999]" data-testid="not-added-list">
                        Not added ({notAdded.length}): {notAdded.join(', ')}
                    </div>
                )}
            </div>
        );
    })();

    return (
        <Dialog
            id="add-folder-overlay"
            open={open}
            onClose={handleClose}
            title="Add Workspace Folder"
            footer={footer}
        >
            {/* Server — which CoC filesystem is scanned and which registry the
                repos land in. Locked once a scan/add run is under way. */}
            <div className="flex flex-col gap-1 mb-2">
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="add-folder-server-select">Server</label>
                <select
                    id="add-folder-server-select"
                    data-testid="add-folder-server-select"
                    value={server.serverId}
                    onChange={e => changeServer(e.target.value)}
                    disabled={phase !== 'pick'}
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] disabled:opacity-60"
                >
                    {server.choices.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
            </div>
            {body}
        </Dialog>
    );
}
