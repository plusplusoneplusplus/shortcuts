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
import { navigateToProcess, fetchApi } from './core';

export function renderDetail(id: string): void {
    const process = appState.processes.find(function(p: any) { return p.id === id; });
    if (!process) { clearDetail(); return; }

    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');

    let duration = '';
    if (process.startTime) {
        const start = new Date(process.startTime).getTime();
        const end = process.endTime ? new Date(process.endTime).getTime() : Date.now();
        duration = formatDuration(end - start);
    }

    let html = '<div class="detail-header">' +
        '<h1>' + escapeHtmlClient(process.promptPreview || process.id || 'Process') + '</h1>' +
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
                    '<td>' + escapeHtmlClient((c.promptPreview || c.id || '').substring(0, 50)) + '</td>' +
                    '<td>' + escapeHtmlClient(typeLabel(c.type)) + '</td>' +
                    '<td>' + formatRelativeTime(c.startTime) + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }
    }

    // Result section
    if (process.result) {
        html += '<div class="result-section"><h2>Result</h2>' +
            '<div class="result-body">' + renderMarkdown(process.result) + '</div></div>';
    }

    if (process.structuredResult) {
        html += '<div class="result-section"><h2>Structured Result</h2>' +
            '<div class="result-body"><pre><code>' +
            escapeHtmlClient(JSON.stringify(process.structuredResult, null, 2)) +
            '</code></pre></div></div>';
    }

    // Prompt section (collapsible)
    if (process.fullPrompt) {
        html += '<details class="prompt-section"><summary>Prompt</summary>' +
            '<div class="prompt-body">' + escapeHtmlClient(process.fullPrompt) + '</div></details>';
    }

    // Conversation section for terminal processes
    const isTerminal = process.status === 'completed' || process.status === 'failed';
    if (isTerminal) {
        html += '<div id="process-conversation-section"></div>';
    }

    // Action buttons
    html += '<div class="action-buttons">';
    if (process.result) {
        html += '<button class="action-btn" onclick="copyToClipboard(appState.processes.find(function(p){return p.id===\'' +
            escapeHtmlClient(id) + '\'}).result||\'\')">' +
            '\u{1F4CB} Copy Result</button>';
    }
    html += '<button class="action-btn" onclick="copyToClipboard(location.origin+\'/process/' +
        escapeHtmlClient(id) + '\')">' +
        '\u{1F517} Copy Link</button>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Load conversation output asynchronously for terminal processes
    if (isTerminal) {
        const sectionEl = document.getElementById('process-conversation-section');
        if (sectionEl) {
            fetchApi('/processes/' + encodeURIComponent(id) + '/output')
                .then(function(data: any) {
                    if (data && data.content) {
                        sectionEl.innerHTML = '<div class="conversation-section"><h2>Conversation</h2>' +
                            '<div id="process-conversation" class="conversation-body">' +
                            renderMarkdown(data.content) + '</div>' +
                            '<button class="action-btn" onclick="copyConversationOutput(\'' +
                            escapeHtmlClient(id) + '\')">\u{1F4CB} Copy Conversation</button></div>';
                    } else {
                        sectionEl.innerHTML = '<div class="conversation-waiting">No conversation output saved.</div>';
                    }
                })
                .catch(function() {
                    sectionEl.innerHTML = '<div class="conversation-waiting">No conversation output saved.</div>';
                });
        }
    }
}

export function clearDetail(): void {
    // Clean up any active SSE connection
    closeQueueTaskStream();
    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (contentEl) { contentEl.classList.add('hidden'); contentEl.innerHTML = ''; }
}

// ================================================================
// Queue Task Detail — Conversation View with SSE Streaming
// ================================================================

let activeQueueTaskStream: EventSource | null = null;
let queueTaskStreamContent = '';
let queueTaskStreamProcessId: string | null = null;

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
    const processId = 'queue-' + taskId;

    // Close any previous stream
    closeQueueTaskStream();

    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');

    queueTaskStreamContent = '';
    queueTaskStreamProcessId = processId;

    // Reset conversation turns
    setQueueTaskConversationTurns([]);

    // First, try to fetch the process from the store for metadata
    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(data: any) {
        const proc = data && data.process ? data.process : null;

        // Populate conversation turns from process data
        if (proc && proc.conversationTurns && proc.conversationTurns.length > 0) {
            setQueueTaskConversationTurns(proc.conversationTurns);
        } else if (proc) {
            // Build synthetic turns from legacy fields
            const syntheticTurns: ClientConversationTurn[] = [];
            if (proc.promptPreview) {
                syntheticTurns.push({
                    role: 'user',
                    content: proc.promptPreview,
                    timestamp: proc.startTime || undefined,
                });
            }
            if (proc.result) {
                syntheticTurns.push({
                    role: 'assistant',
                    content: proc.result,
                    timestamp: proc.endTime || undefined,
                });
            }
            setQueueTaskConversationTurns(syntheticTurns);
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

    let html = '<div class="' + bubbleClass + '">';

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

    // Content
    html += '<div class="chat-message-content">' + renderMarkdown(turn.content || '') + '</div>';

    // Copy button (assistant messages only)
    if (!isUser && turn.content) {
        html += '<button class="bubble-copy-btn" onclick="copyToClipboard(' +
            escapeHtmlClient(JSON.stringify(turn.content)) +
            ')" title="Copy message">\u{1F4CB}</button>';
    }

    html += '</div>';
    return html;
}

function renderQueueTaskConversation(processId: string, taskId: string, proc: any): void {
    const contentEl = document.getElementById('detail-content');
    if (!contentEl) return;

    let name = '';
    let status = '';
    let prompt = '';
    let error = '';
    let startTime = '';
    let endTime = '';

    if (proc) {
        name = proc.promptPreview || proc.id || 'Queue Task';
        status = proc.status || 'running';
        prompt = proc.fullPrompt || '';
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

    let html = '<div class="detail-header">' +
        '<div class="detail-header-top">' +
            '<button class="detail-back-btn" onclick="clearDetail()" title="Back">\u2190</button>' +
            '<h1>' + escapeHtmlClient(name) + '</h1>' +
        '</div>' +
        '<span class="status-badge ' + statusClass + '">' +
            statusIcon(status) + ' ' + statusLabel(status) +
        '</span>' +
    '</div>';

    // Metadata — collapsed by default
    html += '<details class="meta-section">';
    html += '<summary class="meta-summary">';
    html += escapeHtmlClient(processId);
    if (proc && proc.metadata && proc.metadata.model) {
        html += ' \u00B7 ' + escapeHtmlClient(proc.metadata.model);
    }
    if (startTime) {
        html += ' \u00B7 ' + startTime;
    }
    html += '</summary>';
    html += '<div class="meta-grid">';
    html += '<div class="meta-item"><label>Process ID</label><span>' + escapeHtmlClient(processId) + '</span></div>';
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
    html += '</div>';
    html += '</details>';

    // Error
    if (error) {
        html += '<div class="error-alert">' + escapeHtmlClient(error) + '</div>';
    }

    // Prompt (collapsible)
    if (prompt) {
        html += '<details class="prompt-section"><summary>Prompt</summary>' +
            '<div class="prompt-body">' + escapeHtmlClient(prompt) + '</div></details>';
    }

    // Conversation area — chat bubbles
    html += '<div class="conversation-section">' +
        '<h2>Conversation</h2>' +
        '<div id="queue-task-conversation" class="conversation-body">';

    const turns = queueTaskConversationTurns;

    if (turns.length > 0) {
        for (let i = 0; i < turns.length; i++) {
            html += renderChatMessage(turns[i]);
        }
    } else if (proc && proc.result && !isRunning) {
        // Backward compatibility: no conversationTurns, build synthetic bubbles
        if (proc.promptPreview) {
            html += renderChatMessage({
                role: 'user',
                content: proc.promptPreview,
                timestamp: proc.startTime || undefined,
            });
        }
        html += renderChatMessage({
            role: 'assistant',
            content: proc.result,
            timestamp: proc.endTime || undefined,
        });
    } else if (queueTaskStreamContent) {
        // Streaming in progress with no parsed turns — legacy path
        html += renderChatMessage({
            role: 'assistant',
            content: queueTaskStreamContent,
            streaming: true,
        });
    } else if (isRunning) {
        html += '<div class="conversation-waiting">Waiting for response...</div>';
    } else {
        html += '<div class="conversation-waiting">No conversation data available.</div>';
    }

    html += '</div></div>';

    // Action buttons
    html += '<div class="action-buttons">';
    if (proc && proc.result) {
        html += '<button class="action-btn" onclick="copyQueueTaskResult(\'' + escapeHtmlClient(processId) + '\')">' +
            '\u{1F4CB} Copy Result</button>';
    }
    // Apply Changes button for completed "Update Document" tasks
    if (originalTaskPath && originalWorkspaceId && proc && proc.result && !isRunning) {
        html += '<button class="action-btn action-btn-primary" ' +
            'id="apply-changes-btn" ' +
            'data-task-path="' + escapeHtmlClient(originalTaskPath) + '" ' +
            'data-workspace-id="' + escapeHtmlClient(originalWorkspaceId) + '">' +
            '\u{1F4DD} Apply Changes</button>';
    }
    html += '</div>';

    contentEl.innerHTML = html;

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

    // Auto-scroll to bottom if streaming
    if (isRunning) {
        scrollConversationToBottom();
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

    eventSource.addEventListener('chunk', function(e: MessageEvent) {
        if (queueTaskStreamProcessId !== processId) {
            eventSource.close();
            return;
        }
        try {
            const data = JSON.parse(e.data);
            if (data.content) {
                queueTaskStreamContent += data.content;

                // Update the last assistant turn's content in state
                const turns = queueTaskConversationTurns;
                if (turns.length > 0 && turns[turns.length - 1].role === 'assistant') {
                    turns[turns.length - 1].content = queueTaskStreamContent;
                    turns[turns.length - 1].streaming = true;
                }

                updateConversationContent();
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
            // Refresh the full detail to show final state
            fetchApi('/processes/' + encodeURIComponent(processId)).then(function(result: any) {
                if (result && result.process) {
                    if (result.process.conversationTurns && result.process.conversationTurns.length > 0) {
                        setQueueTaskConversationTurns(result.process.conversationTurns);
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

function updateConversationContent(): void {
    const container = document.getElementById('queue-task-conversation');
    if (!container) return;

    // Find the last assistant bubble (the streaming one)
    const bubbles = container.querySelectorAll('.chat-message.assistant');
    const lastBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;

    if (lastBubble) {
        // Update only the content div inside the last assistant bubble
        const contentDiv = lastBubble.querySelector('.chat-message-content');
        if (contentDiv) {
            contentDiv.innerHTML = renderMarkdown(queueTaskStreamContent);
        }
    } else {
        // No assistant bubble yet — append one (streaming just started)
        const streamingTurn: ClientConversationTurn = {
            role: 'assistant',
            content: queueTaskStreamContent,
            streaming: true,
        };
        container.insertAdjacentHTML('beforeend', renderChatMessage(streamingTurn));
    }

    scrollConversationToBottom();
}

function scrollConversationToBottom(): void {
    const el = document.getElementById('queue-task-conversation');
    if (el) {
        el.scrollTop = el.scrollHeight;
    }
}

export function copyQueueTaskResult(processId: string): void {
    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(data: any) {
        if (data && data.process && data.process.result) {
            copyToClipboard(data.process.result);
        }
    });
}

// ================================================================
// Lightweight Markdown Renderer
// ================================================================

export function renderMarkdown(text: string): string {
    if (!text) return '';
    const lines = text.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeLang = '';
    let codeContent = '';
    let inList = false;
    let listType = '';
    let inBlockquote = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Fenced code blocks
        if (line.match(/^```/)) {
            if (inCodeBlock) {
                html += '<pre><code' + (codeLang ? ' class="language-' + codeLang + '"' : '') + '>' +
                    escapeHtmlClient(codeContent) + '</code></pre>';
                inCodeBlock = false;
                codeContent = '';
                codeLang = '';
            } else {
                if (inList) { html += '</' + listType + '>'; inList = false; }
                if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
                inCodeBlock = true;
                codeLang = line.replace(/^```/, '').trim();
            }
            continue;
        }
        if (inCodeBlock) {
            codeContent += (codeContent ? '\n' : '') + line;
            continue;
        }

        // Horizontal rule
        if (line.match(/^---+$/)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
            html += '<hr>';
            continue;
        }

        // Headers
        const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headerMatch) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; }
            const level = headerMatch[1].length;
            html += '<h' + level + '>' + inlineFormat(headerMatch[2]) + '</h' + level + '>';
            continue;
        }

        // Blockquote
        if (line.match(/^>\s?/)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
            html += inlineFormat(line.replace(/^>\s?/, '')) + '<br>';
            continue;
        } else if (inBlockquote) {
            html += '</blockquote>';
            inBlockquote = false;
        }

        // Unordered list
        if (line.match(/^[-*]\s+/)) {
            if (inList && listType !== 'ul') { html += '</' + listType + '>'; inList = false; }
            if (!inList) { html += '<ul>'; inList = true; listType = 'ul'; }
            html += '<li>' + inlineFormat(line.replace(/^[-*]\s+/, '')) + '</li>';
            continue;
        }

        // Ordered list
        const olMatch = line.match(/^\d+\.\s+(.+)$/);
        if (olMatch) {
            if (inList && listType !== 'ol') { html += '</' + listType + '>'; inList = false; }
            if (!inList) { html += '<ol>'; inList = true; listType = 'ol'; }
            html += '<li>' + inlineFormat(olMatch[1]) + '</li>';
            continue;
        }

        // End list if line doesn't match
        if (inList) { html += '</' + listType + '>'; inList = false; }

        // Blank line = paragraph break
        if (line.trim() === '') {
            html += '<br>';
            continue;
        }

        // Normal paragraph text
        html += '<p>' + inlineFormat(line) + '</p>';
    }

    // Close any open blocks
    if (inCodeBlock) {
        html += '<pre><code>' + escapeHtmlClient(codeContent) + '</code></pre>';
    }
    if (inList) html += '</' + listType + '>';
    if (inBlockquote) html += '</blockquote>';

    return html;
}

export function inlineFormat(text: string): string {
    // Inline code (before other formatting)
    text = text.replace(/`([^`]+)`/g, function(m: string, c: string) {
        return '<code>' + escapeHtmlClient(c) + '</code>';
    });
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return text;
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

(window as any).clearDetail = clearDetail;
(window as any).copyQueueTaskResult = copyQueueTaskResult;
(window as any).copyConversationOutput = copyConversationOutput;
(window as any).showQueueTaskDetail = showQueueTaskDetail;
