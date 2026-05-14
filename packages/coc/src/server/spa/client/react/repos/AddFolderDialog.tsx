/**
 * AddFolderDialog — bulk-add repos found under a parent directory.
 *
 * Phase A: Pick parent folder via the inline filesystem browser.
 * Phase B: Show discovered git repos in a checklist.
 * Phase C: Bulk-add selected repos and show progress.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, Button } from '../ui';
import { hashString } from './repoGrouping';
import {
    browseWorkspaceFolders,
    discoverWorkspaces,
    getRepositoryApiErrorMessage,
    registerWorkspace,
} from './repositoryService';
import { isContainerMode, setCurrentAgentId, getCurrentAgentId, markAgentAuthenticated, isAgentAuthenticated, getAuthenticatedAgentAddress, clearAgentAuth, getRawApiBase, hasServerSideAuth } from '../utils/config';
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
}

type Phase = 'pick' | 'checklist' | 'adding' | 'done';

function joinBrowserPath(basePath: string, childName: string): string {
    if (!basePath) return childName;
    if (/[/\\]$/.test(basePath)) return `${basePath}${childName}`;
    const separator = basePath.includes('\\') ? '\\' : '/';
    return `${basePath}${separator}${childName}`;
}

export function AddFolderDialog({ open, onClose, onAdded }: AddFolderDialogProps) {
    const [phase, setPhase] = useState<Phase>('pick');
    const { agents } = useContainerAgents();
    const availableAgents = agents;
    const [selectedAgentId, setSelectedAgentId] = useState('');

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
            cancelRef.current = false;
            if (isContainerMode() && availableAgents.length > 0) {
                setSelectedAgentId(availableAgents[0].id);
            }
            navigateTo('~');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Runs a helper URL on the agent domain via a popup window.
    // First-time auth: larger popup for Microsoft login flow.
    // Cached/already authed: small named popup that reuses the same window and auto-closes.
    const runViaHelper = useCallback((
        agentId: string, agentAddr: string, helperUrl: string,
        resultType: string, errorType: string,
        onResult: (data: unknown) => void,
        onError: (msg: string) => void,
        isFirstAuth: boolean,
    ) => {
        let gotResult = false;

        const cleanupAll = () => {
            window.removeEventListener('message', onMessage);
            clearInterval(closedCheck);
            clearTimeout(timeout);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.data?.type === resultType) {
                gotResult = true;
                cleanupAll();
                markAgentAuthenticated(agentId, agentAddr);
                onResult(event.data.data);
                try { popup?.close(); } catch { /* ignore */ }
            } else if (event.data?.type === errorType) {
                gotResult = true;
                cleanupAll();
                onError(event.data.error || 'Unknown error');
                try { popup?.close(); } catch { /* ignore */ }
            }
        };
        window.addEventListener('message', onMessage);

        const winName = isFirstAuth ? '_blank' : 'coc-agent-helper';
        const winFeatures = isFirstAuth
            ? 'width=600,height=400'
            : 'width=100,height=100';
        const popup = window.open(helperUrl, winName, winFeatures);
        if (!popup) {
            cleanupAll();
            onError('Popup was blocked by the browser. Please allow popups for this site and try again.');
            return;
        }

        const closedCheck = setInterval(() => {
            if (popup.closed) {
                cleanupAll();
                if (!gotResult) onError('Agent is unreachable or authentication was not completed.');
            }
        }, 1000);

        const timeoutMs = isFirstAuth ? 60_000 : 15_000;
        const timeout = setTimeout(() => {
            if (!gotResult) {
                cleanupAll();
                onError('Request timed out — the agent may be offline or unreachable.');
                try { popup.close(); } catch { /* ignore */ }
            }
        }, timeoutMs);
    }, []);

    const browseViaHelper = useCallback((agentId: string, agentAddr: string, dir: string, isFirstAuth: boolean) => {
        const helperUrl = `${agentAddr}/api/fs/browse-helper?path=${encodeURIComponent(dir)}`;
        if (isFirstAuth) {
            setBrowserError('Authenticating — complete login in the opened tab if prompted...');
        }
        runViaHelper(agentId, agentAddr, helperUrl, 'browse-result', 'browse-error',
            (data) => {
                const d = data as BrowserResponse;
                setBrowserPath(d.path);
                setBrowserParent(d.parent || null);
                setBrowserEntries(d.entries || []);
                setBrowserDrives(Array.isArray(d.drives) ? d.drives : []);
                setBrowseRoots(Array.isArray(d.browseRoots) ? d.browseRoots : []);
                setBrowserError(null);
                setBrowserLoading(false);
            },
            (msg) => { setBrowserError(msg); setBrowserLoading(false); },
            isFirstAuth,
        );
    }, [runViaHelper]);

    const navigateTo = useCallback(async (dir: string) => {
        setBrowserLoading(true);
        setBrowserError(null);
        try {
            if (isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);

            // For authenticated devtunnel agents without server-side auth, use browse-helper directly (popup relay)
            if (isContainerMode() && selectedAgentId && !hasServerSideAuth(selectedAgentId) && isAgentAuthenticated(selectedAgentId)) {
                const agentAddr = getAuthenticatedAgentAddress(selectedAgentId)!;
                browseViaHelper(selectedAgentId, agentAddr, dir, false);
                return;
            }

            const data = await browseWorkspaceFolders(dir) as BrowserResponse;
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
            if (isAuthError && isContainerMode() && selectedAgentId) {
                // Clear stale cached auth so we don't keep trying the direct path
                clearAgentAuth(selectedAgentId);
                const agent = availableAgents.find(a => a.id === selectedAgentId);
                if (agent?.address) {
                    browseViaHelper(selectedAgentId, agent.address, dir, true);
                } else {
                    setBrowserError('Authentication required. Please authenticate with this agent first.');
                }
            } else {
                setBrowserError('Unable to browse this path');
            }
        }
        setBrowserLoading(false);
    }, [selectedAgentId, availableAgents, browseViaHelper]);

    const handleScan = useCallback(async () => {
        if (!browserPath) return;
        setScanning(true);
        setScanError(null);
        try {
            if (isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
            const data = await discoverWorkspaces(browserPath) as { repos: DiscoveredRepo[] };
            setRepos(data.repos);
            setChecked(new Set(data.repos.map(r => r.path)));
            setPhase('checklist');
        } catch (error: unknown) {
            setScanError(getRepositoryApiErrorMessage(error, 'Failed to scan folder'));
        }
        setScanning(false);
    }, [browserPath, selectedAgentId]);

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

        const newErrors: string[] = [];
        for (let i = 0; i < selected.length; i++) {
            if (cancelRef.current) break;
            setAddingIdx(i + 1);
            const repo = selected[i];
            try {
                if (isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
                const id = 'ws-' + hashString(repo.path);
                // For devtunnel agents without server-side auth, use register-helper iframe
                if (isContainerMode() && selectedAgentId && !hasServerSideAuth(selectedAgentId) && isAgentAuthenticated(selectedAgentId)) {
                    const agentAddr = getAuthenticatedAgentAddress(selectedAgentId)!;
                    const params = new URLSearchParams({ action: 'register', id, name: repo.name, rootPath: repo.path });
                    const helperUrl = `${agentAddr}/api/fs/browse-helper?${params.toString()}`;
                    try {
                        await new Promise<void>((resolve, reject) => {
                            runViaHelper(selectedAgentId, agentAddr, helperUrl, 'register-result', 'register-error',
                                () => resolve(),
                                (msg) => reject(new Error(msg)),
                                false,
                            );
                        });
                        // Notify container about the new workspace (await to populate cache before refresh)
                        try {
                            await fetch(`${getRawApiBase()}/container/workspace-registered`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    agentId: selectedAgentId,
                                    workspace: { id, name: repo.name, rootPath: repo.path },
                                }),
                            });
                        } catch { /* best-effort */ }
                    } catch {
                        // Helper doesn't support register — fall back to proxy
                        await registerWorkspace({ id, name: repo.name, rootPath: repo.path });
                    }
                } else {
                    await registerWorkspace({ id, name: repo.name, rootPath: repo.path });
                }
            } catch (error) {
                newErrors.push(`${repo.name}: ${getRepositoryApiErrorMessage(error, 'Failed', 'Network error')}`);
            }
        }

        setErrors(newErrors);
        setPhase('done');
    }, [repos, checked, selectedAgentId, runViaHelper]);

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
                    {/* Agent selector (container mode only) */}
                    {isContainerMode() && (
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
        const addedCount = repos.filter(r => checked.has(r.path)).length - errors.length;
        return (
            <div className="flex flex-col gap-2 py-2" data-testid="adding-done">
                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                    {addedCount > 0 && (
                        <span className="text-green-700 dark:text-green-400">
                            ✓ Added {addedCount} repositor{addedCount !== 1 ? 'ies' : 'y'}.
                        </span>
                    )}
                </div>
                {errors.length > 0 && (
                    <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2 space-y-0.5">
                        <div className="font-medium mb-1">Failed to add {errors.length}:</div>
                        {errors.map((e, i) => <div key={i}>{e}</div>)}
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
            {body}
        </Dialog>
    );
}
