/**
 * ProcessDetail — right panel showing detail for the selected process.
 * Replaces renderProcessDetail from detail.ts.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Badge, Button, Spinner } from '../shared';
import { ConversationTurnBubble } from './ConversationTurnBubble';
import { ConversationMetadataPopover, getSessionIdFromProcess } from './ConversationMetadataPopover';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
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
    const [now, setNow] = useState(Date.now());
    const [resumeLaunching, setResumeLaunching] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);

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
    }, [selectedId, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // SSE streaming for running processes
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedId || process?.status !== 'running') return;

        const es = new EventSource(`/api/processes/${encodeURIComponent(selectedId)}/stream`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const turn = JSON.parse(event.data);
                dispatch({ type: 'APPEND_TURN', processId: selectedId, turn });
                setTurns(prev => [...prev, turn]);
            } catch { /* ignore parse errors */ }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [selectedId, process?.status, dispatch]);

    const metadataProcess = processDetails || process;
    const wsId = getProcessWorkspaceId(metadataProcess);
    const wsName = resolveWorkspaceName(wsId, getProcessWorkspaceName(metadataProcess), state.workspaces);

    const navigateToRepo = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (wsId) location.hash = '#repos/' + encodeURIComponent(wsId);
    }, [wsId]);

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
        <div id="detail-content" className="flex-1 overflow-y-auto p-4">
            {/* Header */}
            <div className="mb-4 pb-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <Badge status={process.status}>
                            {statusIcon(process.status)} {statusLabel(process.status)}
                        </Badge>
                        {duration && (
                            <span className="text-xs text-[#848484]">{duration}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {resumeSessionId && (
                            <Button
                                variant="secondary"
                                size="sm"
                                loading={resumeLaunching}
                                onClick={() => { void launchInteractiveResume(); }}
                            >
                                Resume CLI
                            </Button>
                        )}
                        <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
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
                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] break-words">
                    {process.fullPrompt || process.promptPreview || process.id}
                </div>
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

            {/* Conversation turns */}
            {loading ? (
                <div className="flex items-center gap-2 text-[#848484] text-sm">
                    <Spinner size="sm" /> Loading conversation...
                </div>
            ) : turns.length === 0 ? (
                <div className="text-[#848484] text-sm">No conversation data available.</div>
            ) : (
                <div className="space-y-3">
                    {turns.map((turn, i) => (
                        <ConversationTurnBubble key={i} turn={turn} />
                    ))}
                </div>
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
    );
}
