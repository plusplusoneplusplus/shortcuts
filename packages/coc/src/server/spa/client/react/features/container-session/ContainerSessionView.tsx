/**
 * ContainerSessionView — Chat UI for the Default container agent.
 *
 * Renders a chat interface where each message is routed to the appropriate
 * agent:repo. Shows routing badges on turns and a routing override selector.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { isContainerMode } from '../../utils/config';

const CONTAINER_DEFAULT_REPO_ID = '__container_default__';

interface ContainerSessionTurn {
    index: number;
    role: 'user' | 'assistant';
    content: string;
    routing: { agentId: string; workspaceId: string; confidence: number; reason: string };
    downstreamProcessId: string | null;
    timestamp: string;
}

interface ContainerSessionState {
    id: string | null;
    turns: ContainerSessionTurn[];
    loading: boolean;
    routingOverride: { agentId: string; workspaceId: string } | null;
}

export { CONTAINER_DEFAULT_REPO_ID };

export function ContainerSessionView() {
    const [session, setSession] = useState<ContainerSessionState>({
        id: null,
        turns: [],
        loading: false,
        routingOverride: null,
    });
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom on new turns
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [session.turns]);

    const sendMessage = useCallback(async () => {
        if (!input.trim() || sending) return;
        const content = input.trim();
        setInput('');
        setSending(true);

        try {
            let sessionId = session.id;

            // Create session if needed
            if (!sessionId) {
                const resp = await fetch('/api/container/sessions', { method: 'POST' });
                if (!resp.ok) throw new Error('Failed to create session');
                const data = await resp.json();
                sessionId = data.id;
                setSession(prev => ({ ...prev, id: sessionId! }));
            }

            // Send message
            const resp = await fetch(`/api/container/sessions/${sessionId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            if (!resp.ok) throw new Error('Failed to send message');
            const data = await resp.json();

            // Add turn to local state
            setSession(prev => ({
                ...prev,
                turns: [...prev.turns, data.turn],
            }));
        } catch (err) {
            console.error('Container session error:', err);
        } finally {
            setSending(false);
        }
    }, [input, sending, session.id]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    if (!isContainerMode()) return null;

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e]">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-base">🌐</span>
                <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    Default — Smart Routing
                </h2>
                {session.routingOverride && (
                    <span className="ml-2 text-[10px] bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#3794ff]/15 dark:text-[#3794ff] px-2 py-0.5 rounded">
                        Pinned: {session.routingOverride.agentId}
                    </span>
                )}
            </div>

            {/* Chat area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {session.turns.length === 0 && !sending && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[#848484] space-y-2">
                        <span className="text-3xl">🌐</span>
                        <p className="text-sm">Start typing — your message will be routed to the right agent automatically.</p>
                        <p className="text-xs text-[#a0a0a0]">The AI decides which repository should handle each message based on context.</p>
                    </div>
                )}

                {session.turns.map((turn) => (
                    <div key={turn.index} className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* Routing badge */}
                        {turn.role === 'user' && (
                            <span className="text-[10px] text-[#848484] mb-0.5 flex items-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0078d4]" />
                                → {turn.routing.agentId}/{turn.routing.workspaceId}
                                {turn.routing.confidence < 0.7 && (
                                    <span className="text-[#d4a200]" title={turn.routing.reason}>⚠</span>
                                )}
                            </span>
                        )}
                        {/* Message bubble */}
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                            turn.role === 'user'
                                ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]'
                                : 'bg-[#f3f9ff] dark:bg-[#1a2a3a] text-[#1e1e1e] dark:text-[#cccccc] border border-[#d0e4ff] dark:border-[#2a4a6a]'
                        }`}>
                            {turn.content}
                        </div>
                    </div>
                ))}

                {sending && (
                    <div className="flex items-center gap-2 text-xs text-[#848484]">
                        <span className="animate-pulse">●</span>
                        Routing message...
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        className="flex-1 rounded-md border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#2d2d2d] px-3 py-2 text-sm text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#a0a0a0] focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                        placeholder="Type a message..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={sending}
                        data-testid="container-session-input"
                    />
                    <button
                        className="px-3 py-2 bg-[#0078d4] hover:bg-[#006cc1] text-white text-sm rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={sendMessage}
                        disabled={sending || !input.trim()}
                        data-testid="container-session-send"
                    >
                        Send
                    </button>
                </div>
                <div className="mt-1 text-[10px] text-[#a0a0a0] flex items-center gap-2">
                    <span>Route: {session.routingOverride ? `${session.routingOverride.agentId}` : 'Auto'}</span>
                </div>
            </div>
        </div>
    );
}
