/**
 * AddRepoDialog — dual-mode dialog for adding and editing a workspace.
 * Includes inline filesystem browser.
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog, Button } from '../ui';
import { hashString, normalizeRemoteUrl } from './repoGrouping';
import type { RepoData } from './repoGrouping';
import { resolveAutoColor } from '../features/git/diff/colorUtils';
import {
    browseWorkspaceFolders,
    getRepositoryApiErrorMessage,
    registerWorkspace,
    updateWorkspace,
} from './repositoryService';
import { isContainerMode, setCurrentAgentId, getCurrentAgentId, markAgentAuthenticated, isAgentAuthenticated, getAuthenticatedAgentAddress, clearAgentAuth, getRawApiBase, hasServerSideAuth } from '../utils/config';
import { useContainerAgents } from '../contexts/ContainerAgentContext';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

const AUTO_VALUE = 'auto';

const COLOR_PALETTE = [
    { label: 'Auto', value: AUTO_VALUE },
    { label: 'Blue', value: '#0078d4' },
    { label: 'Green', value: '#107c10' },
    { label: 'Orange', value: '#d83b01' },
    { label: 'Purple', value: '#b4009e' },
    { label: 'Teal', value: '#008272' },
    { label: 'Dark Green', value: '#004b1c' },
    { label: 'Grey', value: '#848484' },
];

/** Palette entries excluding the virtual 'auto' entry */
const REAL_PALETTE = COLOR_PALETTE.filter(c => c.value !== AUTO_VALUE);

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

function getPathPlaceholder(): string {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.platform)) {
        return 'C:\\path\\to\\repo';
    }
    return '/path/to/repo';
}

export function AddRepoDialog({ open, onClose, editId, repos, onSuccess }: AddRepoDialogProps) {
    const isEdit = !!editId;
    const editRepo = isEdit ? repos.find(r => r.workspace.id === editId) : null;
    const pathPlaceholder = getPathPlaceholder();
    const { agents } = useContainerAgents();
    const availableAgents = agents;

    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [path, setPath] = useState('');
    const [name, setName] = useState('');
    const [color, setColor] = useState(AUTO_VALUE);
    const [validation, setValidation] = useState<{ msg: string; ok: boolean } | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Auto-select first available agent when dialog opens in container mode
    useEffect(() => {
        if (open && isContainerMode() && !selectedAgentId && availableAgents.length > 0) {
            setSelectedAgentId(availableAgents[0].id);
        }
    }, [open, selectedAgentId, availableAgents]);

    // Browser state
    const [showBrowser, setShowBrowser] = useState(false);
    const [browserPath, setBrowserPath] = useState('');
    const [browserEntries, setBrowserEntries] = useState<BrowserEntry[]>([]);
    const [browserParent, setBrowserParent] = useState<string | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);
    const [browserDrives, setBrowserDrives] = useState<string[]>([]);
    const [browseRoots, setBrowseRoots] = useState<Array<{ label: string; path: string }>>([]);
    const [browserError, setBrowserError] = useState<string | null>(null);

    // Pre-fill for edit mode
    useEffect(() => {
        if (open && isEdit && editRepo) {
            setPath(editRepo.workspace.rootPath || '');
            setName(editRepo.workspace.name || '');
            setColor(editRepo.workspace.color || '#0078d4');
        } else if (open) {
            setPath('');
            setName('');
            setColor(AUTO_VALUE);
        }
        setValidation(null);
        setShowBrowser(false);
        setBrowserDrives([]);
        setBrowseRoots([]);
        setBrowserError(null);
    }, [open, isEdit, editRepo]);

    // Runs a helper URL on the agent domain via a popup window.
    // First-time auth: larger popup for Microsoft login flow.
    // Cached/already authed: small named popup that reuses the same window and auto-closes.
    // Hidden iframes DON'T work because devtunnel auth cookies have SameSite restrictions.
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

        // Use a named window for cached agents (reuses same small popup)
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

    // Browse via helper (popup or iframe depending on auth state)
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
        const prevAgentId = getCurrentAgentId();
        try {
            if (isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);

            // If agent is already authenticated AND doesn't have server-side auth,
            // use browse-helper directly (popup relay). For server-auth agents, use the proxy.
            if (isContainerMode() && selectedAgentId && !hasServerSideAuth(selectedAgentId) && isAgentAuthenticated(selectedAgentId)) {
                const agentAddr = getAuthenticatedAgentAddress(selectedAgentId)!;
                browseViaHelper(selectedAgentId, agentAddr, dir, false);
                setCurrentAgentId(prevAgentId);
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
            console.warn('[AddRepoDialog] Browse error:', { errStatus, errMsg, isAuthError, err });
            if (isAuthError && isContainerMode() && selectedAgentId) {
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
        } finally {
            setCurrentAgentId(prevAgentId);
        }
        setBrowserLoading(false);
    }, [selectedAgentId, availableAgents]);

    const openBrowser = useCallback(() => {
        setShowBrowser(true);
        navigateTo(path.trim() || '~');
    }, [path, navigateTo]);

    const selectBrowserDir = useCallback(() => {
        if (browserPath) {
            setPath(browserPath);
            if (!name.trim()) {
                setName(getPathLeaf(browserPath));
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

        // Resolve 'auto' to a concrete hex color before submitting
        const existingColors = repos.map(r => r.workspace.color).filter(Boolean) as string[];
        const resolvedColor = color === AUTO_VALUE
            ? resolveAutoColor(existingColors, REAL_PALETTE)
            : color;

        const prevAgentId = getCurrentAgentId();
        try {
            if (isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
            if (isEdit && editId) {
                await updateWorkspace(editId, { name: name.trim(), color: resolvedColor });
            } else {
                const wsName = name.trim() || getPathLeaf(trimmedPath) || 'repo';
                const id = 'ws-' + hashString(trimmedPath);

                // For devtunnel agents without server-side auth, use browse-helper with action=register (popup),
                // fall back to proxy if helper doesn't support register action
                if (isContainerMode() && selectedAgentId && !hasServerSideAuth(selectedAgentId) && isAgentAuthenticated(selectedAgentId)) {
                    const agentAddr = getAuthenticatedAgentAddress(selectedAgentId)!;
                    const params = new URLSearchParams({ action: 'register', id, name: wsName, rootPath: trimmedPath });
                    if (resolvedColor) params.set('color', resolvedColor);
                    const helperUrl = `${agentAddr}/api/fs/browse-helper?${params.toString()}`;
                    try {
                        await new Promise<void>((resolve, reject) => {
                            runViaHelper(selectedAgentId, agentAddr, helperUrl, 'register-result', 'register-error',
                                () => resolve(),
                                (msg) => reject(new Error(msg)),
                                false,
                            );
                        });
                        // Notify container about the new workspace so it appears in the aggregated list.
                        // Must await so the cache is populated before onSuccess triggers a refresh.
                        try {
                            await fetch(`${getRawApiBase()}/container/workspace-registered`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    agentId: selectedAgentId,
                                    workspace: { id, name: wsName, rootPath: trimmedPath, color: resolvedColor },
                                }),
                            });
                        } catch { /* best-effort — refresh may not show the workspace immediately */ }
                    } catch {
                        // Helper doesn't support register — fall back to proxy
                        await registerWorkspace({ id, name: wsName, rootPath: trimmedPath, color: resolvedColor });
                    }
                } else {
                    const created = await registerWorkspace({
                        id,
                        name: wsName,
                        rootPath: trimmedPath,
                        color: resolvedColor,
                    });

                    // Clone detection
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
            }

            // Restore agent ID before triggering refresh so fetchRepos uses the correct base
            setCurrentAgentId(prevAgentId);
            onSuccess();
            onClose();
        } catch (error) {
            setCurrentAgentId(prevAgentId);
            setValidation({
                msg: getRepositoryApiErrorMessage(
                    error,
                    isEdit ? 'Failed to update repo' : 'Failed to add repo',
                    'Network error',
                ),
                ok: false,
            });
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
                {/* Agent selector (container mode only) */}
                {isContainerMode() && !isEdit && (
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
                        placeholder={pathPlaceholder}
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
                            <div className="text-[#848484]">Loading...</div>
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
                                {browserEntries.length === 0 && (
                                    <div className="text-[#848484]">No subdirectories</div>
                                )}
                                {browserEntries.map(entry => (
                                    <div
                                        key={entry.name}
                                        className="path-browser-entry flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333] rounded"
                                        data-testid="path-browser-entry"
                                        onClick={() => navigateTo(joinBrowserPath(browserPath, entry.name))}
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
                <div className="flex gap-1.5 items-center" id="repo-color-picker" data-testid="repo-color-picker">
                    {COLOR_PALETTE.map(c => {
                        const isSelected = color === c.value;
                        if (c.value === AUTO_VALUE) {
                            return (
                                <button
                                    key={c.value}
                                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition-transform ${isSelected ? 'border-[#0078d4] scale-110 text-[#0078d4]' : 'border-dashed border-[#848484] text-[#848484]'}`}
                                    style={{ background: 'transparent' }}
                                    onClick={() => setColor(c.value)}
                                    title="Auto (picks least-used color)"
                                    type="button"
                                    data-value={c.value}
                                >
                                    A
                                </button>
                            );
                        }
                        return (
                            <button
                                key={c.value}
                                className={`w-6 h-6 rounded-full border-2 transition-transform ${isSelected ? 'border-[#0078d4] scale-110' : 'border-transparent'}`}
                                style={{ background: c.value }}
                                onClick={() => setColor(c.value)}
                                title={c.label}
                                type="button"
                                data-value={c.value}
                            />
                        );
                    })}
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
