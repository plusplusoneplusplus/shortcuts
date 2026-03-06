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

        it('accepts optional initialSessionId prop', () => {
            expect(source).toContain('initialSessionId?: string | null');
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

        it('passes onNewChat callback to ChatSessionSidebar with readOnly forwarding', () => {
            expect(source).toContain('onNewChat={(readOnly) => onOpenNewChatDialog ? onOpenNewChatDialog(readOnly) : handleNewChat(readOnly)}');
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

        it('uses setTurnsAndCache instead of setTurns to keep turnsRef in sync', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'), source.indexOf('const handleNewChat'));
            expect(handler).toContain('setTurnsAndCache([])');
            expect(handler).not.toContain('setTurns([])');
        });

        it('updates currentChatTaskIdRef before loading', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'));
            const refIdx = handler.indexOf('currentChatTaskIdRef.current = taskId');
            const loadIdx = handler.indexOf('loadSession(taskId)');
            expect(refIdx).toBeGreaterThan(-1);
            expect(loadIdx).toBeGreaterThan(refIdx);
        });
    });

    describe('empty state', () => {
        it('renders "Chat with this repository" heading', () => {
            expect(source).toContain('Chat with this repository');
        });

        it('renders textarea with placeholder', () => {
            expect(source).toContain('Ask anything');
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
            expect(source).toContain("'chat'");
            expect(source).toContain("readonly: readOnly");
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

        it('sends workingDirectory unconditionally (not gated by useProjectRoot)', () => {
            // workingDirectory must appear as a plain key, not inside a conditional spread
            expect(source).not.toContain('useProjectRoot ? { workingDirectory: workspacePath }');
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

        it('schedules a delayed refresh 5 seconds after start to pick up AI-generated title', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain("setTimeout(() => sessionsHook.refresh(), 5000)");
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

        it('handles Ctrl/Cmd+Enter for send', () => {
            expect(source).toContain("(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
        });
    });

    describe('follow-up sidebar status wiring', () => {
        it('calls updateSessionStatus with running after successful POST', () => {
            expect(source).toContain("sessionsHook.updateSessionStatus(chatTaskId, 'running')");
        });

        it('guards updateSessionStatus call with chatTaskId check', () => {
            expect(source).toContain('if (chatTaskId) sessionsHook.updateSessionStatus');
        });

        it('calls sessionsHook.refresh() after waitForFollowUpCompletion in sendFollowUp', () => {
            const sendFollowUpStart = source.indexOf('const sendFollowUp');
            const sendFollowUpBlock = source.slice(sendFollowUpStart, sendFollowUpStart + 3000);
            const waitIdx = sendFollowUpBlock.indexOf('await waitForFollowUpCompletion(processId)');
            const refreshIdx = sendFollowUpBlock.indexOf('sessionsHook.refresh()', waitIdx);
            expect(waitIdx).toBeGreaterThan(-1);
            expect(refreshIdx).toBeGreaterThan(waitIdx);
        });

        it('updateSessionStatus is called before waitForFollowUpCompletion', () => {
            const sendFollowUpStart = source.indexOf('const sendFollowUp');
            const sendFollowUpBlock = source.slice(sendFollowUpStart, sendFollowUpStart + 3000);
            const updateIdx = sendFollowUpBlock.indexOf("sessionsHook.updateSessionStatus(chatTaskId, 'running')");
            const waitIdx = sendFollowUpBlock.indexOf('await waitForFollowUpCompletion(processId)');
            expect(updateIdx).toBeGreaterThan(-1);
            expect(waitIdx).toBeGreaterThan(-1);
            expect(updateIdx).toBeLessThan(waitIdx);
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
            // sessionExpired now shows resume buttons instead of a disabled textarea
            expect(source).toContain('sessionExpired');
            expect(source).toContain('handleResumeChat');
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

        it('accepts initialReadOnly parameter with default false', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'));
            expect(handler).toContain('initialReadOnly = false');
        });

        it('resets all state including readOnly', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'));
            expect(handler).toContain('setSelectedTaskId(null)');
            expect(handler).toContain('setChatTaskId(null)');
            expect(handler).toContain('setTask(null)');
            expect(handler).toContain('setTurnsAndCache([])');
            expect(handler).toContain('setError(null)');
            expect(handler).toContain('setSessionExpired(false)');
            expect(handler).toContain("setInputValue('')");
            expect(handler).toContain('setReadOnly(initialReadOnly)');
        });

        it('clears currentChatTaskIdRef', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'));
            expect(handler).toContain('currentChatTaskIdRef.current = null');
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
            expect(source).toContain("import { Button, Spinner, SuggestionChips } from '../shared'");
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

        it('re-runs on chatTaskId, task status, or processId change', () => {
            expect(source).toContain('[chatTaskId, task?.status, processId]');
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

        it('includes images in local user turn for handleStartChat', () => {
            // After sending, the optimistic user turn should carry the attached images
            const handleStartChat = source.substring(source.indexOf('const handleStartChat'));
            expect(handleStartChat).toContain('sentImages');
            expect(handleStartChat).toContain('images: sentImages');
        });

        it('includes images in local user turn for sendFollowUp', () => {
            // After sending a follow-up, the optimistic user turn should carry images
            const sendFollowUp = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendFollowUp).toContain('sentFollowUpImages');
            expect(sendFollowUp).toContain('images: sentFollowUpImages');
        });
    });

    describe('real-time queue updates', () => {
        it('subscribes to queueState via useQueue', () => {
            expect(source).toContain('const { state: queueState, dispatch: queueDispatch } = useQueue()');
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

        it('skips refresh when streaming is active (eventSourceRef)', () => {
            expect(source).toContain('eventSourceRef.current) return');
        });

        it('uses a serialized key for repoQueue dependency to avoid unnecessary refreshes', () => {
            expect(source).toContain('repoQueueKey');
            // The useEffect should depend on the serialized key, not the raw object
            expect(source).toContain('[repoQueueKey]');
        });

        it('derives repoQueueKey from item counts (running, queued, history)', () => {
            expect(source).toContain('repoQueue.running?.length');
            expect(source).toContain('repoQueue.queued?.length');
            expect(source).toContain('repoQueue.history?.length');
        });
    });

    describe('session-switch guard: currentChatTaskIdRef', () => {
        it('declares currentChatTaskIdRef', () => {
            expect(source).toContain('const currentChatTaskIdRef = useRef<string | null>(null)');
        });

        it('captures ownerChatTaskId at start of waitForFollowUpCompletion', () => {
            const fn = source.substring(source.indexOf('const waitForFollowUpCompletion'));
            expect(fn).toContain('const ownerChatTaskId = currentChatTaskIdRef.current');
        });

        it('guards finish() — skips state update if session changed', () => {
            const fn = source.substring(source.indexOf('const waitForFollowUpCompletion'));
            expect(fn).toContain('if (currentChatTaskIdRef.current !== ownerChatTaskId)');
        });

        it('guards the fetchApi .then callback as well', () => {
            const fn = source.substring(source.indexOf('const waitForFollowUpCompletion'), source.indexOf('// --- load a session'));
            const thenIdx = fn.indexOf('.then(data =>');
            const guardInThen = fn.indexOf('currentChatTaskIdRef.current === ownerChatTaskId', thenIdx);
            expect(thenIdx).toBeGreaterThan(-1);
            expect(guardInThen).toBeGreaterThan(thenIdx);
        });

        it('handleSelectSession sets currentChatTaskIdRef before loadSession', () => {
            const fn = source.substring(source.indexOf('const handleSelectSession'), source.indexOf('const handleNewChat'));
            const setRefIdx = fn.indexOf('currentChatTaskIdRef.current = taskId');
            const loadIdx = fn.indexOf('loadSession(taskId)');
            expect(setRefIdx).toBeGreaterThan(-1);
            expect(loadIdx).toBeGreaterThan(setRefIdx);
        });

        it('handleNewChat clears currentChatTaskIdRef', () => {
            const fn = source.substring(source.indexOf('const handleNewChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain('currentChatTaskIdRef.current = null');
        });

        it('handleStartChat sets currentChatTaskIdRef to newTaskId', () => {
            const fn = source.substring(source.indexOf('const handleStartChat'));
            expect(fn).toContain('currentChatTaskIdRef.current = newTaskId');
        });
    });

    describe('load-session staleness guard: loadSessionCounterRef', () => {
        it('declares loadSessionCounterRef', () => {
            expect(source).toContain('const loadSessionCounterRef = useRef(0)');
        });

        it('increments counter at start of loadSession', () => {
            const fn = source.substring(source.indexOf('const loadSession'));
            expect(fn).toContain('const loadId = ++loadSessionCounterRef.current');
        });

        it('checks counter after first fetch (queue data)', () => {
            const fn = source.substring(source.indexOf('const loadSession'));
            const firstFetch = fn.indexOf('fetchApi(`/queue/');
            const firstGuard = fn.indexOf('if (loadSessionCounterRef.current !== loadId) return', firstFetch);
            expect(firstGuard).toBeGreaterThan(firstFetch);
        });

        it('checks counter after second fetch (process data)', () => {
            const fn = source.substring(source.indexOf('const loadSession'));
            const secondFetch = fn.indexOf('fetchApi(`/processes/');
            const secondGuard = fn.indexOf('if (loadSessionCounterRef.current !== loadId) return', secondFetch);
            expect(secondGuard).toBeGreaterThan(secondFetch);
        });

        it('guards setLoading(false) in finally block', () => {
            const fn = source.substring(source.indexOf('const loadSession'));
            const finallyIdx = fn.indexOf('} finally {');
            const guardInFinally = fn.indexOf('loadSessionCounterRef.current === loadId', finallyIdx);
            expect(guardInFinally).toBeGreaterThan(finallyIdx);
        });

        it('guards catch block against stale errors', () => {
            const fn = source.substring(source.indexOf('const loadSession'));
            const catchIdx = fn.indexOf('} catch (err');
            const guardInCatch = fn.indexOf('loadSessionCounterRef.current !== loadId', catchIdx);
            expect(guardInCatch).toBeGreaterThan(catchIdx);
        });
    });

    describe('streaming placeholder for running chats in loadSession', () => {
        it('checks if loaded task status is running', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain("loadedTask?.status === 'running'");
        });

        it('appends assistant streaming placeholder when task is running', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain("{ role: 'assistant', content: '', streaming: true, timeline: [] }");
        });

        it('spreads existing turns before the streaming placeholder', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain('...loadedTurns, { role:');
        });

        it('does not append placeholder when task is not running', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            // The else branch after the running check sets turns without a placeholder
            const runningCheckIdx = fn.indexOf("loadedTask?.status === 'running'");
            expect(runningCheckIdx).toBeGreaterThan(-1);
            // Find the outermost else (not-running branch) — skip inner else for assistant check
            const innerElse = fn.indexOf('} else {', runningCheckIdx);
            const outerElse = fn.indexOf('} else {', innerElse + 1);
            expect(outerElse).toBeGreaterThan(-1);
            const afterElse = fn.substring(outerElse, outerElse + 100);
            expect(afterElse).toContain('setTurnsAndCache(loadedTurns)');
        });

        it('checks last turn role before appending streaming placeholder to avoid duplicates', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            // Should inspect lastTurn to decide whether to append or reuse
            expect(fn).toContain('const lastTurn = loadedTurns[loadedTurns.length - 1]');
            expect(fn).toContain("lastTurn?.role === 'assistant'");
        });

        it('reuses existing assistant turn with streaming flag when last turn is assistant', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            // When last turn is already assistant, map over turns to set streaming: true
            expect(fn).toContain('loadedTurns.map(');
            expect(fn).toContain('streaming: true');
        });

        it('only appends new placeholder when last turn is not assistant', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            // The else branch inside the running check still creates a new placeholder
            const lastTurnCheck = fn.indexOf("lastTurn?.role === 'assistant'");
            expect(lastTurnCheck).toBeGreaterThan(-1);
            const elseAfterCheck = fn.indexOf('} else {', lastTurnCheck);
            expect(elseAfterCheck).toBeGreaterThan(-1);
            const afterElse = fn.substring(elseAfterCheck, elseAfterCheck + 200);
            expect(afterElse).toContain("...loadedTurns, { role: 'assistant'");
        });
    });

    describe('no raw setTurns([]) calls (turnsRef sync)', () => {
        it('handleSelectSession uses setTurnsAndCache, not setTurns', () => {
            const fn = source.substring(source.indexOf('const handleSelectSession'), source.indexOf('const handleNewChat'));
            expect(fn).not.toMatch(/\bsetTurns\b\(\[\]\)/);
            expect(fn).toContain('setTurnsAndCache([])');
        });

        it('handleNewChat uses setTurnsAndCache, not setTurns', () => {
            const fn = source.substring(source.indexOf('const handleNewChat'), source.indexOf('const handleStartChat'));
            expect(fn).not.toMatch(/\bsetTurns\b\(\[\]\)/);
            expect(fn).toContain('setTurnsAndCache([])');
        });

        it('workspace reset effect uses setTurnsAndCache, not setTurns', () => {
            const resetEffect = source.substring(
                source.indexOf('// Reset auto-select when workspace changes'),
                source.indexOf('// Refresh session list')
            );
            expect(resetEffect).not.toMatch(/\bsetTurns\b\(\[\]\)/);
            expect(resetEffect).toContain('setTurnsAndCache([])');
        });
    });

    describe('processId in SSE effect deps', () => {
        it('includes processId in the SSE effect dependency array', () => {
            expect(source).toContain('[chatTaskId, task?.status, processId]');
        });

        it('does not have the old two-element dependency array', () => {
            // Make sure the old pattern is gone. We look for the exact old dep array
            // that is NOT followed by ", processId]"
            const sseEffect = source.substring(source.indexOf('// --- SSE for initial running task'), source.indexOf('// --- cleanup on unmount'));
            expect(sseEffect).not.toContain('[chatTaskId, task?.status]');
            // But the three-element array should be present
            expect(sseEffect).toContain('[chatTaskId, task?.status, processId]');
        });
    });

    describe('deep-link URL updates', () => {
        it('handleSelectSession updates location.hash with chat session ID', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'), source.indexOf('const handleNewChat'));
            expect(handler).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(taskId)");
        });

        it('handleNewChat resets location.hash to chat without session ID', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'), source.indexOf('const handleStartChat'));
            expect(handler).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat'");
        });

        it('handleStartChat updates location.hash with new task ID', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(newTaskId)");
        });

        it('includes workspaceId in handleSelectSession dependency array', () => {
            const handler = source.substring(source.indexOf('const handleSelectSession'), source.indexOf('const handleNewChat'));
            expect(handler).toContain('workspaceId');
        });

        it('includes workspaceId in handleNewChat dependency array', () => {
            const handler = source.substring(source.indexOf('const handleNewChat'), source.indexOf('const handleStartChat'));
            expect(handler).toContain('workspaceId');
        });
    });

    describe('initialSessionId prop', () => {
        it('destructures initialSessionId from props', () => {
            expect(source).toContain('{ workspaceId, workspacePath, initialSessionId, newChatTrigger, newChatTriggerProcessedRef, onOpenNewChatDialog }');
        });

        it('prefers initialSessionId over auto-select when provided', () => {
            const autoSelectEffect = source.substring(
                source.indexOf('// --- auto-select on mount'),
                source.indexOf('// Reset auto-select when workspace changes')
            );
            expect(autoSelectEffect).toContain('initialSessionId');
            // initialSessionId check should come before sessions[0] fallback
            const initialIdx = autoSelectEffect.indexOf('initialSessionId');
            const fallbackIdx = autoSelectEffect.indexOf('sessionsHook.sessions[0]');
            expect(initialIdx).toBeGreaterThan(-1);
            expect(fallbackIdx).toBeGreaterThan(initialIdx);
        });

        it('calls loadSession with initialSessionId', () => {
            const autoSelectEffect = source.substring(
                source.indexOf('// --- auto-select on mount'),
                source.indexOf('// Reset auto-select when workspace changes')
            );
            expect(autoSelectEffect).toContain('loadSession(initialSessionId)');
        });

        it('sets autoSelectedRef when initialSessionId is used', () => {
            const autoSelectEffect = source.substring(
                source.indexOf('if (initialSessionId)'),
                source.indexOf('if (sessionsHook.sessions.length === 0)')
            );
            expect(autoSelectEffect).toContain('autoSelectedRef.current = true');
        });

        it('updates location.hash when initialSessionId is used', () => {
            const autoSelectEffect = source.substring(
                source.indexOf('if (initialSessionId)'),
                source.indexOf('if (sessionsHook.sessions.length === 0)')
            );
            expect(autoSelectEffect).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(initialSessionId)");
        });
    });

    describe('queued task handling', () => {
        it('skips process fetch when task is queued with no processId', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain("!loadedTask?.processId && loadedTask?.status === 'queued'");
        });

        it('shows user prompt from task payload for queued tasks', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain("loadedTask?.payload?.prompt");
        });

        it('returns early for queued tasks without fetching process', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            // The queued early-return block should exist before the process fetch
            const queuedBlock = fn.substring(
                fn.indexOf("!loadedTask?.processId && loadedTask?.status === 'queued'"),
                fn.indexOf("fetchApi(`/processes/")
            );
            expect(queuedBlock).toContain('return;');
        });
    });

    describe('polling for queued → running transition', () => {
        it('has a polling useEffect for queued tasks', () => {
            expect(source).toContain("poll for queued");
        });

        it('polls only when task status is queued', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'));
            expect(pollSection).toContain("task?.status !== 'queued'");
        });

        it('polls with 2-second interval', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'));
            expect(pollSection).toContain('2000');
        });

        it('re-fetches queue data and transitions to loadSession on status change', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            expect(pollSection).toContain("t.status !== 'queued'");
            expect(pollSection).toContain('loadSession(chatTaskId)');
        });

        it('checks for processId or running status before re-loading', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            expect(pollSection).toContain("t.processId || t.status === 'running'");
        });

        it('cleans up interval on unmount', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            expect(pollSection).toContain('clearInterval(interval)');
        });

        it('depends on chatTaskId, task status, and loadSession', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            expect(pollSection).toContain('[chatTaskId, task?.status, loadSession]');
        });
    });

    describe('waiting state and error visibility', () => {
        it('shows "Waiting to start…" indicator for queued tasks', () => {
            expect(source).toContain("Waiting to start…");
        });

        it('queued indicator only shows when not loading and task is queued', () => {
            expect(source).toContain("!loading && task?.status === 'queued'");
        });

        it('shows prominent error with retry in conversation area', () => {
            const convArea = source.substring(source.indexOf('Conversation area'), source.indexOf('Input area'));
            expect(convArea).toContain('⚠️ {error}');
            expect(convArea).toContain('Retry');
        });

        it('error display only shows when not loading, has error, and no turns', () => {
            expect(source).toContain('!loading && error && turns.length === 0');
        });

        it('retry button calls loadSession with chatTaskId', () => {
            const convArea = source.substring(source.indexOf('Conversation area'), source.indexOf('Input area'));
            expect(convArea).toContain('loadSession(chatTaskId!)');
        });
    });

    describe('getConversationTurns task payload fallback', () => {
        it('accepts optional task parameter', () => {
            expect(source).toContain('function getConversationTurns(data: any, task?: any)');
        });

        it('falls back to task.payload.prompt when no process data', () => {
            expect(source).toContain('task?.payload?.prompt');
        });

        it('passes loadedTask to getConversationTurns in loadSession', () => {
            const fn = source.substring(source.indexOf('const loadSession'), source.indexOf('// --- auto-select'));
            expect(fn).toContain('getConversationTurns(procData, loadedTask)');
        });
    });

    describe('persistent resume buttons (taskFinished)', () => {
        it('derives taskFinished from completed status', () => {
            expect(source).toContain("task?.status === 'completed'");
        });

        it('derives taskFinished from failed status', () => {
            expect(source).toContain("task?.status === 'failed'");
        });

        it('declares taskFinished as a const derived from task status', () => {
            expect(source).toContain("task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled'");
        });

        it('shows header resume button when taskFinished', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('sessionExpired || taskFinished');
        });

        it('hides header resume button when streaming', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('!isStreaming');
        });

        it('shows Resume in Terminal button in header', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('handleResumeInTerminal');
            expect(headerSection).toContain('Resume in Terminal');
        });

        it('Resume in Terminal appears before Resume in header', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            const terminalIdx = headerSection.indexOf('Resume in Terminal');
            const resumeIdx = headerSection.indexOf('↻ Resume');
            expect(terminalIdx).toBeLessThan(resumeIdx);
        });

        it('disables header Resume in Terminal when processId is falsy', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            const resumeBlock = headerSection.substring(headerSection.indexOf('sessionExpired || taskFinished'));
            expect(resumeBlock).toContain('disabled={!processId}');
        });

        it('does not render bottom buttons when taskFinished', () => {
            const inputSection = source.substring(source.indexOf('{/* Input area */}'));
            expect(inputSection).not.toContain('taskFinished && (');
        });

        it('expired state shows informational message instead of buttons', () => {
            const inputSection = source.substring(source.indexOf('{/* Input area */}'));
            const expiredBranch = inputSection.substring(
                inputSection.indexOf('sessionExpired ? ('),
                inputSection.indexOf(') : (')
            );
            expect(expiredBranch).toContain('Session expired');
            expect(expiredBranch).not.toContain('handleResumeChat');
            expect(expiredBranch).not.toContain('Resume in Terminal');
            expect(expiredBranch).not.toContain('New Chat');
            expect(expiredBranch).not.toContain('<textarea');
        });

        it('keeps textarea visible when not expired', () => {
            const inputSection = source.substring(source.indexOf('{/* Input area */}'));
            const elseBranch = inputSection.substring(inputSection.indexOf(') : ('));
            expect(elseBranch).toContain('<textarea');
        });
    });

    describe('cancel queued chat', () => {
        it('defines handleCancelChat as a callback', () => {
            expect(source).toContain('const handleCancelChat = useCallback(async (taskId?: string)');
        });

        it('handleCancelChat sends DELETE to /queue/:id', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'));
            expect(fn).toContain('method: \'DELETE\'');
            expect(fn).toContain('`${getApiBase()}/queue/${encodeURIComponent(targetId)}`');
        });

        it('handleCancelChat resolves targetId from parameter or chatTaskId', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain('const targetId = taskId ?? chatTaskId');
        });

        it('handleCancelChat calls handleNewChat on success when cancelling active chat', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain('if (targetId === chatTaskId) handleNewChat()');
        });

        it('handleCancelChat refreshes sidebar sessions on success', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain('sessionsHook.refresh()');
        });

        it('handleCancelChat sets error on failure', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain("setError(err?.message ?? 'Failed to cancel chat.')");
        });

        it('handleCancelChat is defined after handleNewChat', () => {
            const newChatIdx = source.indexOf('const handleNewChat');
            const cancelIdx = source.indexOf('const handleCancelChat');
            expect(cancelIdx).toBeGreaterThan(newChatIdx);
        });

        it('handleCancelChat includes handleNewChat in dependency array', () => {
            const fn = source.substring(source.indexOf('const handleCancelChat'), source.indexOf('const handleStartChat'));
            expect(fn).toContain('handleNewChat');
            expect(fn).toContain('[chatTaskId, handleNewChat, sessionsHook]');
        });

        it('shows Cancel button in header when task is queued', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain("task?.status === 'queued'");
            expect(headerSection).toContain('Cancel');
            expect(headerSection).toContain('data-testid="cancel-chat-header-btn"');
        });

        it('header Cancel button calls handleCancelChat', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('handleCancelChat()');
        });

        it('shows inline Cancel button next to "Waiting to start…"', () => {
            const convArea = source.substring(source.indexOf('{/* Conversation area */}'), source.indexOf('{/* Input area */}'));
            expect(convArea).toContain('Waiting to start…');
            expect(convArea).toContain('data-testid="cancel-chat-inline-btn"');
            expect(convArea).toContain('Cancel');
        });

        it('inline Cancel button calls handleCancelChat', () => {
            const convArea = source.substring(source.indexOf('Waiting to start'), source.indexOf('{/* Input area */}'));
            expect(convArea).toContain('handleCancelChat()');
        });

        it('passes onCancelSession prop to ChatSessionSidebar', () => {
            expect(source).toContain('onCancelSession=');
            expect(source).toContain('handleCancelChat(taskId)');
        });
    });

    describe('polling handles cancelled status', () => {
        it('checks for cancelled status in poll effect', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            expect(pollSection).toContain("t.status === 'cancelled'");
        });

        it('calls handleNewChat when status is cancelled', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            const cancelledIdx = pollSection.indexOf("t.status === 'cancelled'");
            const newChatIdx = pollSection.indexOf('handleNewChat()', cancelledIdx);
            expect(newChatIdx).toBeGreaterThan(cancelledIdx);
        });

        it('refreshes sessions when status is cancelled', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            const cancelledIdx = pollSection.indexOf("t.status === 'cancelled'");
            const refreshIdx = pollSection.indexOf('sessionsHook.refresh()', cancelledIdx);
            expect(refreshIdx).toBeGreaterThan(cancelledIdx);
        });

        it('cancelled check comes before running/processId check in poll', () => {
            const pollSection = source.substring(source.indexOf('poll for queued'), source.indexOf('// --- cleanup'));
            const cancelledIdx = pollSection.indexOf("t.status === 'cancelled'");
            const runningIdx = pollSection.indexOf("t.processId || t.status === 'running'");
            expect(cancelledIdx).toBeGreaterThan(-1);
            expect(runningIdx).toBeGreaterThan(cancelledIdx);
        });
    });

    describe('streaming chat badge dispatch', () => {
        it('dispatches queueDispatch from useQueue', () => {
            expect(source).toContain('dispatch: queueDispatch } = useQueue()');
        });

        it('dispatches CHAT_STREAMING_STARTED when streaming begins', () => {
            expect(source).toContain("queueDispatch({ type: 'CHAT_STREAMING_STARTED', workspaceId })");
        });

        it('dispatches CHAT_STREAMING_STOPPED when streaming ends', () => {
            expect(source).toContain("queueDispatch({ type: 'CHAT_STREAMING_STOPPED', workspaceId })");
        });

        it('uses a ref to track dispatched state and avoid duplicate dispatches', () => {
            expect(source).toContain('streamingDispatchedRef');
            expect(source).toContain('const streamingDispatchedRef = useRef(false)');
        });

        it('cleans up streaming dispatch on unmount', () => {
            // Unmount cleanup should stop streaming count if still active
            const cleanupSection = source.substring(source.indexOf('Cleanup on unmount'));
            expect(cleanupSection).toContain('CHAT_STREAMING_STOPPED');
        });
    });

    describe('model selector on start screen', () => {
        it('imports usePreferences hook', () => {
            expect(source).toContain("import { usePreferences } from '../hooks/usePreferences'");
        });

        it('destructures model and persistModel from usePreferences', () => {
            expect(source).toContain('const { model: savedModel, setModel: persistModel } = usePreferences(workspaceId)');
        });

        it('declares model and models state variables', () => {
            expect(source).toContain("const [model, setModel] = useState('')");
            expect(source).toContain('const [models, setModels] = useState<string[]>([])');
        });

        it('fetches models from /queue/models on mount', () => {
            expect(source).toContain("fetchApi('/queue/models')");
        });

        it('handles both array and object response formats for models', () => {
            expect(source).toContain('if (Array.isArray(data)) setModels(data)');
            expect(source).toContain('data?.models && Array.isArray(data.models)');
        });

        it('rehydrates model from saved preferences', () => {
            expect(source).toContain('if (savedModel && !model) setModel(savedModel)');
        });

        it('defines handleModelChange that updates state and persists', () => {
            expect(source).toContain('const handleModelChange = useCallback((value: string)');
            const fn = source.substring(source.indexOf('const handleModelChange'), source.indexOf('// --- helpers ---'));
            expect(fn).toContain('setModel(value)');
            expect(fn).toContain('persistModel(value)');
        });

        it('renders a select dropdown with data-testid on start screen', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            expect(startScreen).toContain('data-testid="chat-model-select"');
            expect(startScreen).toContain('<select');
        });

        it('select has Default option with empty value', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            expect(startScreen).toContain('<option value="">Default</option>');
        });

        it('maps models array to option elements', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            expect(startScreen).toContain('models.map(m =>');
            expect(startScreen).toContain('<option key={m} value={m}>{m}</option>');
        });

        it('select is bound to model state', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            expect(startScreen).toContain('value={model}');
        });

        it('select calls handleModelChange on change', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            expect(startScreen).toContain('handleModelChange(e.target.value)');
        });

        it('select is placed inline next to Start Chat button', () => {
            const startScreen = source.substring(source.indexOf('renderStartScreen'), source.indexOf('renderConversation'));
            const selectIdx = startScreen.indexOf('<select');
            const buttonIdx = startScreen.indexOf('Start Chat');
            expect(selectIdx).toBeGreaterThan(-1);
            expect(buttonIdx).toBeGreaterThan(selectIdx);
        });
    });

    describe('model in Start Chat POST body', () => {
        it('includes config.model in POST body when model is set', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain('config: { model }');
        });

        it('conditionally spreads config only when model is non-empty', () => {
            const handler = source.substring(source.indexOf('const handleStartChat'));
            expect(handler).toContain("...(model ? { config: { model } } : {})");
        });
    });

    describe('model badge in header', () => {
        it('renders a model badge with data-testid in header area', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('data-testid="chat-model-badge"');
        });

        it('reads model from task.config.model or task.metadata.model', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('task?.config?.model');
            expect(headerSection).toContain('task?.metadata?.model');
        });

        it('only shows model badge when model is available', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain("(task?.config?.model || task?.metadata?.model) && (");
        });

        it('displays model text from config or metadata', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('task.config?.model || task.metadata?.model');
        });

        it('model badge is not present in the input area', () => {
            const inputSection = source.substring(source.indexOf('{/* Input area */}'));
            expect(inputSection).not.toContain('chat-model-badge');
        });

        it('model badge has a title attribute for accessibility', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('title={task.config?.model || task.metadata?.model}');
        });
    });

    describe('newChatTrigger prop', () => {
        it('accepts optional newChatTrigger prop as object', () => {
            expect(source).toContain('newChatTrigger?: { count: number; readOnly: boolean }');
        });

        it('destructures newChatTrigger from props', () => {
            expect(source).toMatch(/\{\s*workspaceId.*newChatTrigger.*newChatTriggerProcessedRef.*\}/s);
        });

        it('tracks previous trigger value with a ref', () => {
            expect(source).toContain('prevTriggerRef');
            expect(source).toContain('newChatTriggerProcessedRef ?? localTriggerRef');
        });

        it('calls handleNewChat with readOnly when newChatTrigger changes', () => {
            const triggerEffect = source.substring(
                source.indexOf('prevTriggerRef'),
                source.indexOf('prevTriggerRef') + 500
            );
            expect(triggerEffect).toContain('handleNewChat(newChatTrigger.readOnly)');
        });

        it('compares newChatTrigger.count against prevTriggerRef', () => {
            const triggerEffect = source.substring(
                source.indexOf('prevTriggerRef'),
                source.indexOf('prevTriggerRef') + 500
            );
            expect(triggerEffect).toContain('newChatTrigger.count !== prevTriggerRef.current');
        });

        it('skips initial trigger value', () => {
            const triggerEffect = source.substring(
                source.indexOf('prevTriggerRef'),
                source.indexOf('prevTriggerRef') + 500
            );
            expect(triggerEffect).toContain('newChatTrigger &&');
        });
    });

    // ========================================================================
    // Slash-command skill integration
    // ========================================================================

    describe('slash-command skill integration', () => {
        it('imports SlashCommandMenu component', () => {
            expect(source).toContain("import { SlashCommandMenu }");
            expect(source).toContain("from './SlashCommandMenu'");
        });

        it('imports useSlashCommands hook', () => {
            expect(source).toContain("import { useSlashCommands }");
            expect(source).toContain("from './useSlashCommands'");
        });

        it('imports SkillItem type', () => {
            expect(source).toContain("import type { SkillItem }");
        });

        it('declares skills state', () => {
            expect(source).toContain('useState<SkillItem[]>([])');
        });

        it('initializes useSlashCommands with skills', () => {
            expect(source).toContain('useSlashCommands(skills)');
        });

        it('fetches skills from API when workspaceId changes', () => {
            expect(source).toContain('/workspaces/');
            expect(source).toContain('/skills');
            expect(source).toContain('setSkills(data.skills)');
        });

        it('renders SlashCommandMenu in start screen', () => {
            const startScreen = source.substring(
                source.indexOf('const renderStartScreen'),
                source.indexOf('const renderConversation')
            );
            expect(startScreen).toContain('<SlashCommandMenu');
        });

        it('renders SlashCommandMenu in follow-up area', () => {
            const convSection = source.substring(
                source.indexOf('const renderConversation'),
                source.indexOf('// --- render ---')
            );
            expect(convSection).toContain('<SlashCommandMenu');
        });

        it('handleStartChat extracts skills via parseAndExtract', () => {
            const fn = source.substring(
                source.indexOf('const handleStartChat'),
                source.indexOf('const sendFollowUp')
            );
            expect(fn).toContain('slashCommands.parseAndExtract');
            expect(fn).toContain('parsedSkills');
        });

        it('handleStartChat sends skillNames in queue body', () => {
            const fn = source.substring(
                source.indexOf('const handleStartChat'),
                source.indexOf('const sendFollowUp')
            );
            expect(fn).toContain('skillNames: parsedSkills');
        });

        it('sendFollowUp extracts skills via parseAndExtract', () => {
            const fn = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const handleResumeChat')
            );
            expect(fn).toContain('slashCommands.parseAndExtract');
        });

        it('sendFollowUp sends skillNames in message body', () => {
            const fn = source.substring(
                source.indexOf('const sendFollowUp'),
                source.indexOf('const handleResumeChat')
            );
            expect(fn).toContain('skillNames: parsedSkills');
        });

        it('start screen textarea placeholder mentions skills', () => {
            const startScreen = source.substring(
                source.indexOf('const renderStartScreen'),
                source.indexOf('const renderConversation')
            );
            expect(startScreen).toContain('Type / for skills');
        });

        it('follow-up textarea placeholder mentions skills', () => {
            const convSection = source.substring(
                source.indexOf('const renderConversation'),
                source.indexOf('// --- render ---')
            );
            expect(convSection).toContain('Type / for skills');
        });

        it('start screen textarea calls slashCommands.handleInputChange on change', () => {
            const startScreen = source.substring(
                source.indexOf('const renderStartScreen'),
                source.indexOf('const renderConversation')
            );
            expect(startScreen).toContain('slashCommands.handleInputChange');
        });

        it('start screen textarea calls slashCommands.handleKeyDown on keyDown', () => {
            const startScreen = source.substring(
                source.indexOf('const renderStartScreen'),
                source.indexOf('const renderConversation')
            );
            expect(startScreen).toContain('slashCommands.handleKeyDown');
        });
    });

    describe('read-only toggle', () => {
        it('renders a read-only checkbox in start screen', () => {
            const startScreen = source.substring(
                source.indexOf('const renderStartScreen'),
                source.indexOf('const renderConversation')
            );
            expect(startScreen).toContain('data-testid="chat-readonly-toggle"');
        });

        it('has readOnly state', () => {
            expect(source).toContain('readOnly');
            expect(source).toContain('setReadOnly');
        });

        it('sends readonly flag in payload when readOnly is true', () => {
            expect(source).toContain("readonly: readOnly");
        });

        it('shows read-only badge in conversation header', () => {
            const convSection = source.substring(
                source.indexOf('const renderConversation'),
            );
            expect(convSection).toContain('data-testid="chat-readonly-badge"');
            expect(convSection).toContain('Read-only');
        });

        it('badge checks payload.readonly for read-only mode', () => {
            expect(source).toContain("task?.payload");
            expect(source).toContain("readonly");
        });
    });

    describe('conversation metadata popover (info icon)', () => {
        it('imports ConversationMetadataPopover from processes', () => {
            expect(source).toContain("import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover'");
        });

        it('imports useMemo from react', () => {
            expect(source).toContain('useMemo');
            const reactImport = source.substring(source.indexOf("from 'react'") - 100, source.indexOf("from 'react'"));
            expect(reactImport).toContain('useMemo');
        });

        it('builds metadataProcess with useMemo from task object', () => {
            expect(source).toContain('const metadataProcess = useMemo(');
        });

        it('metadataProcess returns null when task is null', () => {
            const memo = source.substring(source.indexOf('const metadataProcess = useMemo'), source.indexOf('}, [task, processId'));
            expect(memo).toContain('if (!task) return null');
        });

        it('metadataProcess uses processId for the id field', () => {
            const memo = source.substring(source.indexOf('const metadataProcess = useMemo'), source.indexOf('}, [task, processId'));
            expect(memo).toContain('id: processId ?? task.id');
        });

        it('metadataProcess includes queueTaskId in metadata', () => {
            const memo = source.substring(source.indexOf('const metadataProcess = useMemo'), source.indexOf('}, [task, processId'));
            expect(memo).toContain('queueTaskId: task.id');
        });

        it('metadataProcess includes model from task config in metadata', () => {
            const memo = source.substring(source.indexOf('const metadataProcess = useMemo'), source.indexOf('}, [task, processId'));
            expect(memo).toContain('task.config?.model');
        });

        it('metadataProcess includes workspaceId in metadata', () => {
            const memo = source.substring(source.indexOf('const metadataProcess = useMemo'), source.indexOf('}, [task, processId'));
            expect(memo).toContain('workspaceId');
        });

        it('metadataProcess depends on task, processId, and workspaceId', () => {
            expect(source).toContain('[task, processId, workspaceId]');
        });

        it('renders ConversationMetadataPopover in the chat header', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('<ConversationMetadataPopover');
        });

        it('passes metadataProcess as the process prop', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('process={metadataProcess}');
        });

        it('passes turns.length as the turnsCount prop', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('turnsCount={turns.length}');
        });

        it('conditionally renders popover only when metadataProcess is defined', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            expect(headerSection).toContain('metadataProcess && <ConversationMetadataPopover');
        });

        it('popover is placed inside the header button group', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            // The popover should be after the resume buttons and before closing the button group div
            const popoverIdx = headerSection.indexOf('<ConversationMetadataPopover');
            const stopIdx = headerSection.indexOf('>Stop<');
            expect(popoverIdx).toBeGreaterThan(stopIdx);
        });

        it('header button group uses items-center alignment for info icon', () => {
            const headerSection = source.substring(source.indexOf('{/* Header */}'), source.indexOf('{/* Conversation area */}'));
            // The div containing buttons should use items-center for vertical alignment
            expect(headerSection).toContain('"flex items-center gap-2"');
        });
    });

    describe('mobile layout — follow-up input bar', () => {
        it('always uses flex items-center gap-2 relative for the follow-up wrapper', () => {
            // Unified horizontal layout for both mobile and desktop
            expect(source).toContain('"flex items-center gap-2 relative"');
            expect(source).not.toContain('isMobile ? "space-y-2"');
        });

        it('textarea wrapper always uses flex-1 relative', () => {
            expect(source).toContain('"flex-1 relative"');
            expect(source).not.toContain('isMobile ? "w-full relative"');
        });

        it('Send button is rendered inline without a separate controls row', () => {
            expect(source).not.toContain('data-testid="chat-followup-controls-row"');
        });

        it('no mobile-specific justify-between wrapper around Send button', () => {
            expect(source).not.toContain('"flex items-center justify-between gap-2"');
        });

        it('Send button does not need ml-auto in the follow-up input area', () => {
            const inputArea = source.substring(source.indexOf('{/* Input area */}'));
            expect(inputArea).not.toContain('className="ml-auto"');
        });
    });

    describe('mobile layout — new-chat start form', () => {
        it('uses isMobile to conditionally choose start-form layout', () => {
            expect(source).toContain('data-testid="chat-start-controls"');
        });

        it('on mobile, Start Chat button has w-full justify-center classes', () => {
            expect(source).toContain('className="w-full justify-center"');
        });

        it('on mobile, model select uses flex-1 to fill available width', () => {
            // The mobile branch select has flex-1 class
            expect(source).toContain('"flex-1 px-2 py-1.5 text-sm rounded border');
        });

        it('on desktop, model select keeps original classes without flex-1', () => {
            // Desktop branch select starts with px-2
            expect(source).toContain('"px-2 py-1.5 text-sm rounded border');
        });
    });
});


describe('RepoChatTab — retry strategy', () => {
    let source: string;

    beforeAll(() => {
        source = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoChatTab.tsx'),
            'utf-8'
        );
    });

    it('defines markLastTurnAsError helper', () => {
        expect(source).toContain('markLastTurnAsError');
    });

    it('defines retryLastMessage function', () => {
        expect(source).toContain('retryLastMessage');
    });

    it('marks last turn as error on non-ok follow-up response', () => {
        expect(source).toContain('markLastTurnAsError(body?.error ??');
    });

    it('marks last turn as error in sendFollowUp catch block', () => {
        // sendFollowUp catch should use markLastTurnAsError, not removeStreamingPlaceholder
        const followUpFn = source.substring(
            source.indexOf('const sendFollowUp'),
            source.indexOf('const retryLastMessage')
        );
        expect(followUpFn).toContain('markLastTurnAsError');
        expect(followUpFn).not.toContain("setError(err?.message ?? 'Failed to send follow-up message.');");
    });

    it('passes onRetry to ConversationTurnBubble for error turns', () => {
        expect(source).toContain('onRetry={');
        expect(source).toContain('turn.isError');
        expect(source).toContain('retryLastMessage');
    });

    it('guards onRetry behind readOnly check', () => {
        const retryProp = source.substring(
            source.indexOf('onRetry={'),
            source.indexOf('onRetry={') + 300
        );
        expect(retryProp).toContain('!readOnly');
    });

    it('guards onRetry behind !sending check', () => {
        const retryProp = source.substring(
            source.indexOf('onRetry={'),
            source.indexOf('onRetry={') + 300
        );
        expect(retryProp).toContain('!sending');
    });

    it('retryLastMessage replaces error bubble with streaming placeholder', () => {
        const retryFn = source.substring(
            source.indexOf('const retryLastMessage'),
            source.indexOf('const handleResumeChat')
        );
        expect(retryFn).toContain("streaming: true");
        expect(retryFn).toContain("last.isError");
    });

    it('retryLastMessage does not clear inputValue', () => {
        const retryFn = source.substring(
            source.indexOf('const retryLastMessage'),
            source.indexOf('const handleResumeChat')
        );
        expect(retryFn).not.toContain("setInputValue('')");
    });
});

describe('RepoChatTab cross-repo event leakage fixes', () => {
    let source: string;
    beforeAll(() => {
        source = require('fs').readFileSync(REPO_CHAT_TAB_PATH, 'utf-8');
    });

    it('filters hasChatTask by workspaceId to prevent foreign queue events triggering refresh', () => {
        const queueEffect = source.substring(
            source.indexOf('const hasChatTask'),
            source.indexOf('if (hasChatTask) sessionsHook.refresh()')
        );
        expect(queueEffect).toContain('t.workspaceId === workspaceId');
    });

    it('hasChatTask guard allows tasks with no workspaceId (legacy compatibility)', () => {
        const queueEffect = source.substring(
            source.indexOf('const hasChatTask'),
            source.indexOf('if (hasChatTask) sessionsHook.refresh()')
        );
        expect(queueEffect).toContain('!t.workspaceId');
    });

    it('hasChatTask filter combines workspaceId check with type check', () => {
        const queueEffect = source.substring(
            source.indexOf('const hasChatTask'),
            source.indexOf('if (hasChatTask) sessionsHook.refresh()')
        );
        expect(queueEffect).toContain("t.type === 'chat'");
        expect(queueEffect).toContain('t.workspaceId === workspaceId');
    });
});
