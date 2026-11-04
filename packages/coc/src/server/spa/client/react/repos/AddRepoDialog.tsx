/**
 * AddRepoDialog — dual-mode dialog for adding and editing a workspace.
 * Includes inline filesystem browser.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, Button } from '../ui';
import { normalizeRemoteUrl } from './repoGrouping';
import type { RepoData } from './repoGrouping';
import { resolveAutoColor } from '../features/git/diff/colorUtils';
import {
    getRepositoryApiErrorMessage,
    registerWorkspace,
    updateWorkspace,
} from './repositoryService';
import { describeServerFailure, useServerSelection } from './useServerSelection';
import { isContainerMode, setCurrentAgentId, getCurrentAgentId } from '../utils/config';
import { useContainerAgents } from '../contexts/ContainerAgentContext';
import { useRepositoryDialogSession } from './useRepositoryDialogSession';
import { getPathLeaf, joinBrowserPath, useRepositoryFolderBrowser } from './useRepositoryFolderBrowser';
import { RepositoryBrowseRoots } from './RepositoryBrowseRoots';
import { RepositoryServerField } from './RepositoryServerField';

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
    /**
     * Server to pre-select when the dialog is launched from a remote context
     * (the remote picker's "Add specific repository"). Omitted = Local.
     */
    serverId?: string;
    /** That server's base URL, so it is targetable before the list loads. */
    baseUrl?: string;
}

function getPathPlaceholder(): string {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.platform)) {
        return 'C:\\path\\to\\repo';
    }
    return '/path/to/repo';
}

export function AddRepoDialog({ open, onClose, editId, repos, onSuccess, serverId, baseUrl }: AddRepoDialogProps) {
    const isEdit = !!editId;
    const editRepo = isEdit ? repos.find(r => r.workspace.id === editId) : null;
    const pathPlaceholder = getPathPlaceholder();
    const { agents } = useContainerAgents();
    const availableAgents = agents;
    // Editing never moves a workspace between servers, so the dropdown is
    // create-mode only and edit mode always talks to the page origin.
    const server = useServerSelection(open && !isEdit, serverId, baseUrl);
    const selectedServer = server.selected;

    const [selectedAgentId, setSelectedAgentId] = useState('');
    const { capture, invalidate } = useRepositoryDialogSession(open, server, editId || (selectedServer.baseUrl ? undefined : selectedAgentId));
    const handleClose = () => { invalidate(); onClose(); };
    const [path, setPath] = useState('');
    const [name, setName] = useState('');
    // Mirrors `name` synchronously so the browser can decide whether to re-derive
    // it without waiting for a render, and remembers the last value the browser
    // filled in: browsing keeps the name in step with the directory on screen,
    // but stops the moment the user types a name of their own.
    const nameRef = useRef('');
    const autoFilledNameRef = useRef<string | null>(null);
    const writeName = useCallback((value: string, fromBrowser: boolean) => {
        nameRef.current = value;
        autoFilledNameRef.current = fromBrowser ? value : null;
        setName(value);
    }, []);
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
    const browser = useRepositoryFolderBrowser({
        open,
        server,
        agent: isContainerMode() ? availableAgents.find(a => a.id === selectedAgentId) : undefined,
        formatError: () => 'Unable to browse this path',
        onSelect: data => {
            if (data.path) {
                setPath(data.path);
                if (!nameRef.current.trim() || nameRef.current === autoFilledNameRef.current) {
                    writeName(getPathLeaf(data.path), true);
                }
            }
        },
    });
    const { browserPath, browserEntries, browserParent, browserLoading, browserError, navigateTo, resetBrowser } = browser;

    // Pre-fill for edit mode
    useEffect(() => {
        if (open && isEdit && editRepo) {
            setPath(editRepo.workspace.rootPath || '');
            writeName(editRepo.workspace.name || '', false);
            setColor(editRepo.workspace.color || '#0078d4');
        } else if (open) {
            setPath('');
            writeName('', false);
            setColor(AUTO_VALUE);
        }
        setValidation(null);
        setSubmitting(false);
        setShowBrowser(false);
        resetBrowser();
    }, [open, isEdit, editRepo, writeName, serverId, baseUrl, resetBrowser]);

    // A path only means something on the server it came from, so switching
    // servers drops it and re-roots the browser at the new box's home.
    const changeServer = useCallback((nextServerId: string) => {
        server.selectServer(nextServerId);
        setPath('');
        setValidation(null);
        setSubmitting(false);
        resetBrowser();
        if (showBrowser) {
            navigateTo('~', nextServerId);
        }
    }, [server, showBrowser, navigateTo, resetBrowser]);

    const openBrowser = useCallback(() => {
        setShowBrowser(true);
        navigateTo(path.trim() || '~');
    }, [path, navigateTo]);

    const handleSubmit = async () => {
        const trimmedPath = path.trim();
        if (!isEdit && !trimmedPath) {
            setValidation({ msg: 'Path is required', ok: false });
            return;
        }

        const isCurrent = capture();
        setSubmitting(true);
        setValidation(null);
        setShowBrowser(false);

        // Resolve 'auto' to a concrete hex color before submitting
        const existingColors = repos.map(r => r.workspace.color).filter(Boolean) as string[];
        const resolvedColor = color === AUTO_VALUE
            ? resolveAutoColor(existingColors, REAL_PALETTE)
            : color;

        const isLocalTarget = !selectedServer.baseUrl;
        const prevAgentId = getCurrentAgentId();
        try {
            if (isLocalTarget && isContainerMode() && selectedAgentId) setCurrentAgentId(selectedAgentId);
            if (isEdit && editId) {
                await updateWorkspace(editId, { name: name.trim(), color: resolvedColor });
            } else {
                const wsName = name.trim() || getPathLeaf(trimmedPath) || 'repo';
                // Id is server-authoritative (machine-scoped). Send only the
                // root path and let the server compute the canonical workspace id.
                const created = await registerWorkspace({
                    name: wsName,
                    rootPath: trimmedPath,
                    color: resolvedColor,
                }, selectedServer.baseUrl);
                if (!isCurrent()) return;

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

            // Restore agent ID before triggering refresh so fetchRepos uses the correct base
            setCurrentAgentId(prevAgentId);
            if (!isCurrent()) return;
            onSuccess();
            onClose();
        } catch (error) {
            if (!isCurrent()) return;
            setValidation({
                msg: describeServerFailure(
                    getRepositoryApiErrorMessage(
                        error,
                        isEdit ? 'Failed to update repo' : 'Failed to add repo',
                        'Network error',
                    ),
                    selectedServer,
                ),
                ok: false,
            });
        } finally {
            setCurrentAgentId(prevAgentId);
            if (isCurrent()) setSubmitting(false);
        }
    };

    return (
        <Dialog
            id="add-repo-overlay"
            open={open}
            onClose={handleClose}
            title={isEdit ? 'Edit Repository' : 'Add Repository'}
            footer={
                <>
                    <Button variant="secondary" id="add-repo-cancel-btn" onClick={handleClose}>Cancel</Button>
                    <Button variant="primary" id="add-repo-submit" loading={submitting} onClick={handleSubmit}>
                        {isEdit ? 'Save Changes' : 'Add Repo'}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {/* Agent selector (container mode only) */}
                {isContainerMode() && !isEdit && !selectedServer.baseUrl && (
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
                {/* Server — which CoC registry the repo is added to */}
                {!isEdit && (
                    <RepositoryServerField id="add-repo-server-select" server={server} onChange={changeServer} />
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
                        <RepositoryBrowseRoots browser={browser} />
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
                            <Button variant="secondary" size="sm" id="path-browser-close" data-testid="path-browser-close" onClick={() => setShowBrowser(false)}>Close</Button>
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
                    onChange={e => writeName(e.target.value, false)}
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
