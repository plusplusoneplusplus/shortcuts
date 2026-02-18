/**
 * Detail panel script: process detail rendering, inline markdown.
 */

import { getApiBase } from './config';
import { appState, queueState, queueTaskConversationTurns, setQueueTaskConversationTurns } from './state';
import type { ClientConversationTurn } from './state';
import {
    formatDuration, formatRelativeTime, statusIcon, statusLabel,
    typeLabel, escapeHtmlClient, copyToClipboard,
} from './utils';
import { navigateToProcess, setHashSilent, fetchApi } from './core';
import { getCachedConversation, cacheConversation, invalidateConversationCache } from './sidebar';
import { renderToolCallsHTML, attachToolCallToggleHandlers, normalizeToolCall, renderToolCall, updateToolCallStatus } from './tool-renderer';
import { renderMarkdownToHtml } from './markdown-renderer';

export function renderDetail(id: string): void {
    // Queue processes (ID starts with 'queue_') should use the queue task conversation view
    if (id.startsWith('queue_')) {
        const taskId = id.substring('queue_'.length);
        showQueueTaskDetail(taskId);
        return;
    }

    let process = appState.processes.find(function(p: any) { return p.id === id; });
    if (!process) {
        // Not found locally — try fetching from API
        fetchProcessAndRender(id);
        return;
    }

    renderProcessDetail(process, id);
}

/** Fetch a process by ID from the API and render it. Shows loading spinner while fetching. */
function fetchProcessAndRender(id: string): void {
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');
    contentEl.innerHTML = '<div class="history-loading"><div class="history-loading-spinner"></div> Loading process...</div>';

    fetchApi('/processes/' + encodeURIComponent(id)).then(function(data: any) {
        if (data && data.process) {
            renderProcessDetail(data.process, id);
        } else {
            clearDetail();
        }
    }).catch(function() {
        clearDetail();
    });
}

function renderProcessDetail(process: any, id: string): void {

    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    const panelEl = document.getElementById('detail-panel');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');
    if (panelEl) panelEl.classList.remove('chat-layout');

    let duration = '';
    if (process.startTime) {
        const start = new Date(process.startTime).getTime();
        const end = process.endTime ? new Date(process.endTime).getTime() : Date.now();
        duration = formatDuration(end - start);
    }

    // Use fullPrompt for the title when available (promptPreview may be truncated)
    const detailTitle = process.fullPrompt || process.promptPreview || process.id || 'Process';

    let html = '<div class="detail-header">' +
        '<h1>' + escapeHtmlClient(detailTitle) + '</h1>' +
        '<span class="status-badge ' + (process.status || 'queued') + '">' +
            statusIcon(process.status) + ' ' + statusLabel(process.status) +
            (duration ? ' \u00B7 ' + duration : '') +
        '</span>' +
    '</div>';

    // Metadata grid
    html += '<div class="meta-grid">';
    html += '<div class="meta-item"><label>Type</label><span>' + escapeHtmlClient(typeLabel(process.type)) + '</span></div>';
    if (process.workspaceId) {
        html += '<div class="meta-item"><label>Workspace</label><span>' + escapeHtmlClient(process.workspaceId) + '</span></div>';
    }
    if (process.metadata && process.metadata.backend) {
        html += '<div class="meta-item"><label>Backend</label><span>' + escapeHtmlClient(process.metadata.backend) + '</span></div>';
    }
    if (process.metadata && process.metadata.model) {
        html += '<div class="meta-item"><label>Model</label><span>' + escapeHtmlClient(process.metadata.model) + '</span></div>';
    }
    if (process.sdkSessionId) {
        html += '<div class="meta-item"><label>Session ID</label><span class="meta-copyable" onclick="copyToClipboard(\'' +
            escapeHtmlClient(process.sdkSessionId) + '\')" title="Click to copy">' +
            escapeHtmlClient(process.sdkSessionId) + '</span></div>';
    }
    if (process.workingDirectory) {
        html += '<div class="meta-item"><label>Working Directory</label><span class="meta-path">' + escapeHtmlClient(process.workingDirectory) + '</span></div>';
    }
    if (process.startTime) {
        html += '<div class="meta-item"><label>Started</label><span>' + new Date(process.startTime).toLocaleString() + '</span></div>';
    }
    if (process.endTime) {
        html += '<div class="meta-item"><label>Ended</label><span>' + new Date(process.endTime).toLocaleString() + '</span></div>';
    }
    html += '</div>';

    // Error section
    if (process.error) {
        html += '<div class="error-alert">' + escapeHtmlClient(process.error) + '</div>';
    }

    // Child process summary for group types
    const isGroup = process.type === 'code-review-group' || process.type === 'pipeline-execution';
    if (isGroup) {
        const children = appState.processes.filter(function(p: any) { return p.parentProcessId === id; });
        if (children.length > 0) {
            html += '<div class="child-summary"><h2>Sub-processes (' + children.length + ')</h2>';
            html += '<table class="child-table"><thead><tr><th>Status</th><th>Title</th><th>Type</th><th>Time</th></tr></thead><tbody>';
            children.forEach(function(c: any) {
                html += '<tr onclick="navigateToProcess(\'' + escapeHtmlClient(c.id) + '\')">' +
                    '<td>' + statusIcon(c.status) + '</td>' +
                    '<td>' + escapeHtmlClient(c.promptPreview || c.id || '') + '</td>' +
                    '<td>' + escapeHtmlClient(typeLabel(c.type)) + '</td>' +
                    '<td>' + formatRelativeTime(c.startTime) + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }
    }

    // Result section
    if (process.result) {
        html += '<div class="result-section"><h2>Result</h2>' +
            '<div class="result-body">' + renderMarkdownToHtml(process.result) + '</div></div>';
    }

    if (process.structuredResult) {
        html += '<div class="result-section"><h2>Structured Result</h2>' +
            '<div class="result-body"><pre><code>' +
            escapeHtmlClient(JSON.stringify(process.structuredResult, null, 2)) +
            '</code></pre></div></div>';
    }

    // Conversation section for terminal processes — use chat bubbles
    const isTerminal = process.status === 'completed' || process.status === 'failed';
    if (isTerminal) {
        html += '<div id="process-conversation-section"></div>';
    }

    // Action buttons
    html += '<div class="action-buttons">';
    html += '<button class="action-btn" onclick="copyToClipboard(location.origin+\'/process/' +
        escapeHtmlClient(id) + '\')">' +
        '\u{1F517} Copy Link</button>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Load conversation output asynchronously for terminal processes — render as chat bubbles
    if (isTerminal) {
        const sectionEl = document.getElementById('process-conversation-section');
        if (sectionEl) {
            // Check client-side cache first
            const cached = getCachedConversation(id);
            if (cached && cached.length > 0) {
                setConversationHTML(sectionEl, id, cached);
            } else {
                // Show loading spinner
                sectionEl.innerHTML = '<div class="history-loading"><div class="history-loading-spinner"></div> Loading conversation...</div>';

                // Fetch the full process with conversationTurns
                fetchApi('/processes/' + encodeURIComponent(id)).then(function(data: any) {
                    const proc = data && data.process ? data.process : null;
                    if (proc && proc.conversationTurns && proc.conversationTurns.length > 0) {
                        cacheConversation(id, proc.conversationTurns);
                        setConversationHTML(sectionEl, id, proc.conversationTurns);
                    } else {
                        // Fall back to /output endpoint and render as chat bubbles
                        return fetchApi('/processes/' + encodeURIComponent(id) + '/output')
                            .then(function(outputData: any) {
                                if (outputData && outputData.content) {
                                    const syntheticTurns: ClientConversationTurn[] = [];
                                    if (process.fullPrompt || process.promptPreview) {
                                        syntheticTurns.push({
                                            role: 'user',
                                            content: process.fullPrompt || process.promptPreview,
                                            timestamp: process.startTime || undefined,
                                            timeline: [],
                                        });
                                    }
                                    syntheticTurns.push({
                                        role: 'assistant',
                                        content: outputData.content,
                                        timestamp: process.endTime || undefined,
                                        timeline: [],
                                    });
                                    cacheConversation(id, syntheticTurns);
                                    setConversationHTML(sectionEl, id, syntheticTurns);
                                } else if (process.result) {
                                    const syntheticTurns: ClientConversationTurn[] = [];
                                    if (process.fullPrompt || process.promptPreview) {
                                        syntheticTurns.push({
                                            role: 'user',
                                            content: process.fullPrompt || process.promptPreview,
                                            timestamp: process.startTime || undefined,
                                            timeline: [],
                                        });
                                    }
                                    syntheticTurns.push({
                                        role: 'assistant',
                                        content: process.result,
                                        timestamp: process.endTime || undefined,
                                        timeline: [],
                                    });
                                    cacheConversation(id, syntheticTurns);
                                    setConversationHTML(sectionEl, id, syntheticTurns);
                                } else {
                                    sectionEl.innerHTML = '<div class="conversation-waiting">No conversation output saved.</div>';
                                }
                            });
                    }
                }).catch(function() {
                    sectionEl.innerHTML = '<div class="conversation-waiting">No conversation output saved.</div>';
                });
            }
        }
    }
}

/** Render conversation turns as chat bubbles for the legacy process detail view. */
function renderConversationBubbles(processId: string, turns: ClientConversationTurn[]): string {
    let html = '<div class="conversation-section"><h2>Conversation</h2>' +
        '<div id="process-conversation" class="conversation-body">';
    for (let i = 0; i < turns.length; i++) {
        html += renderChatMessage(turns[i]);
    }
    html += '</div>' +
        '<button class="action-btn" onclick="copyConversationOutput(\'' +
        escapeHtmlClient(processId) + '\')">\u{1F4CB} Copy Conversation</button></div>';
    return html;
}

/** Set innerHTML to conversation bubbles HTML and attach tool call toggle handlers. */
function setConversationHTML(el: HTMLElement, processId: string, turns: ClientConversationTurn[]): void {
    el.innerHTML = renderConversationBubbles(processId, turns);
    attachToolCallToggleHandlers(el);
}

export function clearDetail(): void {
    // Clean up any active SSE connection
    closeQueueTaskStream();
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    const panelEl = document.getElementById('detail-panel');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (contentEl) { contentEl.classList.add('hidden'); contentEl.innerHTML = ''; }
    if (panelEl) panelEl.classList.remove('chat-layout');
}

// ================================================================
// Queue Task Detail — Conversation View with SSE Streaming
// ================================================================

let activeQueueTaskStream: EventSource | null = null;
let queueTaskStreamContent = '';
let queueTaskStreamProcessId: string | null = null;

/**
 * Tracks content accumulated *before* the most recent tool call in the stream.
 * When a tool-start arrives we snapshot the current content here and reset
 * `queueTaskStreamContent` so subsequent chunks only go into the latest segment.
 * This lets us render content and tool calls in chronological order during streaming.
 */
let streamContentBeforeLastTool = '';

/** Tracks whether the user has manually scrolled up in the conversation. */
let userHasScrolledUp = false;

/** localStorage-backed preferences (read once at module init). */
const chatEnterSend = localStorage.getItem('coc-chat-enter-send') !== 'false';
const chatAutoScroll = localStorage.getItem('coc-chat-auto-scroll') !== 'false';

export function closeQueueTaskStream(): void {
    if (activeQueueTaskStream) {
        activeQueueTaskStream.close();
        activeQueueTaskStream = null;
    }
    queueTaskStreamProcessId = null;
}

/**
 * Show a queue task's conversation in the detail panel.
 * Connects to SSE for real-time streaming if the task is running.
 */
export function showQueueTaskDetail(taskId: string): void {
    const processId = 'queue_' + taskId;

    // Update the URL hash for deep-linking
    setHashSilent('#process/' + encodeURIComponent(processId));

    // Close any previous stream
    closeQueueTaskStream();

    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    const panelEl = document.getElementById('detail-panel');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');
    if (panelEl) panelEl.classList.add('chat-layout');

    queueTaskStreamContent = '';
    streamContentBeforeLastTool = '';
    queueTaskStreamProcessId = processId;

    // Restore from cache if available (eliminates flicker on tab switch)
    const cached = getCachedConversation(processId);
    setQueueTaskConversationTurns(cached || []);

    // First, try to fetch the process from the store for metadata
    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(data: any) {
        const proc = data && data.process ? data.process : null;

        // Populate conversation turns from process data
        if (proc && proc.conversationTurns && proc.conversationTurns.length > 0) {
            setQueueTaskConversationTurns(proc.conversationTurns);
            cacheConversation(processId, proc.conversationTurns);

            // If the last turn is a streaming assistant turn, seed the stream content
            // so SSE can continue appending to it seamlessly after page refresh
            const lastTurn = proc.conversationTurns[proc.conversationTurns.length - 1];
            if (lastTurn && lastTurn.role === 'assistant' && lastTurn.streaming) {
                queueTaskStreamContent = lastTurn.content || '';
            }
        } else if (proc) {
            // Build synthetic turns from legacy fields — prefer full prompt over truncated preview
            const syntheticTurns: ClientConversationTurn[] = [];
            const userContent = proc.fullPrompt || proc.promptPreview;
            if (userContent) {
                syntheticTurns.push({
                    role: 'user',
                    content: userContent,
                    timestamp: proc.startTime || undefined,
                    timeline: [],
                });
            }
            if (proc.result) {
                syntheticTurns.push({
                    role: 'assistant',
                    content: proc.result,
                    timestamp: proc.endTime || undefined,
                    timeline: [],
                });
            }
            setQueueTaskConversationTurns(syntheticTurns);
            cacheConversation(processId, syntheticTurns);
        }

        renderQueueTaskConversation(processId, taskId, proc);

        // Connect SSE for streaming
        connectQueueTaskSSE(processId, taskId, proc);
    }).catch(function() {
        // Process not in store yet — render skeleton and connect SSE
        renderQueueTaskConversation(processId, taskId, null);
        connectQueueTaskSSE(processId, taskId, null);
    });
}

function renderChatMessage(turn: ClientConversationTurn): string {
    const isUser = turn.role === 'user';
    const roleLabel = isUser ? 'You' : 'Assistant';
    const roleIcon = isUser ? '\u{1F464}' : '\u{1F916}';
    const bubbleClass = 'chat-message' + (isUser ? ' user' : ' assistant') + (turn.streaming ? ' streaming' : '');
    const rawAttr = turn.content ? ' data-raw="' + escapeHtmlClient(turn.content) + '"' : '';

    let html = '<div class="' + bubbleClass + '"' + rawAttr + '>';

    // Header: role label + icon + timestamp + optional streaming indicator
    html += '<div class="chat-message-header">';
    html += '<span class="role-icon">' + roleIcon + '</span>';
    html += '<span class="role-label">' + roleLabel + '</span>';
    if (turn.timestamp) {
        html += '<span class="timestamp">' + new Date(turn.timestamp).toLocaleTimeString() + '</span>';
    }
    if (turn.streaming) {
        html += '<span class="streaming-indicator">\u25CF Live</span>';
    }
    html += '</div>';

    // Timeline-first rendering with consolidated tool cards.
    // We collapse lifecycle events by toolCallId so each tool appears once.
    if (turn.timeline && turn.timeline.length > 0) {
        let hasContentSegment = false;
        const toolsById = new Map<string, any>();
        const orderedToolCalls: any[] = [];

        for (const item of turn.timeline) {
            if (item.type === 'content') {
                hasContentSegment = true;
                html += '<div class="chat-message-content">' + renderMarkdownToHtml(item.content || '') + '</div>';
            } else if (item.type.startsWith('tool-')) {
                const tc = normalizeToolCall(item.toolCall || {});
                if (!tc.id) continue;

                const existing = toolsById.get(tc.id);
                if (!existing) {
                    const snapshot = { ...tc };
                    toolsById.set(tc.id, snapshot);
                    orderedToolCalls.push(snapshot);
                } else {
                    if (tc.toolName && (!existing.toolName || existing.toolName === 'unknown')) {
                        existing.toolName = tc.toolName;
                    }
                    if (tc.args && Object.keys(tc.args).length > 0) {
                        existing.args = tc.args;
                    }
                    if (tc.status) {
                        existing.status = tc.status;
                    }
                    if (tc.result !== undefined) {
                        existing.result = tc.result;
                    }
                    if (tc.error !== undefined) {
                        existing.error = tc.error;
                    }
                    if (tc.startTime && !existing.startTime) {
                        existing.startTime = tc.startTime;
                    }
                    if (tc.endTime) {
                        existing.endTime = tc.endTime;
                    }
                    if (tc.parentToolCallId && !existing.parentToolCallId) {
                        existing.parentToolCallId = tc.parentToolCallId;
                    }
                }
            }
        }

        if (!hasContentSegment) {
            html += '<div class="chat-message-content">' + renderMarkdownToHtml(turn.content || '') + '</div>';
        }
        if (!isUser && orderedToolCalls.length > 0) {
            html += '<div class="tool-calls-container">';
            html += renderToolCallsHTML(orderedToolCalls);
            html += '</div>';
        }
    } else {
        // Empty timeline: streaming/optimistic/backward-compat turns
        html += '<div class="chat-message-content">' + renderMarkdownToHtml(turn.content || '') + '</div>';
        if (!isUser && turn.toolCalls && turn.toolCalls.length > 0) {
            html += '<div class="tool-calls-container">';
            html += renderToolCallsHTML(turn.toolCalls);
            html += '</div>';
        }
    }

    // Per-message copy button (user and assistant)
    if (turn.content) {
        html += '<button class="bubble-copy-btn" onclick="handleMsgCopy(this)" title="Copy message">\u{1F4CB}</button>';
    }

    html += '</div>';
    return html;
}

/**
 * Resolve parent tool call id for streaming tool events.
 * Prefers explicit parent from server; falls back to current active task call.
 */
function resolveParentToolCallId(data: any, activeTaskStack: string[], toolName: string): string | undefined {
    if (typeof data?.parentToolCallId === 'string' && data.parentToolCallId) {
        return data.parentToolCallId;
    }
    if (activeTaskStack.length === 0) {
        return undefined;
    }
    // In legacy events without explicit parent, infer from active task scope.
    // This applies to both nested task calls and regular tool calls.
    if (toolName === 'task' || toolName !== '') {
        return activeTaskStack[activeTaskStack.length - 1];
    }
    return undefined;
}

function removeFromTaskStack(activeTaskStack: string[], toolCallId: string): void {
    const idx = activeTaskStack.lastIndexOf(toolCallId);
    if (idx >= 0) {
        activeTaskStack.splice(idx, 1);
    }
}

function ensureParentChildToolContainer(parentCard: HTMLElement): HTMLElement {
    let childContainer = parentCard.querySelector('.tool-call-children') as HTMLElement | null;
    if (!childContainer) {
        childContainer = document.createElement('div');
        childContainer.className = 'tool-call-children';
        parentCard.appendChild(childContainer);
    }
    return childContainer;
}

function appendStreamingToolCard(
    bubble: HTMLElement,
    card: HTMLElement,
    parentToolCallId?: string
): void {
    if (parentToolCallId) {
        const parentCard = findToolCard(parentToolCallId);
        if (parentCard) {
            ensureParentChildToolContainer(parentCard).appendChild(card);
            return;
        }
    }

    const toolContainer = document.createElement('div');
    toolContainer.className = 'tool-calls-container';
    toolContainer.appendChild(card);
    bubble.appendChild(toolContainer);
}

function renderQueueTaskConversation(processId: string, taskId: string, proc: any): void {
    const contentEl = document.getElementById('detail-content');
    if (!contentEl) return;

    let name = '';
    let status = '';
    let error = '';
    let startTime = '';
    let endTime = '';

    if (proc) {
        name = proc.fullPrompt || proc.promptPreview || proc.id || 'Queue Task';
        status = proc.status || 'running';
        error = proc.error || '';
        startTime = proc.startTime ? new Date(proc.startTime).toLocaleString() : '';
        endTime = proc.endTime ? new Date(proc.endTime).toLocaleString() : '';
    } else {
        // Try to find task info from queue state
        const allTasks = (queueState.running || []).concat(queueState.queued || []).concat(queueState.history || []);
        let taskInfo: any = null;
        for (let i = 0; i < allTasks.length; i++) {
            if (allTasks[i].id === taskId) { taskInfo = allTasks[i]; break; }
        }
        if (taskInfo) {
            name = taskInfo.displayName || taskInfo.type || 'Queue Task';
            status = taskInfo.status || 'running';
            startTime = taskInfo.startedAt ? new Date(taskInfo.startedAt).toLocaleString() : '';
        }
    }

    // Extract original task path from queue state payload
    let originalTaskPath: string | null = null;
    let originalWorkspaceId: string | null = null;

    const allQueueTasks = (queueState.running || []).concat(queueState.queued || []).concat(queueState.history || []);
    for (let i = 0; i < allQueueTasks.length; i++) {
        if (allQueueTasks[i].id === taskId) {
            const p = allQueueTasks[i].payload;
            if (p && p.data && typeof p.data.originalTaskPath === 'string') {
                originalTaskPath = p.data.originalTaskPath;
                originalWorkspaceId = typeof p.data.originalWorkspaceId === 'string'
                    ? p.data.originalWorkspaceId : null;
            }
            break;
        }
    }

    // Secondary source: process metadata
    if (!originalTaskPath && proc && proc.metadata) {
        if (typeof proc.metadata.originalTaskPath === 'string') {
            originalTaskPath = proc.metadata.originalTaskPath;
            originalWorkspaceId = typeof proc.metadata.originalWorkspaceId === 'string'
                ? proc.metadata.originalWorkspaceId : null;
        }
    }

    const isRunning = (status === 'running' || status === 'queued');
    const statusClass = status || 'running';

    // Single-line compact header: back | status | model | date | title | info
    let html = '<div class="detail-header-inline">' +
        '<button class="detail-back-btn" onclick="clearDetail()" title="Back">\u2190</button>' +
        '<span class="status-badge ' + statusClass + '">' +
            statusIcon(status) + ' ' + statusLabel(status) +
        '</span>';

    if (proc && proc.metadata && proc.metadata.model) {
        html += '<span class="meta-chip">' + escapeHtmlClient(proc.metadata.model) + '</span>';
    }
    if (startTime) {
        html += '<span class="meta-chip">' + startTime + '</span>';
    }

    html += '<span class="detail-inline-title" title="' + escapeHtmlClient(name) + '">' +
        escapeHtmlClient(name) + '</span>';

    html += '<button class="meta-info-btn" id="meta-info-toggle" title="Show details">' +
        '\u{2139}\uFE0F</button>';

    html += '</div>';

    // Hidden metadata popover (toggled by info button)
    html += '<div class="meta-popover hidden" id="meta-popover">';
    html += '<div class="meta-grid">';
    html += '<div class="meta-item"><label>ID</label><span>' + escapeHtmlClient(processId) + '</span></div>';
    if (proc && proc.metadata && proc.metadata.model) {
        html += '<div class="meta-item"><label>Model</label><span>' + escapeHtmlClient(proc.metadata.model) + '</span></div>';
    }
    if (proc && proc.workingDirectory) {
        html += '<div class="meta-item"><label>Working Directory</label><span class="meta-path">' + escapeHtmlClient(proc.workingDirectory) + '</span></div>';
    }
    if (startTime) {
        html += '<div class="meta-item"><label>Started</label><span>' + startTime + '</span></div>';
    }
    if (endTime) {
        html += '<div class="meta-item"><label>Ended</label><span>' + endTime + '</span></div>';
    }
    html += '</div></div>';

    // Error
    if (error) {
        html += '<div class="error-alert">' + escapeHtmlClient(error) + '</div>';
    }

    // Conversation area — chat bubbles
    html += '<div class="conversation-section">' +
        '<div id="queue-task-conversation" class="conversation-body">';

    const turns = queueTaskConversationTurns;

    if (turns.length > 0) {
        for (let i = 0; i < turns.length; i++) {
            // Long conversation separator after 20 messages
            if (i === 20) {
                html += '<div class="chat-long-hint">Showing all messages. ' +
                    '<button class="scroll-to-bottom" onclick="scrollConversationToBottom()">Jump to latest \u2193</button></div>';
            }
            html += renderChatMessage(turns[i]);
        }
    } else if (proc && proc.result && !isRunning) {
        // Backward compatibility: no conversationTurns, build synthetic bubbles
        const userContent = proc.fullPrompt || proc.promptPreview;
        if (userContent) {
            html += renderChatMessage({
                role: 'user',
                content: userContent,
                timestamp: proc.startTime || undefined,
                timeline: [],
            });
        }
        html += renderChatMessage({
            role: 'assistant',
            content: proc.result,
            timestamp: proc.endTime || undefined,
            timeline: [],
        });
    } else if (queueTaskStreamContent) {
        // Streaming in progress with no parsed turns — legacy path
        html += renderChatMessage({
            role: 'assistant',
            content: queueTaskStreamContent,
            streaming: true,
            timeline: [],
        });
    } else if (isRunning) {
        html += '<div class="conversation-waiting">Waiting for response...</div>';
    } else {
        html += '<div class="conversation-waiting">No conversation data available.</div>';
    }

    // Scroll-to-bottom floating button (hidden by default)
    html += '<button id="scroll-to-bottom-btn" class="scroll-to-bottom" onclick="scrollConversationToBottom()">\u2193 New messages</button>';

    html += '</div></div>';

    // First-time hint (above input bar)
    if (!localStorage.getItem('coc-chat-hint-dismissed') && !isRunning) {
        html += '<div id="chat-hint" class="chat-hint">' +
            '\u{1F4A1} You can send follow-up messages to continue the conversation. ' +
            '<button class="chat-hint-dismiss" onclick="dismissChatHint()">\u2715</button></div>';
    }

    // Chat input bar
    const inputDisabled = (status === 'running' && queueState.isFollowUpStreaming) ||
        status === 'queued' || status === 'cancelled';
    const placeholderText = getInputPlaceholder(status);

    html += '<div class="chat-input-bar' + (inputDisabled ? ' disabled' : '') + '">' +
        '<textarea id="chat-input" rows="1" placeholder="' + escapeHtmlClient(placeholderText) + '"' +
        (inputDisabled ? ' disabled' : '') + '></textarea>' +
        '<button id="chat-send-btn" class="send-btn" title="Send message"' +
        (inputDisabled ? ' disabled' : '') + '>\u27A4</button>' +
        '</div>';

    // Action buttons — only render if there's content
    if (originalTaskPath && originalWorkspaceId && proc && proc.result && !isRunning) {
        html += '<div class="action-buttons">' +
            '<button class="action-btn action-btn-primary" ' +
            'id="apply-changes-btn" ' +
            'data-task-path="' + escapeHtmlClient(originalTaskPath) + '" ' +
            'data-workspace-id="' + escapeHtmlClient(originalWorkspaceId) + '">' +
            '\u{1F4DD} Apply Changes</button>' +
            '</div>';
    }

    contentEl.innerHTML = html;

    // Attach tool call toggle event handlers
    attachToolCallToggleHandlers(contentEl);

    // Wire up info toggle button
    const infoBtn = document.getElementById('meta-info-toggle');
    const infoPopover = document.getElementById('meta-popover');
    if (infoBtn && infoPopover) {
        infoBtn.addEventListener('click', function() {
            infoPopover.classList.toggle('hidden');
            infoBtn.classList.toggle('active');
        });
    }

    // Wire up Apply Changes button if present
    const applyBtn = document.getElementById('apply-changes-btn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            const taskPath = applyBtn.getAttribute('data-task-path') || '';
            const wsId = applyBtn.getAttribute('data-workspace-id') || '';
            if (taskPath && wsId && proc && proc.result) {
                applyWriteBack(wsId, taskPath, proc.result, applyBtn);
            }
        });
    }

    // Reset scroll tracking on re-render
    userHasScrolledUp = false;

    // Auto-scroll to bottom if streaming
    if (isRunning) {
        scrollConversationToBottom();
    }

    // Attach scroll listener for scroll-to-bottom button visibility
    initScrollToBottomTracking();

    // Wire chat input handlers
    initChatInputHandlers(processId);
}

function getInputPlaceholder(status: string): string {
    if (queueState.isFollowUpStreaming) return 'Waiting for response...';
    if (status === 'completed') return 'Continue this conversation...';
    if (status === 'queued') return 'Follow-ups available once task starts...';
    if (status === 'failed') return 'Retry or ask a follow-up...';
    if (status === 'running') return 'Waiting for response...';
    if (status === 'cancelled') return 'Task was cancelled';
    return 'Send a message...';
}

function initChatInputHandlers(processId: string): void {
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
    if (!textarea || !sendBtn) return;

    // Auto-grow textarea (1–4 lines)
    textarea.addEventListener('input', function() {
        textarea.style.height = 'auto';
        const maxHeight = parseInt(getComputedStyle(textarea).lineHeight || '20', 10) * 4;
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    });

    // Enter sends (or Ctrl+Enter if preference is off), Shift+Enter inserts newline
    textarea.addEventListener('keydown', function(e: KeyboardEvent) {
        const enterSends = chatEnterSend;
        if (enterSends && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const content = textarea.value.trim();
            if (content && !textarea.disabled) {
                dismissChatHint();
                sendFollowUpMessage(processId, content);
                textarea.value = '';
                textarea.style.height = 'auto';
            }
        } else if (!enterSends && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const content = textarea.value.trim();
            if (content && !textarea.disabled) {
                dismissChatHint();
                sendFollowUpMessage(processId, content);
                textarea.value = '';
                textarea.style.height = 'auto';
            }
        }
    });

    // Send button click
    sendBtn.addEventListener('click', function() {
        const content = textarea.value.trim();
        if (content && !textarea.disabled) {
            dismissChatHint();
            sendFollowUpMessage(processId, content);
            textarea.value = '';
            textarea.style.height = 'auto';
        }
    });
}

function sendFollowUpMessage(processId: string, content: string): void {
    if (!content.trim()) return;

    // Disable input bar
    setInputBarDisabled(true);
    queueState.isFollowUpStreaming = true;

    // Optimistic UI: append user bubble immediately
    const conversationEl = document.getElementById('queue-task-conversation');
    if (conversationEl) {
        const userTurn: ClientConversationTurn = {
            role: 'user',
            content: content,
            timestamp: new Date().toISOString(),
            timeline: [],
        };
        conversationEl.insertAdjacentHTML('beforeend', renderChatMessage(userTurn));

        // Append empty assistant bubble with streaming indicator
        const assistantBubble = document.createElement('div');
        assistantBubble.className = 'chat-message assistant streaming';
        assistantBubble.id = 'follow-up-assistant-bubble';
        assistantBubble.innerHTML = '<div class="chat-message-header">' +
            '<span class="role-icon">\u{1F916}</span>' +
            '<span class="role-label">Assistant</span>' +
            '<span class="streaming-indicator">\u25CF Live</span>' +
            '</div>' +
            '<div class="chat-message-content"></div>';
        conversationEl.appendChild(assistantBubble);

        scrollConversationToBottom();
    }

    // POST the message
    // Concurrent viewer note: multiple browser tabs may submit simultaneously.
    // The queue executor bridge processes follow-ups sequentially (single-threaded
    // Node.js). Last writer wins — both tabs see all SSE events.
    fetch(getApiBase() + '/processes/' + encodeURIComponent(processId) + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
    }).then(function(res) {
        if (res.status === 410) {
            // Session expired — show inline error bubble and disable input
            throw { sessionExpired: true };
        }
        if (!res.ok) throw new Error('Failed to send message: ' + res.status);
        return res.json();
    }).then(function(data) {
        // Success — connect SSE for the streaming response
        const turnIndex = data && data.turnIndex != null ? data.turnIndex : null;
        queueState.currentStreamingTurnIndex = turnIndex;
        connectFollowUpSSE(processId);
    }).catch(function(err) {
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;

        if (err && err.sessionExpired) {
            // Session expired — replace assistant bubble with error bubble, disable input permanently
            const bubble = document.getElementById('follow-up-assistant-bubble');
            if (bubble) { bubble.remove(); }
            const convEl = document.getElementById('queue-task-conversation');
            if (convEl) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'chat-error-bubble';
                errorDiv.textContent = '\u26A0\uFE0F Session expired. Start a new task to continue.';
                convEl.appendChild(errorDiv);
            }
            setInputBarDisabled(true);
            return;
        }

        // Generic error — mark the assistant bubble with error state
        setInputBarDisabled(false);

        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble) {
            bubble.classList.remove('streaming');
            bubble.classList.add('error');
            bubble.innerHTML = '<div class="bubble-error">' +
                escapeHtmlClient(err.message || 'Failed to send message') +
                '<button class="retry-btn" onclick="sendFollowUpMessage(\'' +
                escapeHtmlClient(processId) + '\', ' +
                escapeHtmlClient(JSON.stringify(content)) + ')">Retry</button></div>';
        }
    });
}

function connectFollowUpSSE(processId: string): void {
    const sseUrl = getApiBase() + '/processes/' + encodeURIComponent(processId) + '/stream';
    const eventSource = new EventSource(sseUrl);
    let accumulatedContent = '';
    let followUpCurrentSegment = '';
    const activeTaskToolCalls: string[] = [];

    eventSource.addEventListener('chunk', function(e: MessageEvent) {
        try {
            const data = JSON.parse(e.data);
            if (data.content) {
                accumulatedContent += data.content;
                followUpCurrentSegment += data.content;
                const bubble = document.getElementById('follow-up-assistant-bubble');
                if (bubble) {
                    bubble.classList.remove('streaming');
                    // Find the last content div (current segment after last tool call)
                    const contentDivs = bubble.querySelectorAll('.chat-message-content');
                    let lastContentDiv = contentDivs.length > 0 ? contentDivs[contentDivs.length - 1] : null;
                    if (!lastContentDiv) {
                        lastContentDiv = document.createElement('div');
                        lastContentDiv.className = 'chat-message-content';
                        bubble.appendChild(lastContentDiv);
                    }
                    lastContentDiv.innerHTML = renderMarkdownToHtml(followUpCurrentSegment);
                }
                scrollConversationToBottom();
            }
        } catch(err) {}
    });

    // Tool call events for follow-up streaming — inline chronologically
    eventSource.addEventListener('tool-start', function(e: MessageEvent) {
        try {
            const data = JSON.parse(e.data);
            const bubble = document.getElementById('follow-up-assistant-bubble');
            if (!bubble) return;

            // Reset current segment so subsequent chunks go into a new content div
            followUpCurrentSegment = '';

            const toolName = typeof data.toolName === 'string' ? data.toolName : '';
            const parentToolCallId = resolveParentToolCallId(data, activeTaskToolCalls, toolName);

            const tc = normalizeToolCall({
                id: data.toolCallId || '',
                toolName,
                args: data.parameters || {},
                status: 'running',
                startTime: new Date().toISOString(),
                parentToolCallId,
            });
            if (toolName === 'task' && tc.id) {
                activeTaskToolCalls.push(tc.id);
            }
            const card = renderToolCall(tc);
            appendStreamingToolCard(bubble, card, parentToolCallId);
            scrollConversationToBottom();
        } catch(err) {}
    });

    eventSource.addEventListener('tool-complete', function(e: MessageEvent) {
        try {
            const data = JSON.parse(e.data);
            const card = findToolCard(data.toolCallId);
            if (card) {
                const toolName = (typeof data.toolName === 'string' && data.toolName)
                    ? data.toolName
                    : (card.querySelector('.tool-call-name')?.textContent || '');
                updateToolCallStatus(card, {
                    id: data.toolCallId,
                    toolName,
                    args: {},
                    result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result),
                    status: 'completed',
                    endTime: new Date().toISOString(),
                });
                if (toolName === 'task') {
                    removeFromTaskStack(activeTaskToolCalls, data.toolCallId);
                }
            }
        } catch(err) {}
    });

    eventSource.addEventListener('tool-failed', function(e: MessageEvent) {
        try {
            const data = JSON.parse(e.data);
            const card = findToolCard(data.toolCallId);
            if (card) {
                const toolName = (typeof data.toolName === 'string' && data.toolName)
                    ? data.toolName
                    : (card.querySelector('.tool-call-name')?.textContent || '');
                updateToolCallStatus(card, {
                    id: data.toolCallId,
                    toolName,
                    args: {},
                    status: 'failed',
                    endTime: new Date().toISOString(),
                });
                if (toolName === 'task') {
                    removeFromTaskStack(activeTaskToolCalls, data.toolCallId);
                }
            }
        } catch(err) {}
    });

    eventSource.addEventListener('done', function() {
        eventSource.close();
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;
        setInputBarDisabled(false);

        // Remove the temporary id so future follow-ups get a fresh bubble
        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble) {
            bubble.removeAttribute('id');
        }

        // Update placeholder text
        const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (textarea) {
            textarea.placeholder = getInputPlaceholder('completed');
            textarea.focus();
        }
    });

    eventSource.addEventListener('status', function() {
        // Status change during follow-up — no full re-render needed
    });

    eventSource.addEventListener('heartbeat', function() {
        // Keep-alive — no action needed
    });

    eventSource.onerror = function() {
        eventSource.close();
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;
        setInputBarDisabled(false);

        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble && !accumulatedContent) {
            bubble.classList.remove('streaming');
            bubble.classList.add('error');
            bubble.innerHTML = '<div class="bubble-error">Connection lost. ' +
                '<button class="retry-btn" onclick="connectFollowUpSSE(\'' +
                escapeHtmlClient(processId) + '\')">Reconnect</button></div>';
        } else if (bubble) {
            // Partial content received — keep what we have, remove streaming state
            bubble.classList.remove('streaming');
            bubble.removeAttribute('id');
        }
    };
}

function setInputBarDisabled(disabled: boolean): void {
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
    const bar = textarea?.closest('.chat-input-bar');

    if (textarea) textarea.disabled = disabled;
    if (sendBtn) sendBtn.disabled = disabled;
    if (bar) {
        if (disabled) bar.classList.add('disabled');
        else bar.classList.remove('disabled');
    }

    // Update placeholder
    if (textarea) {
        const status = disabled ? 'running' : 'completed';
        textarea.placeholder = getInputPlaceholder(status);
    }
}

function connectQueueTaskSSE(processId: string, taskId: string, proc: any): void {
    // If process is already terminal, no need for SSE
    if (proc && proc.status !== 'running' && proc.status !== 'queued') {
        return;
    }

    const sseUrl = getApiBase() + '/processes/' + encodeURIComponent(processId) + '/stream';
    const eventSource = new EventSource(sseUrl);
    activeQueueTaskStream = eventSource;
    const activeTaskToolCalls: string[] = [];

    eventSource.addEventListener('chunk', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) {
            eventSource.close();
            return;
        }
        try {
            const data = JSON.parse(e.data);
            if (data.content) {
                queueTaskStreamContent += data.content;

                // Update or create the assistant turn in state (full content for caching)
                const turns = queueTaskConversationTurns;
                const fullContent = streamContentBeforeLastTool + queueTaskStreamContent;
                if (turns.length > 0 && turns[turns.length - 1].role === 'assistant') {
                    turns[turns.length - 1].content = fullContent;
                    turns[turns.length - 1].streaming = true;
                } else {
                    turns.push({
                        role: 'assistant',
                        content: fullContent,
                        streaming: true,
                        timeline: [],
                    });
                }

                updateStreamingContent();
                cacheConversation(processId, queueTaskConversationTurns);
            }
        } catch(err) {}
    });

    // Tool call events — render tool cards inline chronologically during streaming
    eventSource.addEventListener('tool-start', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) return;
        try {
            const data = JSON.parse(e.data);
            const bubble = getStreamingAssistantBubble();
            if (!bubble) return;

            // Snapshot current content so later chunks go into a new segment
            streamContentBeforeLastTool += queueTaskStreamContent;
            queueTaskStreamContent = '';

            const toolName = typeof data.toolName === 'string' ? data.toolName : '';
            const parentToolCallId = resolveParentToolCallId(data, activeTaskToolCalls, toolName);

            const tc = normalizeToolCall({
                id: data.toolCallId || '',
                toolName,
                args: data.parameters || {},
                status: 'running',
                startTime: new Date().toISOString(),
                parentToolCallId,
            });
            if (toolName === 'task' && tc.id) {
                activeTaskToolCalls.push(tc.id);
            }
            const card = renderToolCall(tc);
            appendStreamingToolCard(bubble, card, parentToolCallId);
            scrollConversationToBottom();
        } catch(err) {}
    });

    eventSource.addEventListener('tool-complete', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) return;
        try {
            const data = JSON.parse(e.data);
            const card = findToolCard(data.toolCallId);
            if (card) {
                const toolName = (typeof data.toolName === 'string' && data.toolName)
                    ? data.toolName
                    : (card.querySelector('.tool-call-name')?.textContent || '');
                updateToolCallStatus(card, {
                    id: data.toolCallId,
                    toolName,
                    args: {},
                    result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result),
                    status: 'completed',
                    endTime: new Date().toISOString(),
                });
                if (toolName === 'task') {
                    removeFromTaskStack(activeTaskToolCalls, data.toolCallId);
                }
            }
        } catch(err) {}
    });

    eventSource.addEventListener('tool-failed', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) return;
        try {
            const data = JSON.parse(e.data);
            const card = findToolCard(data.toolCallId);
            if (card) {
                const toolName = (typeof data.toolName === 'string' && data.toolName)
                    ? data.toolName
                    : (card.querySelector('.tool-call-name')?.textContent || '');
                updateToolCallStatus(card, {
                    id: data.toolCallId,
                    toolName,
                    args: {},
                    status: 'failed',
                    endTime: new Date().toISOString(),
                });
                if (toolName === 'task') {
                    removeFromTaskStack(activeTaskToolCalls, data.toolCallId);
                }
            }
        } catch(err) {}
    });

    eventSource.addEventListener('status', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) {
            eventSource.close();
            return;
        }
        try {
            const data = JSON.parse(e.data);
            // Mark streaming complete
            const turns = queueTaskConversationTurns;
            if (turns.length > 0 && turns[turns.length - 1].streaming) {
                turns[turns.length - 1].streaming = false;
            }
            // Invalidate cache so fresh server data replaces stale streaming state
            invalidateConversationCache(processId);
            // Refresh the full detail to show final state
            fetchApi('/processes/' + encodeURIComponent(processId)).then(function(result: any) {
                if (result && result.process) {
                    if (result.process.conversationTurns && result.process.conversationTurns.length > 0) {
                        setQueueTaskConversationTurns(result.process.conversationTurns);
                        cacheConversation(processId, result.process.conversationTurns);
                    }
                    renderQueueTaskConversation(processId, taskId, result.process);
                }
            });
        } catch(err) {}
    });

    eventSource.addEventListener('done', function(e: MessageEvent) {
        eventSource.close();
        activeQueueTaskStream = null;
    });

    eventSource.addEventListener('heartbeat', function(e: MessageEvent) {
        // Keep-alive — no action needed
    });

    eventSource.onerror = function() {
        // SSE connection failed — process may not exist yet (still queued)
        // Retry after a delay if process is still the active one
        eventSource.close();
        activeQueueTaskStream = null;

        if (queueTaskStreamProcessId === processId) {
            setTimeout(function() {
                if (queueTaskStreamProcessId === processId) {
                    // Re-check process status and reconnect if still running
                    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(result: any) {
                        if (result && result.process) {
                            if (result.process.status === 'running' || result.process.status === 'queued') {
                                connectQueueTaskSSE(processId, taskId, result.process);
                            } else {
                                // Process finished — render final state
                                renderQueueTaskConversation(processId, taskId, result.process);
                            }
                        } else {
                            // Process not found yet — retry
                            connectQueueTaskSSE(processId, taskId, null);
                        }
                    });
                }
            }, 2000);
        }
    };
}

/**
 * Get (or create) the streaming assistant bubble in the conversation container.
 */
function getStreamingAssistantBubble(): HTMLElement | null {
    const container = document.getElementById('queue-task-conversation');
    if (!container) return null;

    const bubbles = container.querySelectorAll('.chat-message.assistant');
    const lastBubble = bubbles.length > 0 ? (bubbles[bubbles.length - 1] as HTMLElement) : null;

    if (lastBubble) return lastBubble;

    // No assistant bubble yet — create one
    const streamingTurn: ClientConversationTurn = {
        role: 'assistant',
        content: '',
        streaming: true,
        timeline: [],
    };
    container.insertAdjacentHTML('beforeend', renderChatMessage(streamingTurn));
    const newBubbles = container.querySelectorAll('.chat-message.assistant');
    return newBubbles.length > 0 ? (newBubbles[newBubbles.length - 1] as HTMLElement) : null;
}

/**
 * Update the streaming content in the current (latest) content segment.
 * After a tool-start, a new content div is appended so subsequent text
 * appears *after* the tool call card — preserving chronological order.
 */
function updateStreamingContent(): void {
    const bubble = getStreamingAssistantBubble();
    if (!bubble) return;

    // Find the last .chat-message-content div in the bubble (the active segment)
    const contentDivs = bubble.querySelectorAll('.chat-message-content');
    let lastContentDiv = contentDivs.length > 0 ? contentDivs[contentDivs.length - 1] : null;

    if (!lastContentDiv) {
        // First content segment — create it
        lastContentDiv = document.createElement('div');
        lastContentDiv.className = 'chat-message-content';
        bubble.appendChild(lastContentDiv);
    }

    // Render only the current segment (queueTaskStreamContent) into the last div
    if (queueTaskStreamContent) {
        lastContentDiv.innerHTML = renderMarkdownToHtml(queueTaskStreamContent);
    }

    scrollConversationToBottom();
}

function scrollConversationToBottom(): void {
    const el = document.getElementById('queue-task-conversation');
    if (el) {
        // Respect auto-scroll preference and user scroll state
        if (!chatAutoScroll || userHasScrolledUp) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
}

/** Track scroll position to show/hide the scroll-to-bottom button. */
function initScrollToBottomTracking(): void {
    const el = document.getElementById('queue-task-conversation');
    const btn = document.getElementById('scroll-to-bottom-btn');
    if (!el || !btn) return;

    el.addEventListener('scroll', function() {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (atBottom) {
            userHasScrolledUp = false;
            btn.classList.remove('visible');
        } else {
            userHasScrolledUp = true;
            btn.classList.add('visible');
        }
    });
}

/** Dismiss the first-time chat hint and persist to localStorage. */
function dismissChatHint(): void {
    const hint = document.getElementById('chat-hint');
    if (hint) hint.remove();
    localStorage.setItem('coc-chat-hint-dismissed', '1');
}

/** Copy raw markdown from the bubble's data-raw attribute with brief "Copied" feedback. */
function handleMsgCopy(btn: HTMLElement): void {
    const bubble = btn.closest('.chat-message');
    if (!bubble) return;
    const raw = bubble.getAttribute('data-raw') || '';
    copyToClipboard(raw);
    const original = btn.textContent;
    btn.textContent = '\u2713 Copied';
    setTimeout(function() { btn.textContent = original; }, 1500);
}

export function copyQueueTaskResult(processId: string): void {
    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(data: any) {
        if (data && data.process && data.process.result) {
            copyToClipboard(data.process.result);
        }
    });
}

export function copyConversationOutput(processId: string): void {
    fetchApi('/processes/' + encodeURIComponent(processId) + '/output')
        .then(function(data: any) {
            if (data && data.content) {
                copyToClipboard(data.content);
            }
        });
}

/**
 * Write AI result back to the original task file.
 * Shows a confirmation dialog before overwriting.
 */
async function applyWriteBack(
    wsId: string,
    taskPath: string,
    content: string,
    btn: HTMLElement
): Promise<void> {
    const fileName = taskPath.split('/').pop() || taskPath;
    if (!confirm(
        'Apply AI changes to "' + fileName + '"?\n\n' +
        'This will overwrite the current file content with the AI result. ' +
        'This action cannot be undone.'
    )) {
        return;
    }

    // Disable button and show progress
    btn.setAttribute('disabled', 'true');
    btn.textContent = '\u23F3 Applying...';

    try {
        const response = await fetch(
            getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/tasks/content',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: taskPath, content }),
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(function() { return { error: 'Request failed' }; });
            throw new Error(data.error || 'Failed to apply changes');
        }

        // Success: lock button, show toast, refresh task list
        btn.textContent = '\u2705 Applied';
        btn.classList.add('action-btn-success');
        showToast('Changes applied to ' + fileName, 'success');

        // Refresh task tree to reflect updated file content
        if (typeof (window as any).fetchRepoTasks === 'function' && wsId) {
            (window as any).fetchRepoTasks(wsId);
        }
    } catch (err) {
        btn.removeAttribute('disabled');
        btn.textContent = '\u274C Failed \u2014 Retry';
        btn.classList.add('action-btn-error');
        const msg = err instanceof Error ? err.message : 'Unknown error';
        showToast('Failed to apply: ' + msg, 'error');
    }
}

function showToast(message: string, type: 'success' | 'error'): void {
    const existing = document.getElementById('writeback-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'writeback-toast';
    toast.className = 'writeback-toast writeback-toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        toast.classList.add('writeback-toast-hide');
        setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
}

// ================================================================
// Tool Call SSE Helpers
// ================================================================

/**
 * Find a tool-call card by its tool call ID across the entire detail panel.
 */
function findToolCard(toolCallId: string): HTMLElement | null {
    if (!toolCallId) return null;
    return document.querySelector('.tool-call-card[data-tool-id="' + toolCallId + '"]') as HTMLElement | null;
}

(window as any).clearDetail = clearDetail;
(window as any).copyQueueTaskResult = copyQueueTaskResult;
(window as any).copyConversationOutput = copyConversationOutput;
(window as any).showQueueTaskDetail = showQueueTaskDetail;
(window as any).sendFollowUpMessage = sendFollowUpMessage;
(window as any).connectFollowUpSSE = connectFollowUpSSE;
(window as any).scrollConversationToBottom = function() {
    // Force-scroll (called from UI buttons — override user preference)
    const el = document.getElementById('queue-task-conversation');
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }
    userHasScrolledUp = false;
    const btn = document.getElementById('scroll-to-bottom-btn');
    if (btn) btn.classList.remove('visible');
};
(window as any).dismissChatHint = dismissChatHint;
(window as any).handleMsgCopy = handleMsgCopy;
