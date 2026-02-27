/**
 * Tests for RepoChatTab component.
 *
 * Validates the component's source structure, exports, state management,
 * API interactions, sidebar integration, and SSE streaming logic.
 *
 * localStorage persistence is replaced by server-side session history
 * and the ChatSessionSidebar + useChatSessions hook.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_CHAT_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('RepoChatTab', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_CHAT_TAB_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { RepoChatTab }");
            expect(indexSource).toContain("from './RepoChatTab'");
        });

        it('exports RepoChatTab as a named export', () => {
            expect(source).toContain('export function RepoChatTab');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts optional workspacePath prop', () => {
            expect(source).toContain('workspacePath?: string');
        });

        it('defines RepoChatTabProps interface', () => {
            expect(source).toContain('interface RepoChatTabProps');
        });
    });

    describe('split-panel layout', () => {
        it('renders a split-panel root with data-testid', () => {
            expect(source).toContain('data-testid="chat-split-panel"');
        });

        it('renders flex h-full overflow-hidden root', () => {
            expect(source).toContain('"flex h-full overflow-hidden"');
        });

        it('renders ChatSessionSidebar in left panel', () => {
            expect(source).toContain('<ChatSessionSidebar');
        });

        it('sidebar has fixed width w-80', () => {
            expect(source).toContain('w-80 flex-shrink-0 border-r');
        });

        it('right panel grows to fill with flex-1 min-w-0', () => {
            expect(source).toContain('"flex-1 min-w-0 overflow-hidden flex flex-col"');
        });
    });

    describe('session selection (no localStorage)', () => {
        it('does NOT use localStorage', () => {
            expect(source).not.toContain('localStorage.getItem');
            expect(source).not.toContain('localStorage.setItem');
            expect(source).not.toContain('localStorage.removeItem');
            expect(source).not.toContain('STORAGE_KEY');
        });

        it('uses selectedTaskId state for session tracking', () => {
            expect(source).toContain('selectedTaskId');
            expect(source).toContain('setSelectedTaskId');
        });

        it('uses useChatSessions hook', () => {
            expect(source).toContain('useChatSessions(workspaceId)');
        });

        it('passes sessions to ChatSessionSidebar', () => {
            expect(source).toContain('sessions={sessionsHook.sessions}');
        });

        it('passes activeTaskId to ChatSessionSidebar', () => {
            expect(source).toContain('activeTaskId={selectedTaskId}');
        });

        it('passes onSelectSession callback to ChatSessionSidebar', () => {
            expect(source).toContain('onSelectSession={handleSelectSession}');
        });

        it('passes onNewChat callback to ChatSessionSidebar', () => {
            expect(source).toContain('onNewChat={handleNewChat}');
        });
    });

    describe('loadSession function', () => {
        it('defines loadSession as a callback', () => {
            expect(source).toContain('const loadSession = useCallback(async (taskId: string)');
        });

        it('fetches task from /queue/:id', () => {
            expect(source).toContain('fetchApi(`/queue/${encodeURIComponent(taskId)}`)');
        });

        it('fetches process for conversation turns', () => {
            expect(source).toContain('fetchApi(`/processes/${encodeURIComponent(pid)}`)');
        });

        it('handles 404 errors', () => {
            expect(source).toContain("err?.message?.includes('404')");
            expect(source).toContain("'Chat session not found'");
        });
    });

    describe('auto-select on mount', () => {
        it('auto-selects a running session if available', () => {
            expect(source).toContain("sessionsHook.sessions.find(s => s.status === 'running')");
        });

        it('falls back to most recent session', () => {
            expect(source).toContain('running ?? sessionsHook.sessions[0]');
        });

        it('uses autoSelectedRef to prevent re-selection', () => {
            expect(source).toContain('autoSelectedRef');
        });

        it('resets auto-select when workspace changes', () => {
            expect(source).toContain('autoSelectedRef.current = false');
        });
    });

    describe('handleSelectSession', () => {
        it('stops streaming before switching sessions', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'));
            expect(handler).toContain('if (isStreaming) stopStreaming()');
        });

        it('sets selectedTaskId and calls loadSession', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'));
            expect(handler).toContain('setSelectedTaskId(taskId)');
            expect(handler).toContain('loadSession(taskId)');
        });
    });

    describe('empty state', () => {
        it('renders "Chat with this repository" heading', () => {
            expect(source).toContain('Chat with this repository');
        });

        it('renders textarea with placeholder', () => {
            expect(source).toContain('Ask anything about this repository');
        });

        it('renders Start Chat button', () => {
            expect(source).toContain('Start Chat');
        });

        it('disables Start Chat when input is empty', () => {
            expect(source).toContain('disabled={!inputValue.trim() || sending}');
        });
    });

    describe('Start Chat handler', () => {
        it('POSTs to /queue endpoint', () => {
            expect(source).toContain('`${getApiBase()}/queue`');
            expect(source).toMatch(/method:\s*'POST'/);
        });

        it('sends type chat in the request body', () => {
            expect(source).toContain("type: 'chat'");
        });

        it('sends workspaceId in the request body', () => {
            const bodyMatch = source.includes('workspaceId,') || source.includes('workspaceId:');
            expect(bodyMatch).toBe(true);
        });

        it('sends prompt in the request body', () => {
            expect(source).toContain('prompt,');
        });

        it('sends workingDirectory from workspacePath', () => {
            expect(source).toContain('workingDirectory: workspacePath');
        });

        it('creates optimistic user turn after submit', () => {
            expect(source).toContain("role: 'user', content: prompt");
        });

        it('creates streaming assistant placeholder after submit', () => {
            expect(source).toContain("role: 'assistant', content: ''");
            expect(source).toContain('streaming: true');
        });

        it('sets selectedTaskId to new task ID', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain('setSelectedTaskId(newTaskId)');
        });

        it('refreshes sidebar sessions after start', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain('sessionsHook.refresh()');
        });
    });

    describe('active chat UI', () => {
        it('renders Chat header', () => {
            const lines = source.split('\n');
            const headerLine = lines.find(l => l.includes('>Chat<'));
            expect(headerLine).toBeDefined();
        });

        it('renders Stop button when streaming', () => {
            expect(source).toContain('isStreaming && <Button');
            expect(source).toContain('>Stop<');
        });

        it('renders ConversationTurnBubble for each turn', () => {
            expect(source).toContain('ConversationTurnBubble');
            expect(source).toContain('turns.map');
        });

        it('renders Spinner when loading', () => {
            expect(source).toContain('loading ? <Spinner');
        });
    });

    describe('follow-up send', () => {
        it('POSTs to /processes/:id/message endpoint', () => {
            expect(source).toContain('`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`');
        });

        it('sends content in the body', () => {
            expect(source).toContain('content,');
        });

        it('includes images in follow-up body when present', () => {
            expect(source).toContain('followUpImagePaste.images.length > 0');
        });

        it('handles Enter key without Shift for send', () => {
            expect(source).toContain("e.key === 'Enter' && !e.shiftKey");
        });
    });

    describe('session expiry (410)', () => {
        it('detects 410 status on follow-up', () => {
            expect(source).toContain('response.status === 410');
        });

        it('sets sessionExpired flag', () => {
            expect(source).toContain('setSessionExpired(true)');
        });

        it('shows expiry message in placeholder', () => {
            expect(source).toContain('Session expired. Start a new chat.');
        });

        it('disables textarea when session is expired', () => {
            expect(source).toContain('disabled={sending || sessionExpired}');
        });
    });

    describe('SSE streaming', () => {
        it('creates EventSource for process stream', () => {
            expect(source).toContain('new EventSource(');
            expect(source).toContain('/stream');
        });

        it('listens for done event', () => {
            expect(source).toContain("addEventListener('done'");
        });

        it('listens for status event', () => {
            expect(source).toContain("addEventListener('status'");
        });

        it('has a 90-second timeout', () => {
            expect(source).toContain('90_000');
        });

        it('stopStreaming closes the EventSource', () => {
            expect(source).toContain('eventSourceRef.current?.close()');
        });
    });

    describe('New Chat handler', () => {
        it('stops streaming when in progress', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'));
            expect(handler).toContain('stopStreaming()');
        });

        it('resets all state', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'));
            expect(handler).toContain('setSelectedTaskId(null)');
            expect(handler).toContain('setChatTaskId(null)');
            expect(handler).toContain('setTask(null)');
            expect(handler).toContain('setTurns([])');
            expect(handler).toContain('setError(null)');
            expect(handler).toContain('setSessionExpired(false)');
            expect(handler).toContain("setInputValue('')");
        });
    });

    describe('cleanup on unmount', () => {
        it('registers cleanup effect', () => {
            expect(source).toContain('useEffect(() => () => stopStreaming(), [])');
        });
    });

    describe('getConversationTurns helper', () => {
        it('checks process.conversationTurns first', () => {
            expect(source).toContain('process?.conversationTurns');
        });

        it('falls back to data.conversation', () => {
            expect(source).toContain("data?.conversation");
        });

        it('falls back to data.turns', () => {
            expect(source).toContain("data?.turns");
        });

        it('creates synthetic turns from fullPrompt and result', () => {
            expect(source).toContain('process.fullPrompt || process.promptPreview');
            expect(source).toContain('process.result');
        });
    });

    describe('imports', () => {
        it('imports from react', () => {
            expect(source).toContain("from 'react'");
            expect(source).toContain('useEffect');
            expect(source).toContain('useRef');
            expect(source).toContain('useState');
            expect(source).toContain('useCallback');
        });

        it('imports fetchApi from hooks/useApi', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('imports getApiBase from utils/config', () => {
            expect(source).toContain("import { getApiBase } from '../utils/config'");
        });

        it('imports Button and Spinner from shared', () => {
            expect(source).toContain("import { Button, Spinner } from '../shared'");
        });

        it('imports ConversationTurnBubble', () => {
            expect(source).toContain("import { ConversationTurnBubble } from '../processes/ConversationTurnBubble'");
        });

        it('imports ClientConversationTurn type', () => {
            expect(source).toContain("import type { ClientConversationTurn } from '../types/dashboard'");
        });

        it('imports ChatSessionSidebar', () => {
            expect(source).toContain("import { ChatSessionSidebar } from '../chat/ChatSessionSidebar'");
        });

        it('imports useChatSessions hook', () => {
            expect(source).toContain("import { useChatSessions } from '../chat/useChatSessions'");
        });

        it('imports useQueue from QueueContext for real-time updates', () => {
            expect(source).toContain("import { useQueue } from '../context/QueueContext'");
        });
    });

    describe('refs', () => {
        it('uses turnsRef for closure-safe turns access', () => {
            expect(source).toContain('turnsRef');
            expect(source).toContain('useRef<ClientConversationTurn[]>');
        });

        it('uses eventSourceRef for SSE connection', () => {
            expect(source).toContain('eventSourceRef');
            expect(source).toContain('useRef<EventSource | null>');
        });
    });

    describe('SSE for initial running task', () => {
        it('opens SSE when task status is running', () => {
            expect(source).toContain("task?.status !== 'running'");
        });

        it('re-runs on chatTaskId or task status change', () => {
            expect(source).toContain('[chatTaskId, task?.status]');
        });
    });

    describe('image paste integration', () => {
        it('imports useImagePaste hook', () => {
            expect(source).toContain("import { useImagePaste } from '../hooks/useImagePaste'");
        });

        it('imports ImagePreviews component', () => {
            expect(source).toContain("import { ImagePreviews } from '../shared/ImagePreviews'");
        });

        it('creates two useImagePaste instances', () => {
            expect(source).toContain('const initialImagePaste = useImagePaste()');
            expect(source).toContain('const followUpImagePaste = useImagePaste()');
        });

        it('attaches onPaste to initial chat textarea', () => {
            expect(source).toContain('onPaste={initialImagePaste.addFromPaste}');
        });

        it('renders ImagePreviews for initial chat', () => {
            expect(source).toContain('images={initialImagePaste.images} onRemove={initialImagePaste.removeImage}');
        });

        it('includes images in handleStartChat POST body', () => {
            expect(source).toContain('initialImagePaste.images.length > 0');
            expect(source).toContain('initialImagePaste.images');
        });

        it('clears initial images after successful start', () => {
            expect(source).toContain('initialImagePaste.clearImages()');
        });

        it('attaches onPaste to follow-up textarea', () => {
            expect(source).toContain('onPaste={followUpImagePaste.addFromPaste}');
        });

        it('renders ImagePreviews for follow-up', () => {
            expect(source).toContain('images={followUpImagePaste.images} onRemove={followUpImagePaste.removeImage}');
        });

        it('clears follow-up images after successful send', () => {
            expect(source).toContain('followUpImagePaste.clearImages()');
        });

        it('clears both image states on New Chat', () => {
            const newChatFn = source.substring(source.indexOf('const handleNewChat'));
            expect(newChatFn).toContain('initialImagePaste.clearImages()');
            expect(newChatFn).toContain('followUpImagePaste.clearImages()');
        });

        it('sends images as undefined when none are pasted', () => {
            const bodySection = source.substring(
                source.indexOf("body: JSON.stringify({"),
                source.indexOf("body: JSON.stringify({") + 500,
            );
            expect(bodySection).toContain(': undefined');
        });
    });

    describe('real-time queue updates', () => {
        it('subscribes to queueState via useQueue', () => {
            expect(source).toContain('const { state: queueState } = useQueue()');
        });

        it('reads repoQueueMap for the workspace', () => {
            expect(source).toContain('queueState.repoQueueMap[workspaceId]');
        });

        it('refreshes sessions when queue contains chat tasks', () => {
            expect(source).toContain("t.type === 'chat'");
            expect(source).toContain('sessionsHook.refresh()');
        });

        it('checks for chat tasks in running, queued, and history arrays', () => {
            expect(source).toContain('repoQueue.running');
            expect(source).toContain('repoQueue.queued');
            expect(source).toContain('repoQueue.history');
        });
    });
});
