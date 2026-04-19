/**
 * ProcessDetail — right panel showing detail for the selected process.
 * Replaces renderProcessDetail from detail.ts.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Badge, Button, Spinner, linkifyFilePaths } from '../shared';
import { RenameDialog } from '../shared/RenameDialog';
import { ConversationTurnBubble } from './ConversationTurnBubble';
import { ConversationMiniMap } from './ConversationMiniMap';
import { ConversationMetadataPopover, getSessionIdFromProcess } from './ConversationMetadataPopover';
import { formatDuration, statusIcon, statusLabel, copyHtmlToClipboard, formatConversationAsHtml } from '../utils/format';
import { chatMarkdownToHtml } from './ConversationTurnBubble';
import { snapshotConversation } from '../utils/snapshot-copy-utils';
import { WorkflowDAGSection } from './dag';
import { resolveWorkspaceName, getProcessWorkspaceId, getProcessWorkspaceName } from '../utils/workspace';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

function getConversationTurns(data: any): ClientConversationTurn[] {
    const process = data?.process;
    if (process?.conversationTurns && Array.isArray(process.conversationTurns) && process.conversationTurns.length > 0) {
        return process.conversationTurns;
    }
    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
        return data.conversation;
    }
    if (Array.isArray(data?.turns) && data.turns.length > 0) {
        return data.turns;
    }

    // Backward-compatible fallback for older persisted processes.
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({
                role: 'user',
                content: userContent,
                timestamp: process.startTime || undefined,
                timeline: [],
            });
        }
        if (process.result) {
            synthetic.push({
                role: 'assistant',
                content: process.result,
                timestamp: process.endTime || undefined,
                timeline: [],
            });
        }
        return synthetic;
    }

    return [];
}

export function ProcessDetail() {
    const { state, dispatch } = useApp();
    const { selectedId, conversationCache, processes } = state;
    const [loading, setLoading] = useState(false);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const turnsContainerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(Date.now());
    const [resumeLaunching, setResumeLaunching] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [pipelinePhases, setPipelinePhases] = useState<Array<{ phase: string; status: string; timestamp?: string; durationMs?: number; error?: string; itemCount?: number }>>([]);
    const [pipelineProgress, setPipelineProgress] = useState<{ phase: string; totalItems: number; completedItems: number; failedItems: number; percentage: number; message?: string } | null>(null);
    const [hookSteps, setHookSteps] = useState<Array<{ step: string; status: string; script: string; output?: string; durationMs?: number; index?: number; actionType?: 'script' | 'skill'; skillName?: string }>>([]);
    const [copiedHtml, setCopiedHtml] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [wasRenamed, setWasRenamed] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [undoDelete, setUndoDelete] = useState<{ turnIndex: number; timer: ReturnType<typeof setTimeout> } | null>(null);

    const process = processes.find((p: any) => p.id === selectedId);

    // Live timer for running process
    useEffect(() => {
        if (process?.status !== 'running') return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [process?.status]);

    // Fetch or load conversation on selectedId change
    useEffect(() => {
        let cancelled = false;
        if (!selectedId) {
            setTurns([]);
            setProcessDetails(null);
            setPipelinePhases([]);
            setPipelineProgress(null);
            setHookSteps([]);
            setWasRenamed(false);
            return;
        }

        const fetchProcess = (showSpinner: boolean) => {
            if (showSpinner) setLoading(true);
            fetchApi(`/processes/${encodeURIComponent(selectedId)}`)
                .then((data: any) => {
                    if (cancelled) return;
                    setProcessDetails(data?.process || null);
                    const t = getConversationTurns(data);
                    dispatch({ type: 'CACHE_CONVERSATION', processId: selectedId, turns: t });
                    setTurns(t);
                })
                .catch(() => {
                    if (cancelled) return;
                    setTurns([]);
                })
                .finally(() => {
                    if (!cancelled && showSpinner) setLoading(false);
                });
        };

        // Check cache
        const cached = conversationCache[selectedId];
        if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurns(cached.turns);
            setLoading(false);
            // Keep metadata fresh even when turn cache is warm.
            fetchProcess(false);
        } else {
            fetchProcess(true);
        }

        return () => {
            cancelled = true;
        };
    }, [selectedId, process?.status, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // SSE streaming for running processes
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedId || process?.status !== 'running') return;

        const es = new EventSource(`/api/processes/${encodeURIComponent(selectedId)}/stream`);
        eventSourceRef.current = es;

        es.addEventListener('chunk', (e) => {
            try {
                const data = JSON.parse(e.data);
                const chunk = data.content || '';
                setTurns(prev => {
                    if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
                        return [...prev, { role: 'assistant', content: chunk, streaming: true, timeline: [] }];
                    }
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    updated[updated.length - 1] = { ...last, content: (last.content || '') + chunk, streaming: true };
                    return updated;
                });
            } catch { /* ignore parse errors */ }
        });

        es.addEventListener('conversation-snapshot', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.turns) {
                    setTurns(data.turns);
                    dispatch({ type: 'CACHE_CONVERSATION', processId: selectedId, turns: data.turns });
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('workflow-phase', (e) => {
            try {
                const data = JSON.parse(e.data);
                setPipelinePhases(prev => {
                    const idx = prev.findIndex(p => p.phase === data.phase);
                    if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = data;
                        return updated;
                    }
                    return [...prev, data];
                });
            } catch { /* ignore */ }
        });

        es.addEventListener('workflow-progress', (e) => {
            try {
                const data = JSON.parse(e.data);
                setPipelineProgress(data);
            } catch { /* ignore */ }
        });

        es.addEventListener('hook-step', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.hookStep) {
                    const stepKey = (s: { step: string; index?: number }) =>
                        s.index != null ? `${s.step}-${s.index}` : s.step;

                    setHookSteps(prev => {
                        const key = stepKey(data.hookStep);
                        const idx = prev.findIndex(s => stepKey(s) === key);
                        if (idx >= 0) {
                            const updated = [...prev];
                            updated[idx] = data.hookStep;
                            return updated;
                        }
                        return [...prev, data.hookStep];
                    });
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('status', (e) => {
            try {
                const data = JSON.parse(e.data);
                dispatch({ type: 'PROCESS_UPDATED', process: { id: selectedId, status: data.status } });
                const terminalStatuses = ['completed', 'failed', 'cancelled'];
                if (terminalStatuses.includes(data.status)) {
                    setTurns(prev => prev.map(t => t.streaming ? { ...t, streaming: false } : t));
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('done', () => {
            setTurns(prev => prev.map(t => t.streaming ? { ...t, streaming: false } : t));
        });

        let consecutiveErrors = 0;
        const MAX_SSE_ERRORS = 5;
        es.onerror = () => {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_SSE_ERRORS) {
                es.close();
                eventSourceRef.current = null;
            }
        };
        es.onopen = () => { consecutiveErrors = 0; };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [selectedId, process?.status, dispatch]);

    // Auto-scroll to bottom when new turns arrive and user is near the bottom
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el || turns.length === 0) return;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist < 150) {
            requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
        }
    }, [turns]);

    const metadataProcess = processDetails || process;
    const wsId = getProcessWorkspaceId(metadataProcess);
    const wsName = resolveWorkspaceName(wsId, getProcessWorkspaceName(metadataProcess), state.workspaces);

    const navigateToRepo = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (wsId) location.hash = '#repos/' + encodeURIComponent(wsId);
    }, [wsId]);

    const scrollToTurn = useCallback((hint: string) => {
        if (!turnsContainerRef.current || turns.length === 0) return;
        const lowerHint = hint.toLowerCase();
        const index = turns.findIndex(t => {
            const content = typeof t.content === 'string' ? t.content.toLowerCase() : '';
            return content.includes(lowerHint) || content.includes('error');
        });
        if (index < 0) return;
        const el = turnsContainerRef.current.children[index];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [turns]);

    const isRenameable = ['completed', 'failed', 'cancelled'].includes(process?.status ?? '');

    const handleRename = useCallback(async (newTitle: string) => {
        if (!selectedId) return;
        setRenameOpen(false);
        try {
            await fetchApi(`/processes/${encodeURIComponent(selectedId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            dispatch({ type: 'PROCESS_UPDATED', process: { id: selectedId, title: newTitle } });
            setWasRenamed(true);
        } catch { /* WS will sync eventually */ }
    }, [selectedId, dispatch]);

    // ── Per-message turn action callbacks ─────────────────────────
    const handleDeleteTurn = useCallback((turnIndex: number) => {
        if (!selectedId) return;
        // Optimistic: mark turn as deleted in local state
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: new Date().toISOString() } : t));
        fetchApi(`/processes/${encodeURIComponent(selectedId)}/turns/${turnIndex}`, { method: 'DELETE' }).catch(() => {
            // Revert on failure
            setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        });
        // Clear any previous undo timer
        if (undoDelete) clearTimeout(undoDelete.timer);
        const timer = setTimeout(() => {
            setUndoDelete(null);
        }, 5000);
        setUndoDelete({ turnIndex, timer });
    }, [selectedId, undoDelete]);

    const handleUndoDelete = useCallback(() => {
        if (!undoDelete || !selectedId) return;
        clearTimeout(undoDelete.timer);
        const { turnIndex } = undoDelete;
        setUndoDelete(null);
        // Restore locally
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        fetchApi(`/processes/${encodeURIComponent(selectedId)}/turns/${turnIndex}/restore`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }).catch(() => {});
    }, [undoDelete, selectedId]);

    const handlePinTurn = useCallback((turnIndex: number, pinned: boolean) => {
        if (!selectedId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex
                ? { ...t, pinnedAt: pinned ? new Date().toISOString() : undefined, archived: pinned ? false : t.archived }
                : t
        ));
        fetchApi(`/processes/${encodeURIComponent(selectedId)}/turns/${turnIndex}/pin`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinned }),
        }).catch(() => {
            // Revert
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex
                    ? { ...t, pinnedAt: pinned ? undefined : new Date().toISOString() }
                    : t
            ));
        });
    }, [selectedId]);

    const handleArchiveTurn = useCallback((turnIndex: number, archived: boolean) => {
        if (!selectedId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex ? { ...t, archived } : t
        ));
        fetchApi(`/processes/${encodeURIComponent(selectedId)}/turns/${turnIndex}/archive`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archived }),
        }).catch(() => {
            // Revert
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex ? { ...t, archived: !archived } : t
            ));
        });
    }, [selectedId]);

    if (!selectedId || !process) {
        return (
            <div id="detail-empty" className="flex-1 flex flex-col items-center justify-center text-[#848484]">
                <div className="text-4xl mb-2">👈</div>
                <div className="text-sm">Select a process to view details</div>
            </div>
        );
    }

    const duration = process.status === 'running' && process.startTime
        ? formatDuration(now - new Date(process.startTime).getTime())
        : process.duration != null
            ? formatDuration(process.duration)
            : '';
    const resumeSessionId = getSessionIdFromProcess(metadataProcess);
    const model = metadataProcess?.metadata?.model || metadataProcess?.config?.model || (metadataProcess as any)?.model;

    const launchInteractiveResume = async () => {
        if (!selectedId || !resumeSessionId) return;
        setResumeLaunching(true);
        setResumeFeedback(null);
        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(selectedId)}/resume-cli`, {
                method: 'POST',
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.error || `Failed to launch resume command (${response.status})`);
            }

            const launched = body?.launched !== false;
            if (launched) {
                setResumeFeedback({
                    type: 'success',
                    message: 'Opened Terminal with Copilot resume command.',
                });
            } else {
                setResumeFeedback({
                    type: 'success',
                    message: 'Auto-launch unavailable. Run this command manually.',
                    command: typeof body?.command === 'string' ? body.command : undefined,
                });
            }
        } catch (error: any) {
            setResumeFeedback({
                type: 'error',
                message: error?.message || 'Failed to launch Copilot resume command.',
            });
        } finally {
            setResumeLaunching(false);
        }
    };

    return (
        <div className="flex-1 flex overflow-hidden">
            <div id="detail-content" className="flex-1 overflow-y-auto p-4" ref={scrollContainerRef}>
                {/* Header */}
                <div className="mb-4 pb-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <Badge status={process.status}>
                                {statusIcon(process.status)} {statusLabel(process.status, process.type)}
                            </Badge>
                            {duration && (
                                <span className="text-xs text-[#848484]">{duration}</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {model && (
                                <span className="text-xs text-[#848484] px-1.5 py-0.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] font-mono max-w-[180px] truncate" title={model}>
                                    {model}
                                </span>
                            )}
                            {(metadataProcess?.metadata?.workflowName || metadataProcess?.type === 'run-workflow') && !metadataProcess?.metadata?.workItemId && wsId && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    data-testid="view-workflow-btn"
                                    onClick={() => {
                                        location.hash = '#repos/' + encodeURIComponent(wsId) + '/workflow/' + encodeURIComponent(process.id);
                                    }}
                                >
                                    View Workflow →
                                </Button>
                            )}
                            {resumeSessionId && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="hidden sm:inline-flex"
                                    loading={resumeLaunching}
                                    onClick={() => { void launchInteractiveResume(); }}
                                >
                                    Resume CLI
                                </Button>
                            )}
                            {resumeSessionId && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    data-testid="view-logs-btn"
                                    onClick={() => {
                                        location.hash = '#logs?sessionId=' + encodeURIComponent(resumeSessionId);
                                    }}
                                    title="View logs for this session"
                                >
                                    🔍 Logs
                                </Button>
                            )}
                            <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
                            <button
                                title="Copy conversation as HTML"
                                data-testid="copy-conversation-html-btn"
                                disabled={loading || turns.length === 0}
                                onClick={async () => {
                                    try {
                                        let html: string;
                                        if (turnsContainerRef.current) {
                                            html = snapshotConversation(turnsContainerRef.current);
                                        } else {
                                            html = formatConversationAsHtml(turns, (c) => chatMarkdownToHtml(c, wsId ?? undefined));
                                        }
                                        await copyHtmlToClipboard(html);
                                        setCopiedHtml(true);
                                        setTimeout(() => setCopiedHtml(false), 2000);
                                    } catch (e) {
                                        console.error('Copy HTML failed:', e);
                                    }
                                }}
                                className="inline-flex items-center justify-center px-1 py-0.5 rounded text-[10px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                            >
                                {copiedHtml ? '✓' : 'HTML'}
                            </button>
                        </div>
                    </div>
                    {wsName && wsId && (
                        <div className="mb-1">
                            <a
                                href={`#repos/${encodeURIComponent(wsId)}`}
                                onClick={navigateToRepo}
                                className="inline-flex items-center gap-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline no-underline"
                                title={`Go to repo: ${wsName}`}
                            >
                                <span>📂</span>
                                <span>{wsName}</span>
                            </a>
                        </div>
                    )}
                    {process.title && (
                        <div className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1 flex items-center gap-1">
                            {process.title}
                            {!wasRenamed && <span className="text-[11px] font-normal text-[#848484]">✦ AI title</span>}
                            {isRenameable && (
                                <button
                                    onClick={() => setRenameOpen(true)}
                                    className="ml-1 text-[11px] text-[#848484] hover:text-[#0078d4] transition-colors"
                                    title="Rename chat"
                                >✏️</button>
                            )}
                        </div>
                    )}
                    {!process.title && isRenameable && (
                        <button
                            onClick={() => setRenameOpen(true)}
                            className="text-xs text-[#848484] hover:text-[#0078d4] mb-1 transition-colors"
                            title="Set a title for this chat"
                        >✏️ Add title</button>
                    )}
                    <div
                        className="text-sm text-[#1e1e1e] dark:text-[#cccccc] break-words"
                        dangerouslySetInnerHTML={{
                            __html: linkifyFilePaths(
                                (process.fullPrompt || process.promptPreview || process.id)
                                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                            ),
                        }}
                    />
                    {resumeFeedback && (
                        <div className={`mt-2 text-xs ${resumeFeedback.type === 'error' ? 'text-[#f14c4c]' : 'text-[#6a9955] dark:text-[#89d185]'}`}>
                            {resumeFeedback.message}
                            {resumeFeedback.command && (
                                <div className="mt-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] px-2 py-1 font-mono text-[11px] break-all text-[#1e1e1e] dark:text-[#cccccc]">
                                    {resumeFeedback.command}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Workflow DAG visualization */}
                <WorkflowDAGSection process={metadataProcess} eventSourceRef={eventSourceRef} onScrollToConversation={scrollToTurn} />

                {/* Hook step indicators (before/after scripts) */}
                {hookSteps.length > 0 && (
                    <div className="flex flex-col gap-1 mb-3 text-sm">
                        {hookSteps.map(step => (
                            <div
                                key={step.index != null ? `${step.step}-${step.index}` : step.step}
                                className="flex items-center gap-2 text-[#848484]"
                            >
                                <span>{step.status === 'done' ? '✅' : step.status === 'running' ? '⏳' : step.status === 'failed' ? '❌' : '○'}</span>
                                <span className="font-medium capitalize">{step.step}</span>
                                {step.actionType === 'skill' ? (
                                    <span className="text-xs">⚡ {step.skillName}</span>
                                ) : (
                                    <span className="font-mono text-xs truncate max-w-[200px]" title={step.script}>{step.script}</span>
                                )}
                                {step.durationMs != null && <span className="text-xs">({step.durationMs}ms)</span>}
                                {step.output && (
                                    <details className="ml-2">
                                        <summary className="text-xs cursor-pointer">Show output</summary>
                                        <pre className="text-xs mt-1 whitespace-pre-wrap">{step.output}</pre>
                                    </details>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Conversation turns */}
                {loading ? (
                    <div className="flex items-center gap-2 text-[#848484] text-sm">
                        <Spinner size="sm" /> Loading conversation...
                    </div>
                ) : turns.length === 0 ? (
                    <div className="text-[#848484] text-sm">No conversation data available.</div>
                ) : (
                    <>
                        {/* Pinned messages section */}
                        {(() => {
                            const pinnedTurns = turns.filter(t => t.pinnedAt && !t.deletedAt);
                            if (pinnedTurns.length === 0) return null;
                            return (
                                <details className="mb-3 border border-amber-300 dark:border-amber-600 rounded-lg" open>
                                    <summary className="px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 cursor-pointer select-none">
                                        📌 Pinned Messages ({pinnedTurns.length})
                                    </summary>
                                    <div className="space-y-2 px-3 pb-2">
                                        {pinnedTurns.sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '')).map((turn, i) => (
                                            <ConversationTurnBubble
                                                key={`pinned-${turn.turnIndex ?? i}`}
                                                turn={turn}
                                                processType={metadataProcess?.type}
                                                wsId={wsId ?? undefined}
                                                turnIndex={turn.turnIndex}
                                                onPinTurn={handlePinTurn}
                                                onArchiveTurn={handleArchiveTurn}
                                                onDeleteTurn={handleDeleteTurn}
                                            />
                                        ))}
                                    </div>
                                </details>
                            );
                        })()}

                        {/* Archived toggle */}
                        {turns.some(t => t.archived && !t.deletedAt) && (
                            <button
                                onClick={() => setShowArchived(v => !v)}
                                className="mb-2 text-xs text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] transition-colors"
                            >
                                {showArchived ? '🗄️ Hide archived messages' : `🗄️ Show archived messages (${turns.filter(t => t.archived && !t.deletedAt).length})`}
                            </button>
                        )}

                        <div className="space-y-3" ref={turnsContainerRef}>
                            {[...turns]
                                .filter(t => !t.deletedAt && (!t.archived || showArchived))
                                .sort((a, b) => {
                                    const ai = a.turnIndex;
                                    const bi = b.turnIndex;
                                    if (ai == null && bi == null) return 0;
                                    if (ai == null) return 1;
                                    if (bi == null) return -1;
                                    return ai - bi;
                                }).map((turn, i) => (
                                    <ConversationTurnBubble
                                        key={turn.turnIndex ?? i}
                                        turn={turn}
                                        processType={metadataProcess?.type}
                                        wsId={wsId ?? undefined}
                                        turnIndex={turn.turnIndex}
                                        onDeleteTurn={handleDeleteTurn}
                                        onPinTurn={handlePinTurn}
                                        onArchiveTurn={handleArchiveTurn}
                                    />
                                ))}
                        </div>

                        {/* Undo delete toast */}
                        {undoDelete && (
                            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#333] dark:bg-[#555] text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in">
                                <span>Message deleted</span>
                                <button
                                    onClick={handleUndoDelete}
                                    className="font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                                >
                                    Undo
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Footer for terminal processes without a session */}
                {process.status !== 'running' && process.status !== 'queued' && !resumeSessionId && (
                    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                        <div className="text-[#848484] text-sm text-center">
                            Follow-up chat is not available for this process type.
                        </div>
                    </div>
                )}
            </div>

            {/* Conversation Mini Map */}
            <ConversationMiniMap
                turns={turns}
                scrollContainerRef={scrollContainerRef}
                turnsContainerRef={turnsContainerRef}
                isStreaming={process.status === 'running'}
            />

            <RenameDialog
                open={renameOpen}
                currentTitle={process.title || process.promptPreview || ''}
                onConfirm={handleRename}
                onCancel={() => setRenameOpen(false)}
            />
        </div>
    );
}
